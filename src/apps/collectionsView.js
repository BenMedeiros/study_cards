import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';

  const collections = store.getAvailableCollections();

  // Build table headers (include additional collection metadata columns)
  const headers = ['Name', 'Path', 'Entries', 'Description', 'Current Index', 'Default View', 'Is Shuffled', 'Order Hash', 'Study Filter'];

  // Build table rows and attach __id metadata for action handlers
  const rows = collections.map(c => {
    const entryCount = (typeof c.entries === 'number') ? c.entries : (Array.isArray(c.entries) ? c.entries.length : (c.entries || 0));
    // Prefer persisted collection state from the store (uiState.collections).
    // Try several candidate keys because persisted records may use slightly
    // different identifiers (path vs key vs id).
    let meta = {};
    try {
      if (store && typeof store.loadCollectionState === 'function') {
        const candidates = [c.path, c.id, c.key, c.path && c.path.replace(/^\.?\/*collections\/*/, ''), c.path && c.path.replace(/^\/*/, '')].filter(Boolean);
        for (const k of candidates) {
          const s = store.loadCollectionState(k);
          if (s && Object.keys(s).length) { meta = s; break; }
        }
        if (!meta || !Object.keys(meta).length) {
          meta = c.value || c.metadata || {};
        }
      } else {
        meta = c.value || c.metadata || {};
      }
    } catch (e) { meta = c.value || c.metadata || {}; }
    const arr = [
      c.name || c.path || c.id || c.key || '',
      c.path || c.id || c.key || '',
      entryCount,
      c.description || '',
      meta.currentIndex ?? '',
      meta.defaultViewMode ?? '',
      (typeof meta.isShuffled === 'boolean') ? (meta.isShuffled ? 'Yes' : 'No') : '',
      meta.order_hash_int ?? '',
      meta.studyFilter ?? ''
    ];
    // attach identifier so table action handlers can find the original collection
    try { arr.__id = c.id || c.key || c.path || c.name || ''; } catch (e) {}
    return arr;
  });

  const rowActions = [
    {
      label: 'Clear settings',
      title: 'Clear collection settings',
      className: 'btn-clear-settings',
      onClick: (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        try {
          if (store && typeof store.saveCollectionState === 'function') {
            store.saveCollectionState(id, { order_hash_int: null, isShuffled: false, currentIndex: 0, studyFilter: '', defaultViewMode: null });
          }
        } catch (e) {}
        // update the row cells in-place so UI reflects cleared settings
        try {
          if (tr) {
            const ci = tr.querySelector('[data-field="currentIndex"]'); if (ci) ci.textContent = '';
            const dv = tr.querySelector('[data-field="defaultView"]'); if (dv) dv.textContent = '';
            const sh = tr.querySelector('[data-field="isShuffled"]'); if (sh) sh.textContent = 'No';
            const oh = tr.querySelector('[data-field="orderHash"]'); if (oh) oh.textContent = '';
            const sf = tr.querySelector('[data-field="studyFilter"]'); if (sf) sf.textContent = '';
          }
        } catch (e) {}
      }
    },
    {
      label: 'Clear history',
      title: 'Clear collection history',
      className: 'btn-clear-history',
      onClick: (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        console.log('collections:clearHistory - no callback built yet for', id);
      }
    }
  ];

  const table = createTable({
    headers,
    rows,
    id: 'collections-table',
    sortable: true,
    searchable: true,
    rowActions
  });

  const collectionsCard = card({
    id: 'collections-card',
    cornerCaption: `${collections.length} Collections`,
    children: [table]
  });

  root.append(collectionsCard);
  
  return root;
}
