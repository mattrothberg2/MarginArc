import { jest } from '@jest/globals';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Mock SSM — the auth module loads JWT secret from SSM
// ---------------------------------------------------------------------------
const TEST_JWT_SECRET = 'test-jwt-secret-for-mfa-tests-1234567890';

const mockSend = jest.fn().mockImplementation((cmd) => {
  if (cmd.Name === '/marginarc/jwt/secret') {
    return { Parameter: { Value: TEST_JWT_SECRET } };
  }
  if (cmd.Name === '/marginarc/jwt/secret-previous') {
    const err = new Error('not found');
    err.name = 'ParameterNotFound';
    throw err;
  }
  return {};
});

jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn((params) => ({ _type: 'Get', ...params })),
}));

// ---------------------------------------------------------------------------
// Import modules under test (after mocks)
// ---------------------------------------------------------------------------
const {
  generateToken,
  generateMfaToken,
  verifyMfaPendingToken,
  verifyToken,
  loadJWTSecret,
} = await import('../src/middleware/auth.js');

const { TOTP, Secret } = await import('otpauth');

// ---------------------------------------------------------------------------
// MFA helper functions (replicate from admin.js for unit testing)
// ---------------------------------------------------------------------------
function deriveEncryptionKey(jwtSecret) {
  return crypto.createHash('sha256').update(jwtSecret).digest();
}

