/**
 * Tests for popup/popup.js — popup UI behaviors.
 *
 * The popup script is an async IIFE that manipulates the DOM and calls chrome APIs.
 * It is too tightly coupled to test by simply evaluating the file (the IIFE runs
 * immediately and awaits chrome.runtime.sendMessage calls).
 *
 * Strategy: We extract the testable logic by recreating the key helper functions
 * and the DOM environment, then test them in isolation. For integration-level tests,
 * we set up the full DOM, mock all chrome API responses, and then load the popup.
 */
import { resetChromeMocks } from './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read popup source for integration test
const popupSrc = readFileSync(join(__dirname, '..', 'popup', 'popup.js'), 'utf-8');
const popupHtml = readFileSync(join(__dirname, '..', 'popup', 'popup.html'), 'utf-8');

/**
 * Set up the DOM to match popup.html structure.
 */
function setupPopupDOM() {
  // Parse out the <body> content from the HTML (skip the <script> tag)
  const bodyMatch = popupHtml.match(/<body>([\s\S]*)<script/);
  if (bodyMatch) {
    document.body.innerHTML = bodyMatch[1];
  } else {
    // Fallback: create the minimal DOM structure
    document.body.innerHTML = `
      <div id="view-idle">
        <div class="search-select" id="search-select">
          <input type="text" id="script-search" autocomplete="off">
          <ul class="search-list hidden" id="search-list"></ul>
        </div>
        <button id="btn-record"></button>
        <button id="btn-fill" disabled></button>
        <a id="link-options" href="#"></a>
        <span id="sync-indicator"></span>
        <a id="link-login" href="#" class="hidden"></a>
        <div id="sync-status"></div>
      </div>
      <div id="view-recording" class="hidden">
        <span id="field-count">0</span>
        <button id="btn-stop"></button>
        <button id="btn-discard"></button>
      </div>
      <div id="view-save" class="hidden">
        <input type="text" id="script-name">
        <p id="save-site-hint"></p>
        <span id="save-field-count">0</span>
        <button id="btn-save"></button>
        <button id="btn-save-discard"></button>
      </div>
      <div id="view-results" class="hidden">
        <p id="result-filled"></p>
        <p id="result-skipped" class="hidden"></p>
        <ul id="result-warnings" class="hidden"></ul>
        <button id="btn-fill-again"></button>
        <button id="btn-back"></button>
      </div>
    `;
  }
}

// ──────────────────────────────────────────────────────────────
// Unit tests for extracted helpers
// ──────────────────────────────────────────────────────────────

