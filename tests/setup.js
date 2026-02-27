/**
 * Vitest setup — comprehensive Chrome Extension API mocks.
 *
 * The mocks use in-memory stores so that set() followed by get()
 * actually returns the stored data. This is critical for StorageService tests.
 */

// ─── In-memory storage backends ────────────────────────────────
function createStorageArea() {
  let store = {};

  return {
    _store: store,

    get: vi.fn(async (keys) => {
      if (keys === null || keys === undefined) {
        return { ...store };
      }
      if (typeof keys === 'string') {
        const result = {};
        if (keys in store) result[keys] = store[keys];
        return result;
      }
      if (Array.isArray(keys)) {
        const result = {};
        for (const k of keys) {
          if (k in store) result[k] = store[k];
        }
        return result;
      }
      // keys is an object with defaults
      const result = {};
      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = k in store ? store[k] : defaultVal;
      }
      return result;
    }),

    set: vi.fn(async (items) => {
      Object.assign(store, items);
    }),

    remove: vi.fn(async (keys) => {
      const keyList = typeof keys === 'string' ? [keys] : keys;
      for (const k of keyList) {
        delete store[k];
      }
    }),

    getBytesInUse: vi.fn(async (keys) => {
      if (!keys) {
        return JSON.stringify(store).length;
      }
      const keyList = typeof keys === 'string' ? [keys] : keys;
      let size = 0;
      for (const k of keyList) {
        if (k in store) size += JSON.stringify(store[k]).length;
      }
      return size;
    }),

    clear: vi.fn(async () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    }),

    /**
     * Reset the backing store. Call this in beforeEach to get a clean slate.
     */
    _reset() {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
      // Reset call history on all mocked methods
      this.get.mockClear();
      this.set.mockClear();
      this.remove.mockClear();
      this.getBytesInUse.mockClear();
      this.clear.mockClear();
    },
  };
}

const syncStorage = createStorageArea();
const localStorage = createStorageArea();

// ─── Message listeners registry ────────────────────────────────
const messageListeners = [];

// ─── chrome global mock ────────────────────────────────────────
globalThis.chrome = {
  storage: {
    sync: syncStorage,
    local: localStorage,
  },

  runtime: {
    sendMessage: vi.fn(async (msg) => {
      // Dispatch to registered listeners and return the first sendResponse value
      for (const listener of messageListeners) {
        let responseValue;
        const sendResponse = (val) => { responseValue = val; };
        const result = listener(msg, {}, sendResponse);
        if (responseValue !== undefined) return responseValue;
        // If the listener returned a promise (async handler), wait for it
        if (result && typeof result.then === 'function') {
          await result;
          if (responseValue !== undefined) return responseValue;
        }
      }
      return undefined;
    }),

    onMessage: {
      addListener: vi.fn((fn) => {
        messageListeners.push(fn);
      }),
      removeListener: vi.fn((fn) => {
        const idx = messageListeners.indexOf(fn);
        if (idx >= 0) messageListeners.splice(idx, 1);
      }),
    },

    lastError: null,

    openOptionsPage: vi.fn(),
  },

  tabs: {
    query: vi.fn(async () => [{ id: 1, url: 'https://example.com/page' }]),
    sendMessage: vi.fn(async () => ({ ok: true })),
    create: vi.fn(async () => ({})),
    onUpdated: {
      addListener: vi.fn(),
    },
  },

  scripting: {
    executeScript: vi.fn(async () => []),
  },

  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: {
      addListener: vi.fn(),
    },
  },

  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    openPopup: vi.fn(async () => {}),
  },
};

// ─── crypto.randomUUID mock ────────────────────────────────────
// jsdom may not provide crypto.randomUUID; ensure it exists.
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  let counter = 0;
  globalThis.crypto.randomUUID = () => {
    counter++;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  };
}

// ─── CSS.escape mock (jsdom does not always provide it) ────────
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = {};
}
if (typeof globalThis.CSS.escape !== 'function') {
  globalThis.CSS.escape = (value) => {
    // Simplified CSS.escape: escape leading digits and special chars
    return String(value).replace(/([^\w-])/g, '\\$1');
  };
}

// ─── Helper to reset all mocks between tests ──────────────────
export function resetChromeMocks() {
  syncStorage._reset();
  localStorage._reset();
  messageListeners.length = 0;
  chrome.runtime.sendMessage.mockClear();
  chrome.runtime.onMessage.addListener.mockClear();
  chrome.runtime.onMessage.removeListener.mockClear();
  chrome.tabs.query.mockClear();
  chrome.tabs.sendMessage.mockClear();
  chrome.scripting.executeScript.mockClear();
  chrome.alarms.create.mockClear();
  chrome.alarms.clear.mockClear();
  chrome.action.setBadgeText.mockClear();
  chrome.action.setBadgeBackgroundColor.mockClear();
}
