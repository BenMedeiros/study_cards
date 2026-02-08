import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { formatDurationMs, formatIsoShort } from '../utils/helpers.js';

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';

  const collections = store.collections.getAvailableCollections();

  // Build table headers (include additional collection metadata columns)
  const headers = [
    'Name',
    'Path',
    'Entries',
    'Description',
    'Last Studied',
    'Last Duration',
    'Total Study',
    '24h',
    '48h',
    '72h',
    '7d',
    'Current Index',
    'Default View',
    'Is Shuffled',
    'Order Hash',
    'Study Filter'
  ];

  // Build table rows and attach __id metadata for action handlers
  const rows = collections.map(c => {
    const entryCount = (typeof c.entries === 'number') ? c.entries : (Array.isArray(c.entries) ? c.entries.length : (c.entries || 0));
    // Prefer persisted collection state from the store (uiState.collections).
    // Try several candidate keys because persisted records may use slightly
    // different identifiers (path vs key vs id).
    let meta = {};
    try {
      if (store?.collections && typeof store.collections.loadCollectionState === 'function') {
        const candidates = [c.path, c.id, c.key, c.path && c.path.replace(/^\.?\/*collections\/*/, ''), c.path && c.path.replace(/^\/*/, '')].filter(Boolean);
        for (const k of candidates) {
          const s = store.collections.loadCollectionState(k);
          if (s && Object.keys(s).length) { meta = s; break; }
        }
        if (!meta || !Object.keys(meta).length) {
          meta = c.value || c.metadata || {};
        }
      } else {
        meta = c.value || c.metadata || {};
      }
    } catch (e) { meta = c.value || c.metadata || {}; }
    const collectionId = c.id || c.key || c.path || '';
    const study = (store?.studyTime && typeof store.studyTime.getCollectionStudyStats === 'function')
      ? store.studyTime.getCollectionStudyStats(collectionId)
      : null;
    const arr = [
      c.name || c.path || c.id || c.key || '',
      c.path || c.id || c.key || '',
      entryCount,
      c.description || '',
      study?.lastEndIso ? formatIsoShort(study.lastEndIso) : '',
      study?.lastDurationMs ? formatDurationMs(study.lastDurationMs) : '',
      study?.totalMs ? formatDurationMs(study.totalMs) : '',
      study?.last24h ? formatDurationMs(study.last24h) : '',
      study?.last48h ? formatDurationMs(study.last48h) : '',
      study?.last72h ? formatDurationMs(study.last72h) : '',
      study?.last7d ? formatDurationMs(study.last7d) : '',
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
          if (store?.collections && typeof store.collections.saveCollectionState === 'function') {
            store.collections.saveCollectionState(id, { order_hash_int: null, isShuffled: false, currentIndex: 0, studyFilter: '', defaultViewMode: null, heldTableSearch: '', expansion_i: [], expansion_na: [] });
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

  // Define column groups for visual grouping and collapse/expand
  const colGroups = [
    { label: 'Meta', start: 0, end: 3, collapsible: false },
    { label: 'Study Time', start: 4, end: 10, collapsible: true, collapsed: false },
    { label: 'Settings', start: 11, end: 15, collapsible: true, collapsed: true }
  ];

  const table = createTable({
    headers,
    rows,
    id: 'collections-table',
    sortable: true,
    searchable: true,
    rowActions,
    colGroups
  });

  const collectionsCard = card({
    id: 'collections-card',
    cornerCaption: `${collections.length} Collections`,
    children: [table]
  });

  root.append(collectionsCard);
  
  return root;
}