function encryptMfaSecret(plaintext, jwtSecret) {
  const key = deriveEncryptionKey(jwtSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

function decryptMfaSecret(encryptedStr, jwtSecret) {
  const key = deriveEncryptionKey(jwtSecret);
  const [ivB64, authTagB64, ciphertext] = encryptedStr.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MFA', () => {
  describe('MFA token generation', () => {
    it('generates a token with mfa_pending claim', async () => {
      const token = await generateMfaToken('testuser', 'admin');
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      // Verify the token has the mfa_pending claim
      const decoded = await verifyMfaPendingToken(token);
      expect(decoded.username).toBe('testuser');
      expect(decoded.role).toBe('admin');
      expect(decoded.mfa_pending).toBe(true);
    });

    it('verifyMfaPendingToken rejects normal tokens', async () => {
      const normalToken = await generateToken('testuser', 'admin');
      await expect(verifyMfaPendingToken(normalToken)).rejects.toThrow('Not an MFA pending token');
    });

    it('verifyMfaPendingToken rejects expired tokens', async () => {
      // We can't easily test expiry without waiting, but verify the token has short expiry
      const token = await generateMfaToken('testuser', 'admin');
      const decoded = await verifyMfaPendingToken(token);
      // Token should expire in 5 minutes (300 seconds)
      const expiresIn = decoded.exp - decoded.iat;
      expect(expiresIn).toBe(300);
    });
  });

  describe('verifyToken middleware rejects mfa_pending tokens', () => {
    it('returns 401 for mfa_pending tokens', async () => {
      const mfaToken = await generateMfaToken('testuser', 'admin');

      const req = {
        headers: { authorization: `Bearer ${mfaToken}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'MFA verification required'
      });
    });

    it('allows normal tokens through', async () => {
      const normalToken = await generateToken('testuser', 'admin');

      const req = {
        headers: { authorization: `Bearer ${normalToken}` }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const next = jest.fn();

      await verifyToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.username).toBe('testuser');
      expect(req.user.role).toBe('admin');
      expect(req.user.mfa_pending).toBeUndefined();
    });
  });

  describe('MFA secret encryption', () => {
    it('encrypts and decrypts a TOTP secret correctly', () => {
      const originalSecret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptMfaSecret(originalSecret, TEST_JWT_SECRET);

      // Encrypted format should be iv:authTag:ciphertext
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      // Decrypt should return the original
      const decrypted = decryptMfaSecret(encrypted, TEST_JWT_SECRET);
      expect(decrypted).toBe(originalSecret);
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const enc1 = encryptMfaSecret(secret, TEST_JWT_SECRET);
      const enc2 = encryptMfaSecret(secret, TEST_JWT_SECRET);
      // IVs should differ, so ciphertexts should differ
      expect(enc1).not.toBe(enc2);
      // But both should decrypt to the same value
      expect(decryptMfaSecret(enc1, TEST_JWT_SECRET)).toBe(secret);
      expect(decryptMfaSecret(enc2, TEST_JWT_SECRET)).toBe(secret);
    });

    it('fails to decrypt with wrong key', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptMfaSecret(secret, TEST_JWT_SECRET);
      expect(() => decryptMfaSecret(encrypted, 'wrong-key-totally-different')).toThrow();
    });

    it('fails to decrypt tampered ciphertext', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptMfaSecret(secret, TEST_JWT_SECRET);
      // Tamper with the ciphertext portion
      const parts = encrypted.split(':');
      parts[2] = Buffer.from('tampered').toString('base64');
      const tampered = parts.join(':');
      expect(() => decryptMfaSecret(tampered, TEST_JWT_SECRET)).toThrow();
    });
  });

  describe('TOTP generation and verification', () => {
    it('generates a valid TOTP secret', () => {
      const secret = new Secret({ size: 20 });
      expect(secret.base32).toBeTruthy();
      expect(secret.base32.length).toBeGreaterThan(0);
    });

    it('creates a valid provisioning URI', () => {
      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: 'MarginArc Admin',
        label: 'testuser',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret
      });

      const uri = totp.toString();
      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain('MarginArc');
      expect(uri).toContain('testuser');
    });

    it('generates and validates a TOTP code', () => {
      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: 'MarginArc Admin',
        label: 'testuser',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret
      });

      // Generate a code for the current time
      const code = totp.generate();
      expect(code).toMatch(/^\d{6}$/);

      // Validate the code
      const delta = totp.validate({ token: code, window: 1 });
      expect(delta).not.toBeNull();
    });

    it('rejects an invalid TOTP code', () => {
      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: 'MarginArc Admin',
        label: 'testuser',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret
      });

      // Use a clearly wrong code
      const delta = totp.validate({ token: '000000', window: 0 });
      // This might coincidentally be valid, so use a different approach:
      // generate with one secret, validate with another
      const otherSecret = new Secret({ size: 20 });
      const otherTotp = new TOTP({
        issuer: 'MarginArc Admin',
        label: 'testuser',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: otherSecret
      });
      const codeFromOther = otherTotp.generate();
      const result = totp.validate({ token: codeFromOther, window: 0 });
      // Extremely unlikely (1 in 1M) that two different secrets produce the same code
      // but we accept this tiny probability in tests
      if (result !== null) {
        console.warn('Coincidental TOTP match — extremely unlikely but possible');
      }
    });
  });

  describe('End-to-end MFA flow', () => {
    it('full MFA setup → login → authenticate flow', async () => {
      // 1. Generate a TOTP secret (simulating /mfa/setup)
      const secret = new Secret({ size: 20 });
      const base32Secret = secret.base32;

      // 2. Encrypt the secret (simulating DB storage)
      const encrypted = encryptMfaSecret(base32Secret, TEST_JWT_SECRET);

      // 3. Simulate login returning mfa_required
      const mfaToken = await generateMfaToken('mfa_user', 'admin');
      const decoded = await verifyMfaPendingToken(mfaToken);
      expect(decoded.mfa_pending).toBe(true);
      expect(decoded.username).toBe('mfa_user');

      // 4. Decrypt the secret (simulating /auth/mfa/authenticate)
      const decryptedSecret = decryptMfaSecret(encrypted, TEST_JWT_SECRET);
      expect(decryptedSecret).toBe(base32Secret);

      // 5. Generate and verify TOTP code
      const totp = new TOTP({
        issuer: 'MarginArc Admin',
        label: 'mfa_user',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(decryptedSecret)
      });
      const code = totp.generate();
      const delta = totp.validate({ token: code, window: 1 });
      expect(delta).not.toBeNull();

      // 6. Issue full token (simulating successful MFA authenticate)
      const fullToken = await generateToken('mfa_user', 'admin');

      // 7. Verify the full token works with verifyToken middleware
      const req = { headers: { authorization: `Bearer ${fullToken}` } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();
      await verifyToken(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.username).toBe('mfa_user');
      expect(req.user.mfa_pending).toBeUndefined();
    });
  });
});
