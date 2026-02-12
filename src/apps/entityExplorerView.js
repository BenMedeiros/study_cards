import { el } from '../components/ui.js';
import * as idb from '../utils/idb.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';
import { createTable } from '../components/table.js';

// Persist UI selections for this view under the global namespaced blob
// stored at localStorage key `study_cards:v1` -> `apps` -> `entityExplorer`.
function readEntityExplorerAppState() {
  try {
    const raw = localStorage.getItem('study_cards:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.apps && parsed.apps.entityExplorer ? parsed.apps.entityExplorer : null;
  } catch {
    return null;
  }
}

function writeEntityExplorerAppState(state = {}) {
  try {
    const raw = localStorage.getItem('study_cards:v1');
    let obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== 'object') obj = {};
    obj.apps = obj.apps || {};
    obj.apps.entityExplorer = obj.apps.entityExplorer || {};
    for (const k of Object.keys(state || {})) {
      const v = state[k];
      if (v === null) {
        try { delete obj.apps.entityExplorer[k]; } catch (e) {}
      } else {
        obj.apps.entityExplorer[k] = v;
      }
    }
    localStorage.setItem('study_cards:v1', JSON.stringify(obj));
  } catch {
    // ignore localStorage errors
  }
}

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
  const text = safeJson(value);
  // collapse very large JSON blobs to keep the UI snappy
  const MAX_CHARS = 1000;
  const MAX_LINES = 40;
  const lines = (typeof text === 'string') ? text.split('\n').length : 0;
  const isBig = (typeof text === 'string' && text.length > MAX_CHARS) || lines > MAX_LINES;

  const wrapper = document.createElement('div');
  wrapper.className = 'json-view-wrapper';
  wrapper.style.position = 'relative';

  const content = document.createElement('div');
  content.className = 'json-content mono';

  const pre = document.createElement('pre');
  pre.className = 'json-view mono';
  pre.textContent = text;

  const previewLen = 200;
  const previewText = typeof text === 'string' ? (text.slice(0, previewLen).replace(/\n/g, ' ') + (text.length > previewLen ? '…' : '')) : String(text);
  const placeholder = document.createElement('div');
  placeholder.className = 'json-collapsed-placeholder';
  placeholder.textContent = previewText;

  // create toggle button (top-right)
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'json-toggle';
  toggle.style.position = 'absolute';
  toggle.style.top = '4px';
  toggle.style.right = '4px';
  toggle.style.padding = '0.15rem 0.4rem';
  toggle.style.fontSize = '0.8rem';
  toggle.style.cursor = 'pointer';

  let expanded = !isBig; // default: expanded for small, collapsed for big

  function renderCurrent() {
    content.innerHTML = '';
    if (expanded) {
      content.appendChild(pre);
      toggle.textContent = '−';
      toggle.title = 'Collapse JSON';
      toggle.setAttribute('aria-label', 'Collapse JSON');
      wrapper.dataset.expanded = 'true';
      toggle.setAttribute('aria-pressed', 'true');
    } else {
      content.appendChild(placeholder);
      toggle.textContent = '+';
      toggle.title = 'Expand JSON';
      toggle.setAttribute('aria-label', 'Expand JSON');
      wrapper.dataset.expanded = 'false';
      toggle.setAttribute('aria-pressed', 'false');
    }
  }

  toggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    expanded = !expanded;
    renderCurrent();
    // notify parent views that a toggle state changed so they can update controls
    try { wrapper.dispatchEvent(new CustomEvent('json-toggle', { bubbles: true })); } catch (e) {}
  });

  // initial render
  renderCurrent();

  wrapper.appendChild(content);
  wrapper.appendChild(toggle);
  return wrapper;
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

  // Collapse-all control (added to header tools)
  const collapseAllBtn = document.createElement('button');
  collapseAllBtn.type = 'button';
  collapseAllBtn.className = 'btn small';
  collapseAllBtn.textContent = 'Collapse all';
  collapseAllBtn.title = 'Collapse all JSON viewers';
  collapseAllBtn.disabled = true;

  function updateCollapseAllBtnState() {
    // enabled only if there exists at least one expanded json-view-wrapper
    const anyExpanded = Boolean(document.querySelector('#entity-explorer-root .json-view-wrapper[data-expanded="true"]'));
    collapseAllBtn.disabled = !anyExpanded;
  }

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

  // Wrap toggle control for JSON views
  const jsonWrapGroup = document.createElement('div');
  jsonWrapGroup.className = 'data-expansion-group';
  const jsonWrapBtn = document.createElement('button');
  jsonWrapBtn.type = 'button';
  jsonWrapBtn.className = 'btn small';
  // default action label (will be updated to reflect current state)
  jsonWrapBtn.textContent = 'Wrap';
  jsonWrapBtn.title = 'Toggle JSON wrap';
  const jsonWrapCaption = document.createElement('div');
  jsonWrapCaption.className = 'data-expansion-caption';
  jsonWrapCaption.textContent = 'JSON';
  jsonWrapGroup.append(jsonWrapBtn, jsonWrapCaption);

  function updateJsonWrapBtn() {
    const wrapped = Boolean(root.classList && root.classList.contains('json-wrap'));
    jsonWrapBtn.textContent = wrapped ? 'Unwrap' : 'Wrap';
    jsonWrapBtn.setAttribute('aria-pressed', wrapped ? 'true' : 'false');
  }

  jsonWrapBtn.addEventListener('click', () => {
    const wrapped = root.classList.toggle('json-wrap');
    updateJsonWrapBtn();
  });

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
        try { updateCollapseAllBtnState(); } catch (e) {}
      }
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    }
  }

  // UI: manager dropdown + optional DB / store groups
  const _savedAppState = readEntityExplorerAppState() || {};
  const initialManager = String(_savedAppState.manager || 'idb');

  const managerDropdown = createDropdown({
    items: managerItems,
    value: initialManager,
    onChange: (next) => {
      const sel = String(next || 'idb');
      // persist manager selection (apps.entityExplorer)
      if (sel === 'ls') {
        // clear idb-specific fields to avoid clutter
        writeEntityExplorerAppState({ manager: sel, db: null, selection: null });
      } else {
        writeEntityExplorerAppState({ manager: sel });
      }
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
  // append JSON wrap group then collapse-all to the right side of header tools
  headerTools.append(jsonWrapGroup);
  headerTools.append(collapseAllBtn);

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
    left.append(dbGroup, storeGroup);
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
          writeEntityExplorerAppState({ db: dbName, manager: 'idb' });
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
          writeEntityExplorerAppState({ manager: 'idb', db: dbName, selection: `idb:${storeName}` });
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
      content.append(createTable({ headers: ['Key', 'Value'], rows, id: `idb-${dbName}-${storeName}-table`, searchable: true, sortable: true }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    } catch (e) {
      content.innerHTML = '';
      content.append(renderJsonViewer({ error: String(e?.message || e) }));
      try { updateCollapseAllBtnState(); } catch (e) {}
    }
  }

  return root;
}
