import { idbGet, idbPut, idbDelete, idbGetAll, idbGetAllByIndex } from '../utils/browser/idb.js';
import { timed } from '../utils/browser/timing.js';
import { normalizeFolderPath } from '../utils/browser/helpers.js';
import { getGlobalSettingsManager } from './settingsManager.js';
import { computePatchFromInput, detectCollectionArrayKey } from '../utils/common/collectionDiff.mjs';
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
import { buildDuplicatedKeysReport } from '../reports/validation/buildDuplicatedKeysReport.js';
import { buildMissingRelatedCollectionDataReport } from '../reports/validation/buildMissingRelatedCollectionDataReport.js';

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

function _nowPerfMs() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

function _normalizeCollectionFetchPath(p) {
  let s = String(p || '').trim();
  if (!s) return '';
  s = s.replace(/^\.\//, '');
  s = s.replace(/^collections\//, '');
  return s;
}

function _parseCollectionSchemaRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw.startsWith('$ref:')) return null;
  const body = raw.slice(5).trim();
  if (!body) return null;
  const hashIndex = body.indexOf('#');
  const path = hashIndex >= 0 ? body.slice(0, hashIndex) : body;
  const typeName = hashIndex >= 0 ? body.slice(hashIndex + 1).trim() : '';
  const normalizedPath = _normalizeCollectionFetchPath(path);
  if (!normalizedPath) return null;
  return { ref: raw, path: normalizedPath, typeName };
}

