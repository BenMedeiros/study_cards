import { createTable } from '../components/table.js';
import { card } from '../components/card.js';
import { el } from '../components/dom.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.getActiveCollection();

  // Controls: Study 10 / Study All buttons grouped like kanji header tools
  const controls = document.createElement('div');
  controls.className = 'kanji-header-tools';
  const studyBtn = document.createElement('button');
  studyBtn.type = 'button';
  studyBtn.className = 'btn small';
  studyBtn.textContent = 'Study 10';

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = 'Shuffle';

  const clearShuffleBtn = document.createElement('button');
  clearShuffleBtn.type = 'button';
  clearShuffleBtn.className = 'btn small';
  clearShuffleBtn.textContent = 'Clear Shuffle';

  const studyAllBtn = document.createElement('button');
  studyAllBtn.type = 'button';
  studyAllBtn.className = 'btn small';
  studyAllBtn.textContent = 'Study All';

  const studyLabel = document.createElement('div');
  studyLabel.className = 'hint';
  studyLabel.style.alignSelf = 'center';
  studyLabel.textContent = '';

  controls.append(studyBtn, studyAllBtn, shuffleBtn, clearShuffleBtn, studyLabel);
  root.appendChild(controls);
  
  if (!active) {
    const emptyCard = card({
      id: 'data-card',
      children: [el('p', { className: 'hint', text: 'No active collection.' })]
    });
    root.append(emptyCard);
    return root;
  }

  // Helpers to read/save per-collection state
  function readCollState() {
    const coll = store.getActiveCollection();
    if (!coll) return null;
    if (typeof store.loadCollectionState === 'function') return store.loadCollectionState(coll.key) || {};
    // fallback for older API
    const saved = store.loadKanjiUIState ? store.loadKanjiUIState() : null;
    return saved || {};
  }

  function writeCollState(patch) {
    const coll = store.getActiveCollection();
    if (!coll) return;
    if (typeof store.saveCollectionState === 'function') return store.saveCollectionState(coll.key, patch);
    // fallback
    if (typeof store.saveKanjiUIState === 'function') return store.saveKanjiUIState(patch);
  }

  // Hook up Study 10 button for active collection
  studyBtn.addEventListener('click', () => {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const n = entries.length;
    if (n === 0) return;
    const saved = readCollState();
    const currentStart = (saved && typeof saved.studyStart === 'number') ? saved.studyStart : 0;
    const nextStart = (currentStart + 10) % n;
    writeCollState({ studyStart: nextStart });
    // update label immediately
    updateStudyLabel();
    // update table highlighting immediately
    markStudyRows();
    // allow other apps to re-render if they subscribe to store
  });

  studyAllBtn.addEventListener('click', () => {
    // Clear studyStart to indicate full study set
    writeCollState({ studyStart: null });
    updateStudyLabel();
    markStudyRows();
  });

  // Shuffle / Clear Shuffle handlers
  shuffleBtn.addEventListener('click', () => {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const seed = Math.floor(Math.random() * 0xFFFFFFFF);
    writeCollState({ order_hash_int: seed, isShuffled: true });
    // update marking and label immediately
    updateStudyLabel();
    markStudyRows();
  });

  clearShuffleBtn.addEventListener('click', () => {
    const coll = store.getActiveCollection();
    if (!coll) return;
    writeCollState({ order_hash_int: null, isShuffled: false });
    updateStudyLabel();
    markStudyRows();
  });

  function updateStudyLabel() {
    const coll = store.getActiveCollection();
    if (!coll) {
      studyLabel.textContent = '';
      return;
    }
    const saved = readCollState();
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    if (n === 0) {
      studyLabel.textContent = '';
      return;
    }
    if (saved && typeof saved.studyStart === 'number') {
      studyLabel.textContent = `Study start: ${saved.studyStart} (10)`;
    } else {
      studyLabel.textContent = 'Study: All';
    }
  }

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  const entries = Array.isArray(active.entries) ? active.entries : [];

  // Build table headers from fields
  const headers = fields.map(f => f.label || f.key);

  // Build table rows from entries
  const rows = entries.map(entry => {
    return fields.map(f => entry[f.key] ?? '');
  });

  const table = createTable({
    headers,
    rows,
    id: 'data-table'
  });

  // Highlight rows that are part of the current study subset
  function markStudyRows() {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const collState = (typeof store.loadCollectionState === 'function') ? store.loadCollectionState(coll.key) : (store.loadKanjiUIState ? store.loadKanjiUIState() : null);
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    let subsetIndices = null;
    if (collState && typeof collState.studyStart === 'number') {
      subsetIndices = new Set();
      for (let i = 0; i < 10; i++) subsetIndices.add((collState.studyStart + i) % n);
    } else if (collState && collState.studyStart === null) {
      // study all
      subsetIndices = new Set(Array.from({ length: n }, (_, i) => i));
    }

    const wrapperEl = table;
    const tbl = wrapperEl.querySelector('table');
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if (!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach((tr, rowIndex) => {
      if (!subsetIndices) {
        tr.classList.remove('in-study');
        return;
      }
      if (subsetIndices.has(rowIndex)) tr.classList.add('in-study');
      else tr.classList.remove('in-study');
    });
  }

  // initial label + marking
  updateStudyLabel();
  markStudyRows();

  // Subscribe to store changes and update markings when session state changes
  let unsub = null;
  if (store && typeof store.subscribe === 'function') {
    try {
      unsub = store.subscribe(() => {
        // update label and highlighting when collection/session state changes
        updateStudyLabel();
        markStudyRows();
      });
    } catch (e) { /* ignore */ }
  }

  // Cleanup subscription when this view is removed from DOM
  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      if (typeof unsub === 'function') unsub();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Collapsible metadata sections (each collapsible individually)
  const wrapper = el('div', { className: 'collection-metadata' });

  const collMetaDetails = el('details', {
    className: 'metadata-details',
    children: [
      el('summary', { text: 'Collection metadata' }),
      el('pre', { text: JSON.stringify(active.metadata || {}, null, 2) })
    ]
  });

  const defaultsDetails = el('details', {
    className: 'defaults-details',
    children: [
      el('summary', { text: 'Collection defaults' }),
      el('pre', { text: JSON.stringify(active.defaults || {}, null, 2) })
    ]
  });

  const folderMetaDetails = el('details', {
    className: 'folder-meta-details',
    children: [
      el('summary', { text: 'Inherited folder _metadata.json' }),
      el('pre', { id: 'folder-meta-pre', text: 'Loading...' })
    ]
  });

  wrapper.append(collMetaDetails, defaultsDetails, folderMetaDetails);

  // Load inherited folder metadata asynchronously via the store API
  if (store && typeof store.getInheritedFolderMetadata === 'function') {
    store.getInheritedFolderMetadata(active.key)
      .then(folderMeta => {
        const pre = wrapper.querySelector('#folder-meta-pre');
        if (pre) pre.textContent = folderMeta ? JSON.stringify(folderMeta, null, 2) : 'None';
      })
      .catch(() => {
        const pre = wrapper.querySelector('#folder-meta-pre');
        if (pre) pre.textContent = 'Error loading folder metadata';
      });
  } else {
    const pre = wrapper.querySelector('#folder-meta-pre');
    if (pre) pre.textContent = 'Unavailable';
  }

  const dataCard = card({
    id: 'data-card',
    cornerCaption: `${entries.length} Entries`,
    children: [wrapper, table]
  });

  // Show the full path to the currently displayed collection file.
  const pathLabel = active?.key ? `Path: ${active.key}` : 'Path: (unknown)';
  root.append(
    el('div', { className: 'hint', text: pathLabel }),
    dataCard
  );
  
  return root;
}
