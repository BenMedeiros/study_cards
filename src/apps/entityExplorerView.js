import { el } from '../components/ui.js';
import * as idb from '../utils/idb.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';

function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function collectLocalStorageKeys() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    keys.sort((a, b) => a.localeCompare(b));
    return keys;
  } catch {
    return [];
  }
}

function readLocalStorageValue(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch {
    return null;
  }
}

function uniqueColumnsFromRows(rows, limit = 50) {
  const cols = new Set();
  const sample = Array.isArray(rows) ? rows.slice(0, limit) : [];
  for (const r of sample) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) cols.add(k);
  }
  return Array.from(cols);
}

function renderTable(rows) {
  const container = el('div', { className: 'entity-explorer-table' });

  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) {
    container.append(el('div', { className: 'hint', text: 'No rows.' }));
    return container;
  }

  const cols = uniqueColumnsFromRows(arr);
  const table = document.createElement('table');
  table.className = 'table';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    trh.append(th);
  }
  thead.append(trh);

  const tbody = document.createElement('tbody');
  for (const r of arr.slice(0, 500)) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      const v = r ? r[c] : null;
      if (isPlainObject(v) || Array.isArray(v)) {
        td.textContent = safeJson(v);
        td.className = 'mono wrap';
      } else {
        td.textContent = (v == null) ? '' : String(v);
      }
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(thead, tbody);
  container.append(table);

  if (arr.length > 500) {
    container.append(el('div', { className: 'hint', text: `Showing first 500 rows (of ${arr.length}).` }));
  }
  return container;
}

function renderJsonViewer(value) {
  const pre = document.createElement('pre');
  pre.className = 'json-view mono';
  pre.textContent = safeJson(value);
  return pre;
}

