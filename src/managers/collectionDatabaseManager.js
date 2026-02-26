import { idbGet, idbPut, idbGetAll, idbGetAllByIndex } from '../utils/idb.js';
import { timed } from '../utils/timing.js';
import { normalizeFolderPath } from '../utils/helpers.js';
import { getGlobalSettingsManager } from './settingsManager.js';
import { computePatchFromInput, applyPatchToCollection } from '../utils/collectionDiff.js';
import { validateCollection } from '../utils/validation.js';

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

function _nowIso() {
  try { return (new Date()).toISOString(); } catch { return ''; }
}

function _randomIdFragment() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return `${a[0].toString(16)}${a[1].toString(16)}`;
    }
  } catch {}
  return Math.random().toString(16).slice(2);
}

function _makeRevisionId() {
  const ts = (() => {
    try { return Date.now(); } catch { return 0; }
  })();
  return `rev_${ts}_${_randomIdFragment()}`;
}

function _safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

function normalizeRelatedCollectionsConfig(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim();
    const path = String(raw.path || '').trim();
    const thisKey = String(raw.this_key || '').trim();
    const foreignKey = String(raw.foreign_key || '').trim();
    if (!name || !path || !thisKey || !foreignKey) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, path, this_key: thisKey, foreign_key: foreignKey });
  }
  return out;
}

function parsePathExpression(expr) {
  const raw = String(expr || '').trim();
  if (!raw) return [];
  return raw
    .split('.')
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .map(part => {
      const many = part.endsWith('[]');
      const key = many ? part.slice(0, -2) : part;
      return { key, many };
    })
    .filter(t => !!t.key);
}

function extractPathValues(obj, expr) {
  const tokens = parsePathExpression(expr);
  if (!obj || typeof obj !== 'object') return [];
  if (!tokens.length) return [];
  let nodes = [obj];
  for (const token of tokens) {
    const next = [];
    for (const node of nodes) {
      if (node == null) continue;
      const value = node[token.key];
      if (token.many) {
        if (Array.isArray(value)) {
          for (const item of value) next.push(item);
        }
      } else {
        next.push(value);
      }
    }
    nodes = next;
    if (!nodes.length) break;
  }
  return nodes;
}

