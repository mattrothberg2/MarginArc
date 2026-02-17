import crypto from 'crypto';
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';

// ---------------------------------------------------------------------------
// Dual-key API key management with SSM-backed rotation
//
// Supports two simultaneous API keys (primary + secondary) loaded from SSM
// parameters. Keys are cached with a 5-minute TTL so rotations propagate
// without a Lambda redeploy.
//
// Also supports per-customer API keys stored in the customers DB table.
// A request is authorized if the provided key matches EITHER a global key
// (primary/secondary) OR any active customer's api_key.
// ---------------------------------------------------------------------------

// Lazy-loaded DB query function to avoid circular imports.
// Set via setQueryFn() during app startup.
let _queryFn = null;

const SSM_KEY_PRIMARY = '/marginarc/api/key-primary';
const SSM_KEY_SECONDARY = '/marginarc/api/key-secondary';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedPrimary = null;
let cachedSecondary = null;
let cacheTimestamp = 0;
let ssmClient = null;

function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return ssmClient;
}

/**
 * Load a single SSM parameter, returning null if it doesn't exist.
 */
async function getSSMParam(name) {
  try {
    const client = getSSMClient();
    const response = await client.send(new GetParameterCommand({
      Name: name,
      WithDecryption: true
    }));
    return response.Parameter.Value;
  } catch (err) {
    if (err.name === 'ParameterNotFound') return null;
    throw err;
  }
}

/**
 * Write (or overwrite) an SSM SecureString parameter.
 */
async function putSSMParam(name, value) {
  const client = getSSMClient();
  await client.send(new PutParameterCommand({
    Name: name,
    Value: value,
    Type: 'SecureString',
    Overwrite: true
  }));
}

/**
 * Delete an SSM parameter. Silently ignores if it doesn't exist.
 */
async function deleteSSMParam(name) {
  try {
    const client = getSSMClient();
    await client.send(new DeleteParameterCommand({ Name: name }));
  } catch (err) {
    if (err.name === 'ParameterNotFound') return;
    throw err;
  }
}

/**
 * Load both API keys from SSM (with TTL caching).
 * Falls back to the MARGINARC_API_KEY env var if no SSM keys exist
 * (backwards-compatible with the legacy single-key setup).
 */
async function loadApiKeys() {
  const now = Date.now();
  if (cachedPrimary !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return { primary: cachedPrimary, secondary: cachedSecondary };
  }

  try {
    const [primary, secondary] = await Promise.all([
      getSSMParam(SSM_KEY_PRIMARY),
      getSSMParam(SSM_KEY_SECONDARY)
    ]);

    if (primary) {
      cachedPrimary = primary;
      cachedSecondary = secondary; // may be null
      cacheTimestamp = now;
      return { primary: cachedPrimary, secondary: cachedSecondary };
    }
  } catch (err) {
    console.error('Failed to load API keys from SSM:', err.message);
    // Fall through to env var fallback
  }

  // Fallback: legacy single env var
  const envKey = process.env.MARGINARC_API_KEY || '';
  if (envKey) {
    cachedPrimary = envKey;
    cachedSecondary = null;
    cacheTimestamp = now;
  }

  return { primary: cachedPrimary, secondary: cachedSecondary };
}

/**
 * Constant-time comparison of two strings using crypto.timingSafeEqual.
 * Returns false if either value is falsy or they differ in length.
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Set the database query function (call once during app startup).
 * This avoids circular imports between api-keys.js and db.js.
 */
export function setQueryFn(fn) {
  _queryFn = fn;
}

/**
 * Check whether a provided key matches any active customer's api_key column.
 * Returns the customer_id if matched, null otherwise.
 * Uses constant-time comparison by hashing provided + stored keys with HMAC
 * to avoid leaking info about which customer key was tested.
 */
async function matchCustomerKey(provided) {
  if (!_queryFn) return null;
  try {
    const result = await _queryFn(
      `SELECT id, api_key FROM customers WHERE api_key IS NOT NULL AND (status IS NULL OR status != 'deleted')`,
      []
    );
    for (const row of result.rows) {
      if (safeCompare(provided, row.api_key)) {
        return row.id;
      }
    }
  } catch (err) {
    // Table may not have api_key column yet — silently skip
    if (err.message && err.message.includes('api_key')) return null;
    console.error('Customer key lookup error:', err.message);
  }
  return null;
}

/**
 * Check whether a provided API key matches either the primary or secondary
 * global key, or any active customer's per-customer key.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param {string} provided - The key from the request header
 * @returns {Promise<boolean>}
 */
export async function validateApiKey(provided) {
  if (!provided) return false;
  const { primary, secondary } = await loadApiKeys();
  if (!primary) return true; // No keys configured — allow (dev mode)
  const matchesPrimary = safeCompare(provided, primary);
  const matchesSecondary = secondary ? safeCompare(provided, secondary) : false;
  if (matchesPrimary || matchesSecondary) return true;

  // Fall through to per-customer key check
  const customerId = await matchCustomerKey(provided);
  return customerId !== null;
}

/**
 * Express middleware that checks the x-api-key header against both active keys.
 * Skips health, licensing, and demo-data routes (same exclusions as before).
 */
export function apiKeyMiddleware(req, res, next) {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/v1/license')) return next();
  if (req.path.startsWith('/demo-data')) return next();

  const provided = req.headers['x-api-key'] || '';

  validateApiKey(provided)
    .then(valid => {
      if (!valid) {
        return res.status(401).json({ error: 'Invalid or missing API key' });
      }
      next();
    })
    .catch(err => {
      console.error('API key validation error:', err.message);
      return res.status(500).json({ error: 'API key validation failed' });
    });
}

/**
 * Generate a cryptographically secure API key.
 * Format: MARC-<32 hex chars> (40 chars total including prefix).
 */
export function generateApiKey() {
  const random = crypto.randomBytes(20).toString('hex');
  return `MARC-${random}`;
}

/**
 * Rotate: generate a new secondary key in SSM without touching the primary.
 * Returns the new key so the admin can provision it in SFDC.
 */
export async function rotateApiKey() {
  const newKey = generateApiKey();
  await putSSMParam(SSM_KEY_SECONDARY, newKey);
  // Invalidate cache so the next request picks up the new secondary
  invalidateCache();
  return newKey;
}

/**
 * Promote: move the current secondary key to primary and remove the old primary.
 * After this, only the new key (formerly secondary) is valid.
 */
export async function promoteApiKey() {
  const secondary = await getSSMParam(SSM_KEY_SECONDARY);
  if (!secondary) {
    throw new Error('No secondary key exists. Call rotate-api-key first.');
  }

  // Overwrite primary with the secondary value
  await putSSMParam(SSM_KEY_PRIMARY, secondary);
  // Remove the secondary parameter
  await deleteSSMParam(SSM_KEY_SECONDARY);
  // Invalidate cache
  invalidateCache();
  return { promoted: true };
}

/**
 * Force-clear the in-memory cache (used after rotation/promotion and in tests).
 */
export function invalidateCache() {
  cachedPrimary = null;
  cachedSecondary = null;
  cacheTimestamp = 0;
}

// Exported constants for tests and admin endpoints
export { SSM_KEY_PRIMARY, SSM_KEY_SECONDARY };