function _buildArrayElementLineNumbers(jsonText, targetKey) {
  if (typeof jsonText !== 'string' || !targetKey) return [];

  let index = 0;
  let line = 1;
  let capturedLines = [];

  function isWhitespace(char) {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
  }

  function advanceChar() {
    if (jsonText[index] === '\r' && jsonText[index + 1] === '\n') {
      index += 2;
      line += 1;
      return;
    }
    if (jsonText[index] === '\n' || jsonText[index] === '\r') line += 1;
    index += 1;
  }

  function skipWhitespace() {
    while (index < jsonText.length && isWhitespace(jsonText[index])) advanceChar();
  }

  function parseString() {
    if (jsonText[index] !== '"') throw new Error(`Expected string at offset ${index}`);
    index += 1;
    let value = '';

    while (index < jsonText.length) {
      const char = jsonText[index];
      if (char === '"') {
        index += 1;
        return value;
      }
      if (char === '\\') {
        const nextChar = jsonText[index + 1];
        if (nextChar === 'u') {
          value += jsonText.slice(index, index + 6);
          index += 6;
        } else {
          value += char + (nextChar || '');
          index += 2;
        }
        continue;
      }
      value += char;
      index += 1;
    }

    throw new Error('Unterminated string literal');
  }

  function parsePrimitive() {
    while (index < jsonText.length) {
      const char = jsonText[index];
      if (isWhitespace(char) || char === ',' || char === ']' || char === '}') return;
      index += 1;
    }
  }

  function parseValue({ captureElements = false } = {}, depth = 0) {
    skipWhitespace();
    const char = jsonText[index];
    if (char === '{') return parseObject(depth);
    if (char === '[') return parseArray({ captureElements }, depth);
    if (char === '"') {
      parseString();
      return null;
    }
    parsePrimitive();
    return null;
  }

  function parseObject(depth = 0) {
    if (jsonText[index] !== '{') throw new Error(`Expected object at offset ${index}`);
    index += 1;
    skipWhitespace();
    if (jsonText[index] === '}') {
      index += 1;
      return null;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      const key = parseString();
      skipWhitespace();
      if (jsonText[index] !== ':') throw new Error(`Expected ':' at offset ${index}`);
      index += 1;
      const shouldCapture = depth === 0 && key === targetKey;
      const maybeLines = parseValue({ captureElements: shouldCapture }, depth + 1);
      if (shouldCapture && Array.isArray(maybeLines)) capturedLines = maybeLines;
      skipWhitespace();
      if (jsonText[index] === ',') {
        index += 1;
        continue;
      }
      if (jsonText[index] === '}') {
        index += 1;
        return null;
      }
      throw new Error(`Expected ',' or '}' at offset ${index}`);
    }

    throw new Error('Unterminated object literal');
  }

  function parseArray({ captureElements = false } = {}, depth = 0) {
    if (jsonText[index] !== '[') throw new Error(`Expected array at offset ${index}`);
    index += 1;
    skipWhitespace();
    const lines = [];
    if (jsonText[index] === ']') {
      index += 1;
      return captureElements ? lines : null;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      if (captureElements) lines.push(line);
      parseValue({}, depth + 1);
      skipWhitespace();
      if (jsonText[index] === ',') {
        index += 1;
        continue;
      }
      if (jsonText[index] === ']') {
        index += 1;
        return captureElements ? lines : null;
      }
      throw new Error(`Expected ',' or ']' at offset ${index}`);
    }

    throw new Error('Unterminated array literal');
  }

  try {
    parseValue({}, 0);
  } catch {
    return [];
  }

  return capturedLines;
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
  const sharedSchemaCache = new Map();

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

  async function _loadSharedSchemaFile(schemaPath) {
    const normalizedPath = _normalizeCollectionFetchPath(schemaPath);
    if (!normalizedPath) throw new Error('schemaPath required');
    if (sharedSchemaCache.has(normalizedPath)) return sharedSchemaCache.get(normalizedPath);
    const promise = (async () => {
      const res = await fetch(`./collections/${normalizedPath}`);
      if (!res.ok) throw new Error(`Failed to load shared schema file ${normalizedPath} (status ${res.status})`);
      const txt = await res.text();
      if (!txt) throw new Error(`Shared schema file ${normalizedPath} was empty`);
      const parsed = JSON.parse(txt);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Shared schema file ${normalizedPath} must be a JSON object`);
      }
      return parsed;
    })();
    sharedSchemaCache.set(normalizedPath, promise);
    try {
      return await promise;
    } catch (error) {
      sharedSchemaCache.delete(normalizedPath);
      throw error;
    }
  }

  async function _materializeCollectionSchema(collection, { collectionKey = '' } = {}) {
    const coll = (collection && typeof collection === 'object') ? collection : null;
    if (!coll) return coll;
    if (!coll.metadata || typeof coll.metadata !== 'object') return coll;
    const schemaRef = _parseCollectionSchemaRef(coll.metadata.schema);
    if (!schemaRef) return coll;

    const sharedSchema = await _loadSharedSchemaFile(schemaRef.path);
    const sharedTypes = (sharedSchema && typeof sharedSchema.schemaTypes === 'object' && !Array.isArray(sharedSchema.schemaTypes))
      ? sharedSchema.schemaTypes
      : null;
    if (!sharedTypes) throw new Error(`Shared schema file ${schemaRef.path} does not define schemaTypes`);

    const resolvedType = schemaRef.typeName ? sharedTypes[schemaRef.typeName] : null;
    if (!resolvedType || typeof resolvedType !== 'object') {
      throw new Error(`Collection ${collectionKey || '(unknown)'} references missing schema type '${schemaRef.typeName}' in ${schemaRef.path}`);
    }

    const resolvedFields = Array.isArray(resolvedType.fields) ? resolvedType.fields : null;
    if (!resolvedFields) {
      throw new Error(`Schema type '${schemaRef.typeName}' in ${schemaRef.path} does not define a fields array`);
    }

    const existingSchemaTypes = (coll.metadata.schemaTypes && typeof coll.metadata.schemaTypes === 'object' && !Array.isArray(coll.metadata.schemaTypes))
      ? coll.metadata.schemaTypes
      : {};

    coll.metadata.schema = resolvedFields.map((field) => ({ ...field }));
    coll.metadata.schemaTypes = {
      ...Object.fromEntries(Object.entries(sharedTypes).map(([key, value]) => [key, _safeClone(value) || value])),
      ...existingSchemaTypes,
    };
    coll.metadata._schemaRef = schemaRef.ref;
    coll.metadata._schemaSource = schemaRef.path;
    coll.metadata._schemaType = schemaRef.typeName;
    return coll;
  }

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

  async function _runLoggedValidationReport(reportId, builder) {
    const normalizedReportId = String(reportId || '').trim();
    const startedAtMs = _nowPerfMs();
    try {
      console.log('[validation.report] run:start', {
        reportId: normalizedReportId,
      });
    } catch (e) {}

    try {
      const result = typeof builder === 'function' ? await builder() : null;
      try {
        console.log('[validation.report] run:finish', {
          reportId: normalizedReportId,
          status: 'ready',
          elapsedMs: Math.round((_nowPerfMs() - startedAtMs) * 100) / 100,
        });
      } catch (e) {}
      return result;
    } catch (error) {
      try {
        console.log('[validation.report] run:finish', {
          reportId: normalizedReportId,
          status: 'error',
          elapsedMs: Math.round((_nowPerfMs() - startedAtMs) * 100) / 100,
          error: error?.message || String(error),
        });
      } catch (e) {}
      throw error;
    }
  }

  async function _loadCollectionsForValidation() {
    const rows = await listAvailableCollections();
    const records = [];
    const loadErrors = [];
    for (const row of rows) {
      const key = String(row?.key || row?.path || '').trim();
      if (!key) continue;
      try {
        const activeRevisionId = _getActiveRevisionId(key);
        const collection = await _resolveCollectionBase(key, { force: false, systemOnly: false });
        if (!collection || typeof collection !== 'object') throw new Error('collection not found');
        let entryLineNumbers = null;
        if (!activeRevisionId) {
          let cachedSystemRow = await idbGet('system_collections', key).catch(() => null);
          if (cachedSystemRow?.blob && !Array.isArray(cachedSystemRow?.entryLineNumbers)) {
            try {
              await getSystemCollection(key, { force: true });
              cachedSystemRow = await idbGet('system_collections', key).catch(() => cachedSystemRow);
            } catch (e) {}
          }
          if (Array.isArray(cachedSystemRow?.entryLineNumbers)) entryLineNumbers = cachedSystemRow.entryLineNumbers.slice();
        }
        records.push({ key, path: key, collection: _safeClone(collection) || collection, entryLineNumbers });
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
    try { console.log('[validationManager] run:start', { reason, runId }); } catch (e) {}
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
      const duplicatedKeysResult = await _runLoggedValidationReport('duplicated_keys', () => buildDuplicatedKeysReport({ records, loadErrors }));
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
      const missingRelatedResult = await _runLoggedValidationReport('missing_related_collection_data', () => buildMissingRelatedCollectionDataReport({ records, loadErrors }));
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
      try {
        console.log('[validationManager] run:finish', {
          reason,
          runId,
          status: validationMeta.lastRunStatus,
          duplicated_keys: validations.duplicated_keys.status,
          missing_related_collection_data: validations.missing_related_collection_data.status,
        });
      } catch (e) {}
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
        return await _materializeCollectionSchema(await getSystemCollection(key, { force }), { collectionKey: key });
      } catch (e) {
        const revs = await listUserRevisions(key);
        const latest = revs.length ? revs[revs.length - 1] : null;
        if (latest && latest.id) {
          return _materializeCollectionSchema(await resolveCollectionAtRevision(key, latest.id, { baseBlob: null }), { collectionKey: key });
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
    return _materializeCollectionSchema(await resolveCollectionAtRevision(key, activeRev, { baseBlob: base }), { collectionKey: key });
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
      if (!force && cached && idxModified && cached.modifiedAt === idxModified && cached.blob && Array.isArray(cached.entryLineNumbers)) {
        loggerReturningCached('getCollection: returning cached', key);
        return _materializeCollectionSchema(cached.blob, { collectionKey: key });
      }

      // Fetch from network
      const url = `./collections/${key}`;
      let res;
      try {
        logger('getCollection: fetching', url);
        res = await fetch(url);
      } catch (err) {
        logger('getCollection: fetch failed', err?.message || err);
        if (cached && cached.blob) return _materializeCollectionSchema(cached.blob, { collectionKey: key });
        throw new Error(`Failed to fetch collection ${key}: ${err?.message || err}`);
      }
      if (!res.ok) {
        logger('getCollection: fetch not ok', res.status);
        if (cached && cached.blob) return _materializeCollectionSchema(cached.blob, { collectionKey: key });
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
        if (cached && cached.blob) return _materializeCollectionSchema(cached.blob, { collectionKey: key });
        throw new Error(`Invalid JSON in collection ${key}: ${err?.message || err}`);
      }

      data = normalizeCollectionBlob(data);
      data = await _materializeCollectionSchema(data, { collectionKey: key });
      const entryLineNumbers = _buildArrayElementLineNumbers(txt, detectCollectionArrayKey(data).key);

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

      const toStore = { key, blob: data, modifiedAt, fetchedAt: now, entryLineNumbers };
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

  async function deleteRevision(collectionKey, revisionId, { cascade = true } = {}) {
    const key = String(collectionKey || '').trim();
    const rid = String(revisionId || '').trim();
    if (!key) throw new Error('collectionKey required');
    if (!rid) throw new Error('revisionId required');
    if (rid === '__system__') throw new Error('System revision cannot be deleted');

    const revisions = normalizeRevisionSet(await listUserRevisions(key));
    const revisionsById = new Map(revisions.map((record) => [record.id, record]));
    const target = revisionsById.get(rid) || null;
    if (!target) throw new Error(`Revision not found: ${rid}`);

    const toDelete = new Set([rid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of revisions) {
        const parentId = String(record?.parentId || '').trim();
        if (!parentId || !toDelete.has(parentId) || toDelete.has(record.id)) continue;
        if (!cascade) throw new Error(`Revision ${rid} has dependent revisions and cannot be deleted without cascade`);
        toDelete.add(record.id);
        changed = true;
      }
    }

    await Promise.all(Array.from(toDelete, (deleteId) => idbDelete('user_collections', deleteId)));

    const activeRevisionId = _getActiveRevisionId(key);
    if (activeRevisionId && toDelete.has(activeRevisionId)) {
      let nextActiveRevisionId = null;
      const seen = new Set();
      let cursor = revisionsById.get(activeRevisionId) || null;
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        const parentId = String(cursor.parentId || '').trim();
        if (!parentId) break;
        if (!toDelete.has(parentId)) {
          nextActiveRevisionId = parentId;
          break;
        }
        cursor = revisionsById.get(parentId) || null;
      }
      _setActiveRevisionId(key, nextActiveRevisionId);
    }

    void _scheduleValidationRun({ reason: 'deleteRevision' }).catch(() => {});
    return {
      deletedIds: Array.from(toDelete),
      activeRevisionId: _getActiveRevisionId(key),
    };
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
    deleteRevision,
    validations,

    // internal map exposed for debugging
    _availableIndexMap: availableIndexMap,
  };
}

export default createCollectionDatabaseManager;
