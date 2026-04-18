import { el, card } from '../../utils/browser/ui.js';
import * as idb from '../../utils/browser/idb.js';
import { createViewHeaderTools } from '../../components/viewHeaderTools/viewHeaderTools.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { createTable } from '../../components/table/table.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';
import { openTableSettingsDialog } from '../../components/table/tableSettingsDialog.js';
import entityExplorerViewController from './entityExplorerViewController.js';
import {
  normalizeTableSettings,
  applyTableColumnSettings,
  applyTableColumnStyles,
  applyTableActionSettings,
  buildTableColumnItems,
  attachCardTableSettingsButton,
} from '../../utils/browser/tableSettings.js';

const TABLE_ACTION_ITEMS = [
  { key: 'clear', label: 'Clear' },
  { key: 'copyJson', label: 'Copy JSON' },
  { key: 'copyFullJson', label: 'Copy Full JSON' },
  { key: 'downloadJson', label: 'Download JSON' },
  { key: 'downloadFullJson', label: 'Download Full JSON' },
];

const DEFAULT_ENTITY_EXPLORER_SETTINGS = Object.freeze({
  manager: 'idb',
  db: null,
  selection: null,
});

function cloneJson(value, fallback = null) {
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    return cloned == null ? fallback : cloned;
  } catch {
    return fallback;
  }
}

function normalizeEntityExplorerSettings(value) {
  const src = (value && typeof value === 'object') ? value : {};
  const rawManager = String(src.manager || DEFAULT_ENTITY_EXPLORER_SETTINGS.manager).trim();
  const manager = ['idb', 'ls'].includes(rawManager) ? rawManager : DEFAULT_ENTITY_EXPLORER_SETTINGS.manager;
  return {
    manager,
    db: (typeof src.db === 'string' && src.db.trim()) ? src.db : null,
    selection: (typeof src.selection === 'string' && src.selection.trim()) ? src.selection : null,
  };
}

// Persist UI selections for this view under the global namespaced blob
// stored at localStorage key `study_cards:v1` -> `apps` -> `entityExplorer`.
// Writes go through SettingsManager (store.settings).

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
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
  } catch { return []; }
}

function readLocalStorageValue(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch { return null; }
}

function renderJsonViewer(value, opts) { return createJsonViewer(value, opts); }

function parseJsonPath(path) {
  const raw = String(path || '').trim();
  if (!raw || raw[0] !== '$') return null;
  const tokens = [];
  let i = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '.') {
      i += 1;
      let j = i;
      while (j < raw.length && /[A-Za-z0-9_$]/.test(raw[j])) j += 1;
      const key = raw.slice(i, j).trim();
      if (!key) return null;
      tokens.push({ kind: 'prop', key });
      i = j;
      continue;
    }
    if (ch === '[') {
      const end = raw.indexOf(']', i + 1);
      if (end < 0) return null;
      const inner = raw.slice(i + 1, end).trim();
      if (!/^\d+$/.test(inner)) return null;
      tokens.push({ kind: 'index', index: Math.max(0, Math.round(Number(inner) || 0)) });
      i = end + 1;
      continue;
    }
    return null;
  }
  return tokens;
}

function extractJsonPathValue(value, path) {
  const tokens = parseJsonPath(path);
  if (!tokens) return undefined;
  let current = value;
  for (const token of tokens) {
    if (token.kind === 'prop') {
      if (!current || typeof current !== 'object') return undefined;
      current = current[token.key];
      continue;
    }
    if (!Array.isArray(current)) return undefined;
    current = current[token.index];
  }
  return current;
}

function classifyJsonFieldValue(value) {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value == null) return 'json';
  return 'json';
}

function inferJsonFieldType(values) {
  const seen = new Set();
  for (const value of (Array.isArray(values) ? values : [])) {
    if (value == null) continue;
    seen.add(classifyJsonFieldValue(value));
  }
  if (!seen.size) return 'json';
  if (seen.size === 1) return Array.from(seen)[0];
  return 'json';
}

function safePreviewValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return cloneJson(value, null);
}

