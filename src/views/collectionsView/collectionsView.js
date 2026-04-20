import { createTable } from '../../components/table/table.js';
import { card } from '../../utils/browser/ui.js';
import { validateCollection } from '../../utils/browser/validation.js';
import { formatDurationMs, formatIsoShort } from '../../utils/browser/helpers.js';
import collectionSettingsManager from '../../managers/collectionSettingsManager.js';
import kanjiStudyController from '../kanjiStudyCardView/kanjiStudyController.js';
import { openSpeechSettingsDialog } from './speechSettingsDialog.js';
import { openTableSettingsDialog } from '../../components/table/tableSettingsDialog.js';
import { syncCollectionSettingSnapshot } from '../../integrations/firebase/collectionSettingsFirestoreSync.js';
import {
  getStudyProgressStateSyncStatus,
  syncStudyProgressStateSnapshot,
} from '../../integrations/firebase/studyProgressFirestoreSync.js';
import { idbGetAll } from '../../utils/browser/idb.js';
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
  { key: 'downloadJson', label: 'Download JSON' },
  { key: 'downloadFullJson', label: 'Download Full JSON' },
];

const FIREBASE_SYNC_SOURCE_DEFS = [
  { key: 'firebaseSyncStatus', label: 'Firebase Sync Status', type: 'string', sourceKind: 'studyProgress', description: 'firebase_sync_state.status for study_progress_state.', defaultSelected: false },
  { key: 'firebaseSyncDirty', label: 'Firebase Sync Dirty', type: 'boolean', sourceKind: 'studyProgress', description: 'Whether the local study_progress_state sync record is marked dirty.', defaultSelected: false },
  { key: 'firebaseSyncDocSize', label: 'Firebase Doc Size', type: 'number', sourceKind: 'studyProgress', description: 'Latest computed study_progress_state snapshot size in bytes.', defaultSelected: false },
  { key: 'firebaseSyncLastSyncedDocSize', label: 'Firebase Last Synced Doc Size', type: 'number', sourceKind: 'studyProgress', description: 'Last successfully synced study_progress_state snapshot size in bytes.', defaultSelected: false },
  { key: 'firebaseSyncLastAttemptDocSize', label: 'Firebase Last Attempt Doc Size', type: 'number', sourceKind: 'studyProgress', description: 'Last attempted study_progress_state snapshot size in bytes.', defaultSelected: false },
  { key: 'firebaseSyncLastAttemptIso', label: 'Firebase Last Attempt', type: 'string', sourceKind: 'studyProgress', description: 'Last attempt timestamp from firebase_sync_state.', defaultSelected: false },
  { key: 'firebaseSyncLastSuccessIso', label: 'Firebase Last Success', type: 'string', sourceKind: 'studyProgress', description: 'Last successful sync timestamp from firebase_sync_state.', defaultSelected: false },
  { key: 'firebaseSyncLastError', label: 'Firebase Last Error', type: 'string', sourceKind: 'studyProgress', description: 'Last sync error from firebase_sync_state.', defaultSelected: false },
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

function resolveCollectionCandidates(collection, fallbackId) {
  return [
    collection?.path,
    collection?.id,
    collection?.key,
    collection?.path && collection.path.replace(/^\.?\/*collections\/*/, ''),
    collection?.path && collection.path.replace(/^\/*/, ''),
    fallbackId,
  ].filter(Boolean);
}

function setStudyProgressSyncButtonStatus(button, status, detail = '') {
  if (!button) return;
  const normalized = String(status || '').trim();
  button.dataset.syncStatus = normalized;
  if (normalized === 'checking') {
    button.textContent = 'Checking sync...';
    button.title = 'Checking whether study progress state needs sync';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    return;
  }
  if (normalized === 'syncing') {
    button.textContent = 'Syncing...';
    button.title = 'Syncing study progress state to Firestore';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    return;
  }
  if (normalized === 'synced') {
    button.textContent = 'Study progress synced';
    button.title = detail || 'Study progress state is already synced';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    return;
  }
  if (normalized === 'error') {
    button.textContent = 'Sync study progress state';
    button.title = detail || 'Unable to determine sync status';
    button.disabled = false;
    button.setAttribute('aria-disabled', 'false');
    return;
  }
  button.textContent = 'Sync study progress state';
  button.title = detail || 'Upload this collection study progress state to Firestore for the signed-in user';
  button.disabled = false;
  button.setAttribute('aria-disabled', 'false');
}

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';
  root.className = 'collections-view';

  const collections = store.collections.getAvailableCollections();
  const firebaseSyncStateByKey = new Map();

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

  function getFirebaseSyncStateForCollection(collection, fallbackId) {
    const candidates = resolveCollectionCandidates(collection, fallbackId)
      .map((value) => asString(value).trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const found = firebaseSyncStateByKey.get(candidate);
      if (found) return found;
    }
    return null;
  }

  function getSelectedFirebaseSyncColumns() {
    const sourceSettings = (collectionsTableSettings?.sources && typeof collectionsTableSettings.sources === 'object')
      ? collectionsTableSettings.sources
      : {};
    if (!sourceSettings.customized) {
      return FIREBASE_SYNC_SOURCE_DEFS.filter((def) => def.defaultSelected !== false);
    }
    const selected = new Set((Array.isArray(sourceSettings.studyProgressFields) ? sourceSettings.studyProgressFields : [])
      .map((value) => asString(value).trim())
      .filter(Boolean));
    return FIREBASE_SYNC_SOURCE_DEFS.filter((def) => selected.has(def.key));
  }

  const selectedFirebaseSyncColumns = getSelectedFirebaseSyncColumns();

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
    for (const def of selectedFirebaseSyncColumns) {
      arr.push('');
    }
    // attach identifier so table action handlers can find the original collection
    try { arr.__id = c.id || c.key || c.path || c.name || ''; } catch (e) {}
    return arr;
  });

  const allHeaders = [
    ...headers,
    ...selectedFirebaseSyncColumns.map((def) => ({
      key: def.key,
      label: def.label,
      type: def.type,
      description: def.description || '',
      sourceKind: def.sourceKind || '',
    })),
  ];

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
            const candidates = resolveCollectionCandidates(col, id);
            const result = await syncCollectionSettingSnapshot(candidates);
            console.log('Snapshot collection_settings: synced', result.collectionId, 'to users/' + result.userId + '/collection_settings/' + result.docId);
        } catch (e) {
          console.error('Snapshot collection_settings: failed for', id, e);
        }
      }
    },
    {
      label: 'Sync study progress state',
      title: 'Upload this collection study progress state to Firestore for the signed-in user',
      className: 'btn-sync-study-progress-state',
      onClick: async (rowData, rowIndex, { tr }) => {
        const id = tr?.dataset?.rowId || rowData.__id;
        const button = tr?.querySelector('.btn-sync-study-progress-state');
        try {
          const col = collections.find(c => (c.id === id || c.key === id || c.path === id || c.name === id));
          const candidates = resolveCollectionCandidates(col, id);
          const syncStatus = await getStudyProgressStateSyncStatus(candidates);
          if (!syncStatus?.needsSync) {
            console.warn('[CollectionsView] sync click ignored because study progress state has no diffs', {
              collectionId: id,
              syncState: syncStatus?.syncState || null,
              payload: syncStatus?.payload || null,
              diff: syncStatus?.diff || null,
            });
            const lastSync = syncStatus?.syncState?.lastSuccessIso || '';
            const title = lastSync ?
              `Study progress state already synced (${lastSync})` :
              `Study progress state already synced for ${syncStatus?.entityKey || id}`;
            setStudyProgressSyncButtonStatus(button, 'synced', title);
            return;
          }
          setStudyProgressSyncButtonStatus(button, 'syncing');
          const result = await syncStudyProgressStateSnapshot(candidates);
          setStudyProgressSyncButtonStatus(
            button,
            'synced',
            `Study progress state synced for ${result.collectionKey}`,
          );
          void refreshFirebaseSyncStateColumns();
          console.log(
            'Sync study progress state: synced',
            result.collectionKey,
            'to users/' + result.userId + '/study_progress_state/' + result.docId,
            result.states,
            syncStatus?.diff || null,
          );
        } catch (e) {
          setStudyProgressSyncButtonStatus(
            button,
            'error',
            String(e?.message || e || 'Study progress sync failed'),
          );
          console.error('Sync study progress state: failed for', id, e);
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

  const applied = applyTableColumnSettings({ headers: allHeaders, rows, tableSettings: collectionsTableSettings });

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

  async function refreshFirebaseSyncStateColumns() {
    try {
      const loadedSyncRows = await idbGetAll('firebase_sync_state').catch(() => []);
      firebaseSyncStateByKey.clear();
      for (const row of (Array.isArray(loadedSyncRows) ? loadedSyncRows : [])) {
        if (!row || typeof row !== 'object') continue;
        if (String(row.entityType || '').trim() !== 'study_progress_state') continue;
        const entityKey = String(row.entityKey || '').trim();
        if (!entityKey || firebaseSyncStateByKey.has(entityKey)) continue;
        firebaseSyncStateByKey.set(entityKey, row);
      }

      for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
        const id = String(tr?.dataset?.rowId || '').trim();
        if (!id) continue;
        const col = collections.find(c => (c.id === id || c.key === id || c.path === id || c.name === id));
        const syncState = getFirebaseSyncStateForCollection(col, id);
        const valuesByKey = {
          firebaseSyncStatus: asString(syncState?.status || ''),
          firebaseSyncDirty: syncState?.dirty === true ? 'true' : (syncState ? 'false' : ''),
          firebaseSyncDocSize: Number.isFinite(Number(syncState?.docSize)) && Number(syncState?.docSize) > 0 ? String(Math.round(Number(syncState.docSize))) : '',
          firebaseSyncLastSyncedDocSize: Number.isFinite(Number(syncState?.lastSyncedDocSize)) && Number(syncState?.lastSyncedDocSize) > 0 ? String(Math.round(Number(syncState.lastSyncedDocSize))) : '',
          firebaseSyncLastAttemptDocSize: Number.isFinite(Number(syncState?.lastAttemptDocSize)) && Number(syncState?.lastAttemptDocSize) > 0 ? String(Math.round(Number(syncState.lastAttemptDocSize))) : '',
          firebaseSyncLastAttemptIso: asString(syncState?.lastAttemptIso || ''),
          firebaseSyncLastSuccessIso: asString(syncState?.lastSuccessIso || ''),
          firebaseSyncLastError: asString(syncState?.lastError || ''),
        };
        for (const def of selectedFirebaseSyncColumns) {
          const cell = tr.querySelector(`[data-field="${def.key}"]`);
          if (!cell) continue;
          cell.textContent = valuesByKey[def.key] ?? '';
        }
      }
    } catch (e) {}
  }

  function scheduleStudyProgressSyncStatusRefresh() {
    const rowsWithButtons = Array.from(table.querySelectorAll('tbody tr'))
      .map((tr) => ({
        tr,
        id: String(tr?.dataset?.rowId || '').trim(),
        button: tr.querySelector('.btn-sync-study-progress-state'),
      }))
      .filter((item) => item.id && item.button);
    if (!rowsWithButtons.length) return;

    const concurrency = 4;
    let index = 0;

    const runNext = async () => {
      const item = rowsWithButtons[index++];
      if (!item) return;
      setStudyProgressSyncButtonStatus(item.button, 'checking');
      try {
        const col = collections.find(c =>
          (c.id === item.id || c.key === item.id || c.path === item.id || c.name === item.id));
        const candidates = resolveCollectionCandidates(col, item.id);
        const status = await getStudyProgressStateSyncStatus(candidates);
        if (status?.needsSync) {
          setStudyProgressSyncButtonStatus(
            item.button,
            'needs-sync',
            `Study progress state needs sync for ${status.entityKey}`,
          );
        } else {
          const lastSync = status?.syncState?.lastSuccessIso || '';
          const title = lastSync ?
            `Study progress state already synced (${lastSync})` :
            `Study progress state already synced for ${status.entityKey}`;
          setStudyProgressSyncButtonStatus(item.button, 'synced', title);
        }
      } catch (error) {
        setStudyProgressSyncButtonStatus(
          item.button,
          'error',
          String(error?.message || error || 'Unable to determine sync status'),
        );
      }
      void runNext();
    };

    for (let i = 0; i < Math.min(concurrency, rowsWithButtons.length); i++) {
      setTimeout(() => {
        void runNext();
      }, 0);
    }
  }

  let refreshTimer = null;
  function scheduleStudyProgressSyncStatusRefreshSoon() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      scheduleStudyProgressSyncStatusRefresh();
    }, 0);
  }

  const collectionsCard = card({
    id: 'collections-card',
    cornerCaption: `${collections.length} Collections`,
    children: [table]
  });
  try {
    const corner = collectionsCard.querySelector('.card-corner-caption');
    const updateCollectionsCaption = ({ visibleRows, totalRows } = {}) => {
      if (!corner) return;
      const visible = Math.max(0, Math.round(Number(visibleRows) || 0));
      const total = Math.max(0, Math.round(Number(totalRows) || 0));
      corner.textContent = (visible < total)
        ? `${visible}/${total} Collections`
        : `${total} Collections`;
      corner.title = (visible < total)
        ? `${visible} of ${total} collections shown`
        : `${total} collections`;
    };
    updateCollectionsCaption({
      visibleRows: Number(table?.dataset?.visibleRows ?? collections.length),
      totalRows: Number(table?.dataset?.totalRows ?? collections.length),
    });
    table.addEventListener('table:stateChange', (e) => {
      updateCollectionsCaption(e?.detail || {});
    });
  } catch (e) {}

  attachCardTableSettingsButton({
    cardEl: collectionsCard,
    onClick: async () => {
      const next = await openTableSettingsDialog({
        tableName: 'Collections Table',
        sourceInfo: settingsCollectionKey ? `${settingsCollectionKey} | ${collections.length} collections` : `${collections.length} collections`,
        columns: buildTableColumnItems(allHeaders, rows),
        actions: TABLE_ACTION_ITEMS,
        settings: collectionsTableSettings,
        studyProgressSources: FIREBASE_SYNC_SOURCE_DEFS,
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
  void refreshFirebaseSyncStateColumns();
  scheduleStudyProgressSyncStatusRefresh();
  root.__activate = () => {
    void refreshFirebaseSyncStateColumns();
    scheduleStudyProgressSyncStatusRefreshSoon();
  };
  root.__updateRoute = () => {
    void refreshFirebaseSyncStateColumns();
    scheduleStudyProgressSyncStatusRefreshSoon();
  };
  table.addEventListener('table:searchApplied', () => {
    void refreshFirebaseSyncStateColumns();
    scheduleStudyProgressSyncStatusRefreshSoon();
  });
  const tbody = table.querySelector('tbody');
  let bodyRefreshInFlight = false;
  const bodyObserver = tbody ? new MutationObserver(() => {
    if (bodyRefreshInFlight) return;
    bodyRefreshInFlight = true;
    setTimeout(() => {
      bodyRefreshInFlight = false;
      void refreshFirebaseSyncStateColumns();
      scheduleStudyProgressSyncStatusRefreshSoon();
    }, 0);
  }) : null;
  if (bodyObserver && tbody) {
    bodyObserver.observe(tbody, { childList: true });
  }

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try { if (collectionsCtrl && typeof collectionsCtrl.dispose === 'function') collectionsCtrl.dispose(); } catch (e) {}
      try { if (bodyObserver) bodyObserver.disconnect(); } catch (e) {}
      if (refreshTimer) clearTimeout(refreshTimer);
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return root;
}







