/**
 * OAuth routes for MarginArc Admin Portal ↔ Salesforce org connections.
 *
 * All routes require JWT admin auth (verifyToken middleware).
 *
 * Routes:
 *   GET  /authorize            - Start OAuth flow (returns redirect URL)
 *   GET  /callback             - OAuth callback (exchanges code for tokens)
 *   GET  /connections          - List all connected orgs
 *   GET  /connections/:orgId/status - Test connection health
 *   DELETE /connections/:orgId - Disconnect an org
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { verifyToken } from '../middleware/auth.js';
import { query } from '../licensing/db.js';
import { getSSMParameter } from '../licensing/db.js';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  storeConnection,
  getConnectedOrg,
  revokeToken,
  generateCodeVerifier,
  generateCodeChallenge
} from './oauth.js';

const router = express.Router();

// Apply JWT auth to all routes EXCEPT /callback (Salesforce redirect has no JWT)
router.use((req, res, next) => {
  if (req.path === '/callback') return next();
  return verifyToken(req, res, next);
});

// ---------------------------------------------------------------------------
// State token helpers (JWT-based, signed with the same JWT secret)
// ---------------------------------------------------------------------------

async function signState(payload) {
  const secret = await getSSMParameter('/marginarc/jwt/secret', true);
  return jwt.sign(payload, secret, { expiresIn: '15m' });
}

async function verifyState(token) {
  const secret = await getSSMParameter('/marginarc/jwt/secret', true);
  return jwt.verify(token, secret);
}

// ---------------------------------------------------------------------------
// GET /authorize
// ---------------------------------------------------------------------------

router.get('/authorize', async (req, res) => {
  try {
    let { license_id } = req.query;

    // If no license_id provided, auto-select the most recent active license
    if (!license_id) {
      const autoLic = await query("SELECT id FROM licenses WHERE status = 'active' ORDER BY id DESC LIMIT 1");
      if (autoLic.rows.length > 0) {
        license_id = autoLic.rows[0].id;
      } else {
        // Fall back to any license
        const anyLic = await query('SELECT id FROM licenses ORDER BY id DESC LIMIT 1');
        if (anyLic.rows.length > 0) {
          license_id = anyLic.rows[0].id;
        }
      }
    } else {
      // Validate that the specified license exists
      const licResult = await query('SELECT id FROM licenses WHERE id = $1', [license_id]);
      if (licResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'License not found' });
      }
    }

    // Generate PKCE code_verifier and code_challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Generate a signed state token with license_id, nonce, and PKCE code_verifier
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = await signState({
      license_id: license_id || null,
      nonce,
      code_verifier: codeVerifier,
      username: req.user?.username
    });

    const authUrl = await getAuthorizationUrl(state, codeChallenge);

    return res.json({ success: true, authorizationUrl: authUrl });
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate authorization URL' });
  }
});

// ---------------------------------------------------------------------------
// GET /callback
// ---------------------------------------------------------------------------

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('OAuth error from Salesforce:', error, error_description);
      return res.redirect(`/admin/connections?oauth_result=error&error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      return res.redirect('/admin/connections?oauth_result=error&error=Missing+authorization+code+or+state');
    }

    // Verify and decode the state token
    let statePayload;
    try {
      statePayload = await verifyState(state);
    } catch (err) {
      console.error('Invalid state token:', err.message);
      return res.redirect('/admin/connections?oauth_result=error&error=Invalid+or+expired+state+token');
    }

    const { license_id, username, code_verifier } = statePayload;

    if (!code_verifier) {
      console.error('No code_verifier in state token — PKCE required');
      return res.redirect('/admin/connections?oauth_result=error&error=Missing+PKCE+code_verifier');
    }

    // Exchange the authorization code for tokens using PKCE
    const tokens = await exchangeCodeForTokens(code, code_verifier);

    // Extract org ID from the identity URL
    // Identity URL format: https://login.salesforce.com/id/00Dxx0000001gPL/005xx000001X8Uz
    const idParts = (tokens.id || '').split('/');
    const orgId = idParts[idParts.length - 2]; // The org ID

    if (!orgId || !orgId.startsWith('00D')) {
      console.error('Could not extract org ID from identity URL:', tokens.id);
      return res.redirect('/admin/connections?oauth_result=error&error=Could+not+determine+Salesforce+org+ID');
    }

    // Store the connection
    await storeConnection({
      licenseId: license_id,
      orgId,
      instanceUrl: tokens.instance_url,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      connectedBy: username || 'admin'
    });

    console.log(`Salesforce org ${orgId} connected for license ${license_id} by ${username}`);

    // Redirect back to the admin portal with success
    return res.redirect(`/admin/connections?oauth_result=success&org_id=${orgId}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(`/admin/connections?oauth_result=error&error=${encodeURIComponent('Connection failed: ' + error.message)}`);
  }
});

// ---------------------------------------------------------------------------
// GET /connections
// ---------------------------------------------------------------------------

router.get('/connections', async (req, res) => {
  try {
    const result = await query(
      `SELECT sc.id, sc.org_id, sc.instance_url, sc.connected_by, sc.connected_at,
              sc.last_used_at, sc.status, sc.license_id, l.license_key, c.name as customer_name
       FROM salesforce_connections sc
       LEFT JOIN licenses l ON sc.license_id = l.id
       LEFT JOIN customers c ON l.customer_id = c.id
       ORDER BY sc.connected_at DESC`
    );

    return res.json({
      success: true,
      connections: result.rows.map(row => ({
        id: row.id,
        orgId: row.org_id,
        instanceUrl: row.instance_url,
        connectedBy: row.connected_by,
        connectedAt: row.connected_at,
        lastUsedAt: row.last_used_at,
        status: row.status,
        licenseId: row.license_id,
        licenseKey: row.license_key,
        customerName: row.customer_name
      }))
    });
  } catch (error) {
    console.error('Error listing connections:', error);
    return res.status(500).json({ success: false, message: 'Failed to list connections' });
  }
});

// ---------------------------------------------------------------------------
// GET /connections/:orgId/status
// ---------------------------------------------------------------------------

router.get('/connections/:orgId/status', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Check if connection exists
    const connResult = await query(
      'SELECT org_id, instance_url, status, connected_at FROM salesforce_connections WHERE org_id = $1',
      [orgId]
    );

    if (connResult.rows.length === 0) {
      return res.json({ success: true, connected: false });
    }

    const conn = connResult.rows[0];

    if (conn.status !== 'active') {
      return res.json({
        success: true,
        connected: true,
        tokenValid: false,
        instanceUrl: conn.instance_url,
        status: conn.status
      });
    }

    // Try to get a valid token (triggers refresh if needed)
    try {
      const orgConn = await getConnectedOrg(orgId);
      return res.json({
        success: true,
        connected: true,
        tokenValid: true,
        instanceUrl: orgConn.instanceUrl
      });
    } catch (err) {
      console.warn(`Connection test failed for org ${orgId}:`, err.message);
      return res.json({
        success: true,
        connected: true,
        tokenValid: false,
        instanceUrl: conn.instance_url,
        error: err.message
      });
    }
  } catch (error) {
    console.error('Error checking connection status:', error);
    return res.status(500).json({ success: false, message: 'Failed to check connection status' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /connections/:orgId
// ---------------------------------------------------------------------------

router.delete('/connections/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Get the connection to revoke tokens
    const connResult = await query(
      'SELECT access_token_enc, refresh_token_enc FROM salesforce_connections WHERE org_id = $1',
      [orgId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    // Try to revoke the refresh token (best effort)
    try {
      const { decryptToken } = await import('./oauth.js');
      const refreshToken = await decryptToken(connResult.rows[0].refresh_token_enc);
      if (refreshToken) {
        await revokeToken(refreshToken);
      }
    } catch (err) {
      console.warn('Token revocation failed (continuing with deletion):', err.message);
    }

    // Remove the connection
    await query('DELETE FROM salesforce_connections WHERE org_id = $1', [orgId]);

    // Also clean up any demo data jobs for this org
    await query('DELETE FROM demo_data_jobs WHERE org_id = $1', [orgId]);

    console.log(`Salesforce org ${orgId} disconnected`);

    return res.json({ success: true, message: `Org ${orgId} disconnected` });
  } catch (error) {
    console.error('Error disconnecting org:', error);
    return res.status(500).json({ success: false, message: 'Failed to disconnect org' });
  }
});

export default router;