function collectJsonPathOptionsFromValue(value, { path = '$', depth = 0, map, rowIndex, maxDepth = 4, maxArrayItems = 5 } = {}) {
  if (!map || depth > maxDepth) return;
  const key = String(path || '$').trim() || '$';
  let rec = map.get(key);
  if (!rec) {
    rec = { path: key, values: [], examples: [] };
    map.set(key, rec);
  }
  rec.values.push(value);
  if (rec.examples.length < 12) {
    rec.examples.push({
      rowIndex,
      value: safePreviewValue(value),
    });
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, maxArrayItems); i++) {
      collectJsonPathOptionsFromValue(value[i], {
        path: `${key}[${i}]`,
        depth: depth + 1,
        map,
        rowIndex,
        maxDepth,
        maxArrayItems,
      });
    }
    return;
  }
  for (const prop of Object.keys(value)) {
    collectJsonPathOptionsFromValue(value[prop], {
      path: `${key}.${prop}`,
      depth: depth + 1,
      map,
      rowIndex,
      maxDepth,
      maxArrayItems,
    });
  }
}

function buildStorageJsonFieldSources({ headers, rows } = {}) {
  const hs = Array.isArray(headers) ? headers : [];
  const rs = Array.isArray(rows) ? rows : [];
  return hs.map((header, columnIndex) => {
    const key = String((header && typeof header === 'object') ? (header.key || '') : (header || '')).trim();
    if (!key) return null;
    const pathMap = new Map();
    for (let rowIndex = 0; rowIndex < rs.length; rowIndex++) {
      const row = rs[rowIndex];
      const value = Array.isArray(row) ? row[columnIndex] : undefined;
      collectJsonPathOptionsFromValue(value, { map: pathMap, rowIndex });
    }
    const pathOptions = Array.from(pathMap.values()).map((item) => ({
      path: item.path,
      label: item.path === '$' ? '(self)' : item.path,
      type: inferJsonFieldType(item.values),
      examples: item.examples,
    })).sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
    return {
      key,
      label: key,
      description: `Extract a JSON field from the ${key} column.`,
      type: inferJsonFieldType(rs.map((row) => Array.isArray(row) ? row[columnIndex] : undefined)),
      pathOptions,
    };
  }).filter(Boolean);
}

function coerceJsonFieldValue(value, valueType) {
  const type = String(valueType || 'auto').trim().toLowerCase();
  if (type === 'json' || type === 'auto') return value;
  if (type === 'string') {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : '';
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    if (typeof value === 'number') return value !== 0;
    return '';
  }
  return value;
}

function buildStorageHeadersAndRows({ headers, rows, tableSettings }) {
  const baseHeaders = Array.isArray(headers) ? headers.slice() : [];
  const baseRows = Array.isArray(rows) ? rows.slice() : [];
  const normalized = normalizeTableSettings(tableSettings);
  const jsonFields = Array.isArray(normalized?.sources?.jsonFields) ? normalized.sources.jsonFields : [];
  if (!jsonFields.length) return { headers: baseHeaders, rows: baseRows };

  const keyToIndex = new Map();
  baseHeaders.forEach((header, index) => {
    const key = String((header && typeof header === 'object') ? (header.key || '') : (header || '')).trim();
    if (key && !keyToIndex.has(key)) keyToIndex.set(key, index);
  });

  const derivedHeaders = jsonFields.map((field) => ({
    key: String(field.key || '').trim(),
    label: String(field.label || field.path || field.key || '').trim() || String(field.key || '').trim(),
    type: String(field.valueType || '').trim() || 'auto',
    sourceKind: 'jsonField',
    sourceKey: String(field.sourceKey || '').trim(),
    jsonPath: String(field.path || '').trim(),
  })).filter((field) => field.key);

  const nextRows = baseRows.map((row) => {
    const out = Array.isArray(row) ? row.slice() : [];
    for (const field of jsonFields) {
      const sourceKey = String(field.sourceKey || '').trim();
      const path = String(field.path || '').trim();
      const sourceIndex = keyToIndex.get(sourceKey);
      const sourceValue = (sourceIndex == null || !Array.isArray(row)) ? undefined : row[sourceIndex];
      const extracted = extractJsonPathValue(sourceValue, path);
      out.push(coerceJsonFieldValue(extracted, field.valueType));
    }
    try { out.__id = row.__id; } catch (e) {}
    return out;
  });

  return {
    headers: [...baseHeaders, ...derivedHeaders],
    rows: nextRows,
  };
}

