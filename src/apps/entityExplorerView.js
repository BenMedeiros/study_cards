import { el } from '../components/ui.js';
import * as idb from '../utils/idb.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';
import { createTable } from '../components/table.js';

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

function renderJsonViewer(value) {
  const pre = document.createElement('pre');
  pre.className = 'json-view mono';
  pre.textContent = safeJson(value);
  return pre;
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

  const headerTools = createViewHeaderTools();
  const content = document.createElement('div');
  content.className = 'entity-explorer-content';

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
        content.append(createTable({ headers: ['Key', 'Value'], rows, id: 'ls-table', searchable: true, sortable: true }));
      }
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
    }
  }

  // UI: manager dropdown + optional DB / store groups
  const managerDropdown = createDropdown({
    items: managerItems,
    value: 'idb',
    onChange: (next) => {
      const sel = String(next || 'idb');
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

  const managerGroup = document.createElement('div');
  managerGroup.className = 'data-expansion-group';
  managerGroup.append(managerDropdown);
  const managerCaption = document.createElement('div');
  managerCaption.className = 'data-expansion-caption';
  managerCaption.textContent = 'Storage';
  managerGroup.append(managerCaption);

  const dbDropdownSlot = document.createElement('div');
  dbDropdownSlot.className = 'entity-explorer-source-slot';
  const dbGroup = document.createElement('div');
  dbGroup.className = 'data-expansion-group';
  dbGroup.append(dbDropdownSlot);
  const dbCaption = document.createElement('div');
  dbCaption.className = 'data-expansion-caption';
  dbCaption.textContent = 'Database';
  dbGroup.append(dbCaption);

  const storeDropdownSlot = document.createElement('div');
  storeDropdownSlot.className = 'entity-explorer-source-slot';
  const storeGroup = document.createElement('div');
  storeGroup.className = 'data-expansion-group';
  storeGroup.append(storeDropdownSlot);
  const storeCaption = document.createElement('div');
  storeCaption.className = 'data-expansion-caption';
  storeCaption.textContent = 'Store';
  storeGroup.append(storeCaption);

  const left = document.createElement('div');
  left.className = 'entity-explorer-controls-row';
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '0.5rem';
  left.append(managerGroup);

  const spacer = document.createElement('div');
  spacer.className = 'qa-header-spacer';
  headerTools.append(left, spacer);

  root.append(headerTools, content);

  // initial state
  left.append(dbGroup, storeGroup);
  loadAndRenderManager('idb');
  rebuildDbDropdown();

  async function rebuildDbDropdown() {
    dbDropdownSlot.innerHTML = '';
    storeDropdownSlot.innerHTML = '';
    try {
      const dbs = await listDatabases();
      if (!dbs || !dbs.length) return;
      const items = dbs.map(n => ({ value: n, label: n }));
      const dd = createDropdown({
        items,
        value: items[0].value,
        onChange: (next) => {
          const dbName = String(next || items[0].value);
          rebuildStoreDropdown(dbName);
        },
        className: '',
        closeOverlaysOnOpen: true,
      });
      dbDropdownSlot.append(dd);
      rebuildStoreDropdown(items[0].value);
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
      const dd = createDropdown({
        items,
        value: items[0].value,
        onChange: async (next) => {
          await loadAndRenderIdbStore(dbName, String(next || items[0].value));
        },
        className: '',
        closeOverlaysOnOpen: true,
      });
      storeDropdownSlot.append(dd);
      await loadAndRenderIdbStore(dbName, items[0].value);
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
      content.append(createTable({ headers: ['Key', 'Value'], rows, id: `idb-${dbName}-${storeName}-table`, searchable: true, sortable: true }));
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
    }
  }

  return root;
}
