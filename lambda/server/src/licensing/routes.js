import express from 'express';
import { query } from './db.js';
import { validateLicenseKey } from './license.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// C4: Shared middleware — validates that a license_key is present in the
// request body and that it exists in the database. Applied to activate,
// validate, and telemetry endpoints so that unknown keys are rejected early.
// ---------------------------------------------------------------------------

/**
 * Middleware that checks the license_key field exists in req.body and that a
 * matching row is present in the licenses table. Attaches the license row to
 * req.license for downstream handlers to use.
 */
async function validateLicenseRequest(req, res, next) {
  const { license_key } = req.body || {};

  if (!license_key) {
    return res.status(400).json({
      success: false,
      message: 'license_key is required'
    });
  }

  // Quick format check before hitting the DB
  if (!validateLicenseKey(license_key)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid license key format or signature'
    });
  }

  // Verify key exists in the database
  try {
    const result = await query(
      `SELECT l.*, c.id as customer_id, c.name as customer_name
       FROM licenses l
       JOIN customers c ON l.customer_id = c.id
       WHERE l.license_key = $1`,
      [license_key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'License key not found'
      });
    }

    // Attach the license record for downstream handlers
    req.license = result.rows[0];
    next();
  } catch (error) {
    console.error('Error in validateLicenseRequest:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/license/health
 * Health check endpoint for licensing API
 */
router.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

/**
 * POST /api/v1/license/activate
 * Activate a license key for a Salesforce org.
 * C4: Uses validateLicenseRequest middleware to verify key exists in DB.
 */
router.post('/activate', validateLicenseRequest, async (req, res) => {
  try {
    const { license_key, org_id } = req.body;
    const license = req.license;

    // Validate org_id is provided
    if (!org_id) {
      return res.status(400).json({
        success: false,
        message: 'license_key and org_id are required'
      });
    }

    // Check if license is already activated for a different org
    if (license.org_id && license.org_id !== org_id) {
      return res.status(403).json({
        success: false,
        message: 'License key is already activated for a different org'
      });
    }

    // Check license status
    if (license.status === 'revoked') {
      return res.status(403).json({
        success: false,
        message: 'License key has been revoked'
      });
    }

    // Check expiry
    const now = new Date();
    const expiryDate = new Date(license.expiry_date);
    if (expiryDate < now) {
      // Update status to expired
      await query(
        'UPDATE licenses SET status = $1 WHERE license_key = $2',
        ['expired', license_key]
      );

      return res.status(403).json({
        success: false,
        message: 'License key has expired'
      });
    }

    // Activate the license
    const updateResult = await query(
      `UPDATE licenses
       SET status = $1,
           activated_at = COALESCE(activated_at, NOW()),
           last_validated_at = NOW(),
           org_id = $2
       WHERE license_key = $3
       RETURNING *`,
      ['active', org_id, license_key]
    );

    const activatedLicense = updateResult.rows[0];

    // Get customer config
    const configResult = await query(
      `SELECT * FROM customer_config WHERE customer_id = $1`,
      [license.customer_id]
    );

    const config = configResult.rows[0] || {
      gemini_api_key: null,
      fulcrum_api_url: 'https://api.marginarc.com/api/recommend',
      phone_home_interval_days: 7,
      features: {},
      settings: {}
    };

    // Return success with configuration
    res.json({
      success: true,
      config: {
        customer_id: license.customer_id,
        customer_name: license.customer_name,
        seats_licensed: activatedLicense.seats_licensed,
        expiry_date: activatedLicense.expiry_date,
        status: activatedLicense.status,
        gemini_api_key: config.gemini_api_key,
        fulcrum_api_url: config.fulcrum_api_url,
        phone_home_interval_days: config.phone_home_interval_days,
        features: config.features,
        settings: config.settings
      },
      message: 'License activated successfully'
    });

  } catch (error) {
    console.error('Error activating license:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/license/validate
 * Validate an existing license key (phone-home check).
 * C4: Uses validateLicenseRequest middleware to verify key exists in DB.
 */
router.post('/validate', validateLicenseRequest, async (req, res) => {
  try {
    const { license_key, org_id } = req.body;
    const license = req.license;

    // Validate org_id is provided
    if (!org_id) {
      return res.status(400).json({
        valid: false,
        message: 'license_key and org_id are required'
      });
    }

    // Check license status
    if (license.status === 'revoked') {
      return res.status(403).json({
        valid: false,
        message: 'License key has been revoked'
      });
    }

    // Check expiry
    const now = new Date();
    const expiryDate = new Date(license.expiry_date);
    if (expiryDate < now) {
      // Update status to expired
      await query(
        'UPDATE licenses SET status = $1 WHERE license_key = $2',
        ['expired', license_key]
      );

      return res.json({
        valid: false,
        message: 'License key has expired'
      });
    }

    // Auto-activate: if the license has no org_id yet (pending/new), bind it to
    // this org on first validate. This lets customers paste a key into the custom
    // setting and have it "just work" on the next phone-home or manual revalidate.
    if (!license.org_id && (license.status === 'pending' || !license.status)) {
      console.log(`Auto-activating license ${license.id} for org ${org_id}`);
      await query(
        `UPDATE licenses
         SET status = 'active',
             org_id = $1,
             activated_at = COALESCE(activated_at, NOW()),
             last_validated_at = NOW()
         WHERE license_key = $2`,
        [org_id, license_key]
      );
      // Reload the license so downstream code sees updated fields
      license.org_id = org_id;
      license.status = 'active';
    }

    // Check org_id match (after potential auto-activation)
    if (license.org_id !== org_id) {
      return res.status(403).json({
        valid: false,
        message: 'License key is not associated with this org'
      });
    }

    // Update last_validated_at
    await query(
      'UPDATE licenses SET last_validated_at = NOW() WHERE license_key = $1',
      [license_key]
    );

    // Get customer config
    const configResult = await query(
      `SELECT * FROM customer_config WHERE customer_id = $1`,
      [license.customer_id]
    );

    const config = configResult.rows[0] || {
      gemini_api_key: null,
      fulcrum_api_url: 'https://api.marginarc.com/api/recommend',
      phone_home_interval_days: 7,
      features: {},
      settings: {}
    };

    // Return success with latest config
    res.json({
      valid: true,
      config: {
        customer_id: license.customer_id,
        customer_name: license.customer_name,
        seats_licensed: license.seats_licensed,
        expiry_date: license.expiry_date,
        status: license.status,
        gemini_api_key: config.gemini_api_key,
        fulcrum_api_url: config.fulcrum_api_url,
        phone_home_interval_days: config.phone_home_interval_days,
        features: config.features,
        settings: config.settings
      },
      message: 'License is valid'
    });

  } catch (error) {
    console.error('Error validating license:', error);
    res.status(500).json({
      valid: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/telemetry
 * Receive telemetry data from Salesforce org.
 * C4: Uses validateLicenseRequest middleware. Additionally verifies the
 * license_key + org_id pair matches an active activation before accepting
 * telemetry data from the source.
 */
router.post('/telemetry', validateLicenseRequest, async (req, res) => {
  try {
    const { license_key, org_id, telemetry } = req.body;
    const license = req.license;

    // Validate required fields
    if (!org_id || !telemetry) {
      return res.status(400).json({
        received: false,
        message: 'license_key, org_id, and telemetry are required'
      });
    }

    // C4: Verify the license_key + org_id pair matches an active activation.
    // Reject telemetry from unknown or mismatched sources.
    if (license.org_id !== org_id) {
      return res.status(403).json({
        received: false,
        message: 'License key is not associated with this org'
      });
    }

    if (license.status !== 'active') {
      return res.status(403).json({
        received: false,
        message: 'License is not active'
      });
    }

    // Insert telemetry event
    await query(
      `INSERT INTO telemetry_events (license_key, org_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [license_key, org_id, 'phone_home', telemetry]
    );

    // Update last_validated_at
    await query(
      'UPDATE licenses SET last_validated_at = NOW() WHERE license_key = $1',
      [license_key]
    );

    res.json({
      received: true,
      message: 'Telemetry data received'
    });

  } catch (error) {
    console.error('Error receiving telemetry:', error);
    res.status(500).json({
      received: false,
      message: 'Internal server error'
    });
  }
});

export default router;