function normalizeRelatedLookupValues(values) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(values) ? values : [values])) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function resolveRelatedCollectionPath(baseCollectionKey, relPath) {
  let p = String(relPath || '').trim();
  if (!p) return '';
  p = p.replace(/^\.\//, '').replace(/^collections\//, '');
  if (p.includes('/')) return p;
  const folder = normalizeFolderPath((typeof baseCollectionKey === 'string' && baseCollectionKey.includes('/'))
    ? baseCollectionKey.slice(0, baseCollectionKey.lastIndexOf('/'))
    : '');
  return folder ? `${folder}/${p}` : p;
}

function extractCollectionRecords(blob) {
  if (Array.isArray(blob)) return blob;
  if (blob && Array.isArray(blob.entries)) return blob.entries;
  if (blob && Array.isArray(blob.sentences)) return blob.sentences;
  return [];
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
    if (!Array.isArray(coll.entries) || !coll.entries.length) return coll;

    if (!coll.metadata || typeof coll.metadata !== 'object') coll.metadata = {};
    if (!Array.isArray(coll.metadata.relatedCollections) || !coll.metadata.relatedCollections.length) {
      try {
        const sys = await getSystemCollection(key, { force: true });
        const rel = Array.isArray(sys?.metadata?.relatedCollections) ? sys.metadata.relatedCollections : [];
        if (rel.length) {
          coll.metadata.relatedCollections = rel.map(r => ({ ...r }));
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

    const relations = normalizeRelatedCollectionsConfig(coll?.metadata?.relatedCollections);
    if (!relations.length) return coll;

    for (const relation of relations) {
      const relName = relation.name;
      const relPath = resolveRelatedCollectionPath(key, relation.path);
      let foreign = null;
      if (relPath) {
        try {
          foreign = await _resolveCollectionBase(relPath, { force: false, systemOnly: false });
        } catch (e) {
          foreign = null;
        }
      }

      const foreignRecords = extractCollectionRecords(foreign);
      const foreignIndex = new Map();
      for (const rec of foreignRecords) {
        if (!rec || typeof rec !== 'object') continue;
        const values = normalizeRelatedLookupValues(extractPathValues(rec, relation.foreign_key));
        for (const value of values) {
          const arr = foreignIndex.get(value) || [];
          arr.push(rec);
          foreignIndex.set(value, arr);
        }
      }

      for (const entry of coll.entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.relatedCollections || typeof entry.relatedCollections !== 'object') entry.relatedCollections = {};

        const localValues = normalizeRelatedLookupValues(extractPathValues(entry, relation.this_key));
        const matches = [];
        const seen = new Set();
        for (const value of localValues) {
          const rows = foreignIndex.get(value) || [];
          for (const rec of rows) {
            if (!rec || typeof rec !== 'object') continue;
            if (seen.has(rec)) continue;
            seen.add(rec);
            matches.push(rec);
          }
        }

        entry.relatedCollections[relName] = matches;
      }
    }
    // compute counts on demand via `entry.relatedCollections[relName].length` — no legacy caches
    return coll;
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
  // persist lightweight index to IDB while preserving existing fetchedAt/fetchedSizeBytes.
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

      if (Array.isArray(data)) data = { metadata: {}, entries: data };

      // Ensure metadata object exists
      if (!data.metadata || typeof data.metadata !== 'object') data.metadata = {};

      // Support metadata.schema as a string pointing to a separate JSON schema file.
      // Resolve relative paths against the collection's folder and attempt to fetch
      // and inline the schema array. If not present, try a folder-level _metadata.json
      // as a fallback source for schema.
      try {
        const schemaRef = data.metadata.schema;
        const folder = (typeof key === 'string' && key.includes('/')) ? key.substring(0, key.lastIndexOf('/')) : '';

        if (typeof schemaRef === 'string' && schemaRef.trim()) {
          let rel = String(schemaRef).trim().replace(/^\.\//, '');
          if (!rel.includes('/') && folder) rel = `${folder}/${rel}`;
          const schemaUrl = `./collections/${rel}`;
          try {
            const sres = await fetch(schemaUrl);
            if (sres && sres.ok) {
              const stxt = await sres.text();
              const parsed = JSON.parse(stxt);
              if (Array.isArray(parsed)) data.metadata.schema = parsed;
            }
          } catch (e) {
            logger('getCollection: failed to fetch schema at', schemaUrl, e?.message || e);
          }
        } else if (!Array.isArray(data.metadata.schema) && folder) {
          // try folder-level _metadata.json
          const metaUrl = `./collections/${folder}/_metadata.json`;
          try {
            const mres = await fetch(metaUrl);
            if (mres && mres.ok) {
              const mtxt = await mres.text();
              const pm = JSON.parse(mtxt);
              if (pm && pm.metadata && Array.isArray(pm.metadata.schema)) data.metadata.schema = pm.metadata.schema;
            }
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // don't block collection load on schema resolution
      }

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
        const v = validateCollection(data, {});
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

  function _buildRevisionChain({ revisionId, revisionsById } = {}) {
    const rid = (typeof revisionId === 'string' && revisionId.trim()) ? revisionId.trim() : '';
    if (!rid) return [];
    const map = revisionsById instanceof Map ? revisionsById : new Map();
    const out = [];
    const seen = new Set();
    let cur = rid;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const rec = map.get(cur);
      if (!rec) break;
      out.push(rec);
      cur = (typeof rec.parentId === 'string' && rec.parentId.trim()) ? rec.parentId.trim() : '';
    }
    out.reverse();
    return out;
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

      const revisions = await listUserRevisions(key);
      const map = new Map();
      for (const r of revisions) {
        if (r && typeof r.id === 'string') map.set(r.id, r);
      }

      const chain = _buildRevisionChain({ revisionId, revisionsById: map });
      if (!chain.length) {
        if (base) return base;
        // No system base and no applicable chain. Return an empty collection.
        return { metadata: { name: key, version: 1 }, entries: [] };
      }

      // If no system base, start from the earliest snapshot we can find.
      if (!base) {
        const snap = chain.find(r => r && r.kind === 'snapshot' && r.blob && typeof r.blob === 'object');
        if (snap) base = _safeClone(snap.blob);
      }
      if (!base) base = { metadata: { name: key, version: 1 }, entries: [] };

      let out = base;
      for (const rec of chain) {
        if (!rec || typeof rec !== 'object') continue;
        if (rec.kind === 'snapshot' && rec.blob && typeof rec.blob === 'object') {
          out = _safeClone(rec.blob) || out;
          continue;
        }
        if (rec.kind === 'diff' && rec.patch && typeof rec.patch === 'object') {
          out = applyPatchToCollection({ baseCollection: out, patch: rec.patch });
        }
      }

      // Annotate with active revision (for UI/debug only)
      try {
        if (!out.metadata || typeof out.metadata !== 'object') out.metadata = {};
        out.metadata._active_revision = String(revisionId || '').trim() || null;
      } catch (e) {}

      return out;
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
    const id = _makeRevisionId();
    const createdAt = _nowIso();
    const rec = {
      id,
      collectionKey: key,
      kind: 'diff',
      createdAt,
      parentId: parentId || null,
      label: (typeof label === 'string' && label.trim()) ? label.trim() : null,
      patch: _safeClone(p) || p,
    };
    await idbPut('user_collections', rec);
    _setActiveRevisionId(key, id);
    return rec;
  }

  async function commitSnapshot(collectionKey, blob, { label = null } = {}) {
    const key = String(collectionKey || '').trim();
    if (!key) throw new Error('collectionKey required');
    const b = blob && typeof blob === 'object' ? blob : null;
    if (!b) throw new Error('blob required');

    const parentId = _getActiveRevisionId(key);
    const id = _makeRevisionId();
    const createdAt = _nowIso();
    const rec = {
      id,
      collectionKey: key,
      kind: 'snapshot',
      createdAt,
      parentId: parentId || null,
      label: (typeof label === 'string' && label.trim()) ? label.trim() : null,
      blob: _safeClone(b) || b,
      patch: null,
    };
    await idbPut('user_collections', rec);
    _setActiveRevisionId(key, id);
    return rec;
  }

  function getActiveRevisionId(collectionKey) {
    return _getActiveRevisionId(collectionKey);
  }

  function setActiveRevisionId(collectionKey, revisionId) {
    _setActiveRevisionId(collectionKey, revisionId);
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
        const res = validateCollection(coll, { entryArrayKey: null, verbose, logLimit });
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

    // internal map exposed for debugging
    _availableIndexMap: availableIndexMap,
  };
}

export default createCollectionDatabaseManager;
