import { createTable } from '../components/table.js';
import { card } from '../components/card.js';
import { el } from '../components/dom.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.getActiveCollection();

  // Controls: Study 10 button (advances per-collection study window by 10)
  const controls = document.createElement('div');
  controls.className = 'data-controls';
  const studyBtn = document.createElement('button');
  studyBtn.type = 'button';
  studyBtn.className = 'btn';
  studyBtn.textContent = 'Study 10';
  controls.appendChild(studyBtn);
  root.appendChild(controls);
  
  if (!active) {
    const emptyCard = card({
      id: 'data-card',
      children: [el('p', { className: 'hint', text: 'No active collection.' })]
    });
    root.append(emptyCard);
    return root;
  }

  // Hook up Study 10 button for active collection
  studyBtn.addEventListener('click', () => {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const n = entries.length;
    if (n === 0) return;
    const saved = store.loadKanjiUIState ? store.loadKanjiUIState() : null;
    const currentStart = (saved && typeof saved.studyStart === 'number') ? saved.studyStart : 0;
    const nextStart = (currentStart + 10) % n;
    // Persist via central store (will save under active collection)
    if (typeof store.saveKanjiUIState === 'function') {
      store.saveKanjiUIState({ studyStart: nextStart });
    }
  });

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
