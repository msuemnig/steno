/**
 * Options page — two-panel tree view with site/persona/script CRUD
 * and script detail view with field reordering.
 */
(async () => {
  // ─── Theme ─────────────────────────────────────────────
  const themePicker = document.getElementById('theme-picker');
  const currentTheme = await chrome.runtime.sendMessage({ type: 'GET_THEME' }) || 'system';
  document.documentElement.setAttribute('data-theme', currentTheme);

  function setActiveThemeBtn(theme) {
    themePicker.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }
  setActiveThemeBtn(currentTheme);

  themePicker.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    const theme = btn.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    setActiveThemeBtn(theme);
    await msg({ type: 'SET_THEME', theme });
  });

  // ─── DOM refs ──────────────────────────────────────────
  const navList = document.getElementById('nav-list');
  const detailPanel = document.getElementById('detail-panel');
  const emptyDetail = document.getElementById('empty-detail');
  const panels = document.getElementById('panels');
  const scriptDetailView = document.getElementById('script-detail');
  const btnExport = document.getElementById('btn-export');
  const importFile = document.getElementById('import-file');

  // Script detail refs
  const detailScriptName = document.getElementById('detail-script-name');
  const detailScriptMeta = document.getElementById('detail-script-meta');
  const fieldTbody = document.getElementById('field-tbody');
  const btnBackToSite = document.getElementById('btn-back-to-site');
  const btnDetailReplay = document.getElementById('btn-detail-replay');

  let selectedSiteId = null; // null = ungrouped
  let selectedSiteIsUngrouped = false;
  let currentDetailScript = null;
  let dragFromIndex = null;

  function msg(data) {
    return chrome.runtime.sendMessage(data);
  }

  // ─── Site Nav ──────────────────────────────────────────

  async function renderNav() {
    const tree = await msg({ type: 'GET_TREE' });
    navList.innerHTML = '';

    for (const site of tree.sites) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      if (site.id === selectedSiteId && !selectedSiteIsUngrouped) li.classList.add('active');
      li.dataset.siteId = site.id;

      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = site.label;
      label.title = site.hostname;
      li.appendChild(label);

      li.addEventListener('click', () => {
        selectedSiteId = site.id;
        selectedSiteIsUngrouped = false;
        renderNav();
        renderDetail();
      });

      navList.appendChild(li);
    }

    // Ungrouped
    const ungroupedLi = document.createElement('li');
    ungroupedLi.className = 'nav-item nav-item-ungrouped';
    if (selectedSiteIsUngrouped) ungroupedLi.classList.add('active');

    const ungroupedLabel = document.createElement('span');
    ungroupedLabel.className = 'nav-label';
    ungroupedLabel.textContent = 'Ungrouped';
    ungroupedLi.appendChild(ungroupedLabel);

    ungroupedLi.addEventListener('click', () => {
      selectedSiteId = null;
      selectedSiteIsUngrouped = true;
      renderNav();
      renderDetail();
    });
    navList.appendChild(ungroupedLi);

    // Auto-select first site if nothing selected
    if (!selectedSiteId && !selectedSiteIsUngrouped && tree.sites.length > 0) {
      selectedSiteId = tree.sites[0].id;
      renderNav();
      renderDetail();
      return;
    }

    renderDetail();
  }

  // ─── Detail Panel ─────────────────────────────────────

  async function renderDetail() {
    const tree = await msg({ type: 'GET_TREE' });
    detailPanel.innerHTML = '';

    let siteData = null;
    let personas = [];
    let unassigned = [];

    if (selectedSiteIsUngrouped) {
      personas = tree.ungrouped.personas || [];
      unassigned = tree.ungrouped.scripts || [];
    } else if (selectedSiteId) {
      siteData = tree.sites.find((s) => s.id === selectedSiteId);
      if (!siteData) {
        detailPanel.innerHTML = '<p class="empty-detail">Site not found.</p>';
        return;
      }
      personas = siteData.personas || [];
      unassigned = siteData.unassigned || [];
    } else {
      detailPanel.innerHTML = '<p class="empty-detail">Select a site to view its scripts.</p>';
      return;
    }

    // Site header (editable label + delete)
    if (siteData) {
      const siteHeader = document.createElement('div');
      siteHeader.className = 'detail-site-header';

      const siteTitle = createInlineEdit(siteData.label, async (newLabel) => {
        await msg({ type: 'SAVE_SITE', site: { ...siteData, label: newLabel } });
        await renderNav();
      });
      siteTitle.classList.add('detail-site-title');
      siteHeader.appendChild(siteTitle);

      const hostSpan = document.createElement('span');
      hostSpan.className = 'detail-site-host';
      hostSpan.textContent = siteData.hostname;
      siteHeader.appendChild(hostSpan);

      const siteActions = document.createElement('div');
      siteActions.className = 'detail-site-actions';

      const addPersonaBtn = document.createElement('button');
      addPersonaBtn.className = 'btn btn-ghost btn-sm';
      addPersonaBtn.textContent = '+ Persona';
      addPersonaBtn.addEventListener('click', async () => {
        const name = prompt('Persona name:');
        if (!name) return;
        await msg({
          type: 'SAVE_PERSONA',
          persona: { id: crypto.randomUUID(), site_id: siteData.id, name },
        });
        await renderDetail();
      });
      siteActions.appendChild(addPersonaBtn);

      const delSiteBtn = document.createElement('button');
      delSiteBtn.className = 'btn btn-danger btn-sm';
      delSiteBtn.textContent = 'Delete site';
      delSiteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete site "${siteData.label}"? Its personas will be deleted. Scripts will move to Ungrouped.`)) return;
        await msg({ type: 'DELETE_SITE', id: siteData.id });
        selectedSiteId = null;
        selectedSiteIsUngrouped = true;
        await renderNav();
      });
      siteActions.appendChild(delSiteBtn);

      siteHeader.appendChild(siteActions);
      detailPanel.appendChild(siteHeader);
    } else {
      const header = document.createElement('div');
      header.className = 'detail-site-header';
      const title = document.createElement('h2');
      title.className = 'detail-site-title';
      title.textContent = 'Ungrouped';
      header.appendChild(title);
      detailPanel.appendChild(header);
    }

    // All personas for this site (to use in reassign dropdowns)
    const allPersonas = personas;

    // Persona sections
    for (const persona of personas) {
      renderPersonaSection(persona, allPersonas);
    }

    // "No persona" section
    if (unassigned.length > 0 || personas.length > 0) {
      const section = document.createElement('div');
      section.className = 'persona-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'persona-header';
      const sectionTitle = document.createElement('span');
      sectionTitle.className = 'persona-name-muted';
      sectionTitle.textContent = 'No persona';
      sectionHeader.appendChild(sectionTitle);
      section.appendChild(sectionHeader);

      if (unassigned.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-persona';
        empty.textContent = 'No scripts without a persona.';
        section.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'script-list';
        for (const script of unassigned) {
          list.appendChild(createScriptRow(script, allPersonas));
        }
        section.appendChild(list);
      }

      detailPanel.appendChild(section);
    }

    // If nothing at all
    if (personas.length === 0 && unassigned.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-detail';
      empty.textContent = 'No scripts here yet. Record one from the popup.';
      detailPanel.appendChild(empty);
    }
  }

  function renderPersonaSection(persona, allPersonas) {
    const section = document.createElement('div');
    section.className = 'persona-section';

    const header = document.createElement('div');
    header.className = 'persona-header';

    const nameEdit = createInlineEdit(persona.name, async (newName) => {
      await msg({ type: 'SAVE_PERSONA', persona: { ...persona, name: newName } });
      await renderDetail();
    });
    nameEdit.classList.add('persona-name-edit');
    header.appendChild(nameEdit);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-icon-danger';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Delete persona';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete persona "${persona.name}"? Scripts will lose their persona assignment.`)) return;
      await msg({ type: 'DELETE_PERSONA', id: persona.id });
      await renderDetail();
    });
    header.appendChild(delBtn);

    section.appendChild(header);

    if (persona.scripts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-persona';
      empty.textContent = 'No scripts in this persona.';
      section.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'script-list';
      for (const script of persona.scripts) {
        list.appendChild(createScriptRow(script, allPersonas));
      }
      section.appendChild(list);
    }

    detailPanel.appendChild(section);
  }

  function createScriptRow(script, allPersonas) {
    const row = document.createElement('div');
    row.className = 'script-row';

    const info = document.createElement('div');
    info.className = 'script-row-info';
    info.addEventListener('click', () => openScriptDetail(script));

    const nameSpan = document.createElement('span');
    nameSpan.className = 'script-row-name';
    nameSpan.textContent = script.name;
    info.appendChild(nameSpan);

    const fieldCount = document.createElement('span');
    fieldCount.className = 'script-row-fields';
    const fields = script.fields || [];
    const clickCount = fields.filter((f) => f.action === 'click').length;
    if (clickCount > 0) {
      const fillCount = fields.length - clickCount;
      fieldCount.textContent = `${fields.length} steps (${fillCount}F ${clickCount}C)`;
    } else {
      fieldCount.textContent = `${fields.length} fields`;
    }
    info.appendChild(fieldCount);

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'script-row-actions';

    // Persona reassign dropdown
    if (allPersonas.length > 0) {
      const reassign = document.createElement('select');
      reassign.className = 'reassign-select';
      reassign.title = 'Assign persona';

      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '\u2014';
      reassign.appendChild(noneOpt);

      for (const p of allPersonas) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (script.persona_id === p.id) opt.selected = true;
        reassign.appendChild(opt);
      }
      if (!script.persona_id) noneOpt.selected = true;

      reassign.addEventListener('change', async () => {
        const newPersonaId = reassign.value || null;
        await msg({
          type: 'SAVE_SCRIPT',
          script: { ...script, persona_id: newPersonaId },
        });
        await renderDetail();
      });
      actions.appendChild(reassign);
    }

    // Edit name
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-icon';
    editBtn.textContent = '\u270E';
    editBtn.title = 'Rename';
    editBtn.addEventListener('click', async () => {
      const newName = prompt('Script name:', script.name);
      if (!newName || newName === script.name) return;
      await msg({ type: 'SAVE_SCRIPT', script: { ...script, name: newName } });
      await renderDetail();
    });
    actions.appendChild(editBtn);

    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-icon-danger';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete script "${script.name}"?`)) return;
      await msg({ type: 'DELETE_SCRIPT', id: script.id });
      await renderDetail();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    return row;
  }

  // ─── Inline Edit Component ────────────────────────────

  function createInlineEdit(value, onSave) {
    const wrapper = document.createElement('span');
    wrapper.className = 'inline-edit';

    const display = document.createElement('span');
    display.className = 'inline-edit-display';
    display.textContent = value;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input hidden';
    input.value = value;

    display.addEventListener('dblclick', () => {
      display.classList.add('hidden');
      input.classList.remove('hidden');
      input.focus();
      input.select();
    });

    async function commit() {
      const newVal = input.value.trim();
      input.classList.add('hidden');
      display.classList.remove('hidden');
      if (newVal && newVal !== value) {
        display.textContent = newVal;
        await onSave(newVal);
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') {
        input.value = value;
        input.classList.add('hidden');
        display.classList.remove('hidden');
      }
    });

    wrapper.appendChild(display);
    wrapper.appendChild(input);
    return wrapper;
  }

  // ─── Script Detail View ───────────────────────────────

  async function openScriptDetail(script) {
    // Fetch fresh copy
    currentDetailScript = await msg({ type: 'GET_SCRIPT', id: script.id });
    if (!currentDetailScript) return;

    panels.classList.add('hidden');
    scriptDetailView.classList.remove('hidden');

    detailScriptName.textContent = currentDetailScript.name;

    const allFields = currentDetailScript.fields || [];
    const detailClickCount = allFields.filter((f) => f.action === 'click').length;
    let stepSummary;
    if (detailClickCount > 0) {
      const detailFillCount = allFields.length - detailClickCount;
      stepSummary = `${allFields.length} steps (${detailFillCount}F ${detailClickCount}C)`;
    } else {
      stepSummary = `${allFields.length} fields`;
    }
    const date = currentDetailScript.updated_at
      ? new Date(currentDetailScript.updated_at).toLocaleDateString()
      : '\u2014';
    let urlHint = '';
    if (currentDetailScript.url_hint) {
      try { urlHint = new URL(currentDetailScript.url_hint).host + new URL(currentDetailScript.url_hint).pathname; }
      catch { urlHint = currentDetailScript.url_hint; }
    }

    detailScriptMeta.textContent = `${stepSummary} \u00B7 recorded ${date}${urlHint ? ' \u00B7 ' + urlHint : ''}`;

    renderFieldTable();
  }

  function renderFieldTable() {
    const fields = currentDetailScript.fields || [];
    fieldTbody.innerHTML = '';

    // Sort by order
    const sorted = [...fields].sort((a, b) => a.order - b.order);

    sorted.forEach((field, idx) => {
      const tr = document.createElement('tr');
      tr.draggable = true;
      tr.dataset.index = idx;
      const isClick = field.action === 'click';

      // Drag handle
      const tdHandle = document.createElement('td');
      tdHandle.className = 'col-handle';
      tdHandle.textContent = '\u2261';
      tr.appendChild(tdHandle);

      // Order
      const tdOrder = document.createElement('td');
      tdOrder.className = 'col-order';
      tdOrder.textContent = field.order;
      tr.appendChild(tdOrder);

      // Action
      const tdAction = document.createElement('td');
      tdAction.className = 'col-action';
      const badge = document.createElement('span');
      badge.className = isClick ? 'action-badge action-click' : 'action-badge action-fill';
      badge.textContent = isClick ? 'CLICK' : 'FILL';
      tdAction.appendChild(badge);
      tr.appendChild(tdAction);

      // Selector
      const tdSelector = document.createElement('td');
      tdSelector.className = 'col-selector';
      const selectorCode = document.createElement('code');
      selectorCode.textContent = field.selector;
      tdSelector.appendChild(selectorCode);
      if (field.fragile) {
        const warn = document.createElement('span');
        warn.className = 'fragile-badge';
        warn.textContent = '\u26A0';
        warn.title = 'Fragile positional selector';
        tdSelector.appendChild(warn);
      }
      tr.appendChild(tdSelector);

      // Type
      const tdType = document.createElement('td');
      tdType.className = 'col-type';
      tdType.textContent = isClick ? 'click' : (field.type || '');
      tr.appendChild(tdType);

      // Value
      const tdValue = document.createElement('td');
      tdValue.className = 'col-value';
      if (isClick) {
        tdValue.textContent = '\u2014';
      } else {
        const valueStr = typeof field.value === 'boolean' ? String(field.value) : `"${field.value}"`;
        tdValue.textContent = valueStr;
      }
      tr.appendChild(tdValue);

      // Label
      const tdLabel = document.createElement('td');
      tdLabel.className = 'col-label';
      tdLabel.textContent = field.label || '';
      tr.appendChild(tdLabel);

      // ─── Drag-and-drop events ───
      tr.addEventListener('dragstart', (e) => {
        dragFromIndex = idx;
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Clear previous drag-over highlights
        fieldTbody.querySelectorAll('tr.drag-over').forEach((r) => r.classList.remove('drag-over'));
        if (dragFromIndex !== null && idx !== dragFromIndex) {
          tr.classList.add('drag-over');
        }
      });

      tr.addEventListener('dragleave', () => {
        tr.classList.remove('drag-over');
      });

      tr.addEventListener('drop', async (e) => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        if (dragFromIndex === null || dragFromIndex === idx) return;

        // Reorder: remove dragged item, insert at target position
        const reordered = [...sorted];
        const [moved] = reordered.splice(dragFromIndex, 1);
        reordered.splice(idx, 0, moved);

        // Reassign sequential order values
        reordered.forEach((f, i) => { f.order = i + 1; });

        currentDetailScript.fields = reordered;
        dragFromIndex = null;

        await msg({ type: 'SAVE_SCRIPT', script: currentDetailScript });
        renderFieldTable();
      });

      tr.addEventListener('dragend', () => {
        dragFromIndex = null;
        fieldTbody.querySelectorAll('tr.dragging, tr.drag-over').forEach((r) => {
          r.classList.remove('dragging', 'drag-over');
        });
      });

      fieldTbody.appendChild(tr);
    });
  }

  btnBackToSite.addEventListener('click', () => {
    scriptDetailView.classList.add('hidden');
    panels.classList.remove('hidden');
    currentDetailScript = null;
    renderDetail();
  });

  btnDetailReplay.addEventListener('click', async () => {
    if (!currentDetailScript) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { alert('No active tab found.'); return; }
      // Ensure content script
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['services/recorder.js', 'content.js'],
        });
      }
      // Clear any stale results
      await msg({ type: 'CLEAR_REPLAY_RESULTS' });
      const results = await chrome.tabs.sendMessage(tab.id, {
        type: 'REPLAY_SCRIPT',
        fields: currentDetailScript.fields,
      });

      // Check for cross-page results (may have additional data)
      const crossResults = await msg({ type: 'GET_REPLAY_RESULTS' });
      const finalResults = crossResults || results;
      await msg({ type: 'CLEAR_REPLAY_RESULTS' });

      const parts = [`${finalResults.filled} filled`];
      if (finalResults.clicked > 0) parts.push(`${finalResults.clicked} clicked`);
      parts.push(`${finalResults.skipped} skipped`);
      let summary = `Replayed: ${parts.join(', ')}.`;
      if (finalResults.aborted) summary += ' (aborted: cross-domain navigation)';
      alert(summary);
    } catch (err) {
      // May fail if page navigated — check for cross-page results
      const crossResults = await msg({ type: 'GET_REPLAY_RESULTS' });
      if (crossResults) {
        await msg({ type: 'CLEAR_REPLAY_RESULTS' });
        const parts = [`${crossResults.filled} filled`];
        if (crossResults.clicked > 0) parts.push(`${crossResults.clicked} clicked`);
        parts.push(`${crossResults.skipped} skipped`);
        let summary = `Replayed (cross-page): ${parts.join(', ')}.`;
        if (crossResults.aborted) summary += ' (aborted: cross-domain navigation)';
        alert(summary);
      } else {
        alert('Replay failed: ' + err.message);
      }
    }
  });

  // ─── Export / Import ──────────────────────────────────

  btnExport.addEventListener('click', async () => {
    const data = await msg({ type: 'EXPORT_ALL' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'steno-export.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    try {
      const data = JSON.parse(text);
      // Detect format: array (legacy) or object with version
      if (Array.isArray(data) || (data && data.version)) {
        await msg({ type: 'IMPORT_ALL', data });
        await renderNav();
      } else {
        alert('Unrecognized format. Expected a JSON array or v2 export object.');
      }
    } catch {
      alert('Failed to parse JSON.');
    }
    importFile.value = '';
  });

  // ─── Init ─────────────────────────────────────────────
  await renderNav();
})();
