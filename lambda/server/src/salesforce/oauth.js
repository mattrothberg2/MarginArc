/**
 * Salesforce OAuth 2.0 Web Server Flow
 *
 * Handles authorization, token exchange, refresh, and revocation for
 * connecting MarginArc Admin Portal to customer Salesforce orgs.
 */

import crypto from 'crypto';
import { query } from '../licensing/db.js';
import { getSSMParameter } from '../licensing/db.js';

// ---------------------------------------------------------------------------
// SSM-backed configuration (cached after first load)
// ---------------------------------------------------------------------------

let sfConsumerKey = null;
let sfConsumerSecret = null;
let encryptionKey = null; // AES-256-GCM key for token encryption at rest

async function loadConsumerKey() {
  if (sfConsumerKey) return sfConsumerKey;
  sfConsumerKey = await getSSMParameter('/marginarc/sf-consumer-key', true);
  console.log('Salesforce consumer key loaded from SSM');
  return sfConsumerKey;
}

async function loadConsumerSecret() {
  if (sfConsumerSecret) return sfConsumerSecret;
  sfConsumerSecret = await getSSMParameter('/marginarc/sf-consumer-secret', true);
  console.log('Salesforce consumer secret loaded from SSM');
  return sfConsumerSecret;
}

/**
 * Load or derive a 32-byte AES-256 encryption key for token-at-rest encryption.
 * Derives from the JWT secret to avoid adding another SSM parameter.
 */
async function loadEncryptionKey() {
  if (encryptionKey) return encryptionKey;
  const jwtSecret = await getSSMParameter('/marginarc/jwt/secret', true);
  // Derive a separate key so a JWT secret compromise doesn't directly leak tokens
  encryptionKey = crypto.createHash('sha256').update('marginarc-token-enc:' + jwtSecret).digest();
  return encryptionKey;
}

// ---------------------------------------------------------------------------
// AES-256-GCM helpers for token encryption at rest
// ---------------------------------------------------------------------------

async function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = await loadEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

