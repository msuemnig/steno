/**
 * Tests for services/storage.js — StorageService
 *
 * StorageService is a plain object declared with `const StorageService = { ... }`.
 * Because it lives in a non-module script (loaded by the extension runtime),
 * we evaluate the file in the current scope so that `StorageService` becomes available
 * as a global. Chrome APIs are provided by tests/setup.js.
 */
import { resetChromeMocks } from './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load StorageService into the global scope
const storageSrc = readFileSync(
  join(__dirname, '..', 'services', 'storage.js'),
  'utf-8',
);
// Evaluate — StorageService becomes a global (const at module-level becomes a var in eval scope)
const _evalStorage = new Function(storageSrc + '\nreturn StorageService;');
const StorageService = _evalStorage();

describe('StorageService', () => {
  beforeEach(() => {
    resetChromeMocks();
    // Ensure the storage starts with the expected initialized state
    // (migrateIfNeeded writes these keys when no legacy data is present)
  });

  // ──────────────────────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────────────────────

  describe('initialization (empty state)', () => {
    it('getSites returns empty array when storage is empty', async () => {
      const sites = await StorageService.getSites();
      expect(sites).toEqual([]);
    });

    it('getPersonas returns empty array when storage is empty', async () => {
      const personas = await StorageService.getPersonas();
      expect(personas).toEqual([]);
    });

    it('getScripts returns empty array when storage is empty', async () => {
      const scripts = await StorageService.getScripts();
      expect(scripts).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Site CRUD
  // ──────────────────────────────────────────────────────────────

  describe('Site CRUD', () => {
    it('saveSite + getSites round-trip', async () => {
      const site = {
        id: crypto.randomUUID(),
        hostname: 'example.com',
        label: 'Example',
      };
      await StorageService.saveSite(site);
      const sites = await StorageService.getSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].id).toBe(site.id);
      expect(sites[0].hostname).toBe('example.com');
      expect(sites[0].label).toBe('Example');
      expect(sites[0].created_at).toBeDefined();
      expect(sites[0].updated_at).toBeDefined();
    });

    it('getSiteByHostname finds the correct site', async () => {
      const site1 = { id: crypto.randomUUID(), hostname: 'alpha.com', label: 'Alpha' };
      const site2 = { id: crypto.randomUUID(), hostname: 'beta.com', label: 'Beta' };
      await StorageService.saveSite(site1);
      await StorageService.saveSite(site2);

      const found = await StorageService.getSiteByHostname('beta.com');
      expect(found).not.toBeNull();
      expect(found.label).toBe('Beta');

      const missing = await StorageService.getSiteByHostname('gamma.com');
      expect(missing).toBeNull();
    });

    it('saveSite updates existing site when id matches', async () => {
      const site = { id: 'site-1', hostname: 'example.com', label: 'Old' };
      await StorageService.saveSite(site);

      site.label = 'New';
      await StorageService.saveSite(site);

      const sites = await StorageService.getSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].label).toBe('New');
    });

    it('deleteSite soft-deletes the site', async () => {
      const site = { id: 'site-del', hostname: 'del.com', label: 'Del' };
      await StorageService.saveSite(site);
      expect(await StorageService.getSites()).toHaveLength(1);

      await StorageService.deleteSite('site-del');

      // Public getter filters it out
      expect(await StorageService.getSites()).toHaveLength(0);

      // But raw storage still has it with deleted_at
      const raw = await StorageService._getRawSites();
      expect(raw).toHaveLength(1);
      expect(raw[0].deleted_at).toBeDefined();
    });

    it('deleteSite cascades: soft-deletes personas, ungroups scripts', async () => {
      const site = { id: 'site-cas', hostname: 'cas.com', label: 'Cascade' };
      await StorageService.saveSite(site);

      const persona = { id: 'p-cas', site_id: 'site-cas', name: 'Cascaded' };
      await StorageService.savePersona(persona);

      const script = {
        id: 'script-cas',
        site_id: 'site-cas',
        persona_id: 'p-cas',
        name: 'My Script',
        fields: [],
      };
      const origIsPaid = StorageService._isPaidUser;
      StorageService._isPaidUser = async () => true;
      await StorageService.saveScript(script);
      StorageService._isPaidUser = origIsPaid;

      await StorageService.deleteSite('site-cas');

      // Personas soft-deleted
      expect(await StorageService.getPersonas()).toHaveLength(0);
      const rawPersonas = await StorageService._getRawPersonas();
      expect(rawPersonas[0].deleted_at).toBeDefined();

      // Scripts ungrouped but NOT deleted
      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].site_id).toBeNull();
      expect(scripts[0].persona_id).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Persona CRUD
  // ──────────────────────────────────────────────────────────────

  describe('Persona CRUD', () => {
    it('savePersona + getPersonas round-trip', async () => {
      const persona = {
        id: crypto.randomUUID(),
        site_id: null,
        name: 'Admin',
      };
      await StorageService.savePersona(persona);

      const personas = await StorageService.getPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].name).toBe('Admin');
      expect(personas[0].created_at).toBeDefined();
    });

    it('savePersona updates existing persona', async () => {
      const persona = { id: 'p-1', site_id: null, name: 'Old' };
      await StorageService.savePersona(persona);
      persona.name = 'New';
      await StorageService.savePersona(persona);

      const personas = await StorageService.getPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].name).toBe('New');
    });

    it('deletePersona soft-deletes the persona', async () => {
      const persona = { id: 'p-del', site_id: null, name: 'Bye' };
      await StorageService.savePersona(persona);
      await StorageService.deletePersona('p-del');

      // Public getter filters it out
      expect(await StorageService.getPersonas()).toHaveLength(0);

      // But raw storage still has it with deleted_at
      const raw = await StorageService._getRawPersonas();
      expect(raw).toHaveLength(1);
      expect(raw[0].deleted_at).toBeDefined();
    });

    it('deletePersona cascades: scripts lose persona_id', async () => {
      const persona = { id: 'p-cas', site_id: null, name: 'Admin' };
      await StorageService.savePersona(persona);

      const origIsPaid = StorageService._isPaidUser;
      StorageService._isPaidUser = async () => true;

      const script = {
        id: 'script-pcas',
        site_id: null,
        persona_id: 'p-cas',
        name: 'With Persona',
        fields: [],
      };
      await StorageService.saveScript(script);
      StorageService._isPaidUser = origIsPaid;

      await StorageService.deletePersona('p-cas');
      const scripts = await StorageService.getScripts();
      expect(scripts[0].persona_id).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Script CRUD
  // ──────────────────────────────────────────────────────────────

  describe('Script CRUD', () => {
    // Helper: bypass free-tier limit
    let origIsPaid;
    beforeEach(() => {
      origIsPaid = StorageService._isPaidUser;
      StorageService._isPaidUser = async () => true;
    });
    afterEach(() => {
      StorageService._isPaidUser = origIsPaid;
    });

    it('saveScript + getScripts round-trip', async () => {
      const script = {
        id: crypto.randomUUID(),
        site_id: null,
        persona_id: null,
        name: 'Login Script',
        fields: [{ order: 1, action: 'fill', selector: '#email', value: 'a@b.com', type: 'text' }],
      };
      await StorageService.saveScript(script);

      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].name).toBe('Login Script');
      expect(scripts[0].fields).toHaveLength(1);
      expect(scripts[0].created_at).toBeDefined();
    });

    it('saveScript updates existing script when id matches', async () => {
      const script = { id: 's-upd', site_id: null, persona_id: null, name: 'Old', fields: [] };
      await StorageService.saveScript(script);

      script.name = 'Updated';
      await StorageService.saveScript(script);

      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].name).toBe('Updated');
    });

    it('deleteScript soft-deletes the script', async () => {
      const script = { id: 's-del', site_id: null, persona_id: null, name: 'Gone', fields: [] };
      await StorageService.saveScript(script);
      await StorageService.deleteScript('s-del');

      // Public getter filters it out
      expect(await StorageService.getScripts()).toHaveLength(0);

      // But raw storage still has it with deleted_at
      const raw = await StorageService._readChunked();
      expect(raw).toHaveLength(1);
      expect(raw[0].deleted_at).toBeDefined();
    });

    it('getScript returns a single script by id', async () => {
      const s1 = { id: 's1', site_id: null, persona_id: null, name: 'One', fields: [] };
      const s2 = { id: 's2', site_id: null, persona_id: null, name: 'Two', fields: [] };
      await StorageService.saveScript(s1);
      await StorageService.saveScript(s2);

      const found = await StorageService.getScript('s2');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Two');

      const missing = await StorageService.getScript('nonexistent');
      expect(missing).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getScriptsFlat — denormalized data
  // ──────────────────────────────────────────────────────────────

  describe('getScriptsFlat', () => {
    it('returns scripts with site_label and persona_name resolved', async () => {
      const origIsPaid = StorageService._isPaidUser;
      StorageService._isPaidUser = async () => true;

      const site = { id: 'sf-site', hostname: 'flat.com', label: 'Flat Site' };
      const persona = { id: 'sf-persona', site_id: 'sf-site', name: 'QA Tester' };
      const script = {
        id: 'sf-script',
        site_id: 'sf-site',
        persona_id: 'sf-persona',
        name: 'Flat Script',
        fields: [],
      };

      await StorageService.saveSite(site);
      await StorageService.savePersona(persona);
      await StorageService.saveScript(script);

      const flat = await StorageService.getScriptsFlat();
      expect(flat).toHaveLength(1);
      expect(flat[0].site_label).toBe('Flat Site');
      expect(flat[0].site_hostname).toBe('flat.com');
      expect(flat[0].persona_name).toBe('QA Tester');

      StorageService._isPaidUser = origIsPaid;
    });

    it('returns empty strings for unassigned site/persona', async () => {
      const origIsPaid = StorageService._isPaidUser;
      StorageService._isPaidUser = async () => true;

      const script = {
        id: 'sf-orphan',
        site_id: null,
        persona_id: null,
        name: 'Orphan',
        fields: [],
      };
      await StorageService.saveScript(script);

      const flat = await StorageService.getScriptsFlat();
      expect(flat[0].site_label).toBe('');
      expect(flat[0].persona_name).toBe('');

      StorageService._isPaidUser = origIsPaid;
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Free tier enforcement
  // ──────────────────────────────────────────────────────────────

  describe('free tier script limit', () => {
    it('blocks saving a 3rd script for free users', async () => {
      // ApiService must be "defined" for the check. The actual code does:
      //   typeof ApiService !== 'undefined' && await this._isPaidUser()
      // We mock _isPaidUser to return false.
      StorageService._isPaidUser = async () => false;
      // Make ApiService defined globally so the typeof check passes
      globalThis.ApiService = {};

      // Save 2 scripts (the maximum for free tier)
      for (let i = 0; i < 2; i++) {
        await StorageService.saveScript({
          id: `free-${i}`,
          site_id: null,
          persona_id: null,
          name: `Script ${i}`,
          fields: [],
        });
      }

      // The 3rd should throw
      await expect(
        StorageService.saveScript({
          id: 'free-2',
          site_id: null,
          persona_id: null,
          name: 'Script 2',
          fields: [],
        }),
      ).rejects.toThrow(/Free plan/);

      // Clean up
      delete globalThis.ApiService;
    });

    it('allows unlimited scripts for paid users', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      for (let i = 0; i < 10; i++) {
        await StorageService.saveScript({
          id: `paid-${i}`,
          site_id: null,
          persona_id: null,
          name: `Script ${i}`,
          fields: [],
        });
      }

      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(10);

      delete globalThis.ApiService;
    });

    it('free limit counts only live scripts (deleting frees a slot)', async () => {
      StorageService._isPaidUser = async () => false;
      globalThis.ApiService = {};

      // Save 2 scripts (at limit)
      await StorageService.saveScript({ id: 'slot-0', site_id: null, persona_id: null, name: 'First', fields: [] });
      await StorageService.saveScript({ id: 'slot-1', site_id: null, persona_id: null, name: 'Second', fields: [] });

      // Can't save a 3rd
      await expect(
        StorageService.saveScript({ id: 'slot-2', site_id: null, persona_id: null, name: 'Third', fields: [] }),
      ).rejects.toThrow(/Free plan/);

      // Delete one — frees a slot
      await StorageService.deleteScript('slot-1');

      // Now the 3rd succeeds
      await StorageService.saveScript({ id: 'slot-2', site_id: null, persona_id: null, name: 'Third', fields: [] });
      expect(await StorageService.getScripts()).toHaveLength(2);

      // Soft-deleted item still in raw storage
      const raw = await StorageService._readChunked();
      expect(raw).toHaveLength(3);

      delete globalThis.ApiService;
    });

    it('blocks editing 3rd+ oldest script for free users', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      // Create 3 scripts as paid user with explicit created_at ordering
      await StorageService.saveScript({
        id: 'edit-oldest', site_id: null, persona_id: null, name: 'Oldest', fields: [],
        created_at: '2025-01-01T00:00:00.000Z',
      });
      await StorageService.saveScript({
        id: 'edit-middle', site_id: null, persona_id: null, name: 'Middle', fields: [],
        created_at: '2025-06-01T00:00:00.000Z',
      });
      await StorageService.saveScript({
        id: 'edit-newest', site_id: null, persona_id: null, name: 'Newest', fields: [],
        created_at: '2025-12-01T00:00:00.000Z',
      });

      // Switch to free user
      StorageService._isPaidUser = async () => false;

      // Can edit the 2 oldest
      await StorageService.saveScript({
        id: 'edit-oldest', site_id: null, persona_id: null, name: 'Oldest Updated', fields: [],
        created_at: '2025-01-01T00:00:00.000Z',
      });
      await StorageService.saveScript({
        id: 'edit-middle', site_id: null, persona_id: null, name: 'Middle Updated', fields: [],
        created_at: '2025-06-01T00:00:00.000Z',
      });

      // Cannot edit the 3rd (newest)
      await expect(
        StorageService.saveScript({
          id: 'edit-newest', site_id: null, persona_id: null, name: 'Newest Updated', fields: [],
          created_at: '2025-12-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(/Upgrade to edit/);

      delete globalThis.ApiService;
    });

    it('saveSite preserves soft-deleted items in storage', async () => {
      // Create and soft-delete a site
      await StorageService.saveSite({ id: 'alive', hostname: 'alive.com', label: 'Alive' });
      await StorageService.saveSite({ id: 'dead', hostname: 'dead.com', label: 'Dead' });
      await StorageService.deleteSite('dead');

      // Save a new site
      await StorageService.saveSite({ id: 'new', hostname: 'new.com', label: 'New' });

      // Public getter returns 2 (alive + new)
      expect(await StorageService.getSites()).toHaveLength(2);

      // Raw storage has 3 (including soft-deleted)
      const raw = await StorageService._getRawSites();
      expect(raw).toHaveLength(3);
      expect(raw.find((s) => s.id === 'dead').deleted_at).toBeDefined();
    });

    it('savePersona preserves soft-deleted items in storage', async () => {
      await StorageService.savePersona({ id: 'p-alive', site_id: null, name: 'Alive' });
      await StorageService.savePersona({ id: 'p-dead', site_id: null, name: 'Dead' });
      await StorageService.deletePersona('p-dead');

      await StorageService.savePersona({ id: 'p-new', site_id: null, name: 'New' });

      expect(await StorageService.getPersonas()).toHaveLength(2);
      const raw = await StorageService._getRawPersonas();
      expect(raw).toHaveLength(3);
      expect(raw.find((p) => p.id === 'p-dead').deleted_at).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Export / Import
  // ──────────────────────────────────────────────────────────────

  describe('exportAll', () => {
    it('returns all data for paid users', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      const site = { id: 'ex-site', hostname: 'ex.com', label: 'Ex' };
      const persona = { id: 'ex-persona', site_id: 'ex-site', name: 'Exporter' };
      const script = { id: 'ex-script', site_id: 'ex-site', persona_id: 'ex-persona', name: 'Ex Script', fields: [] };

      await StorageService.saveSite(site);
      await StorageService.savePersona(persona);
      await StorageService.saveScript(script);

      const exported = await StorageService.exportAll();
      expect(exported.version).toBe(2);
      expect(exported.sites).toHaveLength(1);
      expect(exported.personas).toHaveLength(1);
      expect(exported.scripts).toHaveLength(1);

      delete globalThis.ApiService;
    });

    it('throws for free users', async () => {
      StorageService._isPaidUser = async () => false;
      globalThis.ApiService = {};

      await expect(StorageService.exportAll()).rejects.toThrow(/paid plans/);

      delete globalThis.ApiService;
    });
  });

  describe('importAll', () => {
    it('merges v2 data into existing storage', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      // Seed with one existing script
      await StorageService.saveScript({
        id: 'existing',
        site_id: null,
        persona_id: null,
        name: 'Existing',
        fields: [],
      });

      // Import new data
      await StorageService.importAll({
        version: 2,
        sites: [{ id: 'imp-site', hostname: 'imp.com', label: 'Imported Site' }],
        personas: [{ id: 'imp-persona', site_id: 'imp-site', name: 'Imported Persona' }],
        scripts: [{ id: 'imp-script', site_id: 'imp-site', persona_id: 'imp-persona', name: 'Imported Script', fields: [] }],
      });

      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(2); // existing + imported

      const sites = await StorageService.getSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].label).toBe('Imported Site');

      delete globalThis.ApiService;
    });

    it('handles legacy array format (v1)', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      await StorageService.importAll([
        { id: 'legacy-1', name: 'Legacy Script', fields: [{ order: 1 }] },
      ]);

      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].name).toBe('Legacy Script');
      expect(scripts[0].site_id).toBeNull();

      delete globalThis.ApiService;
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Chunked storage internals
  // ──────────────────────────────────────────────────────────────

  describe('chunked storage', () => {
    it('correctly stores and retrieves data that exceeds one chunk', async () => {
      StorageService._isPaidUser = async () => true;
      globalThis.ApiService = {};

      // Create a script with a large fields array to exceed 7KB chunk
      const bigFields = [];
      for (let i = 0; i < 200; i++) {
        bigFields.push({
          order: i,
          action: 'fill',
          selector: `#field-${i}-with-a-really-long-name-to-increase-size`,
          value: `value-${i}-${'x'.repeat(30)}`,
          type: 'text',
          label: `Field ${i}`,
        });
      }

      await StorageService.saveScript({
        id: 'big-script',
        site_id: null,
        persona_id: null,
        name: 'Big Script',
        fields: bigFields,
      });

      // Verify chunking happened (steno_scripts_count should be > 1)
      const countData = await chrome.storage.local.get('steno_scripts_count');
      expect(countData.steno_scripts_count).toBeGreaterThan(1);

      // Verify round-trip
      const scripts = await StorageService.getScripts();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].fields).toHaveLength(200);
      expect(scripts[0].fields[0].selector).toBe('#field-0-with-a-really-long-name-to-increase-size');

      delete globalThis.ApiService;
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Theme
  // ──────────────────────────────────────────────────────────────

  describe('theme', () => {
    it('getTheme defaults to system', async () => {
      const theme = await StorageService.getTheme();
      expect(theme).toBe('system');
    });

    it('setTheme + getTheme round-trip', async () => {
      await StorageService.setTheme('dark');
      const theme = await StorageService.getTheme();
      expect(theme).toBe('dark');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Migration
  // ──────────────────────────────────────────────────────────────

  describe('migrateIfNeeded', () => {
    it('initializes empty storage when no legacy data', async () => {
      await StorageService.migrateIfNeeded();

      const sites = await StorageService.getSites();
      const personas = await StorageService.getPersonas();
      const scripts = await StorageService.getScripts();

      expect(sites).toEqual([]);
      expect(personas).toEqual([]);
      expect(scripts).toEqual([]);

      // schema version should be set in local storage
      const sv = await chrome.storage.local.get('steno_schema_version');
      expect(sv.steno_schema_version).toBe(StorageService.SCHEMA_VERSION);
    });

    it('skips migration when schema version is current', async () => {
      await chrome.storage.local.set({ steno_schema_version: StorageService.SCHEMA_VERSION });
      // Put in some data that should NOT be touched
      await chrome.storage.local.set({ steno_sites: [{ id: 'keep', hostname: 'keep.com' }] });

      await StorageService.migrateIfNeeded();

      // Data should remain untouched
      const sites = await StorageService.getSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].id).toBe('keep');
    });
  });
});
