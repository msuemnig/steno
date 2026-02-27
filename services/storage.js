/**
 * Storage abstraction layer — v2: sites, personas, scripts.
 * Uses chrome.storage.sync with chunked storage for scripts.
 * Migrates from v1 qafill_profiles on first load.
 */
const StorageService = {
  // ─── Constants ──────────────────────────────────────────
  SCHEMA_VERSION: 2,
  CHUNK_SIZE: 7000, // ~7KB per chunk, well under 8KB limit

  // ─── Migration ──────────────────────────────────────────

  async migrateIfNeeded() {
    const data = await chrome.storage.sync.get('steno_schema_version');
    if (data.steno_schema_version >= this.SCHEMA_VERSION) return;

    const legacy = await chrome.storage.sync.get('qafill_profiles');
    const profiles = legacy.qafill_profiles || [];

    if (profiles.length > 0) {
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

      await chrome.storage.sync.set({ steno_sites: sites });
      await chrome.storage.sync.set({ steno_personas: [] });
      await this._writeChunked(scripts);
    } else {
      // No legacy data — initialize empty
      const existing = await chrome.storage.sync.get(['steno_sites', 'steno_personas']);
      if (!existing.steno_sites) await chrome.storage.sync.set({ steno_sites: [] });
      if (!existing.steno_personas) await chrome.storage.sync.set({ steno_personas: [] });
      const count = await chrome.storage.sync.get('steno_scripts_count');
      if (count.steno_scripts_count === undefined) {
        await chrome.storage.sync.set({ steno_scripts_count: 0 });
      }
    }

    await chrome.storage.sync.set({ steno_schema_version: this.SCHEMA_VERSION });
    // Legacy data left intact as backup
  },

  // ─── Chunked Storage for Scripts ────────────────────────

  async _writeChunked(scripts) {
    const json = JSON.stringify(scripts);
    const chunks = [];
    for (let i = 0; i < json.length; i += this.CHUNK_SIZE) {
      chunks.push(json.slice(i, i + this.CHUNK_SIZE));
    }

    // Remove old chunks first
    const oldData = await chrome.storage.sync.get('steno_scripts_count');
    const oldCount = oldData.steno_scripts_count || 0;
    if (oldCount > 0) {
      const keysToRemove = [];
      for (let i = 0; i < oldCount; i++) {
        keysToRemove.push(`steno_scripts_${i}`);
      }
      await chrome.storage.sync.remove(keysToRemove);
    }

    // Write new chunks
    const writeObj = { steno_scripts_count: chunks.length };
    for (let i = 0; i < chunks.length; i++) {
      writeObj[`steno_scripts_${i}`] = chunks[i];
    }
    await chrome.storage.sync.set(writeObj);
  },

  async _readChunked() {
    const data = await chrome.storage.sync.get('steno_scripts_count');
    const count = data.steno_scripts_count || 0;
    if (count === 0) return [];

    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(`steno_scripts_${i}`);
    }
    const chunks = await chrome.storage.sync.get(keys);
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

  async getSites() {
    const data = await chrome.storage.sync.get('steno_sites');
    return data.steno_sites || [];
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
    const sites = await this.getSites();
    const index = sites.findIndex((s) => s.id === site.id);
    if (index >= 0) {
      site.updated_at = new Date().toISOString();
      sites[index] = site;
    } else {
      site.created_at = site.created_at || new Date().toISOString();
      site.updated_at = site.created_at;
      sites.push(site);
    }
    await chrome.storage.sync.set({ steno_sites: sites });
    return site;
  },

  async deleteSite(id) {
    let sites = await this.getSites();
    sites = sites.filter((s) => s.id !== id);
    await chrome.storage.sync.set({ steno_sites: sites });

    // Cascade: delete personas for this site
    let personas = await this.getPersonas();
    personas = personas.filter((p) => p.site_id !== id);
    await chrome.storage.sync.set({ steno_personas: personas });

    // Cascade: move scripts to Ungrouped (null site_id), clear persona_id
    const scripts = await this._readChunked();
    for (const s of scripts) {
      if (s.site_id === id) {
        s.site_id = null;
        s.persona_id = null;
        s.updated_at = new Date().toISOString();
      }
    }
    await this._writeChunked(scripts);
  },

  // ─── Persona CRUD ──────────────────────────────────────

  async getPersonas() {
    const data = await chrome.storage.sync.get('steno_personas');
    return data.steno_personas || [];
  },

  async getPersonasBySite(siteId) {
    const personas = await this.getPersonas();
    return personas.filter((p) => p.site_id === siteId);
  },

  async savePersona(persona) {
    const personas = await this.getPersonas();
    const index = personas.findIndex((p) => p.id === persona.id);
    if (index >= 0) {
      persona.updated_at = new Date().toISOString();
      personas[index] = persona;
    } else {
      persona.created_at = persona.created_at || new Date().toISOString();
      persona.updated_at = persona.created_at;
      personas.push(persona);
    }
    await chrome.storage.sync.set({ steno_personas: personas });
    return persona;
  },

  async deletePersona(id) {
    let personas = await this.getPersonas();
    personas = personas.filter((p) => p.id !== id);
    await chrome.storage.sync.set({ steno_personas: personas });

    // Cascade: scripts lose their persona_id (stay under same site)
    const scripts = await this._readChunked();
    for (const s of scripts) {
      if (s.persona_id === id) {
        s.persona_id = null;
        s.updated_at = new Date().toISOString();
      }
    }
    await this._writeChunked(scripts);
  },

  // ─── Script CRUD ────────────────────────────────────────

  async getScripts() {
    return await this._readChunked();
  },

  async getScript(id) {
    const scripts = await this.getScripts();
    return scripts.find((s) => s.id === id) || null;
  },

  async saveScript(script) {
    const scripts = await this.getScripts();
    const index = scripts.findIndex((s) => s.id === script.id);
    if (index >= 0) {
      script.updated_at = new Date().toISOString();
      scripts[index] = script;
    } else {
      script.created_at = script.created_at || new Date().toISOString();
      script.updated_at = script.created_at;
      scripts.push(script);
    }
    await this._writeChunked(scripts);
    return script;
  },

  async deleteScript(id) {
    let scripts = await this.getScripts();
    scripts = scripts.filter((s) => s.id !== id);
    await this._writeChunked(scripts);
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

  // ─── Export / Import ────────────────────────────────────

  async exportAll() {
    const [sites, personas, scripts] = await Promise.all([
      this.getSites(),
      this.getPersonas(),
      this.getScripts(),
    ]);
    return { version: 2, sites, personas, scripts };
  },

  async importAll(data) {
    // Detect legacy array format vs v2 object format
    if (Array.isArray(data)) {
      // Legacy v1 format — treat as scripts (profiles)
      const existing = await this.getScripts();
      const merged = [...existing];
      for (const incoming of data) {
        // Ensure script-compatible shape
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
      // v2 format — merge sites, personas, scripts
      if (data.sites) {
        const existingSites = await this.getSites();
        const mergedSites = [...existingSites];
        for (const incoming of data.sites) {
          const index = mergedSites.findIndex((s) => s.id === incoming.id);
          if (index >= 0) mergedSites[index] = incoming;
          else mergedSites.push(incoming);
        }
        await chrome.storage.sync.set({ steno_sites: mergedSites });
      }

      if (data.personas) {
        const existingPersonas = await this.getPersonas();
        const mergedPersonas = [...existingPersonas];
        for (const incoming of data.personas) {
          const index = mergedPersonas.findIndex((p) => p.id === incoming.id);
          if (index >= 0) mergedPersonas[index] = incoming;
          else mergedPersonas.push(incoming);
        }
        await chrome.storage.sync.set({ steno_personas: mergedPersonas });
      }

      if (data.scripts) {
        const existingScripts = await this.getScripts();
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
    const data = await chrome.storage.sync.get('steno_theme');
    return data.steno_theme || 'system';
  },

  async setTheme(theme) {
    await chrome.storage.sync.set({ steno_theme: theme });
  },
};
