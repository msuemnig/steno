# QAFill — Chrome Extension Specification

## Overview

QAFill is a Chrome extension that allows QA teams to record form fill sessions and replay them on demand with a single click. Instead of manually re-entering test data on every QA pass, a tester records a run through the form once, saves it as a named test case, and replays it instantly on any environment.

The tool is designed to be simple, fast, and self-contained in v1 — no backend, no login, no infrastructure. Profiles sync across the team via Chrome's built-in sync storage.

---

## Core Concepts

### Recording
A recording is a single, ordered pass through a form. The extension watches for user input events (text, select, checkbox, radio, date, etc.) and captures the CSS selector and value for each field touched. The sequence is preserved, which naturally handles conditional/branching form logic — if a user triggers a conditional section by checking a box, those fields are captured in order and replayed in the same order.

Each recording is a self-contained test case. Branching scenarios (e.g. "First Time Applicant" vs. "Renewal — Has Existing Passport") are handled by creating separate recordings, not by trying to make one recording handle multiple paths.

### Test Profile
A named, saved recording. Examples:
- "Valid Adult Applicant — First Time"
- "Renewal — Has Passport Book"
- "Minor Applicant — Under 16"
- "Edge Case — Expired Documents"
- "International Address"

Each profile is a JSON object containing an ordered array of field entries.

### Replay
Replay iterates through the recording's field array sequentially. After injecting each value, it fires the appropriate DOM events (input, change) to trigger any framework bindings (React, Vue, Livewire). Between steps it waits for DOM mutations to settle before proceeding, which handles conditional fields that appear asynchronously after a trigger field is filled.

---

## Data Schema

### Profile Object
```json
{
  "id": "uuid-v4",
  "name": "Valid Adult Applicant — First Time",
  "created_by": "tester@govswift.com",
  "created_at": "2026-02-26T12:00:00Z",
  "updated_at": "2026-02-26T12:00:00Z",
  "url_hint": "https://app.govswift.com/apply",
  "fields": [
    {
      "order": 1,
      "selector": "#first_name",
      "value": "John",
      "type": "text",
      "label": "First Name"
    },
    {
      "order": 2,
      "selector": "#last_name",
      "value": "Smith",
      "type": "text",
      "label": "Last Name"
    },
    {
      "order": 3,
      "selector": "select[name='state']",
      "value": "TX",
      "type": "select",
      "label": "State"
    }
  ]
}
```

**Notes:**
- `url_hint` is informational only — replay works on any environment since matching is selector-based, not URL-based
- `label` is captured from the associated `<label>`, `placeholder`, or `aria-label` at record time, used for display purposes only
- `type` informs which DOM events to fire during replay

---

## File Structure

```
qafill-extension/
├── manifest.json
├── background.js                 # Service worker — message routing, storage coordination
├── content.js                    # Injected into pages — recording listener + replay injector
├── popup/
│   ├── popup.html                # Profile selector + record/fill controls
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html              # Full profile manager (CRUD)
│   ├── options.js
│   └── options.css
├── services/
│   ├── storage.js                # Storage abstraction layer (v1: chrome.storage.sync)
│   └── recorder.js               # Recording logic — event capture, selector generation
└── assets/
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## Extension Components

### manifest.json
- Manifest V3
- Permissions: `storage`, `activeTab`, `scripting`, `identity`
- Content script injected on all URLs (required for third-party form support)
- Options page declared for profile management

### content.js
Handles two modes: **recording** and **replay**.

**Recording mode:**
- Activated by message from popup (`START_RECORDING`)
- Attaches event listeners to all form inputs on the page (`input`, `change`)
- For each event, captures:
  - Best available CSS selector (prefers `#id`, falls back to `[name=x]`, then positional)
  - Current value
  - Field type
  - Associated label text
- Streams captured fields back to background via `chrome.runtime.sendMessage`
- Deactivated by message from popup (`STOP_RECORDING`)

