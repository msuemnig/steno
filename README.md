# Steno

Record and replay form fills instantly. A Manifest V3 browser extension for QA testers and developers who fill the same forms repeatedly.

## Features

- **Record** — Fill a form naturally and Steno captures every field (inputs, selects, textareas, checkboxes, radios) plus button clicks
- **Replay** — One click to fill an entire form with saved values
- **Multi-step forms** — Records clicks on "Next", "Continue", etc. so wizard-style forms replay end-to-end
- **Cross-page replay** — When a click navigates to a new page (same domain), replay automatically continues
- **Organize** — Scripts are grouped by site and optionally by persona (e.g. "Valid Adult", "Minor Applicant")
- **Drag-and-drop reorder** — Rearrange field/click order in the options page
- **Cloud sync** — Paid users sync scripts across devices via the Steno web app
- **Import/Export** — Share scripts between machines or team members as JSON (paid plan)
- **Dark/Light/System theme**

## Install

```bash
npm install   # dev dependencies only (vitest, jsdom for tests)
```

### Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this folder

## Project structure

```
steno/
├── manifest.json              # MV3 manifest (permissions, content scripts, service worker)
├── background.js              # Service worker — message routing, recording/replay state, sync alarm
├── content.js                 # Content script — recording HUD, input capture, replay engine
├── services/
│   ├── recorder.js            # Selector generation (id > name > data-qa > positional fallback)
│   ├── storage.js             # Storage abstraction — CRUD, chunked storage, migration, sync
│   └── api.js                 # API client — auth token management, authenticated fetch
├── popup/
│   ├── popup.html             # Extension popup (7-view state machine)
│   ├── popup.js               # Popup logic — search-select, record/save/replay/limit flows
│   └── popup.css              # Popup styles
├── options/
│   ├── options.html           # Full options page (two-panel layout)
│   ├── options.js             # Options logic — tree view, inline edit, drag-and-drop reorder
│   └── options.css            # Options styles
├── assets/icons/              # Extension icons (16, 48, 128px)
├── tests/
│   ├── setup.js               # Vitest setup — chrome.* API mocks with in-memory storage
│   └── recorder.test.js       # Tests for selector generation, labels, types, values
├── vitest.config.js           # Test config (jsdom environment)
└── package.json               # Dev dependencies: vitest, jsdom
```

## Architecture

### Extension components

The extension has three runtime contexts that communicate via `chrome.runtime.sendMessage`:

| Component | File(s) | Role |
|---|---|---|
| **Service worker** | `background.js` | Central message router, holds recording/replay state in memory, runs periodic sync alarm |
| **Content script** | `content.js` + `services/recorder.js` | Injected into every page. Handles recording (capturing input/change/click events), the on-page HUD overlay, and replay (injecting values + clicking) |
| **Popup** | `popup/popup.*` | User-facing UI with 7 views: idle, recording, save, results, limit, replace, confirm-replace |
| **Options page** | `options/options.*` | Full management UI — two-panel tree view (sites on left, scripts/personas on right), script detail with field table and drag-and-drop reorder |

### Service layer

| Service | File | Purpose |
|---|---|---|
| **StorageService** | `services/storage.js` | All data persistence. CRUD for sites, personas, scripts. Chunked script storage (7KB chunks in `chrome.storage.local`). Schema migration (v1/v2 to v3). Cloud sync merge logic. |
| **ApiService** | `services/api.js` | API client for the Steno web app. Token storage, authenticated fetch with auto-logout on 401, sync endpoint. |
| **Recorder** | `services/recorder.js` | Pure DOM utility. Selector generation with priority chain: `#id` > `[name]` > `[data-qa]` > positional `nth-of-type` fallback (marked as `fragile`). Label extraction, field type detection, value reading. |

### Message protocol

The extension uses ~30 message types. Key flows:

**Recording:**
```
popup → background: SET_RECORDING_TAB
popup → content:    START_RECORDING
content → background: FIELD_CAPTURED / STEP_CAPTURED  (updates badge count)
content → background: OVERLAY_STOP_CLICKED  (HUD stop button)
popup → content:    STOP_RECORDING → returns { fields }
popup → background: CLEAR_RECORDING_TAB
```

