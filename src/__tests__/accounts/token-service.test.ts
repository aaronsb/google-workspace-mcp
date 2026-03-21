import { getAccessToken, invalidateToken, TokenRefreshError, _clearCache } from '../../accounts/token-service.js';
import * as credentials from '../../accounts/credentials.js';

jest.mock('../../accounts/credentials.js');

const mockReadCredential = credentials.readCredential as jest.MockedFunction<typeof credentials.readCredential>;

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const TEST_CREDENTIAL: credentials.AuthorizedUserCredential = {
  type: 'authorized_user',
  client_id: 'test-client-id',
  client_secret: 'test-client-secret',
  refresh_token: 'test-refresh-token',
};

describe('token-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCache();
    mockReadCredential.mockResolvedValue(TEST_CREDENTIAL);
  });

  describe('getAccessToken', () => {
    it('exchanges refresh token for access token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
      } as Response);

      const token = await getAccessToken('user@example.com');

      expect(token).toBe('fresh-token');
      expect(mockReadCredential).toHaveBeenCalledWith('user@example.com');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns cached token on subsequent calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'cached-token', expires_in: 3600 }),
      } as Response);

      const first = await getAccessToken('user@example.com');
      const second = await getAccessToken('user@example.com');

      expect(first).toBe('cached-token');
      expect(second).toBe('cached-token');
      expect(mockFetch).toHaveBeenCalledTimes(1); // only one fetch
    });

    it('caches per email', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token-a', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token-b', expires_in: 3600 }),
        } as Response);

      const a = await getAccessToken('a@test.com');
      const b = await getAccessToken('b@test.com');

      expect(a).toBe('token-a');
      expect(b).toBe('token-b');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws TokenRefreshError on invalid_grant', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      } as Response);

      await expect(getAccessToken('user@example.com')).rejects.toThrow(TokenRefreshError);
      await expect(getAccessToken('user@example.com')).rejects.toThrow('revoked');
    });

    it('throws TokenRefreshError on other HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'server_error' }),
      } as Response);

      await expect(getAccessToken('user@example.com')).rejects.toThrow(TokenRefreshError);
    });

    it('sends correct body params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      } as Response);

      await getAccessToken('user@example.com');

      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1]?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-client-secret');
      expect(body.get('refresh_token')).toBe('test-refresh-token');
      expect(body.get('grant_type')).toBe('refresh_token');
    });
  });

  describe('invalidateToken', () => {
    it('forces re-fetch on next getAccessToken call', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'old-token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
        } as Response);

      await getAccessToken('user@example.com');
      invalidateToken('user@example.com');
      const token = await getAccessToken('user@example.com');

      expect(token).toBe('new-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not affect other accounts', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token-a', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token-b', expires_in: 3600 }),
        } as Response);

      await getAccessToken('a@test.com');
      await getAccessToken('b@test.com');

      invalidateToken('a@test.com');

      // b should still be cached
      const bToken = await getAccessToken('b@test.com');
      expect(bToken).toBe('token-b');
      expect(mockFetch).toHaveBeenCalledTimes(2); // no new fetch for b
    });
  });
});