**Replay mode:**
- Activated by message from popup (`REPLAY_PROFILE`) with profile payload
- Iterates fields in `order` sequence
- For each field:
  1. Query DOM for selector
  2. If not found, wait via MutationObserver (up to configurable timeout, default 3s)
  3. If still not found after timeout, log warning and continue
  4. Set value on element
  5. Dispatch `input` event (for React/Vue/Livewire binding)
  6. Dispatch `change` event
  7. Brief settle pause (MutationObserver detects DOM quiet) before next field
- Returns completion report to popup: fields filled, fields skipped, warnings

### background.js
- Manages recording state (which tab is currently recording)
- Routes messages between popup and content scripts
- Handles storage reads/writes via `storage.js`
- Prevents multiple simultaneous recordings

### popup/
The day-to-day interface. Intentionally minimal.

**States:**
1. **Idle — form detected on page:**
   ```
   ┌─────────────────────────────┐
   │  🧪 QAFill                  │
   │  ─────────────────────────  │
   │  Profile: [Valid Adult ▾]   │
   │                             │
   │  [  ⏺ Start Recording  ]   │
   │  [    ▶ Fill Form      ]   │
   │                             │
   │  Manage Profiles →          │
   └─────────────────────────────┘
   ```

2. **Recording in progress:**
   ```
   ┌─────────────────────────────┐
   │  🧪 QAFill        ● REC    │
   │  ─────────────────────────  │
   │  Recording... 6 fields      │
   │                             │
   │  [  ⏹ Stop & Save         ]│
   │  [  ✕ Discard             ]│
   └─────────────────────────────┘
   ```

3. **Stop & Save — name the recording:**
   ```
   ┌─────────────────────────────┐
   │  Save Recording             │
   │  ─────────────────────────  │
   │  Name: [________________]   │
   │  6 fields captured          │
   │                             │
   │  [  Save  ]  [  Discard  ] │
   └─────────────────────────────┘
   ```

4. **Replay complete:**
   ```
   ┌─────────────────────────────┐
   │  🧪 QAFill                  │
   │  ─────────────────────────  │
   │  ✅ 8 fields filled         │
   │  ⚠️  1 field not found      │  ← expandable detail
   │                             │
   │  [    Fill Again    ]       │
   └─────────────────────────────┘
   ```

### options/
Full profile management UI. Accessed via extension options or "Manage Profiles →" link in popup.

**Features:**
- List all saved profiles
- Create new profile (launches recording flow or manual JSON entry)
- Edit profile name
- Delete profile (with confirmation)
- View profile field list (read-only detail view)
- Export all profiles as JSON file
- Import profiles from JSON file

The export/import feature is important in v1 — it lets the team share a baseline profile library before v2 central storage is available, by sharing the JSON file directly.

### services/storage.js
The critical abstraction layer that enables the v1 → v2 migration with zero changes to any other file.

**v1 Interface (chrome.storage.sync):**
```javascript
const StorageService = {
  getProfiles: async () => { ... },
  getProfile: async (id) => { ... },
  saveProfile: async (profile) => { ... },
  deleteProfile: async (id) => { ... },
  exportAll: async () => { ... },
  importAll: async (data) => { ... }
}
```

All other files interact exclusively through this interface. In v2, the internals are replaced with `fetch()` calls to the Laravel API — the interface remains identical.

### services/recorder.js
Selector generation logic. Given a DOM element, returns the best available stable selector:

1. `#id` — if element has an ID
2. `[name="value"]` — if element has a name attribute
3. `[data-qa="value"]` — if a QA-specific data attribute exists
4. Positional fallback — `form:nth-of-type(1) input:nth-of-type(3)`

Positional selectors are flagged as potentially fragile in the saved recording to warn the user.

---

## Replay Engine — Handling Conditional Fields

The replay engine is sequential and event-driven. It does not need to understand conditional logic because the recording already captures the correct fill order. If a user triggered a conditional section during recording by checking a box, that checkbox fill appears in the sequence before the conditional fields — replay honors this naturally.

**MutationObserver pattern for async fields:**
```
Fill field N → Fire events → Start MutationObserver
  → DOM settles (no mutations for 150ms) → Fill field N+1
  → If field N+1 selector not found → Wait up to 3s for it to appear
  → If still not found → Log warning, skip, continue to N+2
```