**Replay:**
```
popup → content:    REPLAY_SCRIPT { fields }
content → background: REPLAY_STARTED / REPLAY_PROGRESS / REPLAY_FINISHED
(on page navigation)
background → content: CONTINUE_REPLAY { fields, startIndex }  (cross-page)
popup → background: GET_REPLAY_RESULTS / CLEAR_REPLAY_RESULTS
```

**Data CRUD (popup/options → background → StorageService):**
```
GET_SCRIPTS, GET_SCRIPTS_FLAT, GET_SCRIPT, SAVE_SCRIPT, DELETE_SCRIPT
GET_SITES, GET_SITE, GET_SITE_BY_HOSTNAME, SAVE_SITE, DELETE_SITE
GET_PERSONAS, GET_PERSONAS_BY_SITE, SAVE_PERSONA, DELETE_PERSONA
GET_TREE, GET_SCRIPT_LIMIT
EXPORT_ALL, IMPORT_ALL
GET_THEME, SET_THEME
```

**Auth & sync:**
```
content → background: SET_AUTH_TOKEN  (from postMessage on steno-web.test)
GET_AUTH_STATUS, LOGOUT, SYNC_NOW
```

## Data model

### Schema v3

All data lives in `chrome.storage.local`. Scripts are chunked across multiple keys to work within Chrome's per-key size limits.

| Entity | Key | Structure |
|---|---|---|
| **Sites** | `steno_sites` | `[{ id, hostname, label, created_at, updated_at, deleted_at? }]` |
| **Personas** | `steno_personas` | `[{ id, site_id, name, created_at, updated_at, deleted_at? }]` |
| **Scripts** | `steno_scripts_0..N` | Chunked JSON: `[{ id, site_id?, persona_id?, name, fields[], created_by, url_hint, created_at, updated_at, deleted_at? }]` |
| | `steno_scripts_count` | Number of chunks |
| **Theme** | `steno_theme` | `"system"` / `"dark"` / `"light"` |
| **Schema** | `steno_schema_version` | `3` |
| **Auth** | `steno_api_token`, `steno_api_user` | Sanctum bearer token + user object |
| **Sync** | `steno_last_synced_at` | ISO timestamp of last successful sync |

### Script fields (steps)

Each script contains an ordered array of steps:

```json
{
  "order": 1,
  "action": "fill",
  "selector": "#email",
  "value": "test@example.com",
  "type": "text",
  "label": "Email Address",
  "fragile": false
}
```

```json
{
  "order": 2,
  "action": "click",
  "selector": "button[type='submit']",
  "label": "Submit",
  "fragile": false
}
```

### Selector priority

The recorder generates selectors in this order:
1. `#id` (stable)
2. `tag[name="value"]` — scoped to `form:nth-of-type(N)` if name isn't unique (stable)
3. `[data-qa="value"]` (stable)
4. Positional `nth-of-type` chain from body (marked `fragile: true`)

### Soft deletes

All entities use soft deletes (`deleted_at` timestamp). Soft-deleted items:
- Are excluded from UI queries (`getScripts()`, `getSites()`, `getPersonas()`)
- Are included in sync payloads so the server learns about deletions
- Are purged from local storage after a successful sync (`_purgeConfirmedDeleted`)

### Cascade behavior

- **Delete site** → soft-deletes its personas, moves its scripts to Ungrouped (`site_id = null`, `persona_id = null`)
- **Delete persona** → scripts lose their `persona_id` but stay under the same site

## Free tier restrictions

Without a paid subscription:
- **2 scripts max** — saving a 3rd triggers the limit/replace flow in the popup
- **Only the 2 oldest scripts** (by `created_at`) are editable — newer scripts are read-only
- **Replay is always allowed** for all scripts
- **Export/Import are blocked** — shows "available on paid plans" message
- **Sync is blocked** — the server's `subscribed` middleware returns 403

The popup's limit flow offers three options: Upgrade, Replace an existing script, or Cancel.

## Cloud sync

### How it works

1. Extension authenticates via the web app: user visits `https://steno-web.test/auth/extension-login`, which generates a Sanctum token and sends it to the extension via `window.postMessage` (the content script listens for `STENO_AUTH_TOKEN` on the `steno-web.test` domain)
2. Sync runs on `POST /api/sync` — sends all local data (including soft-deleted items) with `last_synced_at`
3. Server responds with any items newer than the client's last sync
4. Client merges server changes using **last-write-wins** (`updated_at` comparison)
5. After successful sync, client purges locally soft-deleted items
6. A `chrome.alarms` alarm triggers sync every **5 minutes** in the background

