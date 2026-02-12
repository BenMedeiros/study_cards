import { idbGet, idbPut, idbGetAll } from '../utils/idb.js';
import { timed } from '../utils/timing.js';
import { normalizeFolderPath } from '../utils/helpers.js';
import { getGlobalSettingsManager } from './settingsManager.js';

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

export function createCollectionDatabaseManager({ log = false } = {}) {
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

  // initialize: load ./collections/index.json (preferred), build folderMetadataMap,
  // persist lightweight index to IDB while preserving existing fetchedAt/fetchedSizeBytes.
  async function initialize() {
    return timed('collectionDB.initialize', async () => {
      logger('initialize: loading collections/index.json');
      let index = null;
      try {
        const res = await fetch('./collections/index.json');
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
        }
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
          await idbPut('system_collections_index', { key: r.key, name: r.name, description: r.description, entries: r.entries, modifiedAt: r.modifiedAt || null, fetchedAt, fetchedSizeBytes });
        } catch (e) {
          logger('initialize: idbPut index failed', e?.message || e);
        }
      }

      logger('initialize: indexed', rows.length, 'collections');
      return { paths: Array.from(availableIndexMap.keys()), folderMetadataMap, rawIndex: index };
    });
  }

  async function listAvailableCollections() {
    if (availableIndexMap.size) return Array.from(availableIndexMap.values());
    const rows = await idbGetAll('system_collections_index').catch(() => []);
    for (const r of rows) {
      if (r && r.sizeBytes != null && r.fetchedSizeBytes == null) r.fetchedSizeBytes = r.sizeBytes;
      availableIndexMap.set(r.key, r);
    }
    return Array.from(availableIndexMap.values());
  }

  // getCollection: return parsed blob; use cached IDB copy when modifiedAt matches index; on fetch, compute fetchedSizeBytes and update stores
  async function getCollection(key, { force = false } = {}) {
    if (!key) throw new Error('key required');
    return timed(`collectionDB.getCollection ${key}`, async () => {
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

      if (Array.isArray(data)) data = { metadata: {}, sentences: data };

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

      const toStore = { key, blob: data, modifiedAt, fetchedAt: now };
      try {
        await idbPut('system_collections', toStore);
        // update index fetchedAt and fetchedSizeBytes
        try {
          await idbPut('system_collections_index', { key, name: idx?.name || null, description: idx?.description || null, entries: idx?.entries ?? null, modifiedAt, fetchedAt: now, fetchedSizeBytes });
        } catch (e) {
          logger('getCollection: updating index failed', e?.message || e);
        }
      } catch (e) {
        logger('getCollection: idbPut failed', e?.message || e);
      }

      return data;
    });
  }

  async function prefetch(keys = []) {
    if (!Array.isArray(keys) || !keys.length) return;
    logger('prefetch', keys.length, 'collections');
    const jobs = keys.map(k => getCollection(k).catch(() => null));
    await Promise.all(jobs);
  }

  return {
    initialize,
    listAvailableCollections,
    getCollection,
    prefetch,
    // internal map exposed for debugging
    _availableIndexMap: availableIndexMap,
  };
}

export default createCollectionDatabaseManager;
