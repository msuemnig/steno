/**
 * Tests for services/api.js — ApiService
 *
 * ApiService is a plain object declared as `const ApiService = { ... }`.
 * We evaluate the file source to make it available.
 */
import { resetChromeMocks } from './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiSrc = readFileSync(join(__dirname, '..', 'services', 'api.js'), 'utf-8');
const _evalApi = new Function(apiSrc + '\nreturn ApiService;');
const ApiService = _evalApi();

describe('ApiService', () => {
  let originalFetch;

  beforeEach(() => {
    resetChromeMocks();
    // Reset in-memory caches
    ApiService._token = null;
    ApiService._user = null;
    // Save and mock global fetch
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ──────────────────────────────────────────────────────────────
  // Token Management
  // ──────────────────────────────────────────────────────────────

  describe('token management', () => {
    it('setToken stores token and user in chrome.storage.local', async () => {
      const user = { name: 'Test User', email: 'test@example.com' };
      await ApiService.setToken('tok_abc123', user);

      // Verify it persisted to chrome.storage.local
      const data = await chrome.storage.local.get(['steno_api_token', 'steno_api_user']);
      expect(data.steno_api_token).toBe('tok_abc123');
      expect(data.steno_api_user).toEqual(user);

      // Verify in-memory cache
      expect(ApiService._token).toBe('tok_abc123');
      expect(ApiService._user).toEqual(user);
    });

    it('getToken retrieves stored token from storage', async () => {
      // Store directly in chrome.storage.local to simulate persisted state
      await chrome.storage.local.set({
        steno_api_token: 'tok_from_storage',
        steno_api_user: { name: 'Stored User' },
      });

      // Clear in-memory cache
      ApiService._token = null;
      ApiService._user = null;

      const token = await ApiService.getToken();
      expect(token).toBe('tok_from_storage');
    });

    it('getToken returns cached token without hitting storage again', async () => {
      ApiService._token = 'tok_cached';
      const token = await ApiService.getToken();
      expect(token).toBe('tok_cached');
      // storage.local.get should NOT have been called
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('getToken returns null when no token stored', async () => {
      const token = await ApiService.getToken();
      expect(token).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // isAuthenticated
  // ──────────────────────────────────────────────────────────────

  describe('isAuthenticated', () => {
    it('returns true when token exists', async () => {
      ApiService._token = 'tok_exists';
      const result = await ApiService.isAuthenticated();
      expect(result).toBe(true);
    });

    it('returns false when no token', async () => {
      const result = await ApiService.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // clearToken / logout
  // ──────────────────────────────────────────────────────────────

  describe('clearToken', () => {
    it('clears token, user, and storage entries', async () => {
      await ApiService.setToken('tok_clear', { name: 'Bye' });
      await chrome.storage.local.set({ steno_last_synced_at: '2025-01-01' });

      await ApiService.clearToken();

      expect(ApiService._token).toBeNull();
      expect(ApiService._user).toBeNull();

      // Storage entries should be removed
      const data = await chrome.storage.local.get([
        'steno_api_token',
        'steno_api_user',
        'steno_last_synced_at',
      ]);
      expect(data.steno_api_token).toBeUndefined();
      expect(data.steno_api_user).toBeUndefined();
      expect(data.steno_last_synced_at).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getUser
  // ──────────────────────────────────────────────────────────────

  describe('getUser', () => {
    it('returns cached user', async () => {
      ApiService._user = { name: 'Cached' };
      const user = await ApiService.getUser();
      expect(user.name).toBe('Cached');
    });

    it('loads user from storage if not cached', async () => {
      await chrome.storage.local.set({
        steno_api_token: 'tok_x',
        steno_api_user: { name: 'From Storage' },
      });
      const user = await ApiService.getUser();
      expect(user.name).toBe('From Storage');
    });

    it('returns null when no user data exists', async () => {
      const user = await ApiService.getUser();
      expect(user).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // fetch wrapper
  // ──────────────────────────────────────────────────────────────

  describe('fetch wrapper', () => {
    it('adds Authorization header with Bearer token', async () => {
      ApiService._token = 'tok_auth';
      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: 'ok' }),
      });

      await ApiService.fetch('/api/test');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = globalThis.fetch.mock.calls[0];
      expect(url).toBe('https://steno-web.test/api/test');
      expect(options.headers.Authorization).toBe('Bearer tok_auth');
      expect(options.headers.Accept).toBe('application/json');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('throws when not authenticated', async () => {
      ApiService._token = null;
      await expect(ApiService.fetch('/api/test')).rejects.toThrow('Not authenticated');
    });

    it('handles 401 by clearing token and throwing', async () => {
      ApiService._token = 'tok_expired';
      globalThis.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(ApiService.fetch('/api/test')).rejects.toThrow('Authentication expired');

      // Token should be cleared
      expect(ApiService._token).toBeNull();
    });

    it('handles non-401 errors by throwing with message from body', async () => {
      ApiService._token = 'tok_err';
      globalThis.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server Error' }),
      });

      await expect(ApiService.fetch('/api/test')).rejects.toThrow('Server Error');
    });

    it('handles non-401 errors when body is not JSON', async () => {
      ApiService._token = 'tok_err2';
      globalThis.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => { throw new Error('not json'); },
      });

      await expect(ApiService.fetch('/api/test')).rejects.toThrow('API error: 503');
    });

    it('passes through custom options and merges headers', async () => {
      ApiService._token = 'tok_opts';
      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await ApiService.fetch('/api/upload', {
        method: 'POST',
        body: 'data',
        headers: { 'X-Custom': 'yes' },
      });

      const [, options] = globalThis.fetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.body).toBe('data');
      expect(options.headers['X-Custom']).toBe('yes');
      expect(options.headers.Authorization).toBe('Bearer tok_opts');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // fetchUser
  // ──────────────────────────────────────────────────────────────

  describe('fetchUser', () => {
    it('calls /api/user endpoint', async () => {
      ApiService._token = 'tok_user';
      const mockUser = { id: 1, name: 'Test', email: 'test@example.com' };
      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockUser,
      });

      const user = await ApiService.fetchUser();
      expect(user).toEqual(mockUser);

      const [url] = globalThis.fetch.mock.calls[0];
      expect(url).toBe('https://steno-web.test/api/user');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // sync
  // ──────────────────────────────────────────────────────────────

  describe('sync', () => {
    it('sends correct payload shape with last_synced_at', async () => {
      ApiService._token = 'tok_sync';
      await chrome.storage.local.set({ steno_last_synced_at: '2025-06-01T00:00:00Z' });
      // Re-read from storage (clear cache first)
      ApiService._token = null;
      await chrome.storage.local.set({ steno_api_token: 'tok_sync' });

      const serverResponse = {
        synced_at: '2025-06-02T00:00:00Z',
        sites: [],
        personas: [],
        scripts: [],
      };
      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => serverResponse,
      });

      const localData = {
        sites: [{ id: 's1', hostname: 'test.com' }],
        personas: [],
        scripts: [],
      };

      const result = await ApiService.sync(localData);

      expect(result).toEqual(serverResponse);

      // Verify the payload sent to the server
      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.last_synced_at).toBe('2025-06-01T00:00:00Z');
      expect(body.sites).toEqual(localData.sites);
      expect(body.personas).toEqual(localData.personas);
      expect(body.scripts).toEqual(localData.scripts);

      // Verify last_synced_at was updated
      const stored = await chrome.storage.local.get('steno_last_synced_at');
      expect(stored.steno_last_synced_at).toBe('2025-06-02T00:00:00Z');
    });

    it('sends null last_synced_at on first sync', async () => {
      ApiService._token = 'tok_first';

      globalThis.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ synced_at: '2025-06-01T00:00:00Z' }),
      });

      await ApiService.sync({ sites: [], personas: [], scripts: [] });

      const [, options] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.last_synced_at).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // lastSyncedAt
  // ──────────────────────────────────────────────────────────────

  describe('lastSyncedAt', () => {
    it('getLastSyncedAt returns null when not set', async () => {
      const result = await ApiService.getLastSyncedAt();
      expect(result).toBeNull();
    });

    it('setLastSyncedAt + getLastSyncedAt round-trip', async () => {
      await ApiService.setLastSyncedAt('2025-12-25T00:00:00Z');
      const result = await ApiService.getLastSyncedAt();
      expect(result).toBe('2025-12-25T00:00:00Z');
    });
  });
});
