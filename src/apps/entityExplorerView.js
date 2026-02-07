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

  const baseSources = [
    { id: 'idb:collection_settings', label: 'IndexedDB: collection_settings', manager: 'idb' },
    { id: 'idb:kanji_progress', label: 'IndexedDB: kanji_progress', manager: 'idb' },
    { id: 'idb:grammar_progress', label: 'IndexedDB: grammar_progress', manager: 'idb' },
    { id: 'idb:study_time_sessions', label: 'IndexedDB: study_time_sessions', manager: 'idb' },
    { id: 'ls:shell', label: 'localStorage: shell', manager: 'ls' },
    { id: 'ls:apps', label: 'localStorage: apps', manager: 'ls' },
    { id: 'ls:kv__kanji_progress', label: 'localStorage: kv__kanji_progress (fallback)', manager: 'ls' },
    { id: 'ls:kv__grammar_progress', label: 'localStorage: kv__grammar_progress (fallback)', manager: 'ls' },
    { id: 'ls:ALL', label: 'localStorage: ALL keys', manager: 'ls' },
  ];

  function getCollectionsRuntimeSources() {
    try {
      const items = store?.collections?.debugListRuntimeMaps?.() || [];
      return (Array.isArray(items) ? items : [])
        .filter(it => it && typeof it === 'object')
        .map(it => ({
          id: `mgr:collections:${String(it.id || '').trim()}`,
          label: `Collections: ${String(it.label || it.id || '').trim()}`,
          manager: 'collections',
        }))
        .filter(it => it.id !== 'mgr:collections:');
    } catch {
      return [];
    }
  }

  function getCollectionsRuntimeDrilldownItems(parentMapId) {
    const mapId = String(parentMapId || '').trim();
    if (!mapId) return [];
    try {
      if (mapId === 'sentencesCache') {
        const rows = store?.collections?.debugGetRuntimeMapDump?.('sentencesCache', { limit: 1000 }) || [];
        const arr = Array.isArray(rows) ? rows : [];
        return arr
          .map(r => ({ value: String(r?.top ?? ''), label: `${String(r?.top ?? '')} (${Number(r?.count) || 0})` }))
          .filter(it => it.value);
      }
      if (mapId === 'sentencesRefIndex') {
        const rows = store?.collections?.debugGetRuntimeMapDump?.('sentencesRefIndex', { limit: 1000 }) || [];
        const arr = Array.isArray(rows) ? rows : [];
        return arr
          .map(r => ({ value: String(r?.top ?? ''), label: `${String(r?.top ?? '')} (${Number(r?.refCount) || 0})` }))
          .filter(it => it.value);
      }
      if (mapId === 'folderEntryIndexCache') {
        const rows = store?.collections?.debugGetRuntimeMapDump?.('folderEntryIndexCache', { limit: 1000 }) || [];
        const arr = Array.isArray(rows) ? rows : [];
        return arr
          .map(r => ({ value: String(r?.folder ?? ''), label: `${String(r?.folder ?? '')} (${Number(r?.terms) || 0})` }))
          .filter(it => it.value);
      }
      return [];
    } catch {
      return [];
    }
  }

  function getAllSources() {
    return [...baseSources, ...getCollectionsRuntimeSources()];
  }

  function labelForManager(managerId, source) {
    const m = String(managerId || 'all');
    const raw = String(source?.label || source?.id || '').trim();
    if (m === 'idb') return raw.replace(/^IndexedDB:\s*/i, '');
    if (m === 'ls') return raw.replace(/^localStorage:\s*/i, '');
    if (m === 'collections') return raw.replace(/^Collections:\s*/i, '');
    return raw;
  }

  function buildItemsForManager(managerId) {
    const m = String(managerId || 'all');
    const sources = getAllSources();
    const filtered = (m === 'all')
      ? sources
      : sources.filter(s => String(s.manager) === m);

    return filtered.map(s => ({ value: s.id, label: labelForManager(m, s) }));
  }

  const managerItems = [
    { value: 'all', label: 'All' },
    { value: 'collections', label: 'Collections Manager' },
    { value: 'idb', label: 'IndexedDB' },
    { value: 'ls', label: 'localStorage' },
  ];

  const content = document.createElement('div');
  content.className = 'entity-explorer-content';

  function getPersistedState() {
    try {
      const st = store?.apps?.getState?.('entityExplorer') || {};
      // Backwards compatibility:
      // - older state stored only `selection`
      // - older state stored `{ group, selection }`
      const selection = String(st.selection || '').trim() || null;
      const manager = String(st.manager || '').trim() || null;
      const legacyGroup = String(st.group || '').trim() || null;
      return { manager: manager || legacyGroup, selection };
    } catch {
      return { manager: null, selection: null };
    }
  }

  function setPersistedState({ manager, selection }) {
    try {
      store?.apps?.setState?.('entityExplorer', { manager, selection });
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
      } else if (selection.startsWith('mgr:collections:')) {
        // Selection format:
        // - mgr:collections:<mapId>
        // - mgr:collections:<mapId>:<subKey>
        const rest = selection.slice('mgr:collections:'.length);
        const parts = rest.split(':');
        const mapId = String(parts[0] || '').trim();
        const subKey = parts.length > 1 ? parts.slice(1).join(':') : null;

        const effectiveId = subKey ? `${mapId}:${subKey}` : mapId;
        const dump = store?.collections?.debugGetRuntimeMapDump?.(effectiveId, { limit: 500, includeSample: true });
        value = dump;
        mode = Array.isArray(value) ? 'table' : 'json';
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

  function inferManagerFromSelection(selection) {
    const s = String(selection || '');
    if (s.startsWith('mgr:collections:')) return 'collections';
    if (s.startsWith('idb:')) return 'idb';
    if (s.startsWith('ls:')) return 'ls';
    return 'all';
  }

  const allSources = getAllSources();
  const defaultSelection = allSources[0]?.id || 'ls:ALL';
  let currentSelection = persisted.selection || defaultSelection;
  let currentManager = persisted.manager || inferManagerFromSelection(currentSelection) || 'all';

  // Dynamic drilldown state (only used for Collections Manager runtime maps)
  let currentSubSelection = null;

  function itemsForManager(manager) {
    return buildItemsForManager(manager);
  }

  const controlsRow = document.createElement('div');
  controlsRow.className = 'entity-explorer-controls-row';

  const managerDropdown = createDropdown({
    items: managerItems,
    value: currentManager,
    onChange: (nextManager) => {
      currentManager = String(nextManager || 'all');
      const allowed = itemsForManager(currentManager);
      const normalized = normalizeSelectionForSourceDropdown(currentSelection);
      if (!allowed.some(it => it.value === normalized)) {
        currentSelection = allowed[0]?.value || defaultSelection;
      }
      rebuildSourceDropdown();
      setPersistedState({ manager: currentManager, selection: currentSelection });
      loadAndRender(currentSelection);
    },
    className: '',
    closeOverlaysOnOpen: true,
  });

  const sourceDropdownSlot = document.createElement('div');
  sourceDropdownSlot.className = 'entity-explorer-source-slot';

  const subDropdownSlot = document.createElement('div');
  subDropdownSlot.className = 'entity-explorer-source-slot';

  function selectionHasCollectionsDrilldown(selection) {
    const s = String(selection || '');
    if (!s.startsWith('mgr:collections:')) return false;
    const rest = s.slice('mgr:collections:'.length);
    const mapId = String(rest.split(':')[0] || '').trim();
    return mapId === 'sentencesCache' || mapId === 'sentencesRefIndex' || mapId === 'folderEntryIndexCache';
  }

  function parseCollectionsSelection(selection) {
    const s = String(selection || '');
    if (!s.startsWith('mgr:collections:')) return { mapId: null, subKey: null };
    const rest = s.slice('mgr:collections:'.length);
    const parts = rest.split(':');
    const mapId = String(parts[0] || '').trim() || null;
    const subKey = parts.length > 1 ? parts.slice(1).join(':') : null;
    return { mapId, subKey };
  }

  function buildCollectionsSelection(mapId, subKey) {
    const m = String(mapId || '').trim();
    if (!m) return 'mgr:collections:';
    const s = (subKey == null || String(subKey).trim() === '') ? null : String(subKey);
    return s ? `mgr:collections:${m}:${s}` : `mgr:collections:${m}`;
  }

  function normalizeSelectionForSourceDropdown(selection) {
    const s = String(selection || '');
    if (!s.startsWith('mgr:collections:')) return s;
    const { mapId } = parseCollectionsSelection(s);
    return mapId ? `mgr:collections:${mapId}` : s;
  }

  function rebuildSourceDropdown() {
    const allowed = itemsForManager(currentManager);
    if (!allowed.length) return;

    // Ensure currentSelection is still valid.
    const normalized = normalizeSelectionForSourceDropdown(currentSelection);
    if (!allowed.some(it => it.value === normalized)) {
      currentSelection = allowed[0].value;
    }

    sourceDropdownSlot.innerHTML = '';
    subDropdownSlot.innerHTML = '';

    const sourceDropdown = createDropdown({
      items: allowed,
      value: normalizeSelectionForSourceDropdown(currentSelection),
      onChange: (next) => {
        currentSelection = String(next || '').trim();

        // Reset sub-selection when changing main selection.
        currentSubSelection = null;

        // If the selected runtime map supports drilldown, ensure we show the drilldown dropdown
        // and pick a default sub-selection.
        if (selectionHasCollectionsDrilldown(currentSelection)) {
          const { mapId } = parseCollectionsSelection(currentSelection);
          const items = getCollectionsRuntimeDrilldownItems(mapId);
          if (items.length) {
            currentSubSelection = items[0].value;
            currentSelection = buildCollectionsSelection(mapId, currentSubSelection);
          }
        }

        setPersistedState({ manager: currentManager, selection: currentSelection });
        rebuildSubDropdown();
        loadAndRender(currentSelection);
      },
      className: '',
      closeOverlaysOnOpen: true,
    });
    sourceDropdownSlot.append(sourceDropdown);

    rebuildSubDropdown();
  }

  function rebuildSubDropdown() {
    subDropdownSlot.innerHTML = '';
    if (!String(currentSelection || '').startsWith('mgr:collections:')) return;
    const { mapId, subKey } = parseCollectionsSelection(currentSelection);
    if (!mapId) return;
    if (!selectionHasCollectionsDrilldown(currentSelection)) return;

    const drillItems = getCollectionsRuntimeDrilldownItems(mapId);
    if (!drillItems.length) return;

    // Ensure current sub-selection is valid.
    const current = (subKey != null) ? String(subKey) : (currentSubSelection != null ? String(currentSubSelection) : null);
    const nextSub = drillItems.some(it => it.value === current) ? current : drillItems[0].value;
    currentSubSelection = nextSub;

    // If persisted subKey is invalid/missing, repair currentSelection.
    if (String(subKey || '') !== String(nextSub || '')) {
      currentSelection = buildCollectionsSelection(mapId, nextSub);
      setPersistedState({ manager: currentManager, selection: currentSelection });
    }

    const dd = createDropdown({
      items: drillItems,
      value: nextSub,
      onChange: (next) => {
        currentSubSelection = String(next || '').trim() || null;
        currentSelection = buildCollectionsSelection(mapId, currentSubSelection);
        setPersistedState({ manager: currentManager, selection: currentSelection });
        loadAndRender(currentSelection);
      },
      className: '',
      closeOverlaysOnOpen: true,
    });
    subDropdownSlot.append(dd);
  }

  rebuildSourceDropdown();

  controlsRow.append(managerDropdown, sourceDropdownSlot, subDropdownSlot);
  headerTools.append(el('div', { className: 'hint', text: 'Entity Explorer (read-only)' }), controlsRow);

  root.append(headerTools, content);
  // Persist initial normalized state (in case we inferred manager)
  setPersistedState({ manager: currentManager, selection: currentSelection });
  loadAndRender(currentSelection);
  return root;
}
