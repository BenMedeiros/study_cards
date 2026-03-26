import { createTable } from '../../components/shared/table.js';
import { card } from '../../utils/browser/ui.js';
import { validateCollection } from '../../utils/browser/validation.js';
import { formatDurationMs, formatIsoShort } from '../../utils/browser/helpers.js';
import collectionSettingsManager from '../../managers/collectionSettingsManager.js';
import kanjiStudyController from '../kanjiStudyCardView/kanjiStudyController.js';
import { openSpeechSettingsDialog } from '../../components/dialogs/speechSettingsDialog.js';
import { openTableSettingsDialog } from '../../components/dialogs/tableSettingsDialog.js';
import { syncCollectionSettingSnapshot } from '../../integrations/firebase/collectionSettingsFirestoreSync.js';
import collectionsViewController from './collectionsViewController.js';
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
];

function asString(v) {
  return (v == null) ? '' : String(v);
}

function getSampleTextForField(collection, fieldKey) {
  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry[fieldKey];
    if (raw == null) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      const text = String(raw).trim();
      if (text) return text;
      continue;
    }
    if (Array.isArray(raw)) {
      const text = raw
        .map((item) => (item == null ? '' : String(item).trim()))
        .filter(Boolean)
        .join(', ');
      if (text) return text;
      continue;
    }
  }
  return '';
}

function getCollectionFieldOptions(collection) {
  const metadata = (collection?.metadata && typeof collection.metadata === 'object') ? collection.metadata : {};
  const defs = Array.isArray(metadata.fields)
    ? metadata.fields
    : (Array.isArray(metadata.schema) ? metadata.schema : []);
  const out = [];
  const seen = new Set();
  for (const def of defs) {
    const fieldKey = asString((def && typeof def === 'object') ? (def.key || def.name) : def).trim();
    if (!fieldKey || seen.has(fieldKey)) continue;
    seen.add(fieldKey);
    out.push({
      fieldKey,
      label: `entry.${fieldKey}`,
      sampleText: getSampleTextForField(collection, fieldKey),
      collectionKey: asString(collection?.path || collection?.key || collection?.id).trim(),
    });
  }
  return out;
}
export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';
  root.className = 'collections-view';

  const collections = store.collections.getAvailableCollections();

  const activeCollection = store?.collections?.getActiveCollection?.();
  const settingsCollectionKey = String(activeCollection?.key || activeCollection?.path || '').trim();
  let collectionsCtrl = null;
  let collectionsTableSettings = collectionsViewController.getDefaultCollectionsTableSettings();

  try {
    if (settingsCollectionKey) {
      collectionsCtrl = collectionsViewController.create(settingsCollectionKey);
      collectionsTableSettings = normalizeTableSettings(collectionsCtrl.getCollectionsTableSettings());
    }
  } catch (e) {
    collectionsCtrl = null;
    collectionsTableSettings = collectionsViewController.getDefaultCollectionsTableSettings();
  }

  async function persistCollectionsTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    collectionsTableSettings = normalized;
    try { if (collectionsCtrl) await collectionsCtrl.setCollectionsTableSettings(normalized); } catch (e) {}
  }
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
        const s = collectionSettingsManager.get(k) || {};
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
          if (!res) res = await validateCollection(collObj, { verbose: true, logLimit: 20 });
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
      label: 'Configure Speech',
      title: 'Configure per-collection speech settings',
      className: 'btn-configure-speech',
      onClick: async (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        try {
          const col = collections.find(c => (c.id === id || c.key === id || c.path === id || c.name === id));
          if (!col) return;
          const collKey = col.path || col.key || col.id || id;
          let collectionObj = col;
          try {
            if (store?.collections?.loadCollection) {
              const loaded = await store.collections.loadCollection(collKey).catch(() => null);
              if (loaded && typeof loaded === 'object') collectionObj = loaded;
            }
          } catch (e) {}
          const fields = getCollectionFieldOptions(collectionObj);
          const controller = kanjiStudyController.create(collKey);
          const nextSpeech = await openSpeechSettingsDialog({
            fields,
            speechConfig: controller.getSpeech(),
            collectionKey: collKey,
          });
          if (!nextSpeech) return;
          await controller.setSpeech(nextSpeech);
        } catch (e) {
          console.error('Configure Speech: failed for', id, e);
        }
      }
    },
    {
      label: 'Snapshot collection_settings',
      title: 'Upload this collection_settings row to Firestore for the signed-in user',
      className: 'btn-snapshot-collection-settings',
      onClick: async (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        try {
          const col = collections.find(c => (c.id === id || c.key === id || c.path === id || c.name === id));
          const candidates = [
            col?.path,
            col?.id,
            col?.key,
            col?.path && col.path.replace(/^\.?\/*collections\/*/, ''),
            col?.path && col.path.replace(/^\/*/, ''),
            id,
          ].filter(Boolean);
          const result = await syncCollectionSettingSnapshot(candidates);
          console.log('Snapshot collection_settings: synced', result.collectionId, 'to users/' + result.userId + '/collection_settings/' + result.docId);
        } catch (e) {
          console.error('Snapshot collection_settings: failed for', id, e);
        }
      }
    },
      {
        label: 'Apply Defaults',
        title: 'Apply collection defaults',
        className: 'btn-apply-defaults',
        onClick: async (rowData, rowIndex, { tr }) => {
          const id = tr?.dataset?.rowId || rowData.__id;
          try {
            await collectionSettingsManager.applyDefaults(id);
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
        collectionSettingsManager.set(id, { order_hash_int: null, isShuffled: false, studyFilter: '', defaultViewMode: null, heldTableSearch: '' });
        // Reset the remaining study view index.
        kanjiStudyController.create(id).set({ currentIndex: 0, speech: {} });
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

  const applied = applyTableColumnSettings({ headers, rows, tableSettings: collectionsTableSettings });

  const table = createTable({
    store,
    headers: applied.headers,
    rows: applied.rows,
    columnRenderSettings: (collectionsTableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: collectionsTableSettings?.table || {},
    id: 'collections-table',
    sortable: true,
    searchable: true,
    rowActions
  });
  applyTableColumnStyles({ wrapper: table, tableSettings: collectionsTableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: collectionsTableSettings, actionItems: TABLE_ACTION_ITEMS });

  const collectionsCard = card({
    id: 'collections-card',
    cornerCaption: `${collections.length} Collections`,
    children: [table]
  });

  attachCardTableSettingsButton({
    cardEl: collectionsCard,
    onClick: async () => {
      const next = await openTableSettingsDialog({
        tableName: 'Collections Table',
        sourceInfo: settingsCollectionKey ? `${settingsCollectionKey} | ${collections.length} collections` : `${collections.length} collections`,
        columns: buildTableColumnItems(headers, rows),
        actions: TABLE_ACTION_ITEMS,
        settings: collectionsTableSettings,
      });
      if (!next) return;
      await persistCollectionsTableSettings(next);
      const routePath = String(route?.path || '/collections').trim() || '/collections';
      const target = routePath.startsWith('/') ? routePath : `/${routePath}`;
      if (typeof onNavigate === 'function') onNavigate(target);
      else window.location.hash = `#${target}`;
    },
  });

  root.append(collectionsCard);

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try { if (collectionsCtrl && typeof collectionsCtrl.dispose === 'function') collectionsCtrl.dispose(); } catch (e) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return root;
}







