import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { query, getSSMParameter } from '../licensing/db.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Free email domain blocklist
// ---------------------------------------------------------------------------

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'mail.com', 'zoho.com', 'yandex.com',
  'yandex.ru', 'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com',
  'guerrillamail.com', 'tempmail.com', 'mailinator.com', '10minutemail.com',
  'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'dispostable.com',
  'throwaway.email', 'temp-mail.org', 'fakeinbox.com'
]);

// ---------------------------------------------------------------------------
// JWT secret helper (uses same SSM parameter as admin portal)
// ---------------------------------------------------------------------------

let cachedJwtSecret = null;

async function getJwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;
  cachedJwtSecret = await getSSMParameter('/marginarc/jwt/secret', true);
  return cachedJwtSecret;
}

// ---------------------------------------------------------------------------
// Rate limiter for /register — 3 per hour per IP
// ---------------------------------------------------------------------------

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Please try again later.' }
});

// ---------------------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------------------

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName, company } = req.body;

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    // Block free email domains
    const domain = email.split('@')[1].toLowerCase();
    if (FREE_EMAIL_DOMAINS.has(domain)) {
      return res.status(400).json({
        success: false,
        message: 'Please use your company email address. Free email providers are not accepted.'
      });
    }

    // Check if email already exists
    const existing = await query('SELECT id FROM doc_users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Try to match domain to an active customer
    const customerMatch = await query(
      `SELECT id, name FROM customers WHERE LOWER(website) LIKE '%' || LOWER($1) || '%' AND status = 'active'`,
      [domain]
    );

    let status;
    let customerId = null;
    let message;

    if (customerMatch.rows.length > 0) {
      status = 'approved';
      customerId = customerMatch.rows[0].id;
      message = 'Your account has been approved. You can now log in.';
    } else {
      status = 'pending';
      message = "Your account is pending administrator approval. You'll be notified when approved.";
    }

    await query(
      `INSERT INTO doc_users (email, password_hash, first_name, last_name, company, status, customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email.toLowerCase(), passwordHash, firstName || null, lastName || null, company || null, status, customerId]
    );

    return res.status(201).json({ success: true, status, message });
  } catch (error) {
    console.error('Error during doc user registration:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // Find user by email
    const result = await query(
      'SELECT * FROM doc_users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Check status
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval. Please check back later.'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Access to documentation has been denied. Contact your MarginArc representative.'
      });
    }

    // Status is 'approved' — generate JWT and update last_login
    const secret = await getJwtSecret();
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'doc_user' },
      secret,
      { expiresIn: '8h' }
    );

    await query('UPDATE doc_users SET last_login = NOW() WHERE id = $1', [user.id]);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        company: user.company,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Error during doc user login:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Middleware: verifyDocToken
// ---------------------------------------------------------------------------

export async function verifyDocToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header required' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Invalid authorization format. Use: Bearer <token>' });
  }

  const token = parts[1];

  try {
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret);

    if (decoded.role !== 'doc_user') {
      return res.status(403).json({ success: false, message: 'Invalid token role' });
    }

    req.docUser = decoded;
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ---------------------------------------------------------------------------
// GET /me (requires doc JWT auth)
// ---------------------------------------------------------------------------

router.get('/me', verifyDocToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, company, status, customer_id, created_at, last_login
       FROM doc_users WHERE id = $1`,
      [req.docUser.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        company: user.company,
        status: user.status,
        customerId: user.customer_id,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    console.error('Error in /me:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