// Helpers for listing/opening arbitrary DBs and reading stores
async function listDatabases() {
  try {
    if (indexedDB.databases && typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      const names = Array.isArray(dbs) ? dbs.map(d => d.name).filter(Boolean) : [];
      return names.length ? Array.from(new Set(names)) : ['study_cards'];
    }
  } catch (e) {}
  return ['study_cards'];
}

function openDbByName(name) {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

function getAllFromDbInstance(db, storeName) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      if (typeof store.getAll === 'function') {
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
        return;
      }
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) { resolve(out); return; }
        out.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out);
    } catch (e) { resolve([]); }
  });
}

export function renderEntityExplorer({ store }) {
  const root = document.createElement('div');
  root.id = 'entity-explorer-root';
  root.className = 'entity-explorer-view';

  const activeCollection = store?.collections?.getActiveCollection?.();
  const settingsCollectionKey = String(activeCollection?.key || activeCollection?.path || '').trim();
  let tableSettingsCtrl = null;
  let storageTableSettings = entityExplorerViewController.getDefaultStorageTableSettings();
  let latestTableHeaders = [];
  let latestTableRows = [];
  let latestTableSourceInfo = '';

  function readSavedEntityExplorerSettings() {
    try {
      if (!(store?.settings && typeof store.settings.get === 'function')) return normalizeEntityExplorerSettings(null);
      try {
        return normalizeEntityExplorerSettings(
          store.settings.get('apps.entityExplorer', { consumerId: 'entityExplorerView' })
        );
      } catch (e) {}
      try {
        const raw = localStorage.getItem('study_cards:settings');
        const parsed = raw ? JSON.parse(raw) : {};
        return normalizeEntityExplorerSettings({
          manager: parsed?.['apps.entityExplorer.manager'],
          db: parsed?.['apps.entityExplorer.db'],
          selection: parsed?.['apps.entityExplorer.selection'],
        });
      } catch (e) {}
    } catch (e) {
    }
    return normalizeEntityExplorerSettings(null);
  }

  let entityExplorerSettings = readSavedEntityExplorerSettings();

  function persistEntityExplorerSettings(patch) {
    try {
      if (!(store?.settings && typeof store.settings.set === 'function')) return;
      entityExplorerSettings = normalizeEntityExplorerSettings({
        ...entityExplorerSettings,
        ...(patch && typeof patch === 'object' ? patch : {}),
      });
      store.settings.set(
        'apps.entityExplorer',
        cloneJson(entityExplorerSettings, {}) || {},
        { consumerId: 'entityExplorerView', immediate: true }
      );
    } catch (e) {}
  }

  try {
    if (settingsCollectionKey) {
      tableSettingsCtrl = entityExplorerViewController.create(settingsCollectionKey);
      storageTableSettings = normalizeTableSettings(tableSettingsCtrl.getStorageTableSettings());
    }
  } catch (e) {
    tableSettingsCtrl = null;
    storageTableSettings = entityExplorerViewController.getDefaultStorageTableSettings();
  }

  async function persistStorageTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    storageTableSettings = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setStorageTableSettings(normalized); } catch (e) {}
  }

  async function openStorageTableSettingsDialog() {
    const shaped = buildStorageHeadersAndRows({
      headers: latestTableHeaders,
      rows: latestTableRows,
      tableSettings: storageTableSettings,
    });
    const jsonFieldSources = buildStorageJsonFieldSources({
      headers: latestTableHeaders,
      rows: latestTableRows,
    });
    const next = await openTableSettingsDialog({
      tableName: 'Entity Explorer Storage Table',
      sourceInfo: latestTableSourceInfo,
      columns: buildTableColumnItems(shaped.headers, shaped.rows),
      actions: TABLE_ACTION_ITEMS,
      settings: storageTableSettings,
      jsonFieldSources,
    });
    if (!next) return;
    await persistStorageTableSettings(next);

    const manager = String((managerDropdown?.getValue && managerDropdown.getValue()) || initialManager || 'idb');
    await loadAndRenderManager(manager);
  }

  function buildStorageTableCard({ child, cornerCaption = '' } = {}) {
    const cardEl = card({
      id: 'entity-explorer-storage-card',
      cornerCaption,
      children: child ? [child] : [],
    });
    attachCardTableSettingsButton({
      cardEl,
      onClick: () => {
        void openStorageTableSettingsDialog();
      },
      title: 'Storage table settings',
    });
    return cardEl;
  }

  function updateStorageTableCardCaption(cardEl, { visibleRows, totalRows, unitLabel = 'rows' } = {}) {
    try {
      const corner = cardEl?.querySelector('.card-corner-caption');
      if (!corner) return;
      const visible = Math.max(0, Math.round(Number(visibleRows) || 0));
      const total = Math.max(0, Math.round(Number(totalRows) || 0));
      corner.textContent = (visible < total)
        ? `${visible}/${total} ${unitLabel}`
        : `${total} ${unitLabel}`;
      corner.title = (visible < total)
        ? `${visible} of ${total} ${unitLabel} shown`
        : `${total} ${unitLabel}`;
    } catch (e) {}
  }

  function attachStorageTableCaption(cardEl, tableWrapper, { totalRows = 0, unitLabel = 'rows' } = {}) {
    if (!cardEl || !tableWrapper) return;
    const update = (detail = {}) => {
      updateStorageTableCardCaption(cardEl, {
        visibleRows: detail?.visibleRows,
        totalRows: detail?.totalRows,
        unitLabel,
      });
    };
    tableWrapper.addEventListener('table:stateChange', (e) => {
      update(e?.detail || {});
    });
    update({
      visibleRows: Number(tableWrapper?.dataset?.visibleRows ?? totalRows),
      totalRows: Number(tableWrapper?.dataset?.totalRows ?? totalRows),
    });
  }
  // Register as a settings consumer.
  try {
    store?.settings?.registerConsumer?.({
      consumerId: 'entityExplorerView',
      settings: [
        'apps.entityExplorer',
      ],
    });
  } catch (e) {}

  const headerTools = createViewHeaderTools();
  const content = document.createElement('div');
  content.className = 'entity-explorer-content';

  const managerItems = [
    { value: 'idb', label: 'IndexedDB' },
    { value: 'ls', label: 'localStorage' },
  ];

  function hideIdbControls() {
    try { if (dbGroup?.parentElement) dbGroup.parentElement.removeChild(dbGroup); } catch (e) {}
    try { if (storeGroup?.parentElement) storeGroup.parentElement.removeChild(storeGroup); } catch (e) {}
  }

  function showIdbControls() {
    try { if (dbGroup && !dbGroup.parentElement) left.append(dbGroup); } catch (e) {}
    try { if (storeGroup && !storeGroup.parentElement) left.append(storeGroup); } catch (e) {}
  }

  async function loadAndRenderManager(manager) {
    content.innerHTML = '';
    content.append(el('div', { className: 'hint', text: 'Loading…' }));
    try {
      if (manager === 'idb') {
        const empty = el('div', { className: 'hint', text: 'Select a database and store to inspect.' });
        content.innerHTML = '';
        content.append(buildStorageTableCard({
          child: empty,
          cornerCaption: 'IndexedDB',
        }));
      } else {
        const keys = collectLocalStorageKeys();
        const rows = keys.map(k => {
          const arr = [k, readLocalStorageValue(k)];
          try { arr.__id = k; } catch (e) {}
          return arr;
        });
        const headers = ['Key', 'Value'];
        const shaped = buildStorageHeadersAndRows({ headers, rows, tableSettings: storageTableSettings });
        const applied = applyTableColumnSettings({ headers: shaped.headers, rows: shaped.rows, tableSettings: storageTableSettings });
        const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (storageTableSettings?.columns?.stylesByKey || {}), tableRenderSettings: storageTableSettings?.table || {}, id: 'ls-table', searchable: true, sortable: true });
        applyTableColumnStyles({ wrapper: table, tableSettings: storageTableSettings });
        applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: storageTableSettings, actionItems: TABLE_ACTION_ITEMS });
        latestTableHeaders = headers;
        latestTableRows = rows;
        latestTableSourceInfo = `localStorage | ${rows.length} keys`;

        content.innerHTML = '';
        const cardEl = buildStorageTableCard({
          child: table,
          cornerCaption: `${rows.length} keys`,
        });
        attachStorageTableCaption(cardEl, table, { totalRows: rows.length, unitLabel: 'keys' });
        content.append(cardEl);
      }
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
    }
  }

  // UI: manager dropdown + optional DB / store groups
  const _savedAppState = (() => {
    try {
      if (store?.settings && typeof store.settings.get === 'function') {
        return readSavedEntityExplorerSettings();
      }
    } catch (e) {}
    return {};
  })();
  const initialManager = String(_savedAppState.manager || 'idb');

  let managerGroup = null;
  let dbGroup = null;
  let storeGroup = null;

  const managerDropdown = createDropdown({
    items: managerItems,
    value: initialManager,
    onChange: (next) => {
      const sel = String(next || 'idb');
      persistEntityExplorerSettings({
        manager: sel,
        ...(sel !== 'idb' ? { db: null, selection: null } : {}),
      });
      loadAndRenderManager(sel);
      if (sel === 'idb') {
        showIdbControls();
        rebuildDbDropdown();
      } else {
        hideIdbControls();
      }
    },
    className: '',
    closeOverlaysOnOpen: true,
  });

  // manager dropdown wrapped and added to headerTools
  const _managerRec = headerTools.addElement({ type: 'custom', key: 'manager', create: () => managerDropdown, caption: 'Storage' });

  const dbDropdownSlot = document.createElement('div');
  dbDropdownSlot.className = 'entity-explorer-source-slot';
  // dbGroup will be created by headerTools and the slot used as the control element
  const _dbGroupRec = headerTools.addElement({ type: 'custom', key: 'dbGroup', create: () => dbDropdownSlot, caption: 'Database' });

  const storeDropdownSlot = document.createElement('div');
  storeDropdownSlot.className = 'entity-explorer-source-slot';
  const _storeGroupRec = headerTools.addElement({ type: 'custom', key: 'storeGroup', create: () => storeDropdownSlot, caption: 'Store' });

  const left = document.createElement('div');
  left.className = 'entity-explorer-controls-row';
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '0.5rem';
  // Move the created header groups into our left controls row so they appear together
  try { if (_managerRec && _managerRec.group) { managerGroup = _managerRec.group; left.append(_managerRec.group); } } catch (e) {}
  try { if (_dbGroupRec && _dbGroupRec.group) { dbGroup = _dbGroupRec.group; left.append(_dbGroupRec.group); } } catch (e) {}
  try { if (_storeGroupRec && _storeGroupRec.group) { storeGroup = _storeGroupRec.group; left.append(_storeGroupRec.group); } } catch (e) {}

  const spacer = document.createElement('div');
  spacer.className = 'header-tools-spacer';
  headerTools.append(left, spacer);

  root.append(headerTools, content);

  // initial state
  const _initState = _savedAppState || {};
  const _initManager = String(_initState.manager || 'idb');
  if (_initManager === 'idb') {
    loadAndRenderManager('idb');
    rebuildDbDropdown();
  } else {
    loadAndRenderManager(_initManager);
    hideIdbControls();
  }

  async function rebuildDbDropdown() {
    dbDropdownSlot.innerHTML = '';
    storeDropdownSlot.innerHTML = '';
    try {
      const dbs = await listDatabases();
      if (!dbs || !dbs.length) return;
      const items = dbs.map(n => ({ value: n, label: n }));
      const savedDb = (_savedAppState && _savedAppState.db) ? String(_savedAppState.db) : null;
      const initialDb = (savedDb && items.some(i => i.value === savedDb)) ? savedDb : items[0].value;
      const dd = createDropdown({
        items,
        value: initialDb,
        onChange: (next) => {
          const dbName = String(next || initialDb);
          persistEntityExplorerSettings({ manager: 'idb', db: dbName });
          rebuildStoreDropdown(dbName);
        },
        className: '',
        closeOverlaysOnOpen: true,
      });
      dbDropdownSlot.append(dd);
      rebuildStoreDropdown(initialDb);
    } catch (e) {
      dbDropdownSlot.append(el('div', { className: 'hint', text: 'Failed to list DBs' }));
    }
  }

  async function rebuildStoreDropdown(dbName) {
    storeDropdownSlot.innerHTML = '';
    if (!dbName) return;
    let db = null;
    try {
      db = await openDbByName(dbName);
    } catch (e) {
      storeDropdownSlot.append(el('div', { className: 'hint', text: 'Failed to open DB' }));
      return;
    }
    try {
      const stores = Array.from(db.objectStoreNames || []);
      if (!stores.length) {
        storeDropdownSlot.append(el('div', { className: 'hint', text: 'No object stores' }));
        try { db.close(); } catch (e) {}
        return;
      }
      const items = stores.map(s => ({ value: s, label: s }));
      // choose saved store if it matches this DB
      let savedStore = null;
      try {
        const sel = _savedAppState && _savedAppState.selection ? String(_savedAppState.selection) : '';
        if (sel && sel.startsWith('idb:')) savedStore = sel.slice(4);
        if (!_savedAppState && _savedAppState.store) savedStore = String(_savedAppState.store);
      } catch (e) { savedStore = null; }
      const initialStore = (savedStore && items.some(i => i.value === savedStore)) ? savedStore : items[0].value;
      const dd = createDropdown({
        items,
        value: initialStore,
        onChange: async (next) => {
          const storeName = String(next || initialStore);
          persistEntityExplorerSettings({
            manager: 'idb',
            db: dbName,
            selection: `idb:${storeName}`,
          });
          await loadAndRenderIdbStore(dbName, storeName);
        },
        className: '',
        closeOverlaysOnOpen: true,
      });
      storeDropdownSlot.append(dd);
      await loadAndRenderIdbStore(dbName, initialStore);
    } finally {
      try { db.close(); } catch (e) {}
    }
  }

  async function loadAndRenderIdbStore(dbName, storeName) {
    content.innerHTML = '';
    content.append(el('div', { className: 'hint', text: 'Loading…' }));
    try {
      const db = await openDbByName(dbName);
      const rowsRaw = await getAllFromDbInstance(db, storeName).catch(() => []);
      try { db.close(); } catch (e) {}
      const rows = Array.isArray(rowsRaw) ? rowsRaw.map((r, idx) => {
        let key = '';
        let val = r;
        try {
          if (r && typeof r === 'object') {
            if ('id' in r) { key = String(r.id); val = r.value !== undefined ? r.value : r; }
            else if ('startIso' in r) { key = String(r.startIso); val = r; }
            else { key = String(r.id ?? r.key ?? idx); val = r; }
          } else {
            key = String(idx);
            val = r;
          }
        } catch (e) { key = String(idx); val = r; }
        const arr = [key, val];
        try { arr.__id = key; } catch (e) {}
        return arr;
      }) : [];
      const headers = ['Key', 'Value'];
      const shaped = buildStorageHeadersAndRows({ headers, rows, tableSettings: storageTableSettings });
      const applied = applyTableColumnSettings({ headers: shaped.headers, rows: shaped.rows, tableSettings: storageTableSettings });
      const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (storageTableSettings?.columns?.stylesByKey || {}), tableRenderSettings: storageTableSettings?.table || {}, id: `idb-${dbName}-${storeName}-table`, searchable: true, sortable: true });
      applyTableColumnStyles({ wrapper: table, tableSettings: storageTableSettings });
      applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: storageTableSettings, actionItems: TABLE_ACTION_ITEMS });
      latestTableHeaders = headers;
      latestTableRows = rows;
      latestTableSourceInfo = `${dbName}/${storeName} | ${rows.length} rows`;

      content.innerHTML = '';
      const cardEl = buildStorageTableCard({
        child: table,
        cornerCaption: `${rows.length} rows`,
      });
      attachStorageTableCaption(cardEl, table, { totalRows: rows.length, unitLabel: 'rows' });
      content.append(cardEl);
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
    }
  }

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch (e) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return root;
}






