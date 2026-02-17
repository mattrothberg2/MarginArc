import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Cache for JWT secrets
let JWT_SECRET = null;
let JWT_SECRET_PREVIOUS = null;
let previousSecretChecked = false;
let ssmClient = null;

// Initialize SSM client
function getSSMClient() {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return ssmClient;
}

// Load JWT secret from SSM
async function loadJWTSecret() {
  if (JWT_SECRET) {
    return JWT_SECRET;
  }

  console.log('Loading JWT secret from SSM...');
  const client = getSSMClient();
  const command = new GetParameterCommand({
    Name: '/marginarc/jwt/secret',
    WithDecryption: true
  });

  const response = await client.send(command);
  JWT_SECRET = response.Parameter.Value;
  console.log('JWT secret loaded from SSM');
  return JWT_SECRET;
}

/**
 * Load the previous JWT secret from SSM for key rotation support.
 * Returns null if the parameter does not exist (rotation not in progress).
 */
async function loadPreviousJWTSecret() {
  if (previousSecretChecked) {
    return JWT_SECRET_PREVIOUS;
  }

  try {
    const client = getSSMClient();
    const command = new GetParameterCommand({
      Name: '/marginarc/jwt/secret-previous',
      WithDecryption: true
    });
    const response = await client.send(command);
    JWT_SECRET_PREVIOUS = response.Parameter.Value;
    console.log('Previous JWT secret loaded from SSM (rotation active)');
  } catch (err) {
    // Parameter does not exist — no rotation in progress, this is normal
    JWT_SECRET_PREVIOUS = null;
  }
  previousSecretChecked = true;
  return JWT_SECRET_PREVIOUS;
}

/**
 * Derive a Key ID (kid) from a JWT secret.
 * Uses a SHA-256 hash of the first 8 characters of the secret.
 */
function deriveKid(secret) {
  const prefix = secret.substring(0, 8);
  return crypto.createHash('sha256').update(prefix).digest('hex').substring(0, 8);
}

/**
 * Middleware to verify JWT token for admin endpoints.
 * Supports dual-key verification for secret rotation: tries the current secret
 * first, then falls back to the previous secret if configured.
 */
export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Authorization header required'
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authorization format. Use: Bearer <token>'
    });
  }

  const token = parts[1];

  try {
    const secret = await loadJWTSecret();
    const decoded = jwt.verify(token, secret);

    // Reject MFA-pending tokens from normal routes
    if (decoded.mfa_pending) {
      return res.status(401).json({
        success: false,
        message: 'MFA verification required'
      });
    }

    req.user = decoded;
    return next();
  } catch (primaryError) {
    // If the primary secret fails, try the previous secret (rotation support)
    try {
      const previousSecret = await loadPreviousJWTSecret();
      if (previousSecret) {
        const decoded = jwt.verify(token, previousSecret);

        if (decoded.mfa_pending) {
          return res.status(401).json({
            success: false,
            message: 'MFA verification required'
          });
        }

        req.user = decoded;
        return next();
      }
    } catch (_secondaryError) {
      // Both secrets failed — fall through to error handling below
    }

    // Return appropriate error based on the primary error
    if (primaryError.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
}

/**
 * Generate a JWT token for an authenticated user.
 * Includes role in the payload and kid in the header for key rotation.
 *
 * @param {string} username - The admin username
 * @param {string} role - The user role ('super_admin', 'admin', 'viewer')
 * @returns {string} Signed JWT token
 */
export async function generateToken(username, role = 'super_admin') {
  const secret = await loadJWTSecret();
  const kid = deriveKid(secret);
  return jwt.sign(
    { username, role },
    secret,
    {
      expiresIn: '1h',
      header: { kid }
    }
  );
}

/**
 * Generate a short-lived MFA pending token.
 * This token has a 5-minute expiry and an `mfa_pending: true` claim.
 * The verifyToken middleware rejects these tokens for all normal routes.
 *
 * @param {string} username - The admin username
 * @param {string} role - The user role
 * @returns {string} Signed JWT token with mfa_pending claim
 */
export async function generateMfaToken(username, role) {
  const secret = await loadJWTSecret();
  const kid = deriveKid(secret);
  return jwt.sign(
    { username, role, mfa_pending: true },
    secret,
    {
      expiresIn: '5m',
      header: { kid }
    }
  );
}

/**
 * Verify an MFA pending token. Only accepts tokens with `mfa_pending: true`.
 * Used by the MFA authenticate endpoint.
 *
 * @param {string} token - The JWT token to verify
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid, expired, or not an MFA pending token
 */
export async function verifyMfaPendingToken(token) {
  const secret = await loadJWTSecret();
  const decoded = jwt.verify(token, secret);
  if (!decoded.mfa_pending) {
    throw new Error('Not an MFA pending token');
  }
  return decoded;
}

/**
 * Export the JWT secret loader for MFA secret encryption.
 */
export { loadJWTSecret };

/**
 * Middleware factory that enforces role-based access control (RBAC).
 * Returns 403 if the authenticated user's role is not in the allowed list.
 *
 * @param  {...string} allowedRoles - Roles permitted to access the route
 * @returns {Function} Express middleware
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: requires one of [${allowedRoles.join(', ')}], got '${userRole || 'none'}'`
      });
    }
    next();
  };
}
