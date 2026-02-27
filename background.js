/**
 * Service worker — message routing and recording state management.
 */
if (typeof importScripts === 'function') importScripts('services/api.js', 'services/storage.js');

let recordingTabId = null;
let capturedFieldCount = 0;
let pendingFields = null; // stashed fields when stopped from overlay

// Cross-page replay state
let replayState = null;       // { tabId, steps[], lastCompletedIndex, results, originHostname }
let pendingReplayResults = null;

// Run migration on startup
StorageService.migrateIfNeeded().catch((err) => {
  console.error('Steno migration failed:', err);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ─── Synchronous handlers ────────────────────────────────
  if (msg.type === 'GET_STATE') {
    sendResponse({
      recording: recordingTabId !== null,
      recordingTabId,
      capturedFieldCount,
      pendingFields,
    });
    return false;
  }

  if (msg.type === 'SET_RECORDING_TAB') {
    recordingTabId = msg.tabId;
    capturedFieldCount = 0;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'CLEAR_RECORDING_TAB') {
    if (recordingTabId) {
      chrome.action.setBadgeText({ text: '', tabId: recordingTabId });
    }
    recordingTabId = null;
    capturedFieldCount = 0;
    pendingFields = null;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'CLEAR_PENDING_FIELDS') {
    pendingFields = null;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'FIELD_CAPTURED' || msg.type === 'STEP_CAPTURED') {
    capturedFieldCount++;
    if (recordingTabId && sender.tab?.id === recordingTabId) {
      chrome.action.setBadgeText({ text: String(capturedFieldCount), tabId: recordingTabId });
      chrome.action.setBadgeBackgroundColor({ color: '#e53e3e', tabId: recordingTabId });
    }
    return false;
  }

  if (msg.type === 'REPLAY_STARTED') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      try {
        const tabUrl = sender.tab.url || '';
        replayState = {
          tabId,
          steps: msg.fields || null,
          lastCompletedIndex: -1,
          results: null,
          originHostname: tabUrl ? new URL(tabUrl).hostname : '',
        };
      } catch {
        replayState = null;
      }
    }
    return false;
  }

  if (msg.type === 'REPLAY_PROGRESS') {
    if (replayState) {
      replayState.lastCompletedIndex = msg.lastCompletedIndex;
    }
    return false;
  }

  if (msg.type === 'REPLAY_FINISHED') {
    if (replayState) {
      // Merge results into any pending partial results
      if (pendingReplayResults) {
        pendingReplayResults.filled += (msg.results?.filled || 0);
        pendingReplayResults.clicked += (msg.results?.clicked || 0);
        pendingReplayResults.skipped += (msg.results?.skipped || 0);
        pendingReplayResults.warnings = (pendingReplayResults.warnings || []).concat(msg.results?.warnings || []);
      } else {
        pendingReplayResults = { ...(msg.results || {}) };
      }
      replayState = null;
    } else {
      pendingReplayResults = { ...(msg.results || {}) };
    }
    return false;
  }

  if (msg.type === 'GET_REPLAY_RESULTS') {
    sendResponse(pendingReplayResults);
    return false;
  }

  if (msg.type === 'CLEAR_REPLAY_RESULTS') {
    pendingReplayResults = null;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'OVERLAY_STOP_CLICKED') {
    if (recordingTabId) {
      const tabId = recordingTabId;
      chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' }, (response) => {
        pendingFields = response?.fields || [];
        chrome.action.setBadgeText({ text: '', tabId });
        recordingTabId = null;
        capturedFieldCount = 0;
        chrome.action.openPopup().catch(() => {});
      });
    }
    return false;
  }

  // ─── Async handlers (return true to keep message channel open) ──

  // Script CRUD (new v2 names)
  if (msg.type === 'GET_SCRIPTS' || msg.type === 'GET_PROFILES') {
    StorageService.getScripts().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_SCRIPTS_FLAT') {
    StorageService.getScriptsFlat().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_SCRIPT' || msg.type === 'GET_PROFILE') {
    StorageService.getScript(msg.id).then(sendResponse);
    return true;
  }

  if (msg.type === 'SAVE_SCRIPT' || msg.type === 'SAVE_PROFILE') {
    const script = msg.script || msg.profile;
    StorageService.saveScript(script, { force: !!msg.force })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'GET_SCRIPT_LIMIT') {
    StorageService.getScriptLimit().then(sendResponse);
    return true;
  }

  if (msg.type === 'DELETE_SCRIPT' || msg.type === 'DELETE_PROFILE') {
    StorageService.deleteScript(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Site CRUD
  if (msg.type === 'GET_SITES') {
    StorageService.getSites().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_SITE') {
    StorageService.getSite(msg.id).then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_SITE_BY_HOSTNAME') {
    StorageService.getSiteByHostname(msg.hostname).then(sendResponse);
    return true;
  }

  if (msg.type === 'SAVE_SITE') {
    StorageService.saveSite(msg.site).then((site) => sendResponse(site));
    return true;
  }

  if (msg.type === 'DELETE_SITE') {
    StorageService.deleteSite(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Persona CRUD
  if (msg.type === 'GET_PERSONAS') {
    StorageService.getPersonas().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_PERSONAS_BY_SITE') {
    StorageService.getPersonasBySite(msg.siteId).then(sendResponse);
    return true;
  }

  if (msg.type === 'SAVE_PERSONA') {
    StorageService.savePersona(msg.persona).then((persona) => sendResponse(persona));
    return true;
  }

  if (msg.type === 'DELETE_PERSONA') {
    StorageService.deletePersona(msg.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Tree (for options page)
  if (msg.type === 'GET_TREE') {
    StorageService.getTree().then(sendResponse);
    return true;
  }

  // Export / Import
  if (msg.type === 'EXPORT_ALL') {
    StorageService.exportAll()
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'IMPORT_ALL') {
    StorageService.importAll(msg.data)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Theme
  if (msg.type === 'GET_THEME') {
    StorageService.getTheme().then(sendResponse);
    return true;
  }

  if (msg.type === 'SET_THEME') {
    StorageService.setTheme(msg.theme).then(() => sendResponse({ ok: true }));
    return true;
  }

  // ─── Auth & Sync handlers ─────────────────────────────

  if (msg.type === 'GET_AUTH_STATUS') {
    (async () => {
      const isAuth = await ApiService.isAuthenticated();
      const user = isAuth ? await ApiService.getUser() : null;
      const lastSynced = await ApiService.getLastSyncedAt();
      sendResponse({ authenticated: isAuth, user, lastSyncedAt: lastSynced });
    })();
    return true;
  }

  if (msg.type === 'SET_AUTH_TOKEN') {
    ApiService.setToken(msg.token, msg.user).then(async () => {
      // Trigger initial sync after login
      const result = await StorageService.sync();
      sendResponse({ ok: true, syncResult: result });
    });
    return true;
  }

  if (msg.type === 'LOGOUT') {
    ApiService.clearToken().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'SYNC_NOW') {
    StorageService.sync().then(sendResponse);
    return true;
  }
});

// ─── Cross-page replay navigation listener ──────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!replayState) return;
  if (tabId !== replayState.tabId) return;
  if (changeInfo.status !== 'complete') return;

  const steps = replayState.steps;
  const lastIdx = replayState.lastCompletedIndex;
  if (!steps || lastIdx < 0) return;

  // Same-domain check
  try {
    const newHostname = new URL(tab.url).hostname;
    if (newHostname !== replayState.originHostname) {
      // Different domain — abort with partial results
      pendingReplayResults = pendingReplayResults || { filled: 0, clicked: 0, skipped: 0, warnings: [] };
      pendingReplayResults.aborted = true;
      pendingReplayResults.warnings.push(`Cross-domain navigation to ${newHostname} — replay aborted`);
      replayState = null;
      return;
    }
  } catch {
    replayState = null;
    return;
  }

  // Same domain — continue replay from next step after a short delay
  const startIndex = lastIdx + 1;
  if (startIndex >= steps.length) {
    replayState = null;
    return;
  }

  // Store partial results so far
  if (!pendingReplayResults) {
    pendingReplayResults = { filled: 0, clicked: 0, skipped: 0, warnings: [] };
  }

  setTimeout(() => {
    // Ensure content script is loaded, then send CONTINUE_REPLAY
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, () => {
      if (chrome.runtime.lastError) {
        // Content script not ready, inject it first
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['services/recorder.js', 'content.js'],
        }).then(() => {
          chrome.tabs.sendMessage(tabId, {
            type: 'CONTINUE_REPLAY',
            fields: steps,
            startIndex,
          });
        }).catch(() => {
          replayState = null;
        });
      } else {
        chrome.tabs.sendMessage(tabId, {
          type: 'CONTINUE_REPLAY',
          fields: steps,
          startIndex,
        });
      }
    });
  }, 200);
});

// ─── Periodic background sync (every 5 minutes) ─────────
chrome.alarms.create('steno-sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'steno-sync') return;
  const isAuth = await ApiService.isAuthenticated();
  if (isAuth) {
    StorageService.sync().catch(err => console.error('Periodic sync failed:', err));
  }
});
