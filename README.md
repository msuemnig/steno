# Steno

Record and replay form fills instantly. A browser extension for QA testers and developers who fill the same forms repeatedly.

## Features

- **Record** — Fill a form naturally and Steno captures every field (inputs, selects, textareas, checkboxes, radios) plus button clicks
- **Replay** — One click to fill an entire form with saved values
- **Multi-step forms** — Records clicks on "Next", "Continue", etc. so wizard-style forms replay end-to-end
- **Cross-page replay** — When a click navigates to a new page (same domain), replay automatically continues
- **Organize** — Scripts are grouped by site and optionally by persona (e.g. "Valid Adult", "Minor Applicant")
- **Drag-and-drop reorder** — Rearrange field/click order in the options page
- **Import/Export** — Share scripts between machines or team members as JSON
- **Dark/Light/System theme**

## Install

### Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this folder

## Usage

### Recording

1. Click the Steno icon in the toolbar
2. Click **Record**
3. Fill out the form as you normally would — Steno captures each field and any button/link clicks
4. Click **Stop & save** (in the popup or the on-page HUD)
5. Name your script and it's saved

### Replaying

1. Navigate to the form you want to fill
2. Click the Steno icon, search for a script, and click **Replay**
3. Steno fills all fields and executes clicks in the recorded order
4. If a click navigates to a new page (same domain), replay resumes automatically

### Managing scripts

Click **Manage scripts** in the popup (or open the extension's options page) to:

- Browse scripts grouped by site
- Create personas to organize scripts (e.g. different test users)
- Drag-and-drop to reorder fields
- Rename or delete scripts, personas, and sites
- Export all data as JSON or import from a file

## Data model

Steno stores three entities:

| Entity | Description |
|---|---|
| **Site** | A hostname (auto-created on first recording) |
| **Persona** | An optional grouping within a site |
| **Script** | A named sequence of fill and click steps |

Each script contains an ordered list of steps:

- **Fill** steps: selector, value, field type, label
- **Click** steps: selector, label

Deleting a site removes its personas; scripts move to Ungrouped. Deleting a persona unassigns its scripts but doesn't delete them.

## Keyboard shortcuts

- In the popup script search: **Arrow keys** to navigate, **Enter** to select, **Escape** to close

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save scripts, sites, personas, and preferences |
| `activeTab` | Access the current tab to inject the content script |
| `scripting` | Inject the recorder/replayer into pages |
| `tabs` | Detect page navigation during cross-page replay |
