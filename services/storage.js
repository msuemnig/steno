/**
 * Storage abstraction layer — v3: sites, personas, scripts.
 * Uses chrome.storage.local (device-only). Paid users sync via API.
 * Migrates from v1 qafill_profiles and v2 sync storage on first load.
 */
const StorageService = {
  // ─── Constants ──────────────────────────────────────────
  SCHEMA_VERSION: 3,
  CHUNK_SIZE: 7000, // ~7KB per chunk
  FREE_MAX_SCRIPTS: 2,

  // ─── Migration ──────────────────────────────────────────

  async migrateIfNeeded() {
    const data = await chrome.storage.local.get('steno_schema_version');
    const currentVersion = data.steno_schema_version || 0;
    if (currentVersion >= this.SCHEMA_VERSION) return;

    // ─── v2 → v3: move data from chrome.storage.sync to chrome.storage.local
    if (currentVersion === 2 || currentVersion === 0) {
      const syncData = await chrome.storage.sync.get(null); // get everything from sync

      // Check for v2 data in sync storage
      if (syncData.steno_schema_version === 2) {
        // Copy sites and personas
        if (syncData.steno_sites) {
          await chrome.storage.local.set({ steno_sites: syncData.steno_sites });
        }
        if (syncData.steno_personas) {
          await chrome.storage.local.set({ steno_personas: syncData.steno_personas });
        }

        // Copy chunked scripts
        const count = syncData.steno_scripts_count || 0;
        if (count > 0) {
          const chunkData = { steno_scripts_count: count };
          for (let i = 0; i < count; i++) {
            const key = `steno_scripts_${i}`;
            if (syncData[key]) chunkData[key] = syncData[key];
          }
          await chrome.storage.local.set(chunkData);
        }

        // Copy theme preference
        if (syncData.steno_theme) {
          await chrome.storage.local.set({ steno_theme: syncData.steno_theme });
        }
      } else if (syncData.qafill_profiles) {
        // ─── v1 → v3: migrate legacy profiles directly to local
        const profiles = syncData.qafill_profiles;
        const sites = [];
        const scripts = [];

        for (const p of profiles) {
          let siteId = null;
          if (p.url_hint) {
            try {
              const hostname = new URL(p.url_hint).hostname;
              let site = sites.find((s) => s.hostname === hostname);
              if (!site) {
                site = {
                  id: crypto.randomUUID(),
                  hostname,
                  label: hostname,
                  created_at: p.created_at || new Date().toISOString(),
                  updated_at: p.updated_at || new Date().toISOString(),
                };
                sites.push(site);
              }
              siteId = site.id;
            } catch { /* invalid URL, leave site_id null */ }
          }

          scripts.push({
            id: p.id,
            site_id: siteId,
            persona_id: null,
            name: p.name,
            created_by: p.created_by || '',
            url_hint: p.url_hint || '',
            fields: p.fields || [],
            created_at: p.created_at || new Date().toISOString(),
            updated_at: p.updated_at || new Date().toISOString(),
          });
        }

        await chrome.storage.local.set({ steno_sites: sites });
        await chrome.storage.local.set({ steno_personas: [] });
        await this._writeChunked(scripts);
      }
    }

    // Initialize empty collections if missing
    const existing = await chrome.storage.local.get(['steno_sites', 'steno_personas']);
    if (!existing.steno_sites) await chrome.storage.local.set({ steno_sites: [] });
    if (!existing.steno_personas) await chrome.storage.local.set({ steno_personas: [] });
    const count = await chrome.storage.local.get('steno_scripts_count');
    if (count.steno_scripts_count === undefined) {
      await chrome.storage.local.set({ steno_scripts_count: 0 });
    }

    await chrome.storage.local.set({ steno_schema_version: this.SCHEMA_VERSION });
  },

  // ─── Chunked Storage for Scripts ────────────────────────

  async _writeChunked(scripts) {
    const json = JSON.stringify(scripts);
    const chunks = [];
    for (let i = 0; i < json.length; i += this.CHUNK_SIZE) {
      chunks.push(json.slice(i, i + this.CHUNK_SIZE));
    }

    // Remove old chunks first
    const oldData = await chrome.storage.local.get('steno_scripts_count');
    const oldCount = oldData.steno_scripts_count || 0;
    if (oldCount > 0) {
      const keysToRemove = [];
      for (let i = 0; i < oldCount; i++) {
        keysToRemove.push(`steno_scripts_${i}`);
      }
      await chrome.storage.local.remove(keysToRemove);
    }

    // Write new chunks
    const writeObj = { steno_scripts_count: chunks.length };
    for (let i = 0; i < chunks.length; i++) {
      writeObj[`steno_scripts_${i}`] = chunks[i];
    }
    await chrome.storage.local.set(writeObj);
  },

  async _readChunked() {
    const data = await chrome.storage.local.get('steno_scripts_count');
    const count = data.steno_scripts_count || 0;
    if (count === 0) return [];

    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(`steno_scripts_${i}`);
    }
    const chunks = await chrome.storage.local.get(keys);
    let json = '';
    for (let i = 0; i < count; i++) {
      json += chunks[`steno_scripts_${i}`] || '';
    }
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  },

  // ─── Site CRUD ──────────────────────────────────────────

  async _getRawSites() {
    const data = await chrome.storage.local.get('steno_sites');
    return data.steno_sites || [];
  },

  async getSites() {
    const sites = await this._getRawSites();
    return sites.filter((s) => !s.deleted_at);
  },

  async getSite(id) {
    const sites = await this.getSites();
    return sites.find((s) => s.id === id) || null;
  },

  async getSiteByHostname(hostname) {
    const sites = await this.getSites();
    return sites.find((s) => s.hostname === hostname) || null;
  },

  async saveSite(site) {
    const all = await this._getRawSites();
    const index = all.findIndex((s) => s.id === site.id);
    if (index >= 0) {
      site.updated_at = new Date().toISOString();
      all[index] = site;
    } else {
      site.created_at = site.created_at || new Date().toISOString();
      site.updated_at = site.created_at;
      all.push(site);
    }
    await chrome.storage.local.set({ steno_sites: all });
    return site;
  },

  async deleteSite(id) {
    const now = new Date().toISOString();

    // Soft-delete the site
    const allSites = await this._getRawSites();
    const site = allSites.find((s) => s.id === id);
    if (site) {
      site.deleted_at = now;
      site.updated_at = now;
    }
    await chrome.storage.local.set({ steno_sites: allSites });

    // Cascade: soft-delete personas for this site
    const allPersonas = await this._getRawPersonas();
    for (const p of allPersonas) {
      if (p.site_id === id && !p.deleted_at) {
        p.deleted_at = now;
        p.updated_at = now;
      }
    }
    await chrome.storage.local.set({ steno_personas: allPersonas });

    // Cascade: move scripts to Ungrouped (null site_id), clear persona_id
    const allScripts = await this._readChunked();
    for (const s of allScripts) {
      if (s.site_id === id && !s.deleted_at) {
        s.site_id = null;
        s.persona_id = null;
        s.updated_at = now;
      }
    }
    await this._writeChunked(allScripts);
  },

  // ─── Persona CRUD ──────────────────────────────────────

  async _getRawPersonas() {
    const data = await chrome.storage.local.get('steno_personas');
    return data.steno_personas || [];
  },

  async getPersonas() {
    const personas = await this._getRawPersonas();
    return personas.filter((p) => !p.deleted_at);
  },

  async getPersonasBySite(siteId) {
    const personas = await this.getPersonas();
    return personas.filter((p) => p.site_id === siteId);
  },

  async savePersona(persona) {
    const all = await this._getRawPersonas();
    const index = all.findIndex((p) => p.id === persona.id);
    if (index >= 0) {
      persona.updated_at = new Date().toISOString();
      all[index] = persona;
    } else {
      persona.created_at = persona.created_at || new Date().toISOString();
      persona.updated_at = persona.created_at;
      all.push(persona);
    }
    await chrome.storage.local.set({ steno_personas: all });
    return persona;
  },

  async deletePersona(id) {
    const now = new Date().toISOString();

    // Soft-delete the persona
    const allPersonas = await this._getRawPersonas();
    const persona = allPersonas.find((p) => p.id === id);
    if (persona) {
      persona.deleted_at = now;
      persona.updated_at = now;
    }
    await chrome.storage.local.set({ steno_personas: allPersonas });

    // Cascade: scripts lose their persona_id (stay under same site)
    const allScripts = await this._readChunked();
    for (const s of allScripts) {
      if (s.persona_id === id && !s.deleted_at) {
        s.persona_id = null;
        s.updated_at = now;
      }
    }
    await this._writeChunked(allScripts);
  },

  // ─── Script CRUD ────────────────────────────────────────

  async getScripts() {
    const all = await this._readChunked();
    return all.filter((s) => !s.deleted_at);
  },

  async getScript(id) {
    const scripts = await this.getScripts();
    return scripts.find((s) => s.id === id) || null;
  },

  async saveScript(script, { force = false } = {}) {
    const allScripts = await this._readChunked();
    const liveScripts = allScripts.filter((s) => !s.deleted_at);
    const fullIndex = allScripts.findIndex((s) => s.id === script.id);
    const liveIndex = liveScripts.findIndex((s) => s.id === script.id);

    if (liveIndex >= 0) {
      // UPDATE — enforce edit restriction for free tier
      if (!force) {
        const isPaid = typeof ApiService !== 'undefined' && await this._isPaidUser();
        if (!isPaid) {
          const sorted = [...liveScripts].sort((a, b) => a.created_at.localeCompare(b.created_at));
          const activeIds = sorted.slice(0, this.FREE_MAX_SCRIPTS).map((s) => s.id);
          if (!activeIds.includes(script.id)) {
            throw new Error('Upgrade to edit this script. Free plan allows editing your 2 oldest scripts.');
          }
        }
      }
      script.updated_at = new Date().toISOString();
      allScripts[fullIndex] = script;
    } else {
      // NEW — enforce free-tier limit (count only live scripts)
      if (!force) {
        const isPaid = typeof ApiService !== 'undefined' && await this._isPaidUser();
        if (!isPaid && liveScripts.length >= this.FREE_MAX_SCRIPTS) {
          throw new Error(`Free plan allows up to ${this.FREE_MAX_SCRIPTS} scripts. Upgrade to save more.`);
        }
      }
      script.created_at = script.created_at || new Date().toISOString();
      script.updated_at = script.created_at;
      allScripts.push(script);
    }
    await this._writeChunked(allScripts);
    return script;
  },

  async deleteScript(id) {
    const allScripts = await this._readChunked();
    const script = allScripts.find((s) => s.id === id);
    if (script) {
      const now = new Date().toISOString();
      script.deleted_at = now;
      script.updated_at = now;
    }
    await this._writeChunked(allScripts);
  },

  // ─── Composite Queries ─────────────────────────────────

  /**
   * Flat list of scripts with site/persona names resolved.
   * Used by the popup for search-select display.
   */
  async getScriptsFlat() {
    const [scripts, sites, personas] = await Promise.all([
      this.getScripts(),
      this.getSites(),
      this.getPersonas(),
    ]);
    const siteMap = Object.fromEntries(sites.map((s) => [s.id, s]));
    const personaMap = Object.fromEntries(personas.map((p) => [p.id, p]));

    return scripts.map((s) => ({
      ...s,
      site_label: s.site_id ? (siteMap[s.site_id]?.label || '') : '',
      site_hostname: s.site_id ? (siteMap[s.site_id]?.hostname || '') : '',
      persona_name: s.persona_id ? (personaMap[s.persona_id]?.name || '') : '',
    }));
  },

  /**
   * Hierarchical tree for the options page.
   * Returns { sites: [...], ungrouped: { personas, scripts } }
   */
  async getTree() {
    const [sites, personas, scripts] = await Promise.all([
      this.getSites(),
      this.getPersonas(),
      this.getScripts(),
    ]);

    const tree = {
      sites: [],
      ungrouped: { personas: [], scripts: [] },
    };

    for (const site of sites) {
      const sitePersonas = personas.filter((p) => p.site_id === site.id);
      const siteScripts = scripts.filter((s) => s.site_id === site.id);

      // Group scripts by persona within this site
      const personaGroups = [];
      for (const persona of sitePersonas) {
        personaGroups.push({
          ...persona,
          scripts: siteScripts.filter((s) => s.persona_id === persona.id),
        });
      }

      // Scripts in this site with no persona
      const noPersonaScripts = siteScripts.filter((s) => !s.persona_id);

      tree.sites.push({
        ...site,
        personas: personaGroups,
        unassigned: noPersonaScripts,
      });
    }

    // Ungrouped: scripts with no site
    const ungroupedScripts = scripts.filter((s) => !s.site_id);
    const ungroupedPersonas = personas.filter((p) => !p.site_id);

    // Group ungrouped scripts by persona
    const ungroupedPersonaGroups = [];
    for (const persona of ungroupedPersonas) {
      ungroupedPersonaGroups.push({
        ...persona,
        scripts: ungroupedScripts.filter((s) => s.persona_id === persona.id),
      });
    }
    const ungroupedNoPersona = ungroupedScripts.filter((s) => !s.persona_id);

    tree.ungrouped = {
      personas: ungroupedPersonaGroups,
      scripts: ungroupedNoPersona,
    };

    return tree;
  },

  // ─── Backward-compatible aliases ────────────────────────

  async getProfiles() {
    return await this.getScripts();
  },

  async getProfile(id) {
    return await this.getScript(id);
  },

  async saveProfile(profile) {
    return await this.saveScript(profile);
  },

  async deleteProfile(id) {
    return await this.deleteScript(id);
  },

  // ─── Plan helpers ──────────────────────────────────────

  async _isPaidUser() {
    if (typeof ApiService === 'undefined') return false;
    try {
      const isAuth = await ApiService.isAuthenticated();
      if (!isAuth) return false;
      const user = await ApiService.fetchUser();
      return user?.current_team?.subscribed === true;
    } catch {
      return false;
    }
  },

  async getScriptLimit() {
    const isPaid = typeof ApiService !== 'undefined' && await this._isPaidUser();
    return isPaid ? null : this.FREE_MAX_SCRIPTS;
  },

  async canExport() {
    return typeof ApiService !== 'undefined' && await this._isPaidUser();
  },

  // ─── Export / Import ────────────────────────────────────

  async exportAll() {
    const allowed = await this.canExport();
    if (!allowed) {
      throw new Error('Export is available on paid plans. Upgrade to export your scripts.');
    }
    const [sites, personas, scripts] = await Promise.all([
      this.getSites(),
      this.getPersonas(),
      this.getScripts(),
    ]);
    return { version: 2, sites, personas, scripts };
  },

  async importAll(data) {
    const allowed = await this.canExport();
    if (!allowed) {
      throw new Error('Import is available on paid plans. Upgrade to import scripts.');
    }
    // Detect legacy array format vs v2 object format
    if (Array.isArray(data)) {
      // Legacy v1 format — treat as scripts (profiles)
      const existing = await this._readChunked();
      const merged = [...existing];
      for (const incoming of data) {
        const script = {
          id: incoming.id,
          site_id: incoming.site_id || null,
          persona_id: incoming.persona_id || null,
          name: incoming.name,
          created_by: incoming.created_by || '',
          url_hint: incoming.url_hint || '',
          fields: incoming.fields || [],
          created_at: incoming.created_at || new Date().toISOString(),
          updated_at: incoming.updated_at || new Date().toISOString(),
        };
        const index = merged.findIndex((s) => s.id === script.id);
        if (index >= 0) {
          merged[index] = script;
        } else {
          merged.push(script);
        }
      }
      await this._writeChunked(merged);
    } else if (data && data.version === 2) {
      // v2 format — merge sites, personas, scripts (preserve soft-deleted items)
      if (data.sites) {
        const existingSites = await this._getRawSites();
        const mergedSites = [...existingSites];
        for (const incoming of data.sites) {
          const index = mergedSites.findIndex((s) => s.id === incoming.id);
          if (index >= 0) mergedSites[index] = incoming;
          else mergedSites.push(incoming);
        }
        await chrome.storage.local.set({ steno_sites: mergedSites });
      }

      if (data.personas) {
        const existingPersonas = await this._getRawPersonas();
        const mergedPersonas = [...existingPersonas];
        for (const incoming of data.personas) {
          const index = mergedPersonas.findIndex((p) => p.id === incoming.id);
          if (index >= 0) mergedPersonas[index] = incoming;
          else mergedPersonas.push(incoming);
        }
        await chrome.storage.local.set({ steno_personas: mergedPersonas });
      }

      if (data.scripts) {
        const existingScripts = await this._readChunked();
        const mergedScripts = [...existingScripts];
        for (const incoming of data.scripts) {
          const index = mergedScripts.findIndex((s) => s.id === incoming.id);
          if (index >= 0) mergedScripts[index] = incoming;
          else mergedScripts.push(incoming);
        }
        await this._writeChunked(mergedScripts);
      }
    }
  },

  // ─── Theme ──────────────────────────────────────────────

  async getTheme() {
    const data = await chrome.storage.local.get('steno_theme');
    return data.steno_theme || 'system';
  },

  async setTheme(theme) {
    await chrome.storage.local.set({ steno_theme: theme });
  },

  // ─── Cloud Sync ──────────────────────────────────────────

  /**
   * Bidirectional sync with the API.
   * Uploads all local data, applies server changes locally.
   * Requires ApiService to be loaded and authenticated.
   */
  async sync() {
    if (typeof ApiService === 'undefined') return { ok: false, reason: 'ApiService not loaded' };

    const isAuth = await ApiService.isAuthenticated();
    if (!isAuth) return { ok: false, reason: 'Not authenticated' };

    try {
      // Send ALL data including soft-deleted items so server learns about deletions
      const [sites, personas, scripts] = await Promise.all([
        this._getRawSites(),
        this._getRawPersonas(),
        this._readChunked(),
      ]);

      const result = await ApiService.sync({ sites, personas, scripts });

      // Apply server changes locally (last-write-wins by updated_at)
      if (result.sites) {
        await this._mergeServerData('sites', result.sites);
      }
      if (result.personas) {
        await this._mergeServerData('personas', result.personas);
      }
      if (result.scripts) {
        await this._mergeServerScripts(result.scripts);
      }

      // Purge locally soft-deleted items — they've been sent to the server
      await this._purgeConfirmedDeleted();

      return { ok: true, synced_at: result.synced_at };
    } catch (err) {
      console.error('Steno sync failed:', err);
      return { ok: false, reason: err.message };
    }
  },

  async _mergeServerData(type, serverItems) {
    const key = `steno_${type}`;
    const data = await chrome.storage.local.get(key);
    const localItems = data[key] || [];

    for (const serverItem of serverItems) {
      const localIdx = localItems.findIndex(l => l.id === serverItem.id);
      if (localIdx >= 0) {
        // Server wins if newer
        if (new Date(serverItem.updated_at) > new Date(localItems[localIdx].updated_at)) {
          localItems[localIdx] = serverItem; // keep soft-deleted items (with deleted_at)
        }
      } else {
        localItems.push(serverItem); // add even if deleted — purge handles cleanup
      }
    }

    await chrome.storage.local.set({ [key]: localItems });
  },

  async _mergeServerScripts(serverScripts) {
    const local = await this._readChunked();

    for (const serverScript of serverScripts) {
      const localIdx = local.findIndex(l => l.id === serverScript.id);
      if (localIdx >= 0) {
        if (new Date(serverScript.updated_at) > new Date(local[localIdx].updated_at)) {
          local[localIdx] = serverScript; // keep soft-deleted items (with deleted_at)
        }
      } else {
        local.push(serverScript); // add even if deleted — purge handles cleanup
      }
    }

    await this._writeChunked(local);
  },

  async _purgeConfirmedDeleted() {
    // Remove soft-deleted items from local storage after successful sync
    const allSites = await this._getRawSites();
    await chrome.storage.local.set({ steno_sites: allSites.filter((s) => !s.deleted_at) });

    const allPersonas = await this._getRawPersonas();
    await chrome.storage.local.set({ steno_personas: allPersonas.filter((p) => !p.deleted_at) });

    const allScripts = await this._readChunked();
    await this._writeChunked(allScripts.filter((s) => !s.deleted_at));
  },
};
