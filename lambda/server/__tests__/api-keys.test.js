import { jest } from '@jest/globals';

// Mock the @aws-sdk/client-ssm module before importing the module under test
const mockSend = jest.fn();
jest.unstable_mockModule('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn((params) => ({ _type: 'Get', ...params })),
  PutParameterCommand: jest.fn((params) => ({ _type: 'Put', ...params })),
  DeleteParameterCommand: jest.fn((params) => ({ _type: 'Delete', ...params }))
}));

// Now import the module under test (after mocks are set up)
const {
  validateApiKey,
  generateApiKey,
  rotateApiKey,
  promoteApiKey,
  invalidateCache,
  apiKeyMiddleware,
  setQueryFn,
  SSM_KEY_PRIMARY,
  SSM_KEY_SECONDARY
} = await import('../src/api-keys.js');

describe('api-keys', () => {
  beforeEach(() => {
    invalidateCache();
    mockSend.mockReset();
    // Default: no env var fallback
    delete process.env.MARGINARC_API_KEY;
  });

  // Helper to make mockSend return different values based on the SSM parameter name
  function setupSSMKeys(primary, secondary) {
    mockSend.mockImplementation((cmd) => {
      if (cmd.Name === SSM_KEY_PRIMARY) {
        if (primary === null) {
          const err = new Error('not found');
          err.name = 'ParameterNotFound';
          throw err;
        }
        return { Parameter: { Value: primary } };
      }
      if (cmd.Name === SSM_KEY_SECONDARY) {
        if (secondary === null) {
          const err = new Error('not found');
          err.name = 'ParameterNotFound';
          throw err;
        }
        return { Parameter: { Value: secondary } };
      }
      return {};
    });
  }

  describe('generateApiKey', () => {
    it('generates a key with MARC- prefix and 45 total characters', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^MARC-[0-9a-f]{40}$/);
      expect(key.length).toBe(45);
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
      expect(keys.size).toBe(100);
    });
  });

  describe('validateApiKey', () => {
    it('returns false for empty/null input', async () => {
      expect(await validateApiKey('')).toBe(false);
      expect(await validateApiKey(null)).toBe(false);
      expect(await validateApiKey(undefined)).toBe(false);
    });

    it('accepts primary key', async () => {
      setupSSMKeys('primary-key-123', null);
      expect(await validateApiKey('primary-key-123')).toBe(true);
    });

    it('accepts secondary key', async () => {
      setupSSMKeys('primary-key-123', 'secondary-key-456');
      expect(await validateApiKey('secondary-key-456')).toBe(true);
    });

    it('rejects wrong key when both primary and secondary exist', async () => {
      setupSSMKeys('primary-key-123', 'secondary-key-456');
      expect(await validateApiKey('wrong-key')).toBe(false);
    });

    it('falls back to MARGINARC_API_KEY env var when SSM is empty', async () => {
      setupSSMKeys(null, null);
      process.env.MARGINARC_API_KEY = 'env-key-789';
      expect(await validateApiKey('env-key-789')).toBe(true);
      expect(await validateApiKey('wrong')).toBe(false);
    });

    it('allows all requests when no keys are configured (dev mode)', async () => {
      setupSSMKeys(null, null);
      expect(await validateApiKey('anything')).toBe(true);
    });

    it('caches SSM results within TTL', async () => {
      setupSSMKeys('cached-key', null);
      await validateApiKey('cached-key');
      await validateApiKey('cached-key');
      // SSM should only be called once (2 params per call = 2 sends for first call)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('per-customer key validation', () => {
    it('accepts a matching customer API key from DB', async () => {
      setupSSMKeys('global-key', null);
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ id: 'cust-1', api_key: 'customer-key-abc' }]
      });
      setQueryFn(mockQuery);

      expect(await validateApiKey('customer-key-abc')).toBe(true);
    });

    it('rejects non-matching key even with customer keys', async () => {
      setupSSMKeys('global-key', null);
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [{ id: 'cust-1', api_key: 'customer-key-abc' }]
      });
      setQueryFn(mockQuery);

      expect(await validateApiKey('wrong-key')).toBe(false);
    });

    it('falls through gracefully when api_key column missing', async () => {
      setupSSMKeys('global-key', null);
      const mockQuery = jest.fn().mockRejectedValue(new Error('column "api_key" does not exist'));
      setQueryFn(mockQuery);

      expect(await validateApiKey('wrong-key')).toBe(false);
    });

    // Clean up
    afterEach(() => {
      setQueryFn(null);
    });
  });

  describe('rotateApiKey', () => {
    it('generates a new key and writes it to SSM secondary', async () => {
      mockSend.mockResolvedValue({});
      const key = await rotateApiKey();
      expect(key).toMatch(/^MARC-/);
      // Verify PutParameterCommand was called with the secondary key path
      const putCalls = mockSend.mock.calls.filter(
        ([cmd]) => cmd._type === 'Put'
      );
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][0].Name).toBe(SSM_KEY_SECONDARY);
      expect(putCalls[0][0].Value).toBe(key);
    });
  });

  describe('promoteApiKey', () => {
    it('moves secondary to primary and deletes secondary', async () => {
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Get' && cmd.Name === SSM_KEY_SECONDARY) {
          return { Parameter: { Value: 'new-key-to-promote' } };
        }
        return {};
      });

      const result = await promoteApiKey();
      expect(result.promoted).toBe(true);

      // Should have called Put (primary) and Delete (secondary)
      const putCalls = mockSend.mock.calls.filter(([c]) => c._type === 'Put');
      const delCalls = mockSend.mock.calls.filter(([c]) => c._type === 'Delete');
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][0].Name).toBe(SSM_KEY_PRIMARY);
      expect(putCalls[0][0].Value).toBe('new-key-to-promote');
      expect(delCalls.length).toBe(1);
      expect(delCalls[0][0].Name).toBe(SSM_KEY_SECONDARY);
    });

    it('throws if no secondary key exists', async () => {
      mockSend.mockImplementation((cmd) => {
        if (cmd._type === 'Get') {
          const err = new Error('not found');
          err.name = 'ParameterNotFound';
          throw err;
        }
        return {};
      });

      await expect(promoteApiKey()).rejects.toThrow('No secondary key exists');
    });
  });

  describe('apiKeyMiddleware', () => {
    function mockReqRes(path, apiKey) {
      const req = {
        path,
        headers: { 'x-api-key': apiKey || '' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();
      return { req, res, next };
    }

    it('skips health endpoint', () => {
      const { req, res, next } = mockReqRes('/health', '');
      apiKeyMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('skips license endpoints', () => {
      const { req, res, next } = mockReqRes('/v1/license/validate', '');
      apiKeyMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('skips demo-data endpoints', () => {
      const { req, res, next } = mockReqRes('/demo-data/scenarios', '');
      apiKeyMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects requests with wrong key', async () => {
      setupSSMKeys('correct-key', null);
      const { req, res, next } = mockReqRes('/recommend', 'wrong-key');
      apiKeyMiddleware(req, res, next);

      // Wait for the async validation to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or missing API key' });
    });

    it('allows requests with correct key', async () => {
      setupSSMKeys('correct-key', null);
      const { req, res, next } = mockReqRes('/recommend', 'correct-key');
      apiKeyMiddleware(req, res, next);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(next).toHaveBeenCalled();
    });
  });
});
