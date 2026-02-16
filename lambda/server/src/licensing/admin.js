import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { generateLicenseKey } from './license.js';
import { verifyToken, generateToken, requireRole } from '../middleware/auth.js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { makeApiCall } from '../salesforce/oauth.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// SSM helpers (backward-compat admin password fallback)
// ---------------------------------------------------------------------------

// Cached bcrypt hash of the SSM admin password (never store plaintext)
let ADMIN_PASSWORD_HASH = null;
let ssmClient = null;

function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return ssmClient;
}

/**
 * Load the admin password from SSM, hash it with bcrypt on first load, and
 * cache only the hash. The plaintext is never retained in memory beyond this
 * function scope.
 *
 * NOTE: This SSM fallback should be removed once a proper admin user exists
 * in the admin_users database table.
 */
async function loadAdminPasswordHash() {
  if (ADMIN_PASSWORD_HASH) return ADMIN_PASSWORD_HASH;
  console.log('Loading admin password from SSM...');
  const client = getSSMClient();
  const command = new GetParameterCommand({
    Name: '/marginarc/admin/password',
    WithDecryption: true
  });
  const response = await client.send(command);
  const plaintext = response.Parameter.Value;
  // Hash immediately and discard the plaintext
  ADMIN_PASSWORD_HASH = await bcrypt.hash(plaintext, 12);
  console.log('Admin password loaded from SSM and hashed with bcrypt');
  return ADMIN_PASSWORD_HASH;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whitelist of allowed sort columns per resource to prevent SQL injection */
const ALLOWED_SORT_COLUMNS = {
  customers: ['id', 'name', 'contact_email', 'sales_rep', 'status', 'industry', 'company_size', 'created_at'],
  licenses: ['id', 'customer_id', 'license_key', 'seats_licensed', 'expiry_date', 'status', 'license_type', 'created_at'],
  activations: ['id', 'license_id', 'org_id', 'org_name', 'activated_at', 'last_phone_home', 'seats_used'],
  audit_logs: ['id', 'admin_user', 'action', 'resource_type', 'resource_id', 'created_at'],
  admin_users: ['id', 'username', 'email', 'full_name', 'role', 'is_active', 'last_login', 'created_at'],
  settings: ['key', 'updated_at', 'updated_by']
};

/**
 * Parse React Admin query parameters (sort, range, filter).
 * React Admin sends: sort=["field","ASC"], range=[0,24], filter={...}
 */
function parseReactAdminParams(reqQuery, resource) {
  const sort = reqQuery.sort ? JSON.parse(reqQuery.sort) : ['id', 'ASC'];
  const range = reqQuery.range ? JSON.parse(reqQuery.range) : [0, 24];
  const filter = reqQuery.filter ? JSON.parse(reqQuery.filter) : {};

  // Validate sort field against whitelist
  const allowedCols = ALLOWED_SORT_COLUMNS[resource] || ['id'];
  const sortField = allowedCols.includes(sort[0]) ? sort[0] : 'id';
  const sortOrder = sort[1] === 'DESC' ? 'DESC' : 'ASC';

  return {
    sortField,
    sortOrder,
    rangeStart: range[0],
    rangeEnd: range[1],
    filter
  };
}

/**
 * Set the Content-Range header that React Admin's simpleRestProvider expects.
 * Format: "resource start-end/total"
 */
function setContentRange(res, resource, start, end, total) {
  res.set('Content-Range', `${resource} ${start}-${end}/${total}`);
  res.set('Access-Control-Expose-Headers', 'Content-Range');
}

/**
 * Insert an audit log entry for every write operation.
 */
async function logAudit(req, action, resourceType, resourceId, details) {
  try {
    const adminUser = req.user?.username || 'unknown';
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;
    await query(
      `INSERT INTO audit_logs (admin_user, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminUser, action, resourceType, String(resourceId || ''), details ? JSON.stringify(details) : null, ipAddress, userAgent]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// ---------------------------------------------------------------------------
// Push license changes to connected Salesforce orgs
// ---------------------------------------------------------------------------

/**
 * After a license is updated (seats, expiry, status), push the change to any
 * connected Salesforce org so the Fulcrum_License__c custom setting is updated
 * immediately rather than waiting for the next phone-home cycle.
 *
 * Best-effort: failures are logged but never block the admin API response.
 *
 * @param {object} license - The updated license row from the DB (RETURNING *)
 */
async function pushLicenseToConnectedOrgs(license) {
  try {
    // Find connected orgs: first by license_id (direct link), then by org_id match
    let connResult = await query(
      `SELECT org_id FROM salesforce_connections WHERE license_id = $1 AND status = 'active'`,
      [license.id]
    );

    // Fallback: if no direct license_id link, check if the license's org_id has a connection
    if (connResult.rows.length === 0 && license.org_id) {
      connResult = await query(
        `SELECT org_id FROM salesforce_connections WHERE org_id = $1 AND status = 'active'`,
        [license.org_id]
      );
    }

    if (connResult.rows.length === 0) {
      console.log(`No connected orgs for license ${license.id} (org_id=${license.org_id}), skipping push`);
      return;
    }

    for (const row of connResult.rows) {
      const orgId = row.org_id;
      try {
        // Query for the Fulcrum_License__c org-default record in the connected org
        const soql = encodeURIComponent(
          `SELECT Id FROM Fulcrum_License__c WHERE SetupOwnerId = '${orgId}'`
        );
        const qResult = await makeApiCall(
          orgId,
          'GET',
          `/services/data/v62.0/query?q=${soql}`
        );

        if (!qResult || !qResult.records || qResult.records.length === 0) {
          console.warn(`No Fulcrum_License__c org default found in org ${orgId}`);
          continue;
        }

        const recordId = qResult.records[0].Id;

        // Build the update payload — only send fields that are relevant
        const updatePayload = {};

        if (license.seats_licensed != null) {
          updatePayload.Seats_Licensed__c = license.seats_licensed;
        }
        if (license.expiry_date != null) {
          // Format as YYYY-MM-DD for Salesforce Date field
          const d = new Date(license.expiry_date);
          updatePayload.Expiry_Date__c = d.toISOString().split('T')[0];
        }
        if (license.status != null) {
          updatePayload.Status__c = license.status;
        }

        if (Object.keys(updatePayload).length === 0) {
          continue;
        }

        await makeApiCall(
          orgId,
          'PATCH',
          `/services/data/v62.0/sobjects/Fulcrum_License__c/${recordId}`,
          updatePayload
        );

        console.log(`Pushed license update to org ${orgId}:`, updatePayload);
      } catch (orgErr) {
        // Best-effort: log and continue with other orgs
        console.error(`Failed to push license update to org ${orgId}:`, orgErr.message);
      }
    }
  } catch (err) {
    console.error('Error in pushLicenseToConnectedOrgs:', err.message);
  }
}

// ---------------------------------------------------------------------------
// AUTH routes (no token required)
// ---------------------------------------------------------------------------

/**
 * POST /auth/login
 * Authenticate admin user. Tries admin_users table first (bcrypt), then SSM fallback.
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // --- Try admin_users table first ---
    let dbUser = null;
    try {
      const result = await query(
        'SELECT * FROM admin_users WHERE username = $1 AND is_active = true',
        [username]
      );
      dbUser = result.rows[0] || null;
    } catch (err) {
      // Table may not exist yet; fall through to SSM
      console.warn('admin_users lookup failed, falling back to SSM:', err.message);
    }

    if (dbUser) {
      const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
      if (passwordMatch) {
        // Update last_login
        await query('UPDATE admin_users SET last_login = NOW() WHERE id = $1', [dbUser.id]);

        const token = await generateToken(username, dbUser.role);
        await logAudit(req, 'login', 'admin_users', dbUser.id, { method: 'db' });
        return res.json({
          token,
          user: {
            id: dbUser.id,
            username: dbUser.username,
            fullName: dbUser.full_name,
            role: dbUser.role
          }
        });
      }
    }

    // --- Fallback: SSM password (bcrypt comparison, backward compat) ---
    // NOTE: This fallback should be removed once a proper admin user exists in the DB.
    try {
      const adminHash = await loadAdminPasswordHash();
      if (username === 'admin' && await bcrypt.compare(password, adminHash)) {
        const token = await generateToken(username, 'super_admin');
        await logAudit(req, 'login', 'admin_users', null, { method: 'ssm_fallback' });
        return res.json({
          token,
          user: {
            id: 0,
            username: 'admin',
            fullName: 'Admin (SSM)',
            role: 'super_admin'
          }
        });
      }
    } catch (ssmErr) {
      console.error('SSM fallback login failed:', ssmErr.message);
    }

    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * GET /auth/me
 * Return current user info from JWT. Used by React Admin authProvider checkAuth.
 */
router.get('/auth/me', verifyToken, async (req, res) => {
  try {
    const username = req.user?.username;
    let dbUser = null;
    try {
      const result = await query(
        'SELECT id, username, email, full_name, role, is_active, last_login FROM admin_users WHERE username = $1',
        [username]
      );
      dbUser = result.rows[0] || null;
    } catch (_) {
      // table may not exist
    }

    if (dbUser) {
      return res.json({
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        fullName: dbUser.full_name,
        role: dbUser.role
      });
    }

    // SSM fallback user
    return res.json({
      id: 0,
      username,
      fullName: 'Admin (SSM)',
      role: 'super_admin'
    });
  } catch (error) {
    console.error('Error in /auth/me:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /auth/refresh
 * Issue a new JWT if the current token is valid and not expired.
 * Supports key rotation: accepts tokens signed with the previous secret.
 */
router.post('/auth/refresh', verifyToken, async (req, res) => {
  try {
    const { username, role } = req.user;
    if (!username) {
      return res.status(400).json({ message: 'Invalid token payload' });
    }
    // Issue a fresh token with the current secret and updated expiry
    const token = await generateToken(username, role || 'super_admin');
    return res.json({ token });
  } catch (error) {
    console.error('Error refreshing token:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// All remaining routes require authentication
// ---------------------------------------------------------------------------
router.use(verifyToken);

// ===========================
// CUSTOMERS CRUD
// ===========================

router.get('/customers', async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'customers');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    // Exclude soft-deleted by default unless explicitly filtering for deleted
    if (filter.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(filter.status);
    } else {
      conditions.push(`(status IS NULL OR status != 'deleted')`);
    }

    if (filter.q) {
      conditions.push(`(name ILIKE $${paramIdx} OR contact_email ILIKE $${paramIdx})`);
      values.push(`%${filter.q}%`);
      paramIdx++;
    }

    if (filter.name) {
      conditions.push(`name ILIKE $${paramIdx++}`);
      values.push(`%${filter.name}%`);
    }

    if (filter.industry) {
      conditions.push(`industry = $${paramIdx++}`);
      values.push(filter.industry);
    }

    if (filter.sales_rep) {
      conditions.push(`sales_rep ILIKE $${paramIdx++}`);
      values.push(`%${filter.sales_rep}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countResult = await query(`SELECT COUNT(*) FROM customers ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Data query
    const dataResult = await query(
      `SELECT * FROM customers ${where} ORDER BY ${sortField} ${sortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'customers', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing customers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/customers/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/customers', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { name, contact_email, sales_rep, status, notes, company_size, website, industry } = req.body;
    if (!name || !contact_email) {
      return res.status(400).json({ message: 'name and contact_email are required' });
    }

    const result = await query(
      `INSERT INTO customers (name, contact_email, sales_rep, status, notes, company_size, website, industry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, contact_email, sales_rep || null, status || 'active', notes || null, company_size || null, website || null, industry || null]
    );

    const customer = result.rows[0];
    await logAudit(req, 'create', 'customers', customer.id, { name });
    return res.status(201).json(customer);
  } catch (error) {
    console.error('Error creating customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/customers/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { name, contact_email, sales_rep, status, notes, company_size, website, industry } = req.body;
    const result = await query(
      `UPDATE customers
       SET name = COALESCE($1, name),
           contact_email = COALESCE($2, contact_email),
           sales_rep = COALESCE($3, sales_rep),
           status = COALESCE($4, status),
           notes = COALESCE($5, notes),
           company_size = COALESCE($6, company_size),
           website = COALESCE($7, website),
           industry = COALESCE($8, industry)
       WHERE id = $9
       RETURNING *`,
      [name, contact_email, sales_rep, status, notes, company_size, website, industry, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const customer = result.rows[0];
    await logAudit(req, 'update', 'customers', customer.id, req.body);
    return res.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/customers/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    // Soft delete
    const result = await query(
      `UPDATE customers SET status = 'deleted' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const customer = result.rows[0];
    await logAudit(req, 'delete', 'customers', customer.id, { soft: true });
    return res.json(customer);
  } catch (error) {
    console.error('Error deleting customer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// LICENSES CRUD
// ===========================

router.get('/licenses', async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'licenses');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    if (filter.customer_id) {
      conditions.push(`l.customer_id = $${paramIdx++}`);
      values.push(filter.customer_id);
    }

    if (filter.status) {
      conditions.push(`l.status = $${paramIdx++}`);
      values.push(filter.status);
    }

    if (filter.license_type) {
      conditions.push(`l.license_type = $${paramIdx++}`);
      values.push(filter.license_type);
    }

    if (filter.q) {
      conditions.push(`(l.license_key ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
      values.push(`%${filter.q}%`);
      paramIdx++;
    }

    if (filter.expiring_within) {
      const days = parseInt(filter.expiring_within, 10);
      if (!isNaN(days)) {
        conditions.push(`l.expiry_date <= NOW() + INTERVAL '1 day' * $${paramIdx++}`);
        values.push(days);
        conditions.push(`l.expiry_date > NOW()`);
        conditions.push(`l.status = 'active'`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Prefix sort field with table alias for joined queries
    const qualifiedSort = ['customer_name'].includes(sortField) ? `c.name` : `l.${sortField}`;

    const countResult = await query(
      `SELECT COUNT(*) FROM licenses l LEFT JOIN customers c ON l.customer_id = c.id ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await query(
      `SELECT l.*, c.name as customer_name
       FROM licenses l
       LEFT JOIN customers c ON l.customer_id = c.id
       ${where}
       ORDER BY ${qualifiedSort} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'licenses', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing licenses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/licenses/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, c.name as customer_name
       FROM licenses l
       LEFT JOIN customers c ON l.customer_id = c.id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'License not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting license:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/licenses', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { customer_id, seats_licensed, expiry_date, license_type, notes } = req.body;

    if (!customer_id || !seats_licensed || !expiry_date) {
      return res.status(400).json({ message: 'customer_id, seats_licensed, and expiry_date are required' });
    }

    // Validate customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [customer_id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Validate expiry date
    const expiryDateObj = new Date(expiry_date);
    if (isNaN(expiryDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid expiry_date format. Use ISO format (YYYY-MM-DD)' });
    }

    // Generate license key using existing utility
    const licenseKey = await generateLicenseKey(customer_id, expiryDateObj, seats_licensed);

    const result = await query(
      `INSERT INTO licenses (customer_id, license_key, seats_licensed, expiry_date, status, license_type, notes)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
      [customer_id, licenseKey, seats_licensed, expiry_date, license_type || 'standard', notes || null]
    );

    const license = result.rows[0];

    // Re-fetch with customer name
    const full = await query(
      `SELECT l.*, c.name as customer_name FROM licenses l LEFT JOIN customers c ON l.customer_id = c.id WHERE l.id = $1`,
      [license.id]
    );

    await logAudit(req, 'create', 'licenses', license.id, { customer_id, seats_licensed, license_type });
    return res.status(201).json(full.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'License key collision. Please try again.' });
    }
    console.error('Error creating license:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/licenses/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { seats_licensed, expiry_date, status, license_type, notes } = req.body;

    // Build the UPDATE dynamically to avoid referencing columns that may not exist
    // if the 001_react_admin migration was never applied (notes, license_type).
    const sets = [];
    const values = [];
    let idx = 1;

    // Core columns (always present on the licenses table)
    sets.push(`seats_licensed = COALESCE($${idx}, seats_licensed)`);
    values.push(seats_licensed != null ? seats_licensed : null);
    idx++;

    sets.push(`expiry_date = COALESCE($${idx}, expiry_date)`);
    values.push(expiry_date != null ? expiry_date : null);
    idx++;

    sets.push(`status = COALESCE($${idx}, status)`);
    values.push(status != null ? status : null);
    idx++;

    // Optional columns added by migration — try to include them
    sets.push(`license_type = COALESCE($${idx}, license_type)`);
    values.push(license_type != null ? license_type : null);
    idx++;

    sets.push(`notes = COALESCE($${idx}, notes)`);
    values.push(notes != null ? notes : null);
    idx++;

    values.push(req.params.id);

    let result;
    try {
      result = await query(
        `UPDATE licenses SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
    } catch (sqlErr) {
      // If columns from the migration don't exist, fall back to core columns only
      if (sqlErr.message && (sqlErr.message.includes('notes') || sqlErr.message.includes('license_type'))) {
        console.warn('Optional columns missing, falling back to core-only license update');
        result = await query(
          `UPDATE licenses
           SET seats_licensed = COALESCE($1, seats_licensed),
               expiry_date = COALESCE($2, expiry_date),
               status = COALESCE($3, status)
           WHERE id = $4
           RETURNING *`,
          [seats_licensed, expiry_date, status, req.params.id]
        );
      } else {
        throw sqlErr;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'License not found' });
    }

    // Re-fetch with customer name
    const full = await query(
      `SELECT l.*, c.name as customer_name FROM licenses l LEFT JOIN customers c ON l.customer_id = c.id WHERE l.id = $1`,
      [req.params.id]
    );

    await logAudit(req, 'update', 'licenses', req.params.id, req.body);

    // Push updated license data to connected Salesforce orgs (best-effort, non-blocking)
    const updatedLicense = result.rows[0];
    pushLicenseToConnectedOrgs(updatedLicense).catch(err =>
      console.error('Background push to SFDC orgs failed:', err.message)
    );

    return res.json(full.rows[0]);
  } catch (error) {
    console.error('Error updating license:', error);
    return res.status(500).json({ message: `License update failed: ${error.message}` });
  }
});

router.delete('/licenses/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const result = await query(
      `UPDATE licenses SET status = 'revoked' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'License not found' });
    }

    await logAudit(req, 'delete', 'licenses', req.params.id, { revoked: true });

    // Push revocation to connected Salesforce orgs (best-effort, non-blocking)
    const revokedLicense = result.rows[0];
    pushLicenseToConnectedOrgs(revokedLicense).catch(err =>
      console.error('Background push to SFDC orgs failed:', err.message)
    );

    // Re-fetch with customer name for consistent response shape
    const full = await query(
      `SELECT l.*, c.name as customer_name FROM licenses l LEFT JOIN customers c ON l.customer_id = c.id WHERE l.id = $1`,
      [req.params.id]
    );
    return res.json(full.rows[0]);
  } catch (error) {
    console.error('Error revoking license (DELETE):', error);
    return res.status(500).json({ message: `Revocation failed: ${error.message}` });
  }
});

/**
 * POST /licenses/:id/revoke
 * Revoke a license with a reason.
 */
router.post('/licenses/:id/revoke', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { reason } = req.body;

    // Try with notes column first; fall back to status-only update if notes column
    // doesn't exist (migration may not have been applied).
    let result;
    try {
      result = await query(
        `UPDATE licenses SET status = 'revoked', notes = COALESCE(notes, '') || $1 WHERE id = $2 RETURNING *`,
        [reason ? `\n[Revoked] ${reason}` : '\n[Revoked]', req.params.id]
      );
    } catch (sqlErr) {
      // Column "notes" may not exist — fall back to status-only update
      if (sqlErr.message && sqlErr.message.includes('notes')) {
        console.warn('notes column not available, falling back to status-only revoke');
        result = await query(
          `UPDATE licenses SET status = 'revoked' WHERE id = $1 RETURNING *`,
          [req.params.id]
        );
      } else {
        throw sqlErr;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'License not found' });
    }

    await logAudit(req, 'revoke', 'licenses', req.params.id, { reason });

    // Push revocation to connected Salesforce orgs (best-effort, non-blocking)
    const revokedLicense = result.rows[0];
    pushLicenseToConnectedOrgs(revokedLicense).catch(err =>
      console.error('Background push to SFDC orgs failed:', err.message)
    );

    // Re-fetch with customer name for consistent response shape
    const full = await query(
      `SELECT l.*, c.name as customer_name FROM licenses l LEFT JOIN customers c ON l.customer_id = c.id WHERE l.id = $1`,
      [req.params.id]
    );
    return res.json(full.rows[0]);
  } catch (error) {
    console.error('Error revoking license (POST):', error);
    return res.status(500).json({ message: `Revocation failed: ${error.message}` });
  }
});

/**
 * POST /licenses/:id/renew
 * Extend license expiry date.
 */
router.post('/licenses/:id/renew', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { expiry_date } = req.body;
    if (!expiry_date) {
      return res.status(400).json({ message: 'expiry_date is required' });
    }

    const expiryDateObj = new Date(expiry_date);
    if (isNaN(expiryDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid expiry_date format' });
    }

    const result = await query(
      `UPDATE licenses SET expiry_date = $1, status = 'active' WHERE id = $2 RETURNING *`,
      [expiry_date, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'License not found' });
    }

    await logAudit(req, 'renew', 'licenses', req.params.id, { new_expiry: expiry_date });

    // Push renewal to connected Salesforce orgs (best-effort, non-blocking)
    const renewedLicense = result.rows[0];
    pushLicenseToConnectedOrgs(renewedLicense).catch(err =>
      console.error('Background push to SFDC orgs failed:', err.message)
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error renewing license:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// ACTIVATIONS (read-only)
// ===========================

router.get('/activations', async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'activations');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    if (filter.license_id) {
      conditions.push(`a.license_id = $${paramIdx++}`);
      values.push(filter.license_id);
    }

    if (filter.org_id) {
      conditions.push(`a.org_id ILIKE $${paramIdx++}`);
      values.push(`%${filter.org_id}%`);
    }

    if (filter.q) {
      conditions.push(`(a.org_id ILIKE $${paramIdx} OR a.org_name ILIKE $${paramIdx})`);
      values.push(`%${filter.q}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*)
       FROM license_activations a
       LEFT JOIN licenses l ON a.license_id = l.id
       LEFT JOIN customers c ON l.customer_id = c.id
       ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await query(
      `SELECT a.*, l.license_key, l.status as license_status, c.name as customer_name
       FROM license_activations a
       LEFT JOIN licenses l ON a.license_id = l.id
       LEFT JOIN customers c ON l.customer_id = c.id
       ${where}
       ORDER BY a.${sortField} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'activations', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing activations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/activations/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT a.*, l.license_key, l.status as license_status, c.name as customer_name
       FROM license_activations a
       LEFT JOIN licenses l ON a.license_id = l.id
       LEFT JOIN customers c ON l.customer_id = c.id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Activation not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting activation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// AUDIT LOGS (read-only)
// ===========================

router.get('/audit-logs', async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'audit_logs');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    if (filter.admin_user) {
      conditions.push(`admin_user = $${paramIdx++}`);
      values.push(filter.admin_user);
    }

    if (filter.action) {
      conditions.push(`action = $${paramIdx++}`);
      values.push(filter.action);
    }

    if (filter.resource_type) {
      conditions.push(`resource_type = $${paramIdx++}`);
      values.push(filter.resource_type);
    }

    if (filter.date_gte) {
      conditions.push(`created_at >= $${paramIdx++}`);
      values.push(filter.date_gte);
    }

    if (filter.date_lte) {
      conditions.push(`created_at <= $${paramIdx++}`);
      values.push(filter.date_lte);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*) FROM audit_logs ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await query(
      `SELECT * FROM audit_logs ${where} ORDER BY ${sortField} ${sortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'audit-logs', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing audit logs:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/audit-logs/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM audit_logs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Audit log not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting audit log:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// DASHBOARD
// ===========================

router.get('/dashboard/stats', async (req, res) => {
  try {
    const [customersResult, licensesResult, expiringResult, seatsResult] = await Promise.all([
      query(`SELECT
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE status = 'active' OR status IS NULL) as active
             FROM customers WHERE status IS NULL OR status != 'deleted'`),
      query(`SELECT
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE status = 'active') as active
             FROM licenses`),
      query(`SELECT COUNT(*) as count
             FROM licenses
             WHERE status = 'active'
               AND expiry_date <= NOW() + INTERVAL '30 days'
               AND expiry_date > NOW()`),
      query(`SELECT COALESCE(SUM(seats_licensed), 0) as total FROM licenses WHERE status = 'active'`)
    ]);

    return res.json({
      totalCustomers: parseInt(customersResult.rows[0].total, 10),
      activeCustomers: parseInt(customersResult.rows[0].active, 10),
      totalLicenses: parseInt(licensesResult.rows[0].total, 10),
      activeLicenses: parseInt(licensesResult.rows[0].active, 10),
      expiringLicenses30d: parseInt(expiringResult.rows[0].count, 10),
      totalSeats: parseInt(seatsResult.rows[0].total, 10)
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/dashboard/activity', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20'
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dashboard activity:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/dashboard/expiring', async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, c.name as customer_name
       FROM licenses l
       LEFT JOIN customers c ON l.customer_id = c.id
       WHERE l.status = 'active'
         AND l.expiry_date <= NOW() + INTERVAL '30 days'
         AND l.expiry_date > NOW()
       ORDER BY l.expiry_date ASC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching expiring licenses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// ADMIN USERS CRUD
// ===========================

router.get('/admin-users', requireRole('super_admin'), async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'admin_users');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    if (filter.q) {
      conditions.push(`(username ILIKE $${paramIdx} OR full_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`);
      values.push(`%${filter.q}%`);
      paramIdx++;
    }

    if (filter.role) {
      conditions.push(`role = $${paramIdx++}`);
      values.push(filter.role);
    }

    if (filter.is_active !== undefined) {
      conditions.push(`is_active = $${paramIdx++}`);
      values.push(filter.is_active);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*) FROM admin_users ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await query(
      `SELECT id, username, email, full_name, role, is_active, last_login, created_at, updated_at
       FROM admin_users ${where}
       ORDER BY ${sortField} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'admin-users', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing admin users:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/admin-users/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, email, full_name, role, is_active, last_login, created_at, updated_at FROM admin_users WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting admin user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/admin-users', requireRole('super_admin'), async (req, res) => {
  try {
    const { username, password, email, full_name, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }

    // Validate role
    const validRoles = ['super_admin', 'admin', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO admin_users (username, password_hash, email, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, is_active, last_login, created_at, updated_at`,
      [username, passwordHash, email || null, full_name || null, role || 'admin']
    );

    const user = result.rows[0];
    await logAudit(req, 'create', 'admin_users', user.id, { username, role: role || 'admin' });
    return res.status(201).json(user);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username already exists' });
    }
    console.error('Error creating admin user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/admin-users/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const { username, email, full_name, role, is_active } = req.body;

    // Validate role if provided
    if (role !== undefined) {
      const validRoles = ['super_admin', 'admin', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
    }

    // Build dynamic update (no password — use dedicated password reset endpoint)
    const sets = [];
    const values = [];
    let paramIdx = 1;

    if (username !== undefined) {
      sets.push(`username = $${paramIdx++}`);
      values.push(username);
    }
    if (email !== undefined) {
      sets.push(`email = $${paramIdx++}`);
      values.push(email);
    }
    if (full_name !== undefined) {
      sets.push(`full_name = $${paramIdx++}`);
      values.push(full_name);
    }
    if (role !== undefined) {
      sets.push(`role = $${paramIdx++}`);
      values.push(role);
    }
    if (is_active !== undefined) {
      sets.push(`is_active = $${paramIdx++}`);
      values.push(is_active);
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    sets.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await query(
      `UPDATE admin_users SET ${sets.join(', ')} WHERE id = $${paramIdx}
       RETURNING id, username, email, full_name, role, is_active, last_login, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    await logAudit(req, 'update', 'admin_users', user.id, { fields: Object.keys(req.body) });
    return res.json(user);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username already exists' });
    }
    console.error('Error updating admin user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * PUT /admin-users/:id/password
 * Reset password for an admin user. Allowed for super_admin (any user) or self.
 */
router.put('/admin-users/:id/password', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const callerRole = req.user?.role;
    const callerUsername = req.user?.username;

    // Look up caller's ID from the database
    let callerId = null;
    try {
      const callerResult = await query(
        'SELECT id FROM admin_users WHERE username = $1',
        [callerUsername]
      );
      if (callerResult.rows.length > 0) {
        callerId = callerResult.rows[0].id;
      }
    } catch (_) {
      // fall through
    }

    // Authorization: super_admin can reset anyone, others can only reset themselves
    const isSelf = callerId === targetId;
    if (callerRole !== 'super_admin' && !isSelf) {
      return res.status(403).json({ message: 'Forbidden: only super_admin or the user themselves can reset their password' });
    }

    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password is required and must be at least 6 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, email, full_name, role, is_active, last_login, created_at, updated_at`,
      [passwordHash, targetId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    await logAudit(req, 'password_reset', 'admin_users', user.id, { by: isSelf ? 'self' : 'super_admin' });
    return res.json(user);
  } catch (error) {
    console.error('Error resetting admin user password:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/admin-users/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    // Prevent self-deletion
    const callerUsername = req.user?.username;
    let callerId = null;
    try {
      const callerResult = await query(
        'SELECT id FROM admin_users WHERE username = $1',
        [callerUsername]
      );
      if (callerResult.rows.length > 0) {
        callerId = callerResult.rows[0].id;
      }
    } catch (_) {
      // fall through
    }

    if (callerId === targetId) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Deactivate rather than hard delete
    const result = await query(
      `UPDATE admin_users SET is_active = false, updated_at = NOW() WHERE id = $1
       RETURNING id, username, email, full_name, role, is_active, last_login, created_at, updated_at`,
      [targetId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    await logAudit(req, 'deactivate', 'admin_users', user.id, { deactivated: true });
    return res.json(user);
  } catch (error) {
    console.error('Error deactivating admin user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// SETTINGS
// ===========================

router.get('/settings', async (req, res) => {
  try {
    const { sortField, sortOrder, rangeStart, rangeEnd, filter } = parseReactAdminParams(req.query, 'settings');
    const limit = rangeEnd - rangeStart + 1;
    const offset = rangeStart;

    const conditions = [];
    const values = [];
    let paramIdx = 1;

    if (filter.q) {
      conditions.push(`(key ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
      values.push(`%${filter.q}%`);
      paramIdx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*) FROM settings ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Settings use 'key' as primary identifier; map to 'id' for React Admin
    const dataResult = await query(
      `SELECT key as id, key, value, description, updated_at, updated_by
       FROM settings ${where}
       ORDER BY ${sortField} ${sortOrder}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    );

    setContentRange(res, 'settings', rangeStart, Math.min(rangeEnd, total - 1), total);
    return res.json(dataResult.rows);
  } catch (error) {
    console.error('Error listing settings:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/settings/:key', async (req, res) => {
  try {
    const result = await query(
      'SELECT key as id, key, value, description, updated_at, updated_by FROM settings WHERE key = $1',
      [req.params.key]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Setting not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting setting:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/settings/:key', requireRole('super_admin'), async (req, res) => {
  try {
    const { value, description } = req.body;
    if (value === undefined) {
      return res.status(400).json({ message: 'value is required' });
    }

    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
    const adminUser = req.user?.username || 'unknown';

    const result = await query(
      `INSERT INTO settings (key, value, description, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, description = COALESCE($3, settings.description), updated_by = $4, updated_at = NOW()
       RETURNING key as id, key, value, description, updated_at, updated_by`,
      [req.params.key, jsonValue, description || null, adminUser]
    );

    const setting = result.rows[0];
    await logAudit(req, 'update', 'settings', req.params.key, { value: jsonValue });
    return res.json(setting);
  } catch (error) {
    console.error('Error updating setting:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ===========================
// DOC USERS MANAGEMENT
// ===========================

router.get('/doc-users', async (req, res) => {
  try {
    const { status } = req.query;

    let sql = `
      SELECT du.id, du.email, du.first_name, du.last_name, du.company,
             du.status, du.customer_id, du.approved_by, du.approved_at,
             du.created_at, du.last_login, c.name as customer_name
      FROM doc_users du
      LEFT JOIN customers c ON du.customer_id = c.id
    `;
    const values = [];

    if (status) {
      sql += ' WHERE du.status = $1';
      values.push(status);
    }

    sql += ' ORDER BY du.created_at DESC';

    const result = await query(sql, values);
    return res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('Error listing doc users:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/doc-users/pending-count', async (req, res) => {
  try {
    const result = await query("SELECT COUNT(*) FROM doc_users WHERE status = 'pending'");
    const count = parseInt(result.rows[0].count, 10);
    return res.json({ success: true, count });
  } catch (error) {
    console.error('Error getting pending doc user count:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/doc-users/:id/approve', async (req, res) => {
  try {
    const approvedBy = req.user?.username || 'unknown';
    const result = await query(
      `UPDATE doc_users
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, company, status, customer_id, approved_by, approved_at, created_at, last_login`,
      [approvedBy, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Doc user not found' });
    }

    const user = result.rows[0];
    await logAudit(req, 'approve', 'doc_users', user.id, { email: user.email });
    return res.json({ success: true, user });
  } catch (error) {
    console.error('Error approving doc user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/doc-users/:id/reject', async (req, res) => {
  try {
    const result = await query(
      `UPDATE doc_users SET status = 'rejected' WHERE id = $1
       RETURNING id, email, first_name, last_name, company, status, customer_id, approved_by, approved_at, created_at, last_login`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Doc user not found' });
    }

    const user = result.rows[0];
    await logAudit(req, 'reject', 'doc_users', user.id, { email: user.email });
    return res.json({ success: true, user });
  } catch (error) {
    console.error('Error rejecting doc user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/doc-users/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM doc_users WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Doc user not found' });
    }

    await logAudit(req, 'delete', 'doc_users', req.params.id, { email: result.rows[0].email });
    return res.json({ success: true, message: 'Doc user deleted' });
  } catch (error) {
    console.error('Error deleting doc user:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
