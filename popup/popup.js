/**
 * Popup script — drives the UI state machine.
 */
(async () => {
  // ─── Theme ─────────────────────────────────────────────
  const theme = await chrome.runtime.sendMessage({ type: 'GET_THEME' });
  document.documentElement.setAttribute('data-theme', theme || 'system');

  // ─── DOM refs ────────────────────────────────────────────
  const viewIdle = document.getElementById('view-idle');
  const viewRecording = document.getElementById('view-recording');
  const viewSave = document.getElementById('view-save');
  const viewResults = document.getElementById('view-results');
  const viewLimit = document.getElementById('view-limit');
  const viewReplace = document.getElementById('view-replace');
  const viewConfirm = document.getElementById('view-confirm-replace');

  const scriptSearch = document.getElementById('script-search');
  const searchList = document.getElementById('search-list');
  const btnRecord = document.getElementById('btn-record');
  const btnFill = document.getElementById('btn-fill');
  const linkOptions = document.getElementById('link-options');

  const fieldCount = document.getElementById('field-count');
  const btnStop = document.getElementById('btn-stop');
  const btnDiscard = document.getElementById('btn-discard');

  const scriptNameInput = document.getElementById('script-name');
  const saveSiteHint = document.getElementById('save-site-hint');
  const saveFieldCount = document.getElementById('save-field-count');
  const btnSave = document.getElementById('btn-save');
  const btnSaveDiscard = document.getElementById('btn-save-discard');

  const resultFilled = document.getElementById('result-filled');
  const resultSkipped = document.getElementById('result-skipped');
  const resultWarnings = document.getElementById('result-warnings');
  const btnFillAgain = document.getElementById('btn-fill-again');
  const btnBack = document.getElementById('btn-back');

  const limitMsg = document.getElementById('limit-msg');
  const btnUpgrade = document.getElementById('btn-upgrade');
  const btnReplacePick = document.getElementById('btn-replace-pick');
  const btnLimitCancel = document.getElementById('btn-limit-cancel');
  const replaceListEl = document.getElementById('replace-list');
  const btnReplaceBack = document.getElementById('btn-replace-back');
  const confirmScriptName = document.getElementById('confirm-script-name');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');
  const btnConfirmCancel = document.getElementById('btn-confirm-cancel');

  let capturedFields = [];
  let lastReplayScriptId = null;
  let allScripts = [];
  let selectedScriptId = null;
  let pendingSave = null;         // script object awaiting save after replace
  let limitExistingScripts = [];  // scripts shown in the replace picker
  let replaceScriptId = null;     // script chosen to be replaced

  // ─── Helpers ─────────────────────────────────────────────
  function showView(view) {
    viewIdle.classList.add('hidden');
    viewRecording.classList.add('hidden');
    viewSave.classList.add('hidden');
    viewResults.classList.add('hidden');
    viewLimit.classList.add('hidden');
    viewReplace.classList.add('hidden');
    viewConfirm.classList.add('hidden');
    view.classList.remove('hidden');
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['services/recorder.js', 'content.js'],
      });
    }
  }

  async function sendToTab(tabId, msg) {
    await ensureContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, msg);
  }

  function sendToBackground(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  // ─── Search-select component ───────────────────────────
  async function loadScripts() {
    allScripts = await sendToBackground({ type: 'GET_SCRIPTS_FLAT' });
    selectedScriptId = null;
    scriptSearch.value = '';
    btnFill.disabled = true;
    renderSearchList(allScripts);
  }

  function renderSearchList(scripts) {
    searchList.innerHTML = '';
    if (scripts.length === 0) {
      searchList.classList.add('hidden');
      return;
    }
    for (const s of scripts) {
      const li = document.createElement('li');
      li.dataset.id = s.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'script-name';
      nameSpan.textContent = s.name;
      li.appendChild(nameSpan);

      const context = [];
      if (s.site_label) context.push(s.site_label);
      if (s.persona_name) context.push(s.persona_name);
      if (context.length > 0) {
        const ctxSpan = document.createElement('span');
        ctxSpan.className = 'script-context';
        ctxSpan.textContent = context.join(' > ');
        li.appendChild(ctxSpan);
      }

      li.addEventListener('click', () => selectScript(s));
      searchList.appendChild(li);
    }
  }

  function selectScript(script) {
    selectedScriptId = script.id;
    scriptSearch.value = script.name;
    searchList.classList.add('hidden');
    btnFill.disabled = false;

    // Highlight selected in list
    searchList.querySelectorAll('li').forEach((li) => {
      li.classList.toggle('selected', li.dataset.id === script.id);
    });
  }

  function filterScripts(query) {
    const q = query.toLowerCase();
    if (!q) {
      renderSearchList(allScripts);
      searchList.classList.toggle('hidden', allScripts.length === 0);
      return;
    }
    const filtered = allScripts.filter((s) => {
      return (
        s.name.toLowerCase().includes(q) ||
        (s.site_label && s.site_label.toLowerCase().includes(q)) ||
        (s.persona_name && s.persona_name.toLowerCase().includes(q))
      );
    });
    renderSearchList(filtered);
    searchList.classList.toggle('hidden', filtered.length === 0);
  }

  scriptSearch.addEventListener('input', () => {
    selectedScriptId = null;
    btnFill.disabled = true;
    filterScripts(scriptSearch.value);
  });

  scriptSearch.addEventListener('focus', () => {
    if (allScripts.length > 0) {
      filterScripts(scriptSearch.value);
      searchList.classList.remove('hidden');
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-select')) {
      searchList.classList.add('hidden');
    }
  });

  // Keyboard navigation in search list
  scriptSearch.addEventListener('keydown', (e) => {
    const items = searchList.querySelectorAll('li');
    if (items.length === 0) return;

    const current = searchList.querySelector('li.highlighted');
    let idx = current ? Array.from(items).indexOf(current) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (current) current.classList.remove('highlighted');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (current) current.classList.remove('highlighted');
      idx = idx <= 0 ? items.length - 1 : idx - 1;
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) {
        const id = current.dataset.id;
        const script = allScripts.find((s) => s.id === id);
        if (script) selectScript(script);
      }
    } else if (e.key === 'Escape') {
      searchList.classList.add('hidden');
    }
  });

  // ─── Init ────────────────────────────────────────────────
  const bgState = await sendToBackground({ type: 'GET_STATE' });
  if (bgState.pendingFields) {
    capturedFields = bgState.pendingFields;
    await sendToBackground({ type: 'CLEAR_PENDING_FIELDS' });
    saveFieldCount.textContent = capturedFields.length;
    scriptNameInput.value = '';
    // Show site hint
    const tab = await getActiveTab();
    if (tab?.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        saveSiteHint.textContent = hostname;
      } catch { saveSiteHint.textContent = ''; }
    }
    showView(viewSave);
  } else if (bgState.recording) {
    fieldCount.textContent = bgState.capturedFieldCount || 0;
    showView(viewRecording);
  } else {
    // Check for cross-page replay results
    const crossPageResults = await sendToBackground({ type: 'GET_REPLAY_RESULTS' });
    if (crossPageResults) {
      await sendToBackground({ type: 'CLEAR_REPLAY_RESULTS' });
      showResults(crossPageResults);
    } else {
      showView(viewIdle);
      await loadScripts();
    }
  }

  // ─── Idle events ─────────────────────────────────────────
  btnRecord.addEventListener('click', async () => {
    try {
      const tab = await getActiveTab();
      await sendToBackground({ type: 'SET_RECORDING_TAB', tabId: tab.id });
      await sendToTab(tab.id, { type: 'START_RECORDING' });
      fieldCount.textContent = '0';
      showView(viewRecording);
    } catch (err) {
      console.error('Failed to start recording:', err);
      await sendToBackground({ type: 'CLEAR_RECORDING_TAB' });
    }
  });

  btnFill.addEventListener('click', async () => {
    if (!selectedScriptId) return;
    const script = await sendToBackground({ type: 'GET_SCRIPT', id: selectedScriptId });
    if (!script) return;

    try {
      lastReplayScriptId = selectedScriptId;
      const tab = await getActiveTab();
      const results = await sendToTab(tab.id, { type: 'REPLAY_SCRIPT', fields: script.fields });
      showResults(results);
    } catch (err) {
      console.error('Failed to replay:', err);
    }
  });

  linkOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // ─── Sync status ──────────────────────────────────────
  const syncStatus = document.getElementById('sync-status');
  const syncIndicator = document.getElementById('sync-indicator');
  const linkLogin = document.getElementById('link-login');

  async function updateSyncStatus() {
    try {
      const auth = await sendToBackground({ type: 'GET_AUTH_STATUS' });
      if (auth.authenticated) {
        linkLogin.classList.add('hidden');
        const lastSync = auth.lastSyncedAt
          ? `Synced ${new Date(auth.lastSyncedAt).toLocaleTimeString()}`
          : 'Not synced yet';
        syncIndicator.textContent = `${auth.user?.name || 'Connected'} · ${lastSync}`;
        syncIndicator.classList.remove('hidden');
      } else {
        syncIndicator.classList.add('hidden');
        linkLogin.classList.remove('hidden');
      }
    } catch {
      syncIndicator.classList.add('hidden');
      linkLogin.classList.remove('hidden');
    }
  }

  linkLogin.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://steno-web.test/auth/extension-login' });
  });

  updateSyncStatus();

  // ─── Recording events ───────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'FIELD_CAPTURED' || msg.type === 'STEP_CAPTURED') {
      const count = parseInt(fieldCount.textContent, 10) + 1;
      fieldCount.textContent = count;
    }
  });

  btnStop.addEventListener('click', async () => {
    try {
      const tab = await getActiveTab();
      const response = await sendToTab(tab.id, { type: 'STOP_RECORDING' });
      capturedFields = response.fields || [];
    } catch (err) {
      console.warn('Could not reach content script on stop:', err);
      capturedFields = [];
    }
    await sendToBackground({ type: 'CLEAR_RECORDING_TAB' });

    saveFieldCount.textContent = capturedFields.length;
    scriptNameInput.value = '';
    // Show site hint
    const tab = await getActiveTab();
    if (tab?.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        saveSiteHint.textContent = hostname;
      } catch { saveSiteHint.textContent = ''; }
    }
    showView(viewSave);
  });

  btnDiscard.addEventListener('click', async () => {
    try {
      const tab = await getActiveTab();
      await sendToTab(tab.id, { type: 'STOP_RECORDING' });
    } catch { /* Content script unreachable */ }
    await sendToBackground({ type: 'CLEAR_RECORDING_TAB' });
    capturedFields = [];
    await loadScripts();
    showView(viewIdle);
  });

  // ─── Save events ─────────────────────────────────────────

  async function buildScriptFromForm() {
    const name = scriptNameInput.value.trim();
    if (!name) return null;

    const tab = await getActiveTab();
    let siteId = null;

    if (tab?.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        let site = await sendToBackground({ type: 'GET_SITE_BY_HOSTNAME', hostname });
        if (!site) {
          site = await sendToBackground({
            type: 'SAVE_SITE',
            site: { id: crypto.randomUUID(), hostname, label: hostname },
          });
        }
        siteId = site.id;
      } catch { /* leave siteId null */ }
    }

    return {
      id: crypto.randomUUID(),
      site_id: siteId,
      persona_id: null,
      name,
      created_by: '',
      url_hint: tab?.url || '',
      fields: capturedFields,
    };
  }

  async function finishSave(script, { force = false } = {}) {
    const result = await sendToBackground({ type: 'SAVE_SCRIPT', script, force });
    if (result && !result.ok) {
      console.error('Save failed:', result.error);
      return;
    }
    capturedFields = [];
    pendingSave = null;
    await loadScripts();
    selectScript({ ...script, site_label: '', persona_name: '' });
    showView(viewIdle);
  }

  btnSave.addEventListener('click', async () => {
    const script = await buildScriptFromForm();
    if (!script) { scriptNameInput.focus(); return; }

    // Check free-tier limit
    const limit = await sendToBackground({ type: 'GET_SCRIPT_LIMIT' });
    if (limit !== null) {
      const existingScripts = await sendToBackground({ type: 'GET_SCRIPTS_FLAT' });
      if (existingScripts.length >= limit) {
        pendingSave = script;
        limitExistingScripts = existingScripts;
        limitMsg.innerHTML = `You\u2019ve reached your free plan limit of <strong>${limit} scripts</strong>. Upgrade for unlimited scripts, cloud sync, and more.`;
        showView(viewLimit);
        return;
      }
    }

    await finishSave(script);
  });

  btnSaveDiscard.addEventListener('click', async () => {
    capturedFields = [];
    await loadScripts();
    showView(viewIdle);
  });

  // ─── Limit / Replace flow ────────────────────────────────

  btnUpgrade.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://steno-web.test/pricing' });
  });

  btnReplacePick.addEventListener('click', () => {
    replaceListEl.innerHTML = '';
    for (const s of limitExistingScripts) {
      const li = document.createElement('li');
      li.dataset.id = s.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'replace-name';
      nameSpan.textContent = s.name;
      li.appendChild(nameSpan);

      if (s.site_label) {
        const siteSpan = document.createElement('span');
        siteSpan.className = 'replace-site';
        siteSpan.textContent = s.site_label;
        li.appendChild(siteSpan);
      }

      li.addEventListener('click', () => {
        replaceScriptId = s.id;
        confirmScriptName.textContent = s.name;
        showView(viewConfirm);
      });

      replaceListEl.appendChild(li);
    }
    showView(viewReplace);
  });

  btnLimitCancel.addEventListener('click', () => {
    pendingSave = null;
    showView(viewSave);
  });

  btnReplaceBack.addEventListener('click', () => {
    showView(viewLimit);
  });

  btnConfirmDelete.addEventListener('click', async () => {
    if (!replaceScriptId || !pendingSave) return;
    await sendToBackground({ type: 'DELETE_SCRIPT', id: replaceScriptId });
    const savedScript = pendingSave;
    replaceScriptId = null;
    await finishSave(savedScript, { force: true });
  });

  btnConfirmCancel.addEventListener('click', () => {
    replaceScriptId = null;
    showView(viewReplace);
  });

  // ─── Results ─────────────────────────────────────────────
  function showResults(results) {
    const parts = [];
    parts.push(`${results.filled} field${results.filled !== 1 ? 's' : ''} filled`);
    if (results.clicked > 0) {
      parts.push(`${results.clicked} click${results.clicked !== 1 ? 's' : ''} executed`);
    }
    resultFilled.textContent = parts.join(', ');

    if (results.aborted) {
      resultSkipped.textContent = 'Replay aborted (cross-domain navigation)';
      resultSkipped.classList.remove('hidden');
    } else if (results.skipped > 0) {
      resultSkipped.textContent = `${results.skipped} step${results.skipped !== 1 ? 's' : ''} not found`;
      resultSkipped.classList.remove('hidden');
    } else {
      resultSkipped.classList.add('hidden');
    }

    if (results.warnings && results.warnings.length > 0) {
      resultWarnings.innerHTML = '';
      for (const w of results.warnings) {
        const li = document.createElement('li');
        li.textContent = w;
        resultWarnings.appendChild(li);
      }
      resultWarnings.classList.remove('hidden');
    } else {
      resultWarnings.classList.add('hidden');
    }

    showView(viewResults);
  }

  btnFillAgain.addEventListener('click', async () => {
    if (!lastReplayScriptId) return;
    const script = await sendToBackground({ type: 'GET_SCRIPT', id: lastReplayScriptId });
    if (!script) return;
    try {
      const tab = await getActiveTab();
      const results = await sendToTab(tab.id, { type: 'REPLAY_SCRIPT', fields: script.fields });
      showResults(results);
    } catch (err) {
      console.error('Failed to replay:', err);
    }
  });

  btnBack.addEventListener('click', async () => {
    await loadScripts();
    showView(viewIdle);
  });
})();