export function renderEntityExplorer({ store }) {
  const root = document.createElement('div');
  root.id = 'entity-explorer-root';

  const headerTools = createViewHeaderTools();

  const sources = [
    { id: 'idb:collection_settings', label: 'IndexedDB: collection_settings' },
    { id: 'idb:kanji_progress', label: 'IndexedDB: kanji_progress' },
    { id: 'idb:grammar_progress', label: 'IndexedDB: grammar_progress' },
    { id: 'idb:study_time_sessions', label: 'IndexedDB: study_time_sessions' },
    { id: 'ls:shell', label: 'localStorage: shell' },
    { id: 'ls:apps', label: 'localStorage: apps' },
    { id: 'ls:kv__kanji_progress', label: 'localStorage: kv__kanji_progress (fallback)' },
    { id: 'ls:kv__grammar_progress', label: 'localStorage: kv__grammar_progress (fallback)' },
    { id: 'ls:ALL', label: 'localStorage: ALL keys' },
  ];

  function labelForGroup(group, source) {
    const g = String(group || 'all');
    const raw = String(source?.label || source?.id || '').trim();
    if (g === 'idb') return raw.replace(/^IndexedDB:\s*/i, '');
    if (g === 'ls') return raw.replace(/^localStorage:\s*/i, '');
    return raw;
  }

  function buildItemsForGroup(group) {
    const g = String(group || 'all');
    const filtered = (g === 'idb')
      ? sources.filter(s => String(s.id).startsWith('idb:'))
      : (g === 'ls')
        ? sources.filter(s => String(s.id).startsWith('ls:'))
        : sources;

    return filtered.map(s => ({ value: s.id, label: labelForGroup(g, s) }));
  }

  const groupItems = [
    { value: 'all', label: 'All' },
    { value: 'idb', label: 'IndexedDB' },
    { value: 'ls', label: 'localStorage' },
  ];

  const content = document.createElement('div');
  content.className = 'entity-explorer-content';

  function getPersistedState() {
    try {
      const st = store?.apps?.getState?.('entityExplorer') || {};
      // Backwards compatibility: older state stored only `selection`.
      const selection = String(st.selection || '').trim() || null;
      const group = String(st.group || '').trim() || null;
      return { group, selection };
    } catch {
      return { group: null, selection: null };
    }
  }

  function setPersistedState({ group, selection }) {
    try {
      store?.apps?.setState?.('entityExplorer', { group, selection });
    } catch (e) {}
  }

  async function loadAndRender(selection) {
    content.innerHTML = '';
    const loading = el('div', { className: 'hint', text: 'Loading…' });
    content.append(loading);

    let mode = 'json';
    let value = null;

    try {
      if (selection.startsWith('idb:')) {
        const storeName = selection.slice(4);
        const rows = await idb.idbGetAll(storeName).catch(() => null);
        value = rows || [];
        mode = 'table';
      } else if (selection.startsWith('ls:')) {
        const key = selection.slice(3);
        if (key === 'ALL') {
          const keys = collectLocalStorageKeys();
          value = keys.map(k => ({ key: k, value: readLocalStorageValue(k) }));
          mode = 'table';
        } else {
          value = readLocalStorageValue(key);
          mode = (Array.isArray(value)) ? 'table' : 'json';
        }
      }
    } catch (e) {
      value = { error: String(e?.message || e) };
      mode = 'json';
    }

    content.innerHTML = '';
    if (mode === 'table') content.append(renderTable(value));
    else content.append(renderJsonViewer(value));
  }

  const persisted = getPersistedState();

  function inferGroupFromSelection(selection) {
    const s = String(selection || '');
    if (s.startsWith('idb:')) return 'idb';
    if (s.startsWith('ls:')) return 'ls';
    return 'all';
  }

  let currentSelection = persisted.selection || sources[0].id;
  let currentGroup = persisted.group || inferGroupFromSelection(currentSelection) || 'all';

  function itemsForGroup(group) {
    return buildItemsForGroup(group);
  }

  const controlsRow = document.createElement('div');
  controlsRow.className = 'entity-explorer-controls-row';

  const sourceGroupDropdown = createDropdown({
    items: groupItems,
    value: currentGroup,
    onChange: (nextGroup) => {
      currentGroup = String(nextGroup || 'all');
      // If the selection isn't valid for the group anymore, pick first available.
      const allowed = itemsForGroup(currentGroup);
      if (!allowed.some(it => it.value === currentSelection)) {
        currentSelection = allowed[0]?.value || sources[0].id;
      }
      rebuildSourceDropdown();
      setPersistedState({ group: currentGroup, selection: currentSelection });
      loadAndRender(currentSelection);
    },
    className: '',
    closeOverlaysOnOpen: true,
  });

  const sourceDropdownSlot = document.createElement('div');
  sourceDropdownSlot.className = 'entity-explorer-source-slot';

  function rebuildSourceDropdown() {
    const allowed = itemsForGroup(currentGroup);
    if (!allowed.length) return;

    // Ensure currentSelection is still valid.
    if (!allowed.some(it => it.value === currentSelection)) {
      currentSelection = allowed[0].value;
    }

    sourceDropdownSlot.innerHTML = '';
    const sourceDropdown = createDropdown({
      items: allowed,
      value: currentSelection,
      onChange: (next) => {
        currentSelection = String(next || '').trim();
        setPersistedState({ group: currentGroup, selection: currentSelection });
        loadAndRender(currentSelection);
      },
      className: '',
      closeOverlaysOnOpen: true,
    });
    sourceDropdownSlot.append(sourceDropdown);
  }

  rebuildSourceDropdown();

  controlsRow.append(sourceGroupDropdown, sourceDropdownSlot);
  headerTools.append(el('div', { className: 'hint', text: 'Entity Explorer (read-only)' }), controlsRow);

  root.append(headerTools, content);
  // Persist initial normalized state (in case we inferred group)
  setPersistedState({ group: currentGroup, selection: currentSelection });
  loadAndRender(currentSelection);
  return root;
}
