import { el } from '../components/ui.js';
import * as idb from '../utils/idb.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';
import { createTable } from '../components/table.js';
import { createJsonViewer } from '../components/jsonViewer.js';

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

  // Register as a settings consumer.
  try {
    store?.settings?.registerConsumer?.({
      consumerId: 'entityExplorerView',
      settings: [
        'apps.entityExplorer.manager',
        'apps.entityExplorer.db',
        'apps.entityExplorer.selection',
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

  function updateCollapseAllBtnState() {
    const collapseAllBtn = headerTools.getControl('collapseAll');
    // enabled only if there exists at least one expanded json-view-wrapper
    const anyExpanded = Boolean(document.querySelector('#entity-explorer-root .json-view-wrapper[data-expanded="true"]'));
    if (collapseAllBtn) collapseAllBtn.disabled = !anyExpanded;
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

  // Wrap toggle control for JSON views
  const _jsonWrapRec = headerTools.addElement({ type: 'button', key: 'jsonWrap', label: 'Wrap', caption: 'JSON', title: 'Toggle JSON wrap' });

  function updateJsonWrapBtn() {
    const wrapped = Boolean(root.classList && root.classList.contains('json-wrap'));
    const jsonWrapBtn = headerTools.getControl('jsonWrap');
    if (!jsonWrapBtn) return;
    jsonWrapBtn.textContent = wrapped ? 'Unwrap' : 'Wrap';
    jsonWrapBtn.setAttribute('aria-pressed', wrapped ? 'true' : 'false');
  }

  const jsonWrapBtn = headerTools.getControl('jsonWrap');
  if (jsonWrapBtn) {
    jsonWrapBtn.addEventListener('click', () => {
      const wrapped = root.classList.toggle('json-wrap');
      updateJsonWrapBtn();
    });
  }

  const managerItems = [
    { value: 'idb', label: 'IndexedDB' },
    { value: 'ls', label: 'localStorage' },
  ];

  async function loadAndRenderManager(manager) {
    content.innerHTML = '';
    content.append(el('div', { className: 'hint', text: 'Loading…' }));
    try {
      if (manager === 'idb') {
        content.innerHTML = el('div', { className: 'hint', text: 'Select a database and store to inspect.' });
      } else {
        const keys = collectLocalStorageKeys();
        const rows = keys.map(k => {
          const pre = renderJsonViewer(readLocalStorageValue(k));
          const arr = [k, pre];
          try { arr.__id = k; } catch (e) {}
          return arr;
        });
        content.innerHTML = '';
        content.append(createTable({ store, headers: ['Key', 'Value'], rows, id: 'ls-table', searchable: true, sortable: true }));
        try { updateCollapseAllBtnState(); } catch (e) {}
      }
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
        return {
          manager: store.settings.get('apps.entityExplorer.manager', { consumerId: 'entityExplorerView' }),
          db: store.settings.get('apps.entityExplorer.db', { consumerId: 'entityExplorerView' }),
          selection: store.settings.get('apps.entityExplorer.selection', { consumerId: 'entityExplorerView' }),
        };
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
      // persist manager selection (apps.entityExplorer)
      try {
        if (store?.settings && typeof store.settings.set === 'function') {
          store.settings.set('apps.entityExplorer.manager', sel, { consumerId: 'entityExplorerView', immediate: true });
          if (sel === 'ls') {
            store.settings.set('apps.entityExplorer.db', null, { consumerId: 'entityExplorerView', immediate: true });
            store.settings.set('apps.entityExplorer.selection', null, { consumerId: 'entityExplorerView', immediate: true });
          }
        }
      } catch (e) {}
      loadAndRenderManager(sel);
      if (sel === 'idb') {
        if (!dbGroup.parentElement) left.append(dbGroup);
        if (!storeGroup.parentElement) left.append(storeGroup);
        rebuildDbDropdown();
      } else {
        try { if (dbGroup.parentElement) dbGroup.parentElement.removeChild(dbGroup); } catch (e) {}
        try { if (storeGroup.parentElement) storeGroup.parentElement.removeChild(storeGroup); } catch (e) {}
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
  spacer.className = 'qa-header-spacer';
  headerTools.append(left, spacer);
  // append JSON wrap group then collapse-all to the right side of header tools
  try { if (_jsonWrapRec && _jsonWrapRec.group) headerTools.append(_jsonWrapRec.group); } catch (e) {}
  try { if (_collapseRec && _collapseRec.group) headerTools.append(_collapseRec.group); } catch (e) {}

  // set initial label for wrap button
  updateJsonWrapBtn();

  root.append(headerTools, content);

  // update collapse-all button when individual json viewers change
  root.addEventListener('json-toggle', () => {
    try { updateCollapseAllBtnState(); } catch (e) {}
  });

  // initial state
  const _initState = _savedAppState || {};
  const _initManager = String(_initState.manager || 'idb');
  if (_initManager === 'idb') {
    loadAndRenderManager('idb');
    rebuildDbDropdown();
  } else {
    loadAndRenderManager('ls');
    try { if (dbGroup.parentElement) dbGroup.parentElement.removeChild(dbGroup); } catch (e) {}
    try { if (storeGroup.parentElement) storeGroup.parentElement.removeChild(storeGroup); } catch (e) {}
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
          // persist selected DB
          try {
            store?.settings?.set?.('apps.entityExplorer.manager', 'idb', { consumerId: 'entityExplorerView', immediate: true });
            store?.settings?.set?.('apps.entityExplorer.db', dbName, { consumerId: 'entityExplorerView', immediate: true });
          } catch (e) {}
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
          // persist selected store and manager/db
          try {
            store?.settings?.set?.('apps.entityExplorer.manager', 'idb', { consumerId: 'entityExplorerView', immediate: true });
            store?.settings?.set?.('apps.entityExplorer.db', dbName, { consumerId: 'entityExplorerView', immediate: true });
            store?.settings?.set?.('apps.entityExplorer.selection', `idb:${storeName}`, { consumerId: 'entityExplorerView', immediate: true });
          } catch (e) {}
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
      content.innerHTML = '';
      content.append(createTable({ store, headers: ['Key', 'Value'], rows, id: `idb-${dbName}-${storeName}-table`, searchable: true, sortable: true }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    }
  }

  return root;
}
