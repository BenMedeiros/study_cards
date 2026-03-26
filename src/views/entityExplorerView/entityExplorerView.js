import { el } from '../../utils/browser/ui.js';
import * as idb from '../../utils/browser/idb.js';
import { createViewHeaderTools } from '../../components/features/viewHeaderTools.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { createTable } from '../../components/shared/table.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';
import { openTableSettingsDialog } from '../../components/dialogs/tableSettingsDialog.js';
import entityExplorerViewController from './entityExplorerViewController.js';
import studyManagerController from '../studyManagerView/studyManagerController.js';
import {
  normalizeTableSettings,
  applyTableColumnSettings,
  applyTableColumnStyles,
  applyTableActionSettings,
  buildTableColumnItems,
} from '../../utils/browser/tableSettings.js';

const TABLE_ACTION_ITEMS = [
  { key: 'clear', label: 'Clear' },
  { key: 'copyJson', label: 'Copy JSON' },
  { key: 'copyFullJson', label: 'Copy Full JSON' },
];

const DEFAULT_ENTITY_EXPLORER_SETTINGS = Object.freeze({
  manager: 'idb',
  db: null,
  selection: null,
  sessionStateViewer: {
    expanded: true,
    wrapping: false,
    collapsedPaths: [],
  },
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
  const manager = ['idb', 'ls', 'session'].includes(rawManager) ? rawManager : DEFAULT_ENTITY_EXPLORER_SETTINGS.manager;
  const sessionStateViewer = (src.sessionStateViewer && typeof src.sessionStateViewer === 'object') ? src.sessionStateViewer : {};
  return {
    manager,
    db: (typeof src.db === 'string' && src.db.trim()) ? src.db : null,
    selection: (typeof src.selection === 'string' && src.selection.trim()) ? src.selection : null,
    sessionStateViewer: {
      expanded: sessionStateViewer.expanded !== undefined ? !!sessionStateViewer.expanded : true,
      wrapping: !!sessionStateViewer.wrapping,
      collapsedPaths: Array.isArray(sessionStateViewer.collapsedPaths)
        ? sessionStateViewer.collapsedPaths.filter((entry) => typeof entry === 'string')
        : [],
    },
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
  let analysisStateUnsub = null;
  let sessionViewerExpose = null;

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

  function persistSessionViewerState() {
    try {
      if (!sessionViewerExpose) return;
      persistEntityExplorerSettings({
        sessionStateViewer: {
          expanded: !!sessionViewerExpose.getExpanded?.(),
          wrapping: !!sessionViewerExpose.getWrapping?.(),
          collapsedPaths: Array.isArray(sessionViewerExpose.getCollapsedPaths?.())
            ? sessionViewerExpose.getCollapsedPaths()
            : [],
        },
      });
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
    const next = await openTableSettingsDialog({
      tableName: 'Entity Explorer Storage Table',
      sourceInfo: latestTableSourceInfo,
      columns: buildTableColumnItems(latestTableHeaders, latestTableRows),
      actions: TABLE_ACTION_ITEMS,
      settings: storageTableSettings,
    });
    if (!next) return;
    await persistStorageTableSettings(next);

    const manager = String((managerDropdown?.getValue && managerDropdown.getValue()) || initialManager || 'idb');
    await loadAndRenderManager(manager);
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

  // Collapse-all control (added to header tools)
  const _collapseRec = headerTools.addElement({
    type: 'button', key: 'collapseAll', label: 'Collapse all', title: 'Collapse all JSON viewers'
  });
  const _tableSettingsRec = headerTools.addElement({
    type: 'button', key: 'tableSettings', label: 'Table', title: 'Storage table settings'
  });
  const _refreshSessionRec = headerTools.addElement({
    type: 'button', key: 'refreshSessionState', label: 'Refresh', title: 'Refresh session-state analysis reports'
  });
  function updateCollapseAllBtnState() {
    const collapseAllBtn = headerTools.getControl('collapseAll');
    // enabled only if there exists at least one expanded json-view-wrapper
    const anyExpanded = Boolean(document.querySelector('#entity-explorer-root .json-view-wrapper[data-expanded="true"]'));
    if (collapseAllBtn) collapseAllBtn.disabled = !anyExpanded;
  }

  const tableSettingsBtn = headerTools.getControl('tableSettings');
  if (tableSettingsBtn) {
    tableSettingsBtn.addEventListener('click', () => {
      void openStorageTableSettingsDialog();
    });
  }
  const refreshSessionBtn = headerTools.getControl('refreshSessionState');
  if (refreshSessionBtn) {
    refreshSessionBtn.addEventListener('click', () => {
      void refreshSessionStateReports();
    });
  }
  const collapseAllBtn = headerTools.getControl('collapseAll');
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      const wrappers = Array.from(document.querySelectorAll('#entity-explorer-root .json-view-wrapper'));
      wrappers.forEach(w => {
        const btn = w.querySelector('.json-toggle');
        if (!btn) return;
        // if currently expanded, click to collapse
        if (w.dataset.expanded === 'true') btn.click();
      });
      updateCollapseAllBtnState();
    });
  }


  const managerItems = [
    { value: 'idb', label: 'IndexedDB' },
    { value: 'ls', label: 'localStorage' },
    { value: 'session', label: 'Session State' },
  ];

  function teardownSessionStateSubscription() {
    try { if (typeof analysisStateUnsub === 'function') analysisStateUnsub(); } catch (e) {}
    analysisStateUnsub = null;
    sessionViewerExpose = null;
  }

  function updateTableSettingsBtnState(manager) {
    const button = headerTools.getControl('tableSettings');
    if (!button) return;
    button.disabled = String(manager || 'idb') === 'session';
  }

  function updateSessionRefreshBtnState(manager) {
    const button = headerTools.getControl('refreshSessionState');
    if (!button) return;
    button.disabled = String(manager || 'idb') !== 'session';
  }

  async function refreshSessionStateReports() {
    try { await store?.collectionDB?.validations?.runAll?.(); } catch (e) {}
    try {
      const activeCollectionId = String(store?.collections?.getActiveCollectionId?.() || '').trim();
      if (activeCollectionId) {
        studyManagerController.requestRefresh('entityExplorer.session.refresh', {
          delayMs: 0,
          collectionIds: [activeCollectionId],
        });
      }
    } catch (e) {}
  }

  function hideIdbControls() {
    try { if (dbGroup?.parentElement) dbGroup.parentElement.removeChild(dbGroup); } catch (e) {}
    try { if (storeGroup?.parentElement) storeGroup.parentElement.removeChild(storeGroup); } catch (e) {}
  }

  function showIdbControls() {
    try { if (dbGroup && !dbGroup.parentElement) left.append(dbGroup); } catch (e) {}
    try { if (storeGroup && !storeGroup.parentElement) left.append(storeGroup); } catch (e) {}
  }

  async function loadAndRenderManager(manager) {
    teardownSessionStateSubscription();
    updateTableSettingsBtnState(manager);
    updateSessionRefreshBtnState(manager);
    content.innerHTML = '';
    content.append(el('div', { className: 'hint', text: 'Loading…' }));
    try {
      if (manager === 'session') {
        latestTableHeaders = [];
        latestTableRows = [];
        latestTableSourceInfo = 'Session State';

        const expose = {};
        sessionViewerExpose = expose;
        const getSessionStateSnapshot = () => {
          try { return store?.analysis?.getState?.() || {}; } catch (e) { return {}; }
        };
        const viewer = renderJsonViewer(getSessionStateSnapshot(), {
          id: 'entity-explorer-session-state',
          expanded: entityExplorerSettings?.sessionStateViewer?.expanded !== undefined
            ? !!entityExplorerSettings.sessionStateViewer.expanded
            : true,
          wrapping: !!entityExplorerSettings?.sessionStateViewer?.wrapping,
          collapsedPaths: Array.isArray(entityExplorerSettings?.sessionStateViewer?.collapsedPaths)
            ? entityExplorerSettings.sessionStateViewer.collapsedPaths
            : [],
          maxChars: 200000,
          maxLines: 10000,
          previewLen: 400,
          expose,
        });

        content.innerHTML = '';
        content.append(viewer);
        viewer.addEventListener('json-toggle', () => {
          persistSessionViewerState();
        });
        viewer.addEventListener('json-tree-toggle', () => {
          persistSessionViewerState();
        });
        viewer.addEventListener('json-wrap-toggle', () => {
          persistSessionViewerState();
        });
        if (store?.analysis && typeof store.analysis.subscribe === 'function') {
          analysisStateUnsub = store.analysis.subscribe(() => {
            try {
              const activeManager = String((managerDropdown?.getValue && managerDropdown.getValue()) || initialManager || 'idb');
              if (activeManager !== 'session') return;
              expose.setJson?.(getSessionStateSnapshot());
              updateCollapseAllBtnState();
            } catch (e) {}
          });
        }
        try { updateCollapseAllBtnState(); } catch (e) {}
      } else if (manager === 'idb') {
        content.innerHTML = el('div', { className: 'hint', text: 'Select a database and store to inspect.' });
      } else {
        const keys = collectLocalStorageKeys();
        const rows = keys.map(k => {
          const pre = renderJsonViewer(readLocalStorageValue(k));
          const arr = [k, pre];
          try { arr.__id = k; } catch (e) {}
          return arr;
        });
        const headers = ['Key', 'Value'];
        const applied = applyTableColumnSettings({ headers, rows, tableSettings: storageTableSettings });
        const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (storageTableSettings?.columns?.stylesByKey || {}), tableRenderSettings: storageTableSettings?.table || {}, id: 'ls-table', searchable: true, sortable: true });
        applyTableColumnStyles({ wrapper: table, tableSettings: storageTableSettings });
        applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: storageTableSettings, actionItems: TABLE_ACTION_ITEMS });
        latestTableHeaders = headers;
        latestTableRows = rows;
        latestTableSourceInfo = `localStorage | ${rows.length} keys`;

        content.innerHTML = '';
        content.append(table);
        try { updateCollapseAllBtnState(); } catch (e) {}      }
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
      try { updateCollapseAllBtnState(); } catch (e) {}
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
  // append right-side controls to header tools
  try { if (_tableSettingsRec && _tableSettingsRec.group) headerTools.append(_tableSettingsRec.group); } catch (e) {}
  try { if (_refreshSessionRec && _refreshSessionRec.group) headerTools.append(_refreshSessionRec.group); } catch (e) {}
  try { if (_collapseRec && _collapseRec.group) headerTools.append(_collapseRec.group); } catch (e) {}

  // wrap handled per-view inside each JSON viewer component

  root.append(headerTools, content);

  // update collapse-all button when individual json viewers change
  root.addEventListener('json-toggle', () => {
    try { updateCollapseAllBtnState(); } catch (e) {}
  });

  // initial state
  const _initState = _savedAppState || {};
  const _initManager = String(_initState.manager || 'idb');
  if (_initManager === 'idb') {
    updateTableSettingsBtnState('idb');
    loadAndRenderManager('idb');
    rebuildDbDropdown();
  } else {
    updateTableSettingsBtnState(_initManager);
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
        const pre = renderJsonViewer(val);
        const arr = [key, pre];
        try { arr.__id = key; } catch (e) {}
        return arr;
      }) : [];
      const headers = ['Key', 'Value'];
      const applied = applyTableColumnSettings({ headers, rows, tableSettings: storageTableSettings });
      const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (storageTableSettings?.columns?.stylesByKey || {}), tableRenderSettings: storageTableSettings?.table || {}, id: `idb-${dbName}-${storeName}-table`, searchable: true, sortable: true });
      applyTableColumnStyles({ wrapper: table, tableSettings: storageTableSettings });
      applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: storageTableSettings, actionItems: TABLE_ACTION_ITEMS });
      latestTableHeaders = headers;
      latestTableRows = rows;
      latestTableSourceInfo = `${dbName}/${storeName} | ${rows.length} rows`;

      content.innerHTML = '';
      content.append(table);
      try { updateCollapseAllBtnState(); } catch (e) {}
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    }
  }

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      teardownSessionStateSubscription();
      try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch (e) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return root;
}