async function decryptToken(encoded) {
  if (!encoded) return null;
  const key = await loadEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// OAuth URL construction
// ---------------------------------------------------------------------------

const SF_AUTH_BASE = 'https://login.salesforce.com';
const CALLBACK_URL = 'https://api.marginarc.com/oauth/callback';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generate a PKCE code_verifier (43-128 char URL-safe random string).
 */
export function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Derive the code_challenge from a code_verifier using SHA-256.
 */
export function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Build the Salesforce OAuth authorization URL with PKCE.
 * @param {string} state - Opaque state parameter (JWT with license_id, nonce, code_verifier)
 * @param {string} codeChallenge - PKCE code_challenge (S256)
 * @returns {Promise<string>} Full authorization URL
 */
export async function getAuthorizationUrl(state, codeChallenge) {
  const clientId = await loadConsumerKey();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    scope: 'api refresh_token',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${SF_AUTH_BASE}/services/oauth2/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange & refresh
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for access + refresh tokens using PKCE.
 * @param {string} code - Authorization code from callback
 * @param {string} codeVerifier - PKCE code_verifier
 * @returns {Promise<object>} { access_token, refresh_token, instance_url, id, ... }
 */
export async function exchangeCodeForTokens(code, codeVerifier) {
  const clientId = await loadConsumerKey();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    code_verifier: codeVerifier
  });

  const res = await fetch(`${SF_AUTH_BASE}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Token exchange failed:', res.status, err);
    throw new Error(`MarginArc OAuth token exchange failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Refresh an access token using a refresh token.
 * @param {string} refreshToken - Salesforce refresh token (plaintext)
 * @returns {Promise<object>} { access_token, instance_url, ... }
 */
export async function refreshAccessToken(refreshToken) {
  const [clientId, clientSecret] = await Promise.all([loadConsumerKey(), loadConsumerSecret()]);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  if (clientSecret && !clientSecret.startsWith('PLACEHOLDER')) {
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(`${SF_AUTH_BASE}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Token refresh failed:', res.status, err);
    throw new Error(`MarginArc OAuth token refresh failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Revoke an access or refresh token.
 * @param {string} token - Token to revoke
 */
export async function revokeToken(token) {
  const res = await fetch(`${SF_AUTH_BASE}/services/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString()
  });

  if (!res.ok) {
    console.warn('Token revocation returned non-200:', res.status);
  }
}

// ---------------------------------------------------------------------------
// Database helpers: store / retrieve / refresh connections
// ---------------------------------------------------------------------------

/**
 * Store (or upsert) a Salesforce connection in the database.
 */
export async function storeConnection({ licenseId, orgId, instanceUrl, accessToken, refreshToken, connectedBy }) {
  const [accessEnc, refreshEnc] = await Promise.all([
    encryptToken(accessToken),
    encryptToken(refreshToken)
  ]);

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // SF tokens ~2h

  await query(
    `INSERT INTO salesforce_connections
       (license_id, org_id, instance_url, access_token_enc, refresh_token_enc, token_expires_at, connected_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     ON CONFLICT (org_id) DO UPDATE SET
       license_id = EXCLUDED.license_id,
       instance_url = EXCLUDED.instance_url,
       access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       token_expires_at = EXCLUDED.token_expires_at,
       connected_by = EXCLUDED.connected_by,
       connected_at = NOW(),
       status = 'active'`,
    [licenseId, orgId, instanceUrl, accessEnc, refreshEnc, expiresAt, connectedBy]
  );
}

/**
 * Get a connected org with a valid access token. Refreshes if expired.
 * @param {string} orgId - Salesforce org ID
 * @returns {Promise<{instanceUrl, accessToken, orgId}>}
 */
export async function getConnectedOrg(orgId) {
  const result = await query(
    'SELECT * FROM salesforce_connections WHERE org_id = $1 AND status = $2',
    [orgId, 'active']
  );

  if (result.rows.length === 0) {
    throw new Error(`MarginArc: No active connection for org ${orgId}`);
  }

  const conn = result.rows[0];
  const now = new Date();
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : new Date(0);

  let accessToken = await decryptToken(conn.access_token_enc);

  // Refresh if expired or about to expire (5 min buffer)
  if (!accessToken || now >= new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
    console.log(`Refreshing access token for org ${orgId}`);
    const refreshToken = await decryptToken(conn.refresh_token_enc);
    const tokens = await refreshAccessToken(refreshToken);

    accessToken = tokens.access_token;
    const newExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const newAccessEnc = await encryptToken(accessToken);

    await query(
      `UPDATE salesforce_connections
       SET access_token_enc = $1, token_expires_at = $2, instance_url = $3, last_used_at = NOW()
       WHERE org_id = $4`,
      [newAccessEnc, newExpiresAt, tokens.instance_url || conn.instance_url, orgId]
    );

    return { instanceUrl: tokens.instance_url || conn.instance_url, accessToken, orgId };
  }

  // Update last_used_at
  await query('UPDATE salesforce_connections SET last_used_at = NOW() WHERE org_id = $1', [orgId]);

  return { instanceUrl: conn.instance_url, accessToken, orgId };
}

/**
 * Make an authenticated API call to a customer Salesforce org.
 * Handles auto-refresh on 401.
 *
 * @param {string} orgId - Org ID
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g., /services/data/v62.0/query?q=...)
 * @param {object|null} body - Request body (for POST/PATCH/PUT)
 * @returns {Promise<object>} Parsed JSON response
 */
export async function makeApiCall(orgId, method, path, body = null) {
  let conn = await getConnectedOrg(orgId);

  const doFetch = async (accessToken, instanceUrl) => {
    const url = `${instanceUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    const options = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      options.body = JSON.stringify(body);
    }
    return fetch(url, options);
  };

  let res = await doFetch(conn.accessToken, conn.instanceUrl);

  // Auto-retry on 401 (token might have been revoked server-side)
  if (res.status === 401) {
    console.log(`Got 401 for org ${orgId}, forcing token refresh`);
    // Invalidate cached token expiry to force refresh
    await query(
      'UPDATE salesforce_connections SET token_expires_at = $1 WHERE org_id = $2',
      [new Date(0), orgId]
    );
    conn = await getConnectedOrg(orgId);
    res = await doFetch(conn.accessToken, conn.instanceUrl);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`Salesforce API error (${method} ${path}):`, res.status, errorBody.slice(0, 500));
    throw new Error(`Salesforce API ${res.status}: ${errorBody.slice(0, 200)}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

/**
 * Make an authenticated API call that returns the raw Response (for Bulk API, etc.).
 */
export async function makeRawApiCall(orgId, method, path, body = null, contentType = 'application/json') {
  const conn = await getConnectedOrg(orgId);
  const url = `${conn.instanceUrl}${path}`;
  const headers = {
    'Authorization': `Bearer ${conn.accessToken}`,
    'Content-Type': contentType
  };
  const options = { method, headers };
  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return fetch(url, options);
}

// ---------------------------------------------------------------------------
// Exports for tests / internal use
// ---------------------------------------------------------------------------

export { encryptToken, decryptToken };
