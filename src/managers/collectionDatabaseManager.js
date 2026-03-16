import { idbGet, idbPut, idbGetAll, idbGetAllByIndex } from '../utils/browser/idb.js';
import { timed } from '../utils/browser/timing.js';
import { normalizeFolderPath } from '../utils/browser/helpers.js';
import { getGlobalSettingsManager } from './settingsManager.js';
import { computePatchFromInput } from '../utils/common/collectionDiff.mjs';
import {
  attachRelatedCollections,
  normalizeCollectionBlob,
  normalizeRelatedCollectionsConfig,
} from '../utils/common/collectionParser.mjs';
import {
  createRevisionId,
  createPatchRevisionRecord,
  createSnapshotRevisionRecord,
  currentTimestampIso,
  normalizeRevisionSet,
  resolveCollectionAtRevision as resolveCollectionAtRevisionShared,
} from '../utils/common/collectionRevisions.mjs';
import { validateCollection } from '../utils/browser/validation.js';
import {
  validateDuplicatedKeys,
  validateMissingRelatedCollectionData,
} from '../utils/common/collectionValidations.mjs';

function normalizeIndexRelativePath(p) {
  let s = String(p || '').trim();
  if (!s) return '';
  s = s.replace(/^\.\//, '');
  s = s.replace(/^collections\//, '');
  return s;
}

function _safeDebug(...args) {
  try { console.debug('[CollectionDB]', ...args); } catch { /* ignore */ }
}

function _safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

function _nowIso() {
  return new Date().toISOString();
}

function _normalizeFetchHistory(history) {
  const arr = Array.isArray(history) ? history : [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    out.push({
      entries: (typeof item.entries === 'number') ? item.entries : null,
      modifiedAt: (typeof item.modifiedAt === 'string') ? item.modifiedAt : null,
      fetchedAt: (typeof item.fetchedAt === 'string') ? item.fetchedAt : null,
      fetchedSizeBytes: (typeof item.fetchedSizeBytes === 'number') ? item.fetchedSizeBytes : null,
    });
  }
  return out;
}

function _appendFetchHistory(history, row, { limit = 100 } = {}) {
  const base = _normalizeFetchHistory(history);
  const item = {
    entries: (typeof row?.entries === 'number') ? row.entries : null,
    modifiedAt: (typeof row?.modifiedAt === 'string') ? row.modifiedAt : null,
    fetchedAt: (typeof row?.fetchedAt === 'string') ? row.fetchedAt : null,
    fetchedSizeBytes: (typeof row?.fetchedSizeBytes === 'number') ? row.fetchedSizeBytes : null,
  };
  if (!item.fetchedAt) return base;
  base.push(item);
  if (base.length > limit) return base.slice(base.length - limit);
  return base;
}

export function createCollectionDatabaseManager({ log = false, onValidationStateChange = null } = {}) {
  let logEnabled = !!log;
  let logReturningCached = false;

  try {
    const settings = getGlobalSettingsManager && typeof getGlobalSettingsManager === 'function' ? getGlobalSettingsManager() : null;
    if (settings && typeof settings.registerConsumer === 'function') {
      if (typeof settings.isReady === 'function' && settings.isReady()) {
        try { logEnabled = !!settings.get('managers.collectionDatabaseManager.log.enabled', { consumerId: 'collectionDB' }); } catch {}
        try { logReturningCached = !!settings.get('managers.collectionDatabaseManager.log.cachedCollections', { consumerId: 'collectionDB' }); } catch {}
      }

      try {
        settings.registerConsumer({
          consumerId: 'collectionDB',
          settings: ['managers.collectionDatabaseManager.log.enabled', 'managers.collectionDatabaseManager.log.cachedCollections'],
          onChange: ({ settingId, prev, next }) => {
            try {
              if (settingId === 'managers.collectionDatabaseManager.log.enabled') logEnabled = !!next;
              if (settingId === 'managers.collectionDatabaseManager.log.cachedCollections') logReturningCached = !!next;
            } catch (e) {}
          }
        });
      } catch (e) {
        // ignore registration errors
      }
    }
  } catch (e) {}

  const logger = function(...args) { if (!logEnabled) return; _safeDebug(...args); };
  const loggerReturningCached = function(...args) { if (!logReturningCached) return; _safeDebug(...args); };

  // In-memory cache of index entries keyed by path
  let availableIndexMap = new Map();
  let validationRunPromise = null;
  let validationRerunRequested = false;
  let validationRunCounter = 0;

  const validationMeta = {
    state: 'idle',
    source: 'runtime',
    owner: 'collectionDB',
    module: 'src/managers/collectionDatabaseManager.js',
    scheduleFunction: '_scheduleValidationRun',
    runFunction: '_runAllValidationsNow',
    validationFunctions: {
      duplicated_keys: 'validateDuplicatedKeys',
      missing_related_collection_data: 'validateMissingRelatedCollectionData',
    },
    validationModule: 'src/utils/common/collectionValidations.mjs',
    createdAt: _nowIso(),
    lastScheduledAt: null,
    lastScheduledReason: null,
    lastRunRequestedAt: null,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunReason: null,
    lastRunStatus: null,
    lastRunId: null,
    runCount: 0,
    rerunRequested: false,
    isRunning: false,
    pendingPromise: false,
    lastCollectionLoadSummary: {
      recordsLoaded: 0,
      loadErrorCount: 0,
    },
  };

  const validations = {
    duplicated_keys: { status: 'idle', startedAt: null, finishedAt: null, error: null, result: null, loadErrors: [] },
    missing_related_collection_data: { status: 'idle', startedAt: null, finishedAt: null, error: null, result: null, loadErrors: [] },
    runAll: async function() {
      return _scheduleValidationRun({ reason: 'manual' });
    },
    getSnapshot: function() {
      return _safeClone({
        meta: validationMeta,
        duplicated_keys: validations.duplicated_keys,
        missing_related_collection_data: validations.missing_related_collection_data,
      });
    },
  };

  function _notifyValidationStateChanged() {
    if (typeof onValidationStateChange !== 'function') return;
    try {
      onValidationStateChange(validations.getSnapshot());
    } catch (e) {}
  }

  function _markValidationRunning(state) {
    state.status = 'running';
    state.startedAt = _nowIso();
    state.finishedAt = null;
    state.error = null;
  }

  function _markValidationReady(state, result, loadErrors) {
    state.status = 'ready';
    state.result = result;
    state.loadErrors = Array.isArray(loadErrors) ? loadErrors.slice() : [];
    state.error = null;
    state.finishedAt = _nowIso();
  }

  function _markValidationError(state, error, loadErrors) {
    state.status = 'error';
    state.error = error ? String(error) : 'Unknown validation error';
    state.loadErrors = Array.isArray(loadErrors) ? loadErrors.slice() : [];
    state.finishedAt = _nowIso();
  }

  async function _loadCollectionsForValidation() {
    const rows = await listAvailableCollections();
    const records = [];
    const loadErrors = [];
    for (const row of rows) {
      const key = String(row?.key || row?.path || '').trim();
      if (!key) continue;
      try {
        const collection = await _resolveCollectionBase(key, { force: false, systemOnly: false });
        if (!collection || typeof collection !== 'object') throw new Error('collection not found');
        records.push({ key, path: key, collection: _safeClone(collection) || collection });
      } catch (e) {
        loadErrors.push({ key, error: e?.message || String(e) });
      }
    }
    validationMeta.lastCollectionLoadSummary = {
      recordsLoaded: records.length,
      loadErrorCount: loadErrors.length,
    };
    return { records, loadErrors };
  }

  async function _runAllValidationsNow({ reason = 'unknown' } = {}) {
    const runId = ++validationRunCounter;
    validationMeta.state = 'running';
    validationMeta.isRunning = true;
    validationMeta.pendingPromise = true;
    validationMeta.lastRunId = runId;
    validationMeta.lastRunReason = reason;
    validationMeta.lastRunRequestedAt = validationMeta.lastRunRequestedAt || _nowIso();
    validationMeta.lastRunStartedAt = _nowIso();
    validationMeta.runCount += 1;
    validationMeta.rerunRequested = false;
    _markValidationRunning(validations.duplicated_keys);
    _markValidationRunning(validations.missing_related_collection_data);
    _notifyValidationStateChanged();

    const { records, loadErrors } = await _loadCollectionsForValidation();

    try {
      const duplicatedKeysResult = validateDuplicatedKeys(records);
      duplicatedKeysResult.loadErrors = loadErrors.slice();
      if (runId === validationRunCounter) {
        _markValidationReady(validations.duplicated_keys, duplicatedKeysResult, loadErrors);
        _notifyValidationStateChanged();
      }
    } catch (e) {
      if (runId === validationRunCounter) {
        _markValidationError(validations.duplicated_keys, e?.message || e, loadErrors);
        _notifyValidationStateChanged();
      }
    }

    try {
      const missingRelatedResult = validateMissingRelatedCollectionData(records);
      missingRelatedResult.loadErrors = loadErrors.slice();
      if (runId === validationRunCounter) {
        _markValidationReady(validations.missing_related_collection_data, missingRelatedResult, loadErrors);
        _notifyValidationStateChanged();
      }
    } catch (e) {
      if (runId === validationRunCounter) {
        _markValidationError(validations.missing_related_collection_data, e?.message || e, loadErrors);
        _notifyValidationStateChanged();
      }
    }

    if (runId === validationRunCounter) {
      validationMeta.isRunning = false;
      validationMeta.pendingPromise = false;
      validationMeta.lastRunFinishedAt = _nowIso();
      const states = [validations.duplicated_keys.status, validations.missing_related_collection_data.status];
      validationMeta.lastRunStatus = states.includes('error') ? 'error' : 'ready';
      validationMeta.state = validationRerunRequested ? 'queued' : validationMeta.lastRunStatus;
      validationMeta.rerunRequested = !!validationRerunRequested;
      _notifyValidationStateChanged();
    }
  }

  function _scheduleValidationRun({ reason = 'unknown' } = {}) {
    logger('validations: schedule', reason);
    validationMeta.lastScheduledAt = _nowIso();
    validationMeta.lastScheduledReason = reason;
    validationMeta.lastRunRequestedAt = validationMeta.lastScheduledAt;
    validationMeta.pendingPromise = true;
    validationMeta.state = validationRunPromise ? 'queued' : 'scheduled';
    _notifyValidationStateChanged();
    if (validationRunPromise) {
      validationRerunRequested = true;
      validationMeta.rerunRequested = true;
      validationMeta.state = 'queued';
      _notifyValidationStateChanged();
      return validationRunPromise;
    }

    validationRunPromise = (async () => {
      do {
        validationRerunRequested = false;
        validationMeta.rerunRequested = false;
        await _runAllValidationsNow({ reason });
      } while (validationRerunRequested);
    })().finally(() => {
      validationRunPromise = null;
      validationMeta.pendingPromise = false;
      if (!validationMeta.isRunning && validationMeta.state === 'scheduled') {
        validationMeta.state = validationMeta.lastRunStatus || 'idle';
      }
      _notifyValidationStateChanged();
    });

    return validationRunPromise;
  }

  async function _resolveCollectionBase(key, { force = false, systemOnly = false } = {}) {
    if (!key) throw new Error('key required');
    if (systemOnly) return getSystemCollection(key, { force });

    const activeRev = _getActiveRevisionId(key);
    if (!activeRev) {
      try {
        return await getSystemCollection(key, { force });
      } catch (e) {
        const revs = await listUserRevisions(key);
        const latest = revs.length ? revs[revs.length - 1] : null;
        if (latest && latest.id) {
          return resolveCollectionAtRevision(key, latest.id, { baseBlob: null });
        }
        throw e;
      }
    }

    let base = null;
    try {
      base = await getSystemCollection(key, { force });
    } catch (e) {
      base = null;
    }
    return resolveCollectionAtRevision(key, activeRev, { baseBlob: base });
  }

  async function _compileCollectionRelated(collection, key, { force = false } = {}) {
    const coll = (collection && typeof collection === 'object') ? collection : null;
    if (!coll) return coll;
    const normalized = normalizeCollectionBlob(coll);
    if (!Array.isArray(normalized.entries) || !normalized.entries.length) return normalized;

    if (!normalized.metadata || typeof normalized.metadata !== 'object') normalized.metadata = {};
    if (!Array.isArray(normalized.metadata.relatedCollections) || !normalized.metadata.relatedCollections.length) {
      try {
        const sys = await getSystemCollection(key, { force: true });
        const rel = Array.isArray(sys?.metadata?.relatedCollections) ? sys.metadata.relatedCollections : [];
        if (rel.length) {
          normalized.metadata.relatedCollections = rel.map(r => ({ ...r }));
          try {
            console.debug('[CollectionDB] recovered relatedCollections metadata', {
              key,
              count: rel.length,
              names: rel.map(r => String(r?.name || '').trim()).filter(Boolean),
            });
          } catch (e) {}
        }
      } catch (e) {}
    }

    const relations = normalizeRelatedCollectionsConfig(normalized?.metadata?.relatedCollections);
    if (!relations.length) return normalized;

    await attachRelatedCollections(normalized, key, {
      resolveCollection: async (relPath) => _resolveCollectionBase(relPath, { force: false, systemOnly: false })
    });

    return normalized;
  }

  function _getSettings() {
    try {
      return (getGlobalSettingsManager && typeof getGlobalSettingsManager === 'function') ? getGlobalSettingsManager() : null;
    } catch {
      return null;
    }
  }

  function _getActiveRevisionsMap() {
    try {
      const sm = _getSettings();
      if (!sm || typeof sm.get !== 'function') return {};
      const v = sm.get('collections.activeRevisionsByKey', { consumerId: 'collectionDB' });
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch {
      return {};
    }
  }

  function _setActiveRevisionId(collectionKey, revisionId, { silent = false } = {}) {
    try {
      const sm = _getSettings();
      if (!sm || typeof sm.set !== 'function') return;
      const map = _getActiveRevisionsMap();
      const k = String(collectionKey || '').trim();
      if (!k) return;
      const rid = (typeof revisionId === 'string' && revisionId.trim()) ? revisionId.trim() : null;
      if (!rid) {
        try { delete map[k]; } catch (e) {}
      } else {
        map[k] = rid;
      }
      sm.set('collections.activeRevisionsByKey', map, { consumerId: 'collectionDB', silent: !!silent });
    } catch (e) {}
  }

  function _getActiveRevisionId(collectionKey) {
    const k = String(collectionKey || '').trim();
    if (!k) return null;
    const map = _getActiveRevisionsMap();
    const v = map[k];
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  }

  async function listUserRevisions(collectionKey) {
    const k = String(collectionKey || '').trim();
    if (!k) return [];
    try {
      const rows = await idbGetAllByIndex('user_collections', 'by_collection', k).catch(() => []);
      const out = Array.isArray(rows) ? rows.slice() : [];
      out.sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
      return out;
    } catch {
      return [];
    }
  }

  async function _listAllUserCollectionKeys() {
    try {
      const all = await idbGetAll('user_collections').catch(() => []);
      const keys = new Set();
      for (const r of (Array.isArray(all) ? all : [])) {
        const k = (r && typeof r.collectionKey === 'string') ? r.collectionKey.trim() : '';
        if (k) keys.add(k);
      }
      return Array.from(keys);
    } catch {
      return [];
    }
  }

  // initialize: load ./collections/index.json (preferred), build folderMetadataMap,
  // persist lightweight index to IDB while preserving existing fetchedAt/fetchedSizeBytes/fetchHistory.
  async function initialize() {
    return timed('collectionDB.initialize', async () => {
      logger('initialize: loading collections/index.json');
      let index = null;
      try {
        const res = await fetch('./collections/_index.json');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const txt = await res.text();
        index = JSON.parse(txt);
      } catch (err) {
        logger('initialize: failed to load index.json', err?.message || err);
        // Fall back to IDB index if available
        const rows = await idbGetAll('system_collections_index').catch(() => []);
        availableIndexMap = new Map((rows || []).map(r => [r.key, r]));
        // normalize any legacy sizeBytes -> fetchedSizeBytes
        for (const [k, v] of availableIndexMap.entries()) {
          if (v && v.sizeBytes != null && v.fetchedSizeBytes == null) v.fetchedSizeBytes = v.sizeBytes;
          if (v && v.fetchHistory == null) v.fetchHistory = [];
        }

        // Merge in user-defined collection keys so they appear in the UI.
        try {
          const userKeys = await _listAllUserCollectionKeys();
          for (const k of userKeys) {
            if (!k) continue;
            if (!availableIndexMap.has(k)) {
              availableIndexMap.set(k, { key: k, path: k, name: null, description: null, entries: null, modifiedAt: null, fetchedAt: null, fetchedSizeBytes: null, _kind: 'user' });
            }
          }
        } catch (e) {}

        void _scheduleValidationRun({ reason: 'initialize-fallback' }).catch(() => {});

        return { paths: Array.from(availableIndexMap.keys()), folderMetadataMap: new Map(), rawIndex: null };
      }

      const rawCollections = Array.isArray(index?.collections) ? index.collections : [];

      // Build folderMetadataMap analogous to previous buildFolderMetadataMap
      const folderMetadata = index?.folderMetadata || {};
      const folderMetadataMap = new Map();
      for (const [rawFolder, rawFile] of Object.entries(folderMetadata || {})) {
        const folder = normalizeFolderPath(rawFolder);
        let fileRel = normalizeIndexRelativePath(rawFile);
        if (!fileRel) continue;
        if (!fileRel.includes('/')) {
          fileRel = folder ? `${folder}/${fileRel}` : fileRel;
        } else if (folder) {
          if (!fileRel.startsWith(`${folder}/`) && !fileRel.startsWith('../') && !fileRel.startsWith('/')) {
            fileRel = `${folder}/${fileRel}`;
          }
        }
        folderMetadataMap.set(folder, fileRel);
      }

      const rows = rawCollections.map(c => (typeof c === 'string' ? { key: c, path: c, name: null, description: null, entries: null, modifiedAt: null } : { key: c.path, path: c.path, name: c.name || null, description: c.description || null, entries: (typeof c.entries === 'number') ? c.entries : null, modifiedAt: c.modifiedAt || null }));

      // populate in-memory map and persist lightweight index to IDB
      for (const r of rows) {
        availableIndexMap.set(r.key, r);
        try {
          const existing = await idbGet('system_collections_index', r.key).catch(() => null);
          const fetchedAt = existing?.fetchedAt ?? null;
          const fetchedSizeBytes = (existing && (existing.fetchedSizeBytes ?? existing.sizeBytes)) ?? null;
          const fetchHistory = _normalizeFetchHistory(existing?.fetchHistory);
          await idbPut('system_collections_index', { key: r.key, name: r.name, description: r.description, entries: r.entries, modifiedAt: r.modifiedAt || null, fetchedAt, fetchedSizeBytes, fetchHistory });
        } catch (e) {
          logger('initialize: idbPut index failed', e?.message || e);
        }
      }

      logger('initialize: indexed', rows.length, 'collections');

      // Merge in user-defined collection keys so they appear in the UI.
      try {
        const userKeys = await _listAllUserCollectionKeys();
        for (const k of userKeys) {
          if (!k) continue;
          if (!availableIndexMap.has(k)) {
            availableIndexMap.set(k, { key: k, path: k, name: null, description: null, entries: null, modifiedAt: null, fetchedAt: null, fetchedSizeBytes: null, _kind: 'user' });
          }
        }
      } catch (e) {}

      void _scheduleValidationRun({ reason: 'initialize' }).catch(() => {});

      return { paths: Array.from(availableIndexMap.keys()), folderMetadataMap, rawIndex: index };
    });
  }

  async function listAvailableCollections() {
    if (availableIndexMap.size) {
      // Ensure any user-defined keys are included (initialize may not have run).
      try {
        const userKeys = await _listAllUserCollectionKeys();
        for (const k of userKeys) {
          if (!k) continue;
          if (!availableIndexMap.has(k)) {
            availableIndexMap.set(k, { key: k, path: k, name: null, description: null, entries: null, modifiedAt: null, fetchedAt: null, fetchedSizeBytes: null, _kind: 'user' });
          }
        }
      } catch (e) {}
      return Array.from(availableIndexMap.values());
    }
    const rows = await idbGetAll('system_collections_index').catch(() => []);
    for (const r of rows) {
      if (r && r.sizeBytes != null && r.fetchedSizeBytes == null) r.fetchedSizeBytes = r.sizeBytes;
      if (r && r.fetchHistory == null) r.fetchHistory = [];
      availableIndexMap.set(r.key, r);
    }

    try {
      const userKeys = await _listAllUserCollectionKeys();
      for (const k of userKeys) {
        if (!k) continue;
        if (!availableIndexMap.has(k)) {
          availableIndexMap.set(k, { key: k, path: k, name: null, description: null, entries: null, modifiedAt: null, fetchedAt: null, fetchedSizeBytes: null, _kind: 'user' });
        }
      }
    } catch (e) {}

    return Array.from(availableIndexMap.values());
  }

  // getSystemCollection: return parsed blob from ./collections (system collections).
  // Uses cached IDB copy when modifiedAt matches index; on fetch, compute fetchedSizeBytes and update stores.
  async function getSystemCollection(key, { force = false } = {}) {
    if (!key) throw new Error('key required');
    return timed(`collectionDB.getSystemCollection ${key}`, async () => {
      const idx = availableIndexMap.get(key) || await idbGet('system_collections_index', key).catch(() => null);
      const idxModified = idx?.modifiedAt || null;

      const cached = await idbGet('system_collections', key).catch(() => null);
      if (!force && cached && idxModified && cached.modifiedAt === idxModified && cached.blob) {
        loggerReturningCached('getCollection: returning cached', key);
        return cached.blob;
      }

      // Fetch from network
      const url = `./collections/${key}`;
      let res;
      try {
        logger('getCollection: fetching', url);
        res = await fetch(url);
      } catch (err) {
        logger('getCollection: fetch failed', err?.message || err);
        if (cached && cached.blob) return cached.blob;
        throw new Error(`Failed to fetch collection ${key}: ${err?.message || err}`);
      }
      if (!res.ok) {
        logger('getCollection: fetch not ok', res.status);
        if (cached && cached.blob) return cached.blob;
        throw new Error(`Failed to load collection ${key} (status ${res.status})`);
      }

      let data;
      let txt = null;
      try {
        txt = await res.text();
        if (!txt) throw new Error('empty response');
        data = JSON.parse(txt);
      } catch (err) {
        logger('getCollection: parse failed', err?.message || err);
        if (cached && cached.blob) return cached.blob;
        throw new Error(`Invalid JSON in collection ${key}: ${err?.message || err}`);
      }

      data = normalizeCollectionBlob(data);

      const now = (new Date()).toISOString();
      const modifiedAt = idxModified || now;

      let fetchedSizeBytes = null;
      try {
        if (typeof txt === 'string') {
          fetchedSizeBytes = (new TextEncoder().encode(txt)).length;
        } else {
          fetchedSizeBytes = (new TextEncoder().encode(JSON.stringify(data))).length;
        }
      } catch (e) {
        fetchedSizeBytes = null;
      }
      // Validate collection schema and entries where possible and mark validation date.
      let validatedAt = null;
      try {
        const v = await validateCollection(data, {});
        if (v && v.valid) validatedAt = now;
      } catch (e) {
        // ignore validation errors
      }

      const toStore = { key, blob: data, modifiedAt, fetchedAt: now };
      if (validatedAt) toStore.validatedAt = validatedAt;
      try {
        await idbPut('system_collections', toStore);
        // update index fetchedAt and fetchedSizeBytes
        try {
          const prevFetchHistory = _normalizeFetchHistory(idx?.fetchHistory);
          const fetchHistory = _appendFetchHistory(prevFetchHistory, {
            entries: idx?.entries ?? null,
            modifiedAt,
            fetchedAt: now,
            fetchedSizeBytes,
          });
          const indexRow = { key, name: idx?.name || null, description: idx?.description || null, entries: idx?.entries ?? null, modifiedAt, fetchedAt: now, fetchedSizeBytes, fetchHistory };
          await idbPut('system_collections_index', indexRow);
          try { availableIndexMap.set(key, indexRow); } catch (e) {}
        } catch (e) {
          logger('getCollection: updating index failed', e?.message || e);
        }
      } catch (e) {
        logger('getCollection: idbPut failed', e?.message || e);
      }

      return data;
    });
  }

  async function resolveCollectionAtRevision(collectionKey, revisionId, { baseBlob = null } = {}) {
    const key = String(collectionKey || '').trim();
    if (!key) throw new Error('collectionKey required');

    return timed(`collectionDB.resolveCollectionAtRevision ${key}`, async () => {
      let base = baseBlob ? _safeClone(baseBlob) : null;
      if (!base) {
        try {
          base = await getSystemCollection(key);
        } catch (e) {
          base = null;
        }
      }

      const revisions = normalizeRevisionSet(await listUserRevisions(key));
      return resolveCollectionAtRevisionShared({
        collectionKey: key,
        revisionId,
        baseCollection: base,
        revisions,
        fallbackToEmpty: true,
        strictParents: false,
        annotateRevision: true,
      });
    });
  }

  // getCollection: resolved collection that includes user diffs (if any active revision exists).
  async function getCollection(key, { force = false, systemOnly = false } = {}) {
    const base = await _resolveCollectionBase(key, { force, systemOnly });
    if (systemOnly) return base;
    const cloned = _safeClone(base) || base;
    return _compileCollectionRelated(cloned, key, { force });
  }

  async function prefetch(keys = []) {
    if (!Array.isArray(keys) || !keys.length) return;
    logger('prefetch', keys.length, 'collections');
    const jobs = keys.map(k => getCollection(k).catch(() => null));
    await Promise.all(jobs);
  }

  async function previewInputChanges(collectionKey, input, { treatFullAsReplace = false } = {}) {
    const key = String(collectionKey || '').trim();
    if (!key) throw new Error('collectionKey required');
    const activeRev = _getActiveRevisionId(key);
    const base = activeRev
      ? await resolveCollectionAtRevision(key, activeRev).catch(() => null)
      : await _resolveCollectionBase(key).catch(() => null);
    const baseColl = base || { metadata: { name: key, version: 1 }, entries: [] };
    return computePatchFromInput({ baseCollection: baseColl, input, treatFullAsReplace: !!treatFullAsReplace });
  }

  async function commitPatch(collectionKey, patch, { label = null } = {}) {
    const key = String(collectionKey || '').trim();
    if (!key) throw new Error('collectionKey required');
    const p = patch && typeof patch === 'object' ? patch : null;
    if (!p) throw new Error('patch required');

    const parentId = _getActiveRevisionId(key);
    const rec = createPatchRevisionRecord({
      collectionKey: key,
      patch: p,
      parentId,
      id: createRevisionId(),
      createdAt: currentTimestampIso(),
      label,
    });
    await idbPut('user_collections', rec);
    _setActiveRevisionId(key, rec.id);
    void _scheduleValidationRun({ reason: 'commitPatch' }).catch(() => {});
    return rec;
  }

  async function commitSnapshot(collectionKey, blob, { label = null } = {}) {
    const key = String(collectionKey || '').trim();
    if (!key) throw new Error('collectionKey required');
    const b = blob && typeof blob === 'object' ? blob : null;
    if (!b) throw new Error('blob required');

    const parentId = _getActiveRevisionId(key);
    const rec = createSnapshotRevisionRecord({
      collectionKey: key,
      blob: b,
      parentId,
      id: createRevisionId(),
      createdAt: currentTimestampIso(),
      label,
    });
    await idbPut('user_collections', rec);
    _setActiveRevisionId(key, rec.id);
    void _scheduleValidationRun({ reason: 'commitSnapshot' }).catch(() => {});
    return rec;
  }

  function getActiveRevisionId(collectionKey) {
    return _getActiveRevisionId(collectionKey);
  }

  function setActiveRevisionId(collectionKey, revisionId) {
    _setActiveRevisionId(collectionKey, revisionId);
    void _scheduleValidationRun({ reason: 'setActiveRevisionId' }).catch(() => {});
  }

  return {
    initialize,
    listAvailableCollections,
    getCollection,
    getSystemCollection,
    prefetch,

    // validation helper: load collection blob and run centralized validation
    validateCollectionFile: async function(collectionKey, { force = false, verbose = false, logLimit = 5 } = {}) {
      if (!collectionKey) throw new Error('collectionKey required');
      try {
        const coll = await _resolveCollectionBase(collectionKey, { force, systemOnly: false });
        if (!coll) return { valid: false, error: 'collection not found' };
        const res = await validateCollection(coll, { entryArrayKey: null, verbose, logLimit });
        return res;
      } catch (e) {
        return { valid: false, error: e?.message || String(e) };
      }
    },

    // User collection mutation APIs
    listUserRevisions,
    getActiveRevisionId,
    setActiveRevisionId,
    resolveCollectionAtRevision,
    previewInputChanges,
    commitPatch,
    commitSnapshot,
    validations,

    // internal map exposed for debugging
    _availableIndexMap: availableIndexMap,
  };
}

export default createCollectionDatabaseManager;




