import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { validateCollection } from '../utils/validation.js';
import { formatDurationMs, formatIsoShort } from '../utils/helpers.js';
import collectionSettingsController from '../controllers/collectionSettingsController.js';
import kanjiStudyController from '../controllers/kanjiStudyController.js';
import qaCardsController from '../controllers/qaCardsController.js';
import flashcardsController from '../controllers/flashcardsController.js';

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
    if (store?.collections) {
      const candidates = [c.path, c.id, c.key, c.path && c.path.replace(/^\.?\/*collections\/*/, ''), c.path && c.path.replace(/^\/*/, '')].filter(Boolean);
      for (const k of candidates) {
        const s = collectionSettingsController.get(k) || {};
        if (s && Object.keys(s).length) { meta = s; break; }
      }
      if (!meta || !Object.keys(meta).length) meta = c.value || c.metadata || {};
    } else {
      meta = c.value || c.metadata || {};
    }
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
      label: 'Validate',
      title: 'Validate collection file and log issues to console',
      className: 'btn-validate',
      onClick: async (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        try {
          const col = collections.find(c => (c.id === id || c.key === id || c.path === id || c.name === id));
          if (!col) {
            console.warn('Validate: collection not found for id', id);
            return;
          }
          let collObj = col.value || col.metadata || col || null;
          // If we have a collections manager, try to load the full collection (with entries) before validating
          try {
            if (store?.collections && typeof store.collections.getCollection === 'function') {
              const key = col.path || col.key || col.id || id;
              const full = await store.collections.getCollection(key).catch(() => null);
              if (full && typeof full === 'object') collObj = full;
            }
          } catch (e) {}
          // Log whether we have the full collection blob (entries) or only metadata
          try {
            const hasEntries = !!(collObj && typeof collObj === 'object' && Array.isArray(collObj.entries) && collObj.entries.length);
            console.log('Validate: loaded full collection object?', !!collObj, 'hasEntries:', hasEntries, 'source:', (col.path || col.id || col.key));
            if (collObj && typeof collObj === 'object') {
              console.log('Validate: collObj keys:', Object.keys(collObj).slice(0,40));
              if (hasEntries) console.log('Validate: entries count:', collObj.entries.length, 'sample entries:', collObj.entries.slice(0,3));
            }
          } catch (e) { console.warn('Validate: unable to inspect collObj', e); }

          // Prefer manager-provided validateCollectionFile so the manager determines how to load the blob
          let res = null;
          try {
            if (store?.collections && typeof store.collections.validateCollectionFile === 'function') {
              const key = col.path || col.key || col.id || id;
              res = await store.collections.validateCollectionFile(key, { force: false, verbose: true, logLimit: 20 }).catch(() => null);
            }
          } catch (e) { /* ignore */ }
          // fallback: validate local object if manager helper not available or failed
          if (!res) res = validateCollection(collObj, { verbose: true, logLimit: 20 });
          console.group(`Collection validation: ${col.path || col.id || col.name || id}`);
          console.log('Valid:', !!res.valid);
          if (res.schemaValidation) {
            if (res.schemaValidation.errors && res.schemaValidation.errors.length) console.error('Schema errors:', res.schemaValidation.errors);
            if (res.schemaValidation.warnings && res.schemaValidation.warnings.length) console.warn('Schema warnings:', res.schemaValidation.warnings);
          }
          if (res.entriesValidation) {
            if (res.entriesValidation.entryErrors && res.entriesValidation.entryErrors.length) {
              console.error('Entry errors (sample 200):', res.entriesValidation.entryErrors.slice(0,200));
            } else {
              console.log('Entry errors: none');
            }
            if (res.entriesValidation.entryWarnings && res.entriesValidation.entryWarnings.length) {
              console.warn('Entry warnings (sample 200):', res.entriesValidation.entryWarnings.slice(0,200));
            }
            if (res.entriesValidation.diagnostics) console.log('Entry diagnostics:', res.entriesValidation.diagnostics);
            if (res.entriesValidation.duplicates && res.entriesValidation.duplicates.length) {
              console.warn('Duplicate entry keys (sample 50):', res.entriesValidation.duplicates.slice(0,50));
            }
          }
          console.groupEnd();
        } catch (e) { console.error('Validate: unexpected error', e); }
      }
    },
      {
        label: 'Apply Defaults',
        title: 'Apply collection defaults',
        className: 'btn-apply-defaults',
        onClick: async (rowData, rowIndex, { tr }) => {
          const id = tr?.dataset?.rowId || rowData.__id;
          try {
            await collectionSettingsController.applyDefaults(id);
            console.log('Apply Defaults: applied defaults for', id);
          } catch (e) {
            console.error('Apply Defaults: failed for', id, e);
          }
        }
      },
    {
      label: 'Clear settings',
      title: 'Clear collection settings',
      className: 'btn-clear-settings',
      onClick: (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        // Reset top-level collection settings
        collectionSettingsController.set(id, { order_hash_int: null, isShuffled: false, studyFilter: '', defaultViewMode: null, heldTableSearch: '', expansion_i: [], expansion_na: [] });
        // Reset per-view app indices
        kanjiStudyController.create(id).set({ currentIndex: 0 });
        qaCardsController.create(id).set({ currentIndex: 0 });
        flashcardsController.create(id).setCurrentIndex(0);
        // update the row cells in-place so UI reflects cleared settings
        if (tr) {
          const ci = tr.querySelector('[data-field="currentIndex"]'); if (ci) ci.textContent = '';
          const dv = tr.querySelector('[data-field="defaultView"]'); if (dv) dv.textContent = '';
          const sh = tr.querySelector('[data-field="isShuffled"]'); if (sh) sh.textContent = 'No';
          const oh = tr.querySelector('[data-field="orderHash"]'); if (oh) oh.textContent = '';
          const sf = tr.querySelector('[data-field="studyFilter"]'); if (sf) sf.textContent = '';
        }
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
    store,
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