### Web app (companion)

The web app lives in a separate repo at `steno-web`. Stack:
- Laravel 12, PHP 8.3, MySQL
- React via Inertia.js
- Auth: Fortify (headless + MFA) + Sanctum (SPA cookies + API tokens) + Socialite (Google SSO)
- Billing: Laravel Cashier (Stripe) — **Team** is the billable entity, not User
- Roles: owner > admin > editor > viewer (per `team_user` pivot)

## Design tokens

| Token | Value |
|---|---|
| Body font | DM Sans |
| Mono font | JetBrains Mono |
| Accent | `#38bdf8` |
| Accent hover | `#56ccf9` |
| Danger | `#ef4444` |
| Warning | `#fbbf24` |
| Dark bg | `#131315` (options) / `#1a1a1e` (popup/HUD) |
| Light bg | `#f0f0f2` (options) / `#f4f4f5` (popup) |

Theme is stored in `chrome.storage.local` and applied via `data-theme` attribute on `<html>`. The HUD reads theme from background and applies inline CSS variables in its shadow DOM.

## Usage

### Recording

1. Click the Steno icon in the toolbar
2. Click **Record**
3. Fill out the form as you normally would — Steno captures each field and any button/link clicks
4. Click **Stop & save** (in the popup or the on-page HUD)
5. Name your script and it's saved

The HUD overlay uses a Shadow DOM so it doesn't interfere with page styles. It shows a live field/click count, a timer, the last captured label, and a fragile-selector warning badge.

### Replaying

1. Navigate to the form you want to fill
2. Click the Steno icon, search for a script, and click **Replay**
3. Steno fills all fields and executes clicks in the recorded order
4. If a click navigates to a new page (same domain), replay resumes automatically

Replay uses `waitForElement` (MutationObserver with 3s timeout) before each step, and `waitForDomSettle` (300ms for clicks, 150ms for fills) between steps.

### Managing scripts

Click **Manage scripts** in the popup (or open the extension's options page) to:

- Browse scripts grouped by site (left nav) with personas (right panel)
- Create personas to organize scripts (e.g. different test users)
- Inline-edit site labels and persona names (double-click)
- Drag-and-drop to reorder fields in script detail view
- Rename or delete scripts, personas, and sites
- Replay from the script detail view
- Export all data as JSON or import from a file (paid plan)

## Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests use **Vitest** with a **jsdom** environment. The test setup (`tests/setup.js`) provides comprehensive Chrome extension API mocks with in-memory storage backends, so `set()` followed by `get()` works correctly.

Current test coverage: `recorder.test.js` covers selector generation, label extraction, field type detection, value reading, click labels, and positional selector building.

## Keyboard shortcuts

- In the popup script search: **Arrow keys** to navigate, **Enter** to select, **Escape** to close

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save scripts, sites, personas, and preferences |
| `activeTab` | Access the current tab to inject the content script |
| `scripting` | Inject the recorder/replayer into pages |
| `tabs` | Detect page navigation during cross-page replay |
| `alarms` | Periodic background sync (every 5 minutes) |
| `host_permissions: steno-web.test` | Auth token exchange with the web app |

## Browser support

- **Chrome / Edge** — Full support (MV3 service worker)
- **Firefox** — Supported via `browser_specific_settings.gecko` in manifest (requires Firefox 142+, extension ID: `steno@steno-web.test`)

## Schema migration

StorageService handles automatic migration on extension startup:

| From | To | What happens |
|---|---|---|
| v1 (`qafill_profiles` in `chrome.storage.sync`) | v3 | Profiles converted to scripts with auto-created sites from `url_hint`. Data moved to `chrome.storage.local`. |
| v2 (structured data in `chrome.storage.sync`) | v3 | Sites, personas, and chunked scripts copied from sync to local storage. |

## Issues & contributing

Bug reports, feature requests, and pending QA tasks are tracked as GitHub issues:

**https://github.com/msuemnig/steno/issues**

## Version history

| Version | Highlights |
|---|---|
| 0.2.5 | Soft deletes, free-tier edit restrictions, replace flow |
| 0.2.4 | Cloud sync, auth integration, free-tier limits, test suite |
| 0.2.0 | Record and replay form fills with click support |
