/**
 * API client for Steno cloud sync.
 * Stores auth token in chrome.storage.local (device-specific, not synced).
 * Handles authenticated fetch, token management, and 401 auto-logout.
 */
const ApiService = {
  baseUrl: 'https://steno-web.test',
  _token: null,
  _user: null,

  // ─── Token Management ──────────────────────────────────

  async getToken() {
    if (this._token) return this._token;
    const data = await chrome.storage.local.get(['steno_api_token', 'steno_api_user']);
    this._token = data.steno_api_token || null;
    this._user = data.steno_api_user || null;
    return this._token;
  },

  async setToken(token, user) {
    this._token = token;
    this._user = user;
    await chrome.storage.local.set({ steno_api_token: token, steno_api_user: user });
  },

  async clearToken() {
    this._token = null;
    this._user = null;
    await chrome.storage.local.remove(['steno_api_token', 'steno_api_user', 'steno_last_synced_at']);
  },

  async isAuthenticated() {
    const token = await this.getToken();
    return !!token;
  },

  async getUser() {
    if (this._user) return this._user;
    await this.getToken();
    return this._user;
  },

  async getLastSyncedAt() {
    const data = await chrome.storage.local.get('steno_last_synced_at');
    return data.steno_last_synced_at || null;
  },

  async setLastSyncedAt(timestamp) {
    await chrome.storage.local.set({ steno_last_synced_at: timestamp });
  },

  // ─── Authenticated Fetch ───────────────────────────────

  async fetch(path, options = {}) {
    const token = await this.getToken();
    if (!token) throw new Error('Not authenticated');

    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      await this.clearToken();
      throw new Error('Authentication expired');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || `API error: ${response.status}`);
    }

    return response.json();
  },

  // ─── API Methods ───────────────────────────────────────

  async fetchUser() {
    return this.fetch('/api/user');
  },

  async sync(localData) {
    const lastSyncedAt = await this.getLastSyncedAt();
    const payload = {
      last_synced_at: lastSyncedAt,
      ...localData,
    };

    const result = await this.fetch('/api/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (result.synced_at) {
      await this.setLastSyncedAt(result.synced_at);
    }

    return result;
  },
};
