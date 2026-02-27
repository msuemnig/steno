/**
 * Content script — injected into every page.
 * Handles recording (capturing input events), replay (injecting values),
 * and the on-page recording HUD.
 */
(() => {
  let recording = false;
  let fieldOrder = 0;
  let capturedFields = [];
  let overlayEl = null;
  let recordingStartTime = null;
  let timerInterval = null;
  let lastCapturedLabel = '';

  const CLICK_TARGETS = 'button, a, [role="button"], input[type="submit"], input[type="button"]';

  // ─── Extension auth token listener ───────────────────────
  // Listens for STENO_AUTH_TOKEN postMessage on the steno domain
  if (window.location.hostname === 'steno-web.test' || window.location.hostname === 'localhost') {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'STENO_AUTH_TOKEN') return;
      if (!event.data.token || !event.data.user) return;

      chrome.runtime.sendMessage({
        type: 'SET_AUTH_TOKEN',
        token: event.data.token,
        user: event.data.user,
      });
    });
  }

  // ─── Recording HUD ──────────────────────────────────────

  async function createOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'steno-hud';
    overlayEl.attachShadow({ mode: 'open' });
    // Detect theme: ask background for stored pref, fall back to OS
    let hudTheme = 'dark';
    try {
      const stored = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_THEME' }, resolve);
      });
      if (stored === 'light') {
        hudTheme = 'light';
      } else if (stored === 'system') {
        hudTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
    } catch { /* default dark */ }

    const isLight = hudTheme === 'light';
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
      :host { all: initial; position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; font-family: 'DM Sans', system-ui, sans-serif; }
      .hud {
        --hud-bg: ${isLight ? '#ffffffee' : '#1a1a1eee'};
        --hud-border: ${isLight ? '#d4d4d8' : '#333338'};
        --hud-text: ${isLight ? '#18181b' : '#e4e4e7'};
        --hud-muted: #71717a; --hud-accent: #38bdf8;
        --hud-shadow: ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.5)'};
        --hud-hint: ${isLight ? '#a1a1aa' : '#52525b'};
        --hud-last-val: ${isLight ? '#3f3f46' : '#a1a1aa'};
        --hud-divider: ${isLight ? '#e4e4e7' : '#333338'};
        background: var(--hud-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--hud-border); border-radius: 6px; padding: 12px 14px; width: 240px;
        color: var(--hud-text); font-size: 12px; line-height: 1.4; box-shadow: 0 4px 24px var(--hud-shadow); user-select: none;
      }
      .hud-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .hud-dot { width: 6px; height: 6px; background: #ef4444; border-radius: 50%; flex-shrink: 0; animation: blink 1s steps(1) infinite; }
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      .hud-brand { display: flex; align-items: center; gap: 4px; flex-grow: 1; }
      .hud-mark { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--hud-accent); }
      .hud-title { font-weight: 700; font-size: 12px; letter-spacing: -0.2px; }
      .hud-timer { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--hud-muted); font-variant-numeric: tabular-nums; }
      .hud-stats { display: flex; gap: 20px; margin-bottom: 8px; }
      .hud-stat-value { font-family: 'JetBrains Mono', monospace; font-size: 24px; font-weight: 600; color: var(--hud-accent); line-height: 1; }
      .hud-stat-label { font-size: 9px; font-weight: 600; color: var(--hud-muted); text-transform: uppercase; letter-spacing: 0.8px; }
      .hud-stat-wrap { position: relative; display: inline-block; }
      .hud-fragile-badge { position: absolute; top: -4px; right: -8px; font-size: 9px; color: #fbbf24; }
      .hud-last { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--hud-muted); margin-bottom: 10px; min-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hud-last span { color: var(--hud-last-val); }
      .hud-hint { font-size: 10px; color: var(--hud-hint); margin-bottom: 10px; padding-top: 8px; border-top: 1px solid var(--hud-divider); }
      .hud-stop { display: block; width: 100%; padding: 7px; background: var(--hud-accent); color: #1a1a1e; font-family: 'DM Sans', system-ui, sans-serif; font-size: 11px; font-weight: 700; border: none; border-radius: 4px; cursor: pointer; transition: background 0.12s; letter-spacing: 0.2px; }
      .hud-stop:hover { background: #56ccf9; }
      .hidden { display: none !important; }
    `;
    overlayEl.shadowRoot.appendChild(style);

    const hud = document.createElement('div');
    hud.className = 'hud';

    const header = document.createElement('div');
    header.className = 'hud-header';
    const dot = document.createElement('div');
    dot.className = 'hud-dot';
    header.appendChild(dot);
    const brand = document.createElement('div');
    brand.className = 'hud-brand';
    const mark = document.createElement('span');
    mark.className = 'hud-mark';
    mark.textContent = '>_';
    brand.appendChild(mark);
    const title = document.createElement('span');
    title.className = 'hud-title';
    title.textContent = 'Steno';
    brand.appendChild(title);
    header.appendChild(brand);
    const timer = document.createElement('div');
    timer.className = 'hud-timer';
    timer.id = 'hud-timer';
    timer.textContent = '0:00';
    header.appendChild(timer);
    hud.appendChild(header);

    const stats = document.createElement('div');
    stats.className = 'hud-stats';
    const fieldsStat = document.createElement('div');
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'hud-stat-wrap';
    const fieldsVal = document.createElement('div');
    fieldsVal.className = 'hud-stat-value';
    fieldsVal.id = 'hud-count';
    fieldsVal.textContent = '0';
    fieldsWrap.appendChild(fieldsVal);
    const fragileBadge = document.createElement('span');
    fragileBadge.className = 'hud-fragile-badge hidden';
    fragileBadge.id = 'hud-fragile-badge';
    fieldsWrap.appendChild(fragileBadge);
    fieldsStat.appendChild(fieldsWrap);
    const fieldsLabel = document.createElement('div');
    fieldsLabel.className = 'hud-stat-label';
    fieldsLabel.textContent = 'Fields';
    fieldsStat.appendChild(fieldsLabel);
    stats.appendChild(fieldsStat);
    const clicksStat = document.createElement('div');
    const clicksVal = document.createElement('div');
    clicksVal.className = 'hud-stat-value';
    clicksVal.id = 'hud-clicks';
    clicksVal.textContent = '0';
    clicksStat.appendChild(clicksVal);
    const clicksLabel = document.createElement('div');
    clicksLabel.className = 'hud-stat-label';
    clicksLabel.textContent = 'Clicks';
    clicksStat.appendChild(clicksLabel);
    stats.appendChild(clicksStat);
    hud.appendChild(stats);

    const last = document.createElement('div');
    last.className = 'hud-last';
    last.id = 'hud-last';
    hud.appendChild(last);

    const hint = document.createElement('div');
    hint.className = 'hud-hint';
    hint.textContent = 'Fill the form, then stop to save.';
    hud.appendChild(hint);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'hud-stop';
    stopBtn.id = 'hud-stop';
    stopBtn.textContent = 'Stop & save';
    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OVERLAY_STOP_CLICKED' });
    });
    hud.appendChild(stopBtn);

    overlayEl.shadowRoot.appendChild(hud);
    document.documentElement.appendChild(overlayEl);
  }

  function updateOverlay() {
    if (!overlayEl) return;
    const root = overlayEl.shadowRoot;
    const countEl = root.getElementById('hud-count');
    const clicksEl = root.getElementById('hud-clicks');
    const fragileBadge = root.getElementById('hud-fragile-badge');
    const lastEl = root.getElementById('hud-last');

    const fills = capturedFields.filter((f) => f.action !== 'click').length;
    const clicks = capturedFields.filter((f) => f.action === 'click').length;
    const fragileCount = capturedFields.filter((f) => f.fragile).length;

    if (countEl) countEl.textContent = fills;
    if (clicksEl) clicksEl.textContent = clicks;
    if (fragileBadge) {
      if (fragileCount > 0) {
        fragileBadge.textContent = '\u26A0' + fragileCount;
        fragileBadge.classList.remove('hidden');
      } else {
        fragileBadge.classList.add('hidden');
      }
    }
    if (lastEl) {
      lastEl.textContent = '';
      if (lastCapturedLabel) {
        lastEl.appendChild(document.createTextNode('last '));
        const span = document.createElement('span');
        span.textContent = lastCapturedLabel;
        lastEl.appendChild(span);
      }
    }
  }

  function startTimer() {
    recordingStartTime = Date.now();
    timerInterval = setInterval(() => {
      if (!overlayEl) return;
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = String(elapsed % 60).padStart(2, '0');
      const timerEl = overlayEl.shadowRoot.getElementById('hud-timer');
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function removeOverlay() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  // ─── Recording ───────────────────────────────────────────

  function onInput(e) {
    if (!recording) return;
    const el = e.target;
    if (!isFormElement(el)) return;

    const { selector, fragile } = Recorder.getSelector(el);
    const type = Recorder.getFieldType(el);
    const value = Recorder.getValue(el);
    const label = Recorder.getLabel(el);

    // Dedupe: update existing entry for same selector instead of adding duplicates
    const existing = capturedFields.find((f) => f.selector === selector);
    if (existing) {
      existing.value = value;
      lastCapturedLabel = label || selector;
      updateOverlay();
    } else {
      fieldOrder++;
      const field = { order: fieldOrder, action: 'fill', selector, value, type, label, fragile };
      capturedFields.push(field);
      lastCapturedLabel = label || selector;
      chrome.runtime.sendMessage({ type: 'FIELD_CAPTURED', field });
      updateOverlay();
    }
  }

  function onClickCapture(e) {
    if (!recording) return;
    const el = e.target.closest(CLICK_TARGETS);
    if (!el) return;

    // Skip form fields (already handled by onInput), except submit/button inputs
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const inputType = (el.type || '').toLowerCase();
      if (inputType !== 'submit' && inputType !== 'button') return;
    }

    // Skip labels (clicking a label focuses the input, handled by onInput)
    if (tag === 'label' || el.closest('label')) return;

    // Skip HUD overlay
    if (el.closest('#steno-hud') || (overlayEl && overlayEl.contains(el))) return;

    const { selector, fragile } = Recorder.getSelector(el);
    const label = Recorder.getClickLabel(el);

    fieldOrder++;
    const step = { order: fieldOrder, action: 'click', selector, label, fragile };
    capturedFields.push(step);
    lastCapturedLabel = label || selector;
    chrome.runtime.sendMessage({ type: 'STEP_CAPTURED', field: step });
    updateOverlay();
  }

  function isFormElement(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea';
  }

  async function startRecording() {
    recording = true;
    fieldOrder = 0;
    capturedFields = [];
    lastCapturedLabel = '';
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('click', onClickCapture, true);
    await createOverlay();
    startTimer();
  }

  function stopRecording() {
    recording = false;
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onInput, true);
    document.removeEventListener('click', onClickCapture, true);
    removeOverlay();
    return capturedFields;
  }

  // ─── Replay ──────────────────────────────────────────────

  async function replayScript(fields, startIndex = 0) {
    const results = { filled: 0, clicked: 0, skipped: 0, warnings: [], lastIndex: startIndex };
    const sorted = [...fields].sort((a, b) => a.order - b.order);

    for (let i = startIndex; i < sorted.length; i++) {
      const step = sorted[i];
      const action = step.action || 'fill';

      const el = await waitForElement(step.selector, 3000);
      if (!el) {
        results.skipped++;
        results.warnings.push(`${step.selector} (${step.label})`);
        results.lastIndex = i;
        continue;
      }

      if (action === 'click') {
        // Notify background before clicking (in case nav destroys this script)
        chrome.runtime.sendMessage({ type: 'REPLAY_PROGRESS', lastCompletedIndex: i });
        el.click();
        results.clicked++;
        results.lastIndex = i;
        await waitForDomSettle(300);
      } else {
        setValue(el, step.value, step.type);
        results.filled++;
        results.lastIndex = i;
        await waitForDomSettle(150);
      }
    }

    return results;
  }

  function setValue(el, value, type) {
    if (type === 'checkbox') {
      if (el.checked !== value) {
        el.checked = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    if (type === 'radio') {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (type === 'select') {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waitForElement(selector, timeout) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      let resolved = false;
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          resolved = true;
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        if (!resolved) {
          observer.disconnect();
          resolve(null);
        }
      }, timeout);
    });
  }

  function waitForDomSettle(quietMs) {
    return new Promise((resolve) => {
      let timer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, quietMs);
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, quietMs);
    });
  }

  // ─── Message handling ────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'START_RECORDING') {
      startRecording();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'STOP_RECORDING') {
      const fields = stopRecording();
      sendResponse({ ok: true, fields });
      return;
    }

    if (msg.type === 'REPLAY_SCRIPT' || msg.type === 'REPLAY_PROFILE') {
      chrome.runtime.sendMessage({ type: 'REPLAY_STARTED', fields: msg.fields });
      replayScript(msg.fields).then((results) => {
        chrome.runtime.sendMessage({ type: 'REPLAY_FINISHED', results });
        sendResponse(results);
      });
      return true;
    }

    if (msg.type === 'CONTINUE_REPLAY') {
      replayScript(msg.fields, msg.startIndex).then((results) => {
        chrome.runtime.sendMessage({ type: 'REPLAY_FINISHED', results });
        sendResponse(results);
      });
      return true;
    }
  });
})();