This handles Livewire server round-trips and React state updates without any hardcoded delays.

---

## Event Firing — Framework Compatibility

A plain `element.value = 'x'` does not trigger React, Vue, or Livewire data bindings. The replay engine must fire synthetic events after setting each value:

```javascript
// For text inputs
element.value = value;
element.dispatchEvent(new Event('input', { bubbles: true }));
element.dispatchEvent(new Event('change', { bubbles: true }));

// For React specifically (uses synthetic event system)
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeInputValueSetter.call(element, value);
element.dispatchEvent(new Event('input', { bubbles: true }));
```

Select, checkbox, and radio elements each have their own event patterns handled per `type`.

---

## Environment Handling

Profiles are environment-agnostic. The `url_hint` field is stored for reference but is never used for matching. Replay works on any URL because field matching is purely selector-based. The same "Valid Adult Applicant" recording works identically on:
- `http://localhost:8000/apply`
- `https://dev.govswift.com/apply`
- `https://staging.govswift.com/apply`
- `https://app.govswift.com/apply`

---

## v1 Build Phases

### Phase 1 — Working record + replay loop
- `manifest.json` scaffold
- `content.js` — input event capture (recording) + sequential value injection (replay)
- `background.js` — message routing, recording state management
- `services/storage.js` — chrome.storage.sync implementation
- `services/recorder.js` — selector generation
- Basic `popup` — profile dropdown, record button, fill button

**Success criteria:** A tester can record a form fill, save it with a name, navigate to the same form on a different environment, and replay it with one click.

### Phase 2 — Polish and profile management
- Full options page with CRUD
- Replay result reporting (fields filled / fields skipped)
- Export / import JSON
- Recording indicator UI improvements
- Warning flags on positional selectors

### Phase 3 — Hardening
- Edge case handling: iframes, shadow DOM, dynamically generated forms
- Selector stability improvements
- Timeout configuration (default 3s, user-adjustable)
- Error logging for failed replays

---

## v2 — Central Storage & Team Features (Future)

The following features are explicitly out of scope for v1 but are accounted for in the architecture. The `storage.js` abstraction layer is the primary enabler.

**Backend (Laravel API):**
- Profiles stored centrally, shared across all team members
- No Chrome account dependency — any browser, any machine
- Version history on recordings (see when a profile was last updated and by whom)
- Soft deletes (recover accidentally deleted profiles)

**Auth:**
- SSO via existing Adverscale/GovSwift identity provider
- Extension authenticates via OAuth token stored in `chrome.storage.local`

**Team & Access Control:**
- Profiles belong to a team/organization, not an individual
- Role-based permissions: Viewer (replay only) vs. Editor (record + manage)

**Monetization options (if commercialized beyond internal use):**
- Per-seat SaaS pricing (per user/month)
- Per-team flat rate (better fit for small QA teams)
- Freemium: local storage free, central sync paid
- API access tier for CI/CD integration (replay profiles as part of automated test pipeline)

**CI/CD Integration (stretch goal):**
- Expose profile recordings as Playwright-compatible scripts
- Run replay headlessly as part of staging deployment checks
- Integrates with existing Laravel Forge deployment workflow

---

## Out of Scope (v1)

- Multi-step / wizard forms (single-page forms only in v1)
- File upload fields
- CAPTCHA or bot-detection bypass
- Scheduled / automated replay (manual trigger only)
- Cross-browser support (Chrome only in v1)
- Backend, authentication, or user accounts

---

## Notes for Implementation

- The project should be bootstrapped as a standard Manifest V3 Chrome extension with no build tooling required for v1 (plain JS, no bundler). This keeps it simple to load unpacked during development.
- All async storage operations should use `async/await` throughout to keep the v1 → v2 swap clean.
- The `storage.js` service should be the only file that ever references `chrome.storage` directly.
- Test on Livewire forms first (GovSwift internal), then validate on a third-party form (GHL or similar) before considering Phase 1 complete.