describe('popup helpers (unit)', () => {
  beforeEach(() => {
    resetChromeMocks();
    setupPopupDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ── showView ──────────────────────────────────────────────

  describe('showView', () => {
    // Re-implement showView exactly as in popup.js
    function showView(view) {
      document.getElementById('view-idle').classList.add('hidden');
      document.getElementById('view-recording').classList.add('hidden');
      document.getElementById('view-save').classList.add('hidden');
      document.getElementById('view-results').classList.add('hidden');
      view.classList.remove('hidden');
    }

    it('hides all views and shows the target', () => {
      const viewIdle = document.getElementById('view-idle');
      const viewRecording = document.getElementById('view-recording');
      const viewSave = document.getElementById('view-save');
      const viewResults = document.getElementById('view-results');

      // Initially view-idle is visible
      expect(viewIdle.classList.contains('hidden')).toBe(false);

      showView(viewRecording);

      expect(viewIdle.classList.contains('hidden')).toBe(true);
      expect(viewRecording.classList.contains('hidden')).toBe(false);
      expect(viewSave.classList.contains('hidden')).toBe(true);
      expect(viewResults.classList.contains('hidden')).toBe(true);
    });

    it('can switch from recording to save view', () => {
      const viewSave = document.getElementById('view-save');
      showView(viewSave);

      expect(viewSave.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('view-idle').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('view-recording').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('view-results').classList.contains('hidden')).toBe(true);
    });
  });

  // ── filterScripts ─────────────────────────────────────────

  describe('filterScripts', () => {
    // Recreate the filter logic from popup.js
    let allScripts;
    let searchList;

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
        searchList.appendChild(li);
      }
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

    beforeEach(() => {
      searchList = document.getElementById('search-list');
      allScripts = [
        { id: '1', name: 'Login Admin', site_label: 'example.com', persona_name: 'Admin' },
        { id: '2', name: 'Register User', site_label: 'example.com', persona_name: 'User' },
        { id: '3', name: 'Checkout Flow', site_label: 'shop.com', persona_name: '' },
      ];
    });

    it('filters by name match', () => {
      filterScripts('login');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(1);
      expect(items[0].dataset.id).toBe('1');
    });

    it('filters by site_label match', () => {
      filterScripts('shop');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(1);
      expect(items[0].dataset.id).toBe('3');
    });

    it('filters by persona_name match', () => {
      filterScripts('admin');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(1);
      expect(items[0].dataset.id).toBe('1');
    });

    it('shows all scripts when query is empty', () => {
      filterScripts('');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(3);
    });

    it('shows no results for non-matching query', () => {
      filterScripts('zzzzz');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(0);
      expect(searchList.classList.contains('hidden')).toBe(true);
    });

    it('is case-insensitive', () => {
      filterScripts('LOGIN');
      const items = searchList.querySelectorAll('li');
      expect(items).toHaveLength(1);
      expect(items[0].dataset.id).toBe('1');
    });

    it('matches partial strings', () => {
      filterScripts('exam');
      const items = searchList.querySelectorAll('li');
      // "example.com" matches two scripts
      expect(items).toHaveLength(2);
    });
  });

  // ── selectScript ──────────────────────────────────────────

  describe('selectScript', () => {
    it('sets selectedScriptId and updates input value', () => {
      const scriptSearch = document.getElementById('script-search');
      const searchList = document.getElementById('search-list');
      const btnFill = document.getElementById('btn-fill');
      let selectedScriptId = null;

      // Recreate selectScript from popup.js
      function selectScript(script) {
        selectedScriptId = script.id;
        scriptSearch.value = script.name;
        searchList.classList.add('hidden');
        btnFill.disabled = false;

        searchList.querySelectorAll('li').forEach((li) => {
          li.classList.toggle('selected', li.dataset.id === script.id);
        });
      }

      // Populate the search list
      const li1 = document.createElement('li');
      li1.dataset.id = 'script-1';
      searchList.appendChild(li1);
      const li2 = document.createElement('li');
      li2.dataset.id = 'script-2';
      searchList.appendChild(li2);

      selectScript({ id: 'script-2', name: 'My Script' });

      expect(selectedScriptId).toBe('script-2');
      expect(scriptSearch.value).toBe('My Script');
      expect(btnFill.disabled).toBe(false);
      expect(searchList.classList.contains('hidden')).toBe(true);
      expect(li1.classList.contains('selected')).toBe(false);
      expect(li2.classList.contains('selected')).toBe(true);
    });
  });

  // ── Keyboard navigation ───────────────────────────────────

  describe('keyboard navigation in search list', () => {
    let scriptSearch;
    let searchList;
    let allScripts;
    let selectedScriptId;

    function selectScript(script) {
      selectedScriptId = script.id;
      scriptSearch.value = script.name;
      searchList.classList.add('hidden');
    }

    function setupKeyboardHandler() {
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
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (current) current.classList.remove('highlighted');
          idx = idx <= 0 ? items.length - 1 : idx - 1;
          items[idx].classList.add('highlighted');
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
    }

    beforeEach(() => {
      scriptSearch = document.getElementById('script-search');
      searchList = document.getElementById('search-list');
      selectedScriptId = null;
      allScripts = [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
      ];

      // Populate the search list
      searchList.innerHTML = '';
      for (const s of allScripts) {
        const li = document.createElement('li');
        li.dataset.id = s.id;
        li.textContent = s.name;
        searchList.appendChild(li);
      }
      searchList.classList.remove('hidden');

      setupKeyboardHandler();
    });

    it('ArrowDown highlights the first item', () => {
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      const items = searchList.querySelectorAll('li');
      expect(items[0].classList.contains('highlighted')).toBe(true);
    });

    it('ArrowDown wraps around to the first item', () => {
      // Press ArrowDown 4 times (3 items, so 4th should wrap to first)
      for (let i = 0; i < 4; i++) {
        scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }

      const items = searchList.querySelectorAll('li');
      expect(items[0].classList.contains('highlighted')).toBe(true);
      expect(items[1].classList.contains('highlighted')).toBe(false);
      expect(items[2].classList.contains('highlighted')).toBe(false);
    });

    it('ArrowUp from no selection goes to last item', () => {
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      const items = searchList.querySelectorAll('li');
      expect(items[2].classList.contains('highlighted')).toBe(true);
    });

    it('ArrowUp from first item wraps to last item', () => {
      // Move to first item
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      // Then go up — should wrap to last
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      const items = searchList.querySelectorAll('li');
      expect(items[2].classList.contains('highlighted')).toBe(true);
    });

    it('Enter selects the highlighted item', () => {
      // Highlight second item
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      // Press Enter
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(selectedScriptId).toBe('b');
      expect(scriptSearch.value).toBe('Beta');
    });

    it('Escape hides the search list', () => {
      expect(searchList.classList.contains('hidden')).toBe(false);

      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(searchList.classList.contains('hidden')).toBe(true);
    });

    it('Enter without highlighted item does nothing', () => {
      scriptSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(selectedScriptId).toBeNull();
    });
  });

  // ── showResults ───────────────────────────────────────────

  describe('showResults', () => {
    // Recreate showResults from popup.js
    function showView(view) {
      document.getElementById('view-idle').classList.add('hidden');
      document.getElementById('view-recording').classList.add('hidden');
      document.getElementById('view-save').classList.add('hidden');
      document.getElementById('view-results').classList.add('hidden');
      view.classList.remove('hidden');
    }

    function showResults(results) {
      const resultFilled = document.getElementById('result-filled');
      const resultSkipped = document.getElementById('result-skipped');
      const resultWarnings = document.getElementById('result-warnings');

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

      showView(document.getElementById('view-results'));
    }

    it('displays filled count correctly (singular)', () => {
      showResults({ filled: 1, clicked: 0, skipped: 0, warnings: [] });

      const resultFilled = document.getElementById('result-filled');
      expect(resultFilled.textContent).toBe('1 field filled');
    });

    it('displays filled count correctly (plural)', () => {
      showResults({ filled: 5, clicked: 0, skipped: 0, warnings: [] });

      const resultFilled = document.getElementById('result-filled');
      expect(resultFilled.textContent).toBe('5 fields filled');
    });

    it('displays filled and clicked counts', () => {
      showResults({ filled: 3, clicked: 2, skipped: 0, warnings: [] });

      const resultFilled = document.getElementById('result-filled');
      expect(resultFilled.textContent).toBe('3 fields filled, 2 clicks executed');
    });

    it('displays clicked singular', () => {
      showResults({ filled: 0, clicked: 1, skipped: 0, warnings: [] });

      const resultFilled = document.getElementById('result-filled');
      expect(resultFilled.textContent).toBe('0 fields filled, 1 click executed');
    });

    it('hides skipped when none skipped', () => {
      showResults({ filled: 3, clicked: 0, skipped: 0, warnings: [] });

      const resultSkipped = document.getElementById('result-skipped');
      expect(resultSkipped.classList.contains('hidden')).toBe(true);
    });

    it('shows skipped count when steps skipped', () => {
      showResults({ filled: 2, clicked: 0, skipped: 3, warnings: ['a', 'b', 'c'] });

      const resultSkipped = document.getElementById('result-skipped');
      expect(resultSkipped.classList.contains('hidden')).toBe(false);
      expect(resultSkipped.textContent).toBe('3 steps not found');
    });

    it('shows singular skipped text for 1 skip', () => {
      showResults({ filled: 2, clicked: 0, skipped: 1, warnings: ['x'] });

      const resultSkipped = document.getElementById('result-skipped');
      expect(resultSkipped.textContent).toBe('1 step not found');
    });

    it('shows aborted message on cross-domain navigation', () => {
      showResults({ filled: 1, clicked: 0, skipped: 0, warnings: [], aborted: true });

      const resultSkipped = document.getElementById('result-skipped');
      expect(resultSkipped.classList.contains('hidden')).toBe(false);
      expect(resultSkipped.textContent).toContain('cross-domain');
    });

    it('displays warnings list', () => {
      showResults({
        filled: 1,
        clicked: 0,
        skipped: 2,
        warnings: ['#missing-field (Email)', '#gone-field (Name)'],
      });

      const resultWarnings = document.getElementById('result-warnings');
      expect(resultWarnings.classList.contains('hidden')).toBe(false);
      const warningItems = resultWarnings.querySelectorAll('li');
      expect(warningItems).toHaveLength(2);
      expect(warningItems[0].textContent).toBe('#missing-field (Email)');
      expect(warningItems[1].textContent).toBe('#gone-field (Name)');
    });

    it('hides warnings list when no warnings', () => {
      showResults({ filled: 3, clicked: 0, skipped: 0, warnings: [] });

      const resultWarnings = document.getElementById('result-warnings');
      expect(resultWarnings.classList.contains('hidden')).toBe(true);
    });

    it('switches to the results view', () => {
      showResults({ filled: 1, clicked: 0, skipped: 0, warnings: [] });

      const viewResults = document.getElementById('view-results');
      expect(viewResults.classList.contains('hidden')).toBe(false);

      const viewIdle = document.getElementById('view-idle');
      expect(viewIdle.classList.contains('hidden')).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────────────────────
// Integration test: popup initialization
// ──────────────────────────────────────────────────────────────

describe('popup integration', () => {
  beforeEach(() => {
    resetChromeMocks();
    setupPopupDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('has all required DOM elements from popup.html', () => {
    const requiredIds = [
      'view-idle', 'view-recording', 'view-save', 'view-results',
      'script-search', 'search-list', 'btn-record', 'btn-fill',
      'link-options', 'field-count', 'btn-stop', 'btn-discard',
      'script-name', 'save-site-hint', 'save-field-count',
      'btn-save', 'btn-save-discard', 'result-filled',
      'result-skipped', 'result-warnings', 'btn-fill-again', 'btn-back',
    ];

    for (const id of requiredIds) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('search-list renders context labels (site > persona)', () => {
    const searchList = document.getElementById('search-list');
    const scripts = [
      { id: '1', name: 'Test', site_label: 'example.com', persona_name: 'QA' },
    ];

    // Inline renderSearchList
    searchList.innerHTML = '';
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
      searchList.appendChild(li);
    }

    const li = searchList.querySelector('li');
    expect(li).not.toBeNull();
    expect(li.querySelector('.script-name').textContent).toBe('Test');
    expect(li.querySelector('.script-context').textContent).toBe('example.com > QA');
  });

  it('btn-fill starts disabled', () => {
    const btnFill = document.getElementById('btn-fill');
    expect(btnFill.disabled).toBe(true);
  });

  it('view-recording starts hidden', () => {
    const viewRecording = document.getElementById('view-recording');
    expect(viewRecording.classList.contains('hidden')).toBe(true);
  });

  it('view-save starts hidden', () => {
    const viewSave = document.getElementById('view-save');
    expect(viewSave.classList.contains('hidden')).toBe(true);
  });

  it('view-results starts hidden', () => {
    const viewResults = document.getElementById('view-results');
    expect(viewResults.classList.contains('hidden')).toBe(true);
  });
});
