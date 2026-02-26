import { basename, dirname, normalizeFolderPath, titleFromFilename } from '../utils/helpers.js';
import { buildHashRoute, parseHashRoute } from '../utils/helpers.js';
import { timed } from '../utils/timing.js';
import { compileTableSearchQuery, matchesTableSearch, filterRecordsAndIndicesByTableSearch } from '../utils/tableSearch.js';
import {
  collectionUsesJapaneseExpansion,
  getJapaneseExpansionControlConfig,
  expandJapaneseEntriesAndIndices,
  getJapaneseExpansionDeltas,
} from '../collectionExpansions/japaneseExpansion.js';

export function createCollectionsManager({ state, uiState, persistence, emitter, progressManager, grammarProgressManager = null, collectionDB = null, settings = null }) {
  // Folder metadata helpers/storage used for lazy loads
  let folderMetadataMap = null;
  const metadataCache = {};
  const pendingFolderMetadataLoads = new Map();

  // Register the settings this manager owns/updates.
  try {
    if (settings && typeof settings.registerConsumer === 'function') {
      settings.registerConsumer({
        consumerId: 'collectionsManager',
        settings: [
          'shell.activeCollectionId',
          'shell.activeCollectionPath',
          'shell.activeCollectionEntriesCount',
          'shell.lastRoute',
        ],
      });
    }
  } catch (e) {}

  // map of available collection path -> lightweight metadata from index.json
  let availableCollectionsMap = new Map();

  // Track in-flight collection fetch promises to avoid duplicate fetches
  const pendingLoads = new Map();

  // Collection sets (tags) support: per-folder `_collectionSets.json`
  const COLLECTION_SETS_FILE = '_collectionSets.json';
  const COLLECTION_SETS_DIRNAME = '__collectionSets';
  const collectionSetsCache = new Map();
  const pendingCollectionSetsLoads = new Map();

  // Folder-level entry index cache used to resolve set terms to real entries.
  const folderEntryIndexCache = new Map();

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

  function getEntryRelatedCounts(entry, collection) {
    const out = {};
    const relations = normalizeRelatedCollectionsConfig(collection?.metadata?.relatedCollections);
    for (const relation of relations) {
      const name = relation.name;
      const arr = Array.isArray(entry?.relatedCollections?.[name]) ? entry.relatedCollections[name] : [];
      out[name] = arr.length;
    }
    return out;
  }

  const DEBUG_PREVIEW_LIMIT = 200;

  function debugPreviewLimit(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return DEBUG_PREVIEW_LIMIT;
    return Math.max(10, Math.min(2000, v));
  }

  function debugMapKeys(m, limit) {
    try {
      const out = [];
      if (!(m instanceof Map)) return out;
      const lim = debugPreviewLimit(limit);
      for (const k of m.keys()) {
        out.push(String(k));
        if (out.length >= lim) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function debugSerializeFolderEntryIndex(map, limit) {
    const lim = debugPreviewLimit(limit);
    const out = [];
    if (!(map instanceof Map)) return out;
    let i = 0;
    for (const [term, entry] of map.entries()) {
      out.push({
        term: String(term || ''),
        entry: (entry && typeof entry === 'object') ? {
          kanji: entry.kanji ?? null,
          reading: entry.reading ?? entry.kana ?? null,
          meaning: entry.meaning ?? entry.definition ?? entry.gloss ?? null,
          type: entry.type ?? null,
        } : null,
      });
      i++;
      if (i >= lim) break;
    }
    return out;
  }

  function debugListRuntimeMaps() {
    const items = [];
    items.push({ id: 'availableCollectionsMap', label: 'availableCollectionsMap (index metadata)' });
    items.push({ id: 'pendingLoads', label: 'pendingLoads (in-flight fetches)' });
    items.push({ id: 'pendingFolderMetadataLoads', label: 'pendingFolderMetadataLoads' });
    items.push({ id: 'folderMetadataMap', label: 'folderMetadataMap (index folderMetadata)' });
    items.push({ id: 'metadataCache', label: 'metadataCache (resolved folder metadata)' });
    items.push({ id: 'collectionSetsCache', label: 'collectionSetsCache' });
    items.push({ id: 'pendingCollectionSetsLoads', label: 'pendingCollectionSetsLoads' });
    items.push({ id: 'folderEntryIndexCache', label: 'folderEntryIndexCache' });
    return items;
  }

  function debugGetRuntimeMapDump(mapId, opts = {}) {
    const id = String(mapId || '').trim();
    const limit = debugPreviewLimit(opts?.limit);

    if (id === 'availableCollectionsMap') {
      const out = [];
      for (const [path, meta] of availableCollectionsMap.entries()) {
        out.push({ path, ...(meta && typeof meta === 'object' ? meta : {}) });
        if (out.length >= limit) break;
      }
      return out;
    }

    if (id === 'pendingLoads') {
      return debugMapKeys(pendingLoads, limit);
    }

    if (id === 'pendingFolderMetadataLoads') {
      return debugMapKeys(pendingFolderMetadataLoads, limit);
    }

    if (id === 'folderMetadataMap') {
      if (!(folderMetadataMap instanceof Map)) return [];
      const out = [];
      for (const [k, v] of folderMetadataMap.entries()) {
        out.push({ folder: String(k || ''), file: String(v || '') });
        if (out.length >= limit) break;
      }
      return out;
    }

    if (id === 'metadataCache') {
      const out = [];
      for (const k of Object.keys(metadataCache || {})) {
        const v = metadataCache[k];
        const fmFields = Array.isArray(v?.fields) ? v.fields : (Array.isArray(v?.schema) ? v.schema : null);
        out.push({ folder: k, hasValue: v != null, fieldsCount: fmFields ? fmFields.length : null });
        if (out.length >= limit) break;
      }
      return out;
    }

    if (id === 'collectionSetsCache') {
      const out = [];
      for (const [folder, cs] of collectionSetsCache.entries()) {
        out.push({ folder: String(folder || ''), setCount: Array.isArray(cs?.sets) ? cs.sets.length : 0, name: cs?.name ?? null, version: cs?.version ?? null });
        if (out.length >= limit) break;
      }
      return out;
    }

    if (id === 'pendingCollectionSetsLoads') {
      return debugMapKeys(pendingCollectionSetsLoads, limit);
    }

    if (id === 'folderEntryIndexCache') {
      const out = [];
      for (const [folder, idx] of folderEntryIndexCache.entries()) {
        out.push({ folder: String(folder || ''), terms: (idx instanceof Map) ? idx.size : 0 });
        if (out.length >= limit) break;
      }
      return out;
    }
    if (id.startsWith('folderEntryIndexCache:')) {
      const folder = id.slice('folderEntryIndexCache:'.length);
      const idx = folderEntryIndexCache.get(folder);
      return debugSerializeFolderEntryIndex(idx, limit);
    }

    return { error: `Unknown runtime map: ${id}` };
  }

  function emit() {
    emitter.emit();
  }

  function getCollections() {
    return state.collections;
  }

  function getActiveCollectionId() {
    return state.activeCollectionId;
  }

  function getActiveCollection() {
    return state.collections.find((c) => c.key === state.activeCollectionId) ?? null;
  }

  function syncHashCollectionParam(collectionId) {
    if (!location.hash) return;

    const { pathname, query } = parseHashRoute(location.hash);
    const id = (typeof collectionId === 'string' && collectionId) ? collectionId : null;
    if (id) query.set('collection', id);
    else query.delete('collection');

    const newHash = buildHashRoute({ pathname, query });
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }

  function collectionSetsDirPath(baseFolder) {
    const folder = normalizeFolderPath(baseFolder);
    return folder ? `${folder}/${COLLECTION_SETS_DIRNAME}` : COLLECTION_SETS_DIRNAME;
  }

  function isCollectionSetsDirPath(dirPath) {
    const folder = normalizeFolderPath(dirPath);
    return folder === COLLECTION_SETS_DIRNAME || folder.endsWith(`/${COLLECTION_SETS_DIRNAME}`);
  }

  function parseCollectionSetVirtualKey(key) {
    const parts = String(key || '').split('/').filter(Boolean);
    const idx = parts.lastIndexOf(COLLECTION_SETS_DIRNAME);
    if (idx === -1) return null;
    if (idx >= parts.length - 1) return null;
    const baseFolder = parts.slice(0, idx).join('/');
    const setId = parts[idx + 1];
    if (!setId) return null;
    return { baseFolder, setId };
  }

  function topFolderOfKey(key) {
    const parts = String(key || '').split('/').filter(Boolean);
    return parts.length ? parts[0] : '';
  }

  function isCollectionSetVirtualKey(key) {
    return !!parseCollectionSetVirtualKey(key);
  }

  function hasCollectionSetsFile(baseFolder) {
    const folder = normalizeFolderPath(baseFolder);
    const rel = folder ? `${folder}/${COLLECTION_SETS_FILE}` : COLLECTION_SETS_FILE;
    return state._availableCollectionPaths.includes(rel);
  }

  async function loadCollectionSetsForFolder(baseFolder) {
    // Deprecated: collection sets are removed. Fail fast to keep codebase strict.
    throw new Error('Deprecated feature: collection sets (_collectionSets.json / __collectionSets) are no longer supported.');
  }

  async function ensureCollectionsLoadedInFolder(baseFolder, opts = { excludeCollectionSets: true }) {
    const folder = normalizeFolderPath(baseFolder);
    const prefix = folder ? `${folder}/` : '';
    const excludeCollectionSets = opts?.excludeCollectionSets !== false;

    const keys = state._availableCollectionPaths
      .filter(k => (prefix ? k.startsWith(prefix) : true))
      .filter(k => {
        if (!excludeCollectionSets) return true;
        return basename(k) !== COLLECTION_SETS_FILE && !k.split('/').includes(COLLECTION_SETS_DIRNAME);
      });

    const loads = [];
    for (const k of keys) {
      if (!k) continue;
      if (state.collections.some(c => c.key === k)) continue;
      if (pendingLoads.has(k)) {
        loads.push(pendingLoads.get(k).catch(() => null));
        continue;
      }
      loads.push(loadCollectionInternal(k, { notify: false }).catch(() => null));
    }

    if (loads.length) {
      await timed(`collections.ensureCollectionsLoadedInFolder ${folder || '(root)'} (${loads.length})`, () => Promise.all(loads));
    }
  }

  function computeEntryScore(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    const keys = ['kanji', 'character', 'text', 'word', 'reading', 'kana', 'meaning', 'definition', 'gloss', 'type'];
    let score = 0;
    for (const k of keys) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) score += 1;
    }
    return score;
  }

  function buildFolderEntryIndex(baseFolder) {
    const folder = normalizeFolderPath(baseFolder);
    if (folderEntryIndexCache.has(folder)) return folderEntryIndexCache.get(folder);

    return timed(`collections.buildFolderEntryIndex ${folder || '(root)'}`, () => {

      const prefix = folder ? `${folder}/` : '';
      const index = new Map();
      const scoreMap = new Map();
      const candidateKeys = ['kanji', 'character', 'text', 'word', 'kana', 'reading'];

    const relevantCollections = state.collections
      .filter(c => c && typeof c.key === 'string')
      .filter(c => (prefix ? c.key.startsWith(prefix) : true))
      .filter(c => !isCollectionSetVirtualKey(c.key));

    for (const coll of relevantCollections) {
      const entries = Array.isArray(coll.entries) ? coll.entries : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const score = computeEntryScore(entry);
        for (const k of candidateKeys) {
          const v = entry[k];
          if (typeof v !== 'string') continue;
          const term = v.trim();
          if (!term) continue;
          const prevScore = scoreMap.get(term);
          if (typeof prevScore !== 'number' || score > prevScore) {
            index.set(term, entry);
            scoreMap.set(term, score);
          }
        }
      }
    }

      folderEntryIndexCache.set(folder, index);
      return index;
    });
  }

  async function resolveVirtualSetRecord(record, baseFolder, setObj) {
    const folder = normalizeFolderPath(baseFolder);
    return timed(`collections.resolveVirtualSetRecord ${folder || '(root)'}`, async () => {
      // Virtual sets are deprecated. Throw to enforce strict codebase.
      throw new Error('Deprecated feature: virtual collection sets are no longer supported.');

    const resolved = [];
    if (Array.isArray(setObj?.kanjiFilter) && setObj.kanjiFilter.length) {
      function parseFilter(f) {
        const s = String(f || '').trim();
        if (!s) return null;
        const mStarts = s.match(/^(.+?)\.startsWith\[(.*)\]$/);
        if (mStarts) return { field: mStarts[1], op: 'startsWith', value: mStarts[2] };
        const mEnds = s.match(/^(.+?)\.endsWith\[(.*)\]$/);
        if (mEnds) return { field: mEnds[1], op: 'endsWith', value: mEnds[2] };
        const mIn = s.match(/^(.+?)\.in\[(.*)\]$/);
        if (mIn) return { field: mIn[1], op: 'in', value: mIn[2] };
        const mNeq = s.match(/^(.+?)!=([\s\S]*)$/);
        if (mNeq) return { field: mNeq[1], op: 'neq', value: mNeq[2] };
        const mEq = s.match(/^(.+?)=([\s\S]*)$/);
        if (mEq) return { field: mEq[1], op: 'eq', value: mEq[2] };
        return null;
      }

      function matchesAll(entry, filters) {
        const progressMap = progressManager?._unsafeGetMap?.() || {};
        const normalize = progressManager?.normalizeKanjiValue || ((v) => String(v ?? '').trim());
        const keyCandidates = ['kanji', 'character', 'text', 'word', 'kana', 'reading'];

        function entryKeyForProgress(e) {
          if (!e || typeof e !== 'object') return '';
          for (const k of keyCandidates) {
            const v = e[k];
            if (v !== undefined && v !== null && String(v || '').trim()) return normalize(v);
          }
          return '';
        }

        for (const f of filters) {
          const parsed = parseFilter(f);
          if (!parsed) return false;

          if (String(parsed.field).startsWith('kanji_progress.')) {
            const parts = String(parsed.field).split('.');
            const fieldName = parts.slice(1).join('.');
            const entryKey = entryKeyForProgress(entry);
            if (!entryKey) return false;
            const rec = progressMap[entryKey]
              || progressMap[`japanese.words|${entryKey}`]
              || progressMap[`grammar|${entryKey}`];
            if (!rec || typeof rec !== 'object') {
              if (parsed.op === 'neq') {
                const cmpVal = String(parsed.value || '').trim();
                if (cmpVal === '') return false;
                continue;
              }
              return false;
            }

            const raw = rec[fieldName];

            if (parsed.op === 'eq') {
              if (typeof raw === 'boolean') {
                const want = String(parsed.value || '').trim().toLowerCase();
                const wantBool = (want === 'true');
                if (raw !== wantBool) return false;
              } else if (typeof raw === 'number') {
                const wantNum = Number(parsed.value);
                if (!Number.isFinite(wantNum) || raw !== wantNum) return false;
              } else if (raw === null || raw === undefined) {
                if ((parsed.value || '') !== '') return false;
              } else {
                const sval = String(raw);
                if (sval !== String(parsed.value || '')) return false;
              }
            } else if (parsed.op === 'neq') {
              if (typeof raw === 'boolean') {
                const want = String(parsed.value || '').trim().toLowerCase();
                const wantBool = (want === 'true');
                if (raw === wantBool) return false;
              } else if (typeof raw === 'number') {
                const wantNum = Number(parsed.value);
                if (Number.isFinite(wantNum) && raw === wantNum) return false;
              } else if (raw === null || raw === undefined) {
                if ((parsed.value || '') === '') return false;
              } else {
                const sval = String(raw);
                if (sval === String(parsed.value || '')) return false;
              }
            } else if (parsed.op === 'startsWith' || parsed.op === 'endsWith' || parsed.op === 'in') {
              const sval = (raw === null || raw === undefined) ? '' : String(raw);
              const v = String(parsed.value || '');
              if (parsed.op === 'startsWith') {
                if (!sval.startsWith(v)) return false;
              } else if (parsed.op === 'endsWith') {
                if (!sval.endsWith(v)) return false;
              } else {
                const partsList = String(parsed.value || '').split(',').map(x => x.trim()).filter(Boolean);
                if (partsList.length === 0) return false;
                if (!partsList.includes(sval)) return false;
              }
            } else {
              return false;
            }

            continue;
          }

          const raw = entry && typeof entry === 'object' ? entry[parsed.field] : undefined;
          const val = (typeof raw === 'string' || typeof raw === 'number') ? String(raw) : null;
          if (val === null) return false;
          const v = String(parsed.value || '');
          if (parsed.op === 'eq') {
            if (val !== v) return false;
          } else if (parsed.op === 'startsWith') {
            if (!val.startsWith(v)) return false;
          } else if (parsed.op === 'endsWith') {
            if (!val.endsWith(v)) return false;
          } else if (parsed.op === 'in') {
            const partsList = String(parsed.value || '').split(',').map(x => x.trim()).filter(Boolean);
            if (partsList.length === 0) return false;
            if (!partsList.includes(val)) return false;
          } else if (parsed.op === 'neq') {
            if (val === v) return false;
          } else {
            return false;
          }
        }
        return true;
      }

      for (const coll of state.collections.slice()) {
        if (!coll || !coll.key) continue;
        if (isCollectionSetVirtualKey(coll.key)) continue;
        if (folder && topFolderOfKey(coll.key) !== folder) continue;
        if (!Array.isArray(coll.entries)) continue;
        for (const e of coll.entries) {
          if (!e || typeof e !== 'object') continue;
          if (matchesAll(e, setObj.kanjiFilter)) resolved.push(e);
        }
      }
    } else {
      const terms = Array.isArray(setObj?.kanji) ? setObj.kanji.slice() : [];
      for (const t of terms) {
        const term = String(t || '').trim();
        if (!term) continue;
        const found = index.get(term);
        if (found) resolved.push(found);
        else resolved.push({ kanji: term, text: term });
      }
    }

    const fm = (await loadInheritedFolderMetadata(folder, metadataCache, folderMetadataMap)) || null;
    const fields = Array.isArray(fm?.fields) ? fm.fields : (Array.isArray(fm?.schema) ? fm.schema : null);

    record.entries = resolved;
    record.metadata = record.metadata || {};
    if (fields) record.metadata.fields = fields;

      emit();
    });
  }

  function getCachedCollectionSetsForFolder(baseFolder) {
    // Deprecated: collection sets removed. Fail fast when queried.
    throw new Error('Deprecated feature: collection sets (_collectionSets.json / __collectionSets) are no longer supported.');
  }

  function normalizeIndexRelativePath(p) {
    let s = String(p || '').trim();
    if (!s) return '';
    s = s.replace(/^\.\//, '');
    s = s.replace(/^collections\//, '');
    return s;
  }

  function buildFolderMetadataMap(folderMetadata) {
    if (!folderMetadata || typeof folderMetadata !== 'object') return null;

    const map = new Map();
    for (const [rawFolder, rawFile] of Object.entries(folderMetadata)) {
      const folder = normalizeFolderPath(rawFolder);
      let fileRel = normalizeIndexRelativePath(rawFile);
      if (!fileRel) continue;

      // If the file path is not a single filename, try to make it
      // relative to the folder key when it looks like a subpath
      // intended for that folder. This handles index entries like
      // { "japanese": "words/_metadata.json" } meaning
      // "collections/japanese/words/_metadata.json".
      if (!fileRel.includes('/')) {
        fileRel = folder ? `${folder}/${fileRel}` : fileRel;
      } else if (folder) {
        // If the provided relative path doesn't already start with
        // the folder, and doesn't look like an explicit parent path,
        // prefix it so it resolves under the folder key. This keeps
        // backwards compatibility while allowing shorthand like
        // "words/_metadata.json" under the "japanese" key.
        if (!fileRel.startsWith(`${folder}/`) && !fileRel.startsWith('../') && !fileRel.startsWith('/')) {
          fileRel = `${folder}/${fileRel}`;
        }
      }

      map.set(folder, fileRel);
    }

    return map;
  }

  async function tryLoadFolderMetadata(folderPath, folderMetadataMapParam) {
    const folder = normalizeFolderPath(folderPath);
    if (folderMetadataMapParam instanceof Map) {
      // If a mapping exists, attempt to resolve metadata via collectionDB.
      // CollectionsManager must not perform network fetches itself.
      const rel = folderMetadataMapParam.get(folder);
      if (!rel) return null;
      if (collectionDB && typeof collectionDB.getCollection === 'function') {
        try {
          const parsed = await collectionDB.getCollection(rel).catch(() => null);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {
          // ignore collectionDB errors
        }
      } else {
        // collectionDB not available; skip
      }
      return null;
    }
    // No mapping provided; do not attempt direct network fetches here.
    // no mapping and fetches are disabled
    return null;
  }

  async function loadInheritedFolderMetadata(folderPath, cache, folderMetadataMapParam) {
    const folder = normalizeFolderPath(folderPath);
    if (Object.prototype.hasOwnProperty.call(cache, folder)) return cache[folder];

    if (pendingFolderMetadataLoads.has(folder)) {
      return pendingFolderMetadataLoads.get(folder);
    }

    const p = timed(`collections.loadInheritedFolderMetadata ${folder || '(root)'}`, async () => {
      const direct = await tryLoadFolderMetadata(folder, folderMetadataMapParam);
      if (direct) {
        cache[folder] = direct;
        return direct;
      }

      const parent = dirname(folder);
      if (parent === folder) {
        cache[folder] = null;
        return null;
      }

      const inherited = folder ? await loadInheritedFolderMetadata(parent, cache, folderMetadataMapParam) : null;
      cache[folder] = inherited;
      return inherited;
    });

    pendingFolderMetadataLoads.set(folder, p);
    try {
      return await p;
    } finally {
      pendingFolderMetadataLoads.delete(folder);
    }
  }

  async function getInheritedFolderMetadata(collectionKeyOrFolder) {
    if (!collectionKeyOrFolder) return null;
    const folder = (typeof collectionKeyOrFolder === 'string' && collectionKeyOrFolder.includes('/'))
      ? dirname(collectionKeyOrFolder)
      : normalizeFolderPath(collectionKeyOrFolder);

    const meta = await loadInheritedFolderMetadata(folder, metadataCache, folderMetadataMap);
    return meta || null;
  }

  function mergeMetadata(collection, categoryMetadata) {
    const categoryFields = Array.isArray(categoryMetadata?.fields) ? categoryMetadata.fields : (Array.isArray(categoryMetadata?.schema) ? categoryMetadata.schema : []);
    const collectionFields = Array.isArray(collection.metadata?.fields) ? collection.metadata.fields : (Array.isArray(collection.metadata?.schema) ? collection.metadata.schema : []);
    const collectionFieldKeys = new Set(collectionFields.map(f => f.key));

    const mergedFields = [
      ...categoryFields.filter(f => !collectionFieldKeys.has(f.key)),
      ...collectionFields
    ];

    const category = categoryMetadata?.category || categoryMetadata?.language || (categoryMetadata?.metadata && categoryMetadata.metadata.category) || null;

    return {
      ...collection,
      metadata: {
        ...collection.metadata,
        // keep `fields` for backwards compatibility, but also expose `schema`
        fields: mergedFields,
        schema: mergedFields,
        category: category
      }
    };
  }

  function buildCollectionTreeFromPaths(paths) {
    const root = { type: 'dir', name: '', path: '', dirs: new Map(), files: new Map() };

    for (const relPath of paths) {
      const parts = String(relPath || '').split('/').filter(Boolean);
      if (parts.length === 0) continue;
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        if (!isLast) {
          if (!node.dirs.has(part)) {
            const nextPath = node.path ? `${node.path}/${part}` : part;
            node.dirs.set(part, { type: 'dir', name: part, path: nextPath, dirs: new Map(), files: new Map() });
          }
          node = node.dirs.get(part);
        } else {
          node.files.set(part, relPath);
        }
      }
    }

    return root;
  }

  function findTreeNode(dirPath) {
    const folder = normalizeFolderPath(dirPath);
    const root = state.collectionTree;
    if (!root) return null;
    if (!folder) return root;

    const parts = folder.split('/').filter(Boolean);
    let node = root;
    for (const p of parts) {
      const next = node.dirs.get(p);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  function listCollectionDir(dirPath) {
    const folder = normalizeFolderPath(dirPath);
    if (isCollectionSetsDirPath(folder)) {
      throw new Error('Deprecated feature: collection sets directory requested.');
    }

    const node = findTreeNode(folder);
    const parentDir = folder ? dirname(folder) : null;

    if (!node) {
      return { dir: folder, parentDir, folders: [], files: [] };
    }

    const folders = Array.from(node.dirs.values())
      .map(d => ({ name: d.name, path: d.path, label: d.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const files = Array.from(node.files.entries())
      .map(([filename, key]) => {
        const loaded = state.collections.find(c => c.key === key);
        const label = loaded?.metadata?.name || titleFromFilename(filename);
        return { filename, key, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return { dir: folder, parentDir, folders, files };
  }

  async function loadSeedCollections() {
    return timed('collections.loadSeedCollections', async () => {
      if (!collectionDB || typeof collectionDB.initialize !== 'function') {
        throw new Error('collectionDB is required: collections must be loaded via collectionDatabaseManager');
      }

      // Use collectionDB to load index + folder metadata
      const initRes = await collectionDB.initialize();
      const paths = Array.isArray(initRes?.paths) ? initRes.paths : [];

      // Strict mode: fail if deprecated collection-sets files are present in the index
      for (const p of paths) {
        if (!p) continue;
        if (basename(p) === COLLECTION_SETS_FILE || p.split('/').includes(COLLECTION_SETS_DIRNAME)) {
          throw new Error(`Deprecated collection sets detected in index: ${p}`);
        }
      }
      folderMetadataMap = initRes?.folderMetadataMap || null;

      // Build tree and available paths
      state.collectionTree = buildCollectionTreeFromPaths(paths);
      state._availableCollectionPaths = paths.slice();

      availableCollectionsMap = new Map();
      try {
        const list = await collectionDB.listAvailableCollections();
        for (const r of list) {
          if (!r || !r.key) continue;
          availableCollectionsMap.set(r.key, { path: r.key, name: r.name || null, description: r.description || null, entries: (typeof r.entries === 'number') ? r.entries : null });
        }
      } catch (e) {
        // ignore
      }

      emit();

      return paths;
    });
  }

  function getAvailableCollections() {
    return state._availableCollectionPaths.map(p => availableCollectionsMap.get(p) || { path: p, name: null, description: null, entries: null });
  }

  async function loadCollection(key) {
    return loadCollectionInternal(key, { notify: true });
  }

  async function loadCollectionInternal(key, opts = { notify: true }) {
    if (!key) throw new Error('collection key required');
    const existing = state.collections.find(c => c.key === key);
    if (existing) return existing;
    if (pendingLoads.has(key)) return pendingLoads.get(key);

    const p = timed(`collections.loadCollection ${key}`, async () => {
      const virtual = parseCollectionSetVirtualKey(key);
      if (virtual) {
        throw new Error(`Deprecated collection set virtual key used: ${key}`);
      }

      if (!state._availableCollectionPaths.includes(key)) {
        throw new Error(`Collection not found in index: ${key}`);
      }

      let data;
      if (!collectionDB || typeof collectionDB.getCollection !== 'function') {
        throw new Error('collectionDB.getCollection is required to load collections');
      }
      data = await collectionDB.getCollection(key);
      console.debug(`[CollectionsManager] Loaded collection data for key: ${key}`, { raw: data });


      if (Array.isArray(data)) {
        data = { metadata: {}, sentences: data };
      }

      const folderPath = dirname(key);
      const fm = (await loadInheritedFolderMetadata(folderPath, metadataCache, folderMetadataMap)) || { fields: [], category: folderPath.split('/')[0] || '' };
      data = mergeMetadata(data, fm);

      data.metadata = data.metadata || {};
      if (!data.metadata.name) {
        data.metadata.name = titleFromFilename(basename(key));
      }

      const record = { ...data, key };
      state.collections = [record];

      try {
        const top = topFolderOfKey(key);
        if (top) folderEntryIndexCache.delete(top);
      } catch {
        // ignore
      }

      if (opts.notify !== false) emit();
      return record;
    });

    pendingLoads.set(key, p);
    try {
      return await p;
    } finally {
      pendingLoads.delete(key);
    }
  }

  function prefetchCollectionsInFolder(baseFolder, prefetchOpts = {}) {
    // Active-only architecture: do not prefetch collections.
    return;
  }

  async function setActiveCollectionId(id) {
    const nextId = id || null;
    const same = state.activeCollectionId === nextId;

    if (!same && nextId) {
      const alreadyLoaded = state.collections.some(c => c.key === nextId);
      if (!alreadyLoaded) {
        try {
          await loadCollection(nextId);
        } catch (err) {
          return;
        }
      }
    }

    if (!same) state.activeCollectionId = nextId;
    if (!same && !nextId) state.collections = [];

    try {
      syncHashCollectionParam(nextId);
    } catch {
      // ignore
    }

    
      if (settings && typeof settings.set === 'function') {
        settings.set('shell.activeCollectionId', state.activeCollectionId, { consumerId: 'collectionsManager', silent: true });

        // Also persist active collection path and base entries count for shell display
        try {
          const activeColl = state.collections.find(c => c.key === state.activeCollectionId) || null;
          settings.set('shell.activeCollectionPath', activeColl?.key || null, { consumerId: 'collectionsManager', silent: true });
          settings.set('shell.activeCollectionEntriesCount', Array.isArray(activeColl?.entries) ? activeColl.entries.length : 0, { consumerId: 'collectionsManager', silent: true });
        } catch (e) {
          // ignore
        }

        if (location.hash) {
          const lr = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
          settings.set('shell.lastRoute', lr, { consumerId: 'collectionsManager', silent: true });
        }
      } else {
        // SettingsManager should be provided; do not fall back to uiState.shell.
        // If absent, silently ignore per user's preference (no migration/fallback).
      }
    

    if (!same) emit();
  }

  async function syncCollectionFromURL(route) {
    const collectionId = route?.query?.get('collection');
    if (collectionId && collectionId !== state.activeCollectionId) {
      await setActiveCollectionId(collectionId);
    }
  }

  function loadCollectionState(collId) {
    try {
      if (!uiState.collections) return null;
      const obj = uiState.collections[collId] || null;
      return obj;
    } catch {
      return null;
    }
  }

  // Save per-collection UI state. `opts` may include `{ app: 'appName' }` to
  // scope certain properties (notably `currentIndex`) to a specific app/view.
  function saveCollectionState(collId, patch, opts = {}) {
    try {
      uiState.collections = uiState.collections || {};
      const prev = uiState.collections[collId] || {};
      const next = { ...prev };

      const app = String(opts?.app || '').trim();

      // If an app is provided, move certain keys into the app-scoped bucket.
      // Keys that should be stored per-app: `currentIndex`, `questionField`, `answerField`.
      const keysToApp = new Set(['currentIndex', 'questionField', 'answerField']);
      if (app && patch && typeof patch === 'object') {
        const appObj = { ...(next[app] || {}) };
        const rest = { ...patch };
        for (const k of Object.keys(patch)) {
          if (keysToApp.has(k)) {
            const v = patch[k];
            if (k === 'currentIndex') {
              if (typeof v === 'number' && Number.isFinite(v)) appObj.currentIndex = Math.round(v);
              else appObj.currentIndex = v;
            } else {
              appObj[k] = v;
            }
            delete rest[k];
          }
        }
        if (Object.keys(appObj).length) next[app] = appObj;
        uiState.collections[collId] = { ...next, ...(rest || {}) };
      } else {
        uiState.collections[collId] = { ...next, ...(patch || {}) };
      }

      persistence.markDirty({ collectionId: collId });
      persistence.scheduleFlush();
    } catch {
      // ignore
    }
  }

  // Delete collection state keys. If `opts.app` is provided, keys will be
  // removed from the app-scoped bucket instead of top-level properties.
  function deleteCollectionStateKeys(collId, keys = [], opts = {}) {
    try {
      const id = String(collId || '').trim();
      if (!id) return;
      uiState.collections = uiState.collections || {};
      const prev = uiState.collections[id] || {};
      if (!prev || typeof prev !== 'object') return;
      const next = { ...prev };
      let changed = false;

      const app = String(opts?.app || '').trim();
      if (app) {
        const appObj = { ...(next[app] || {}) };
        for (const k of (Array.isArray(keys) ? keys : [])) {
          const key = String(k || '');
          if (!key) continue;
          if (Object.prototype.hasOwnProperty.call(appObj, key)) {
            delete appObj[key];
            changed = true;
          }
        }
        if (changed) {
          // if appObj is empty, remove the bucket entirely
          if (Object.keys(appObj).length === 0) delete next[app];
          else next[app] = appObj;
        }
      } else {
        for (const k of (Array.isArray(keys) ? keys : [])) {
          const key = String(k || '');
          if (!key) continue;
          if (Object.prototype.hasOwnProperty.call(next, key)) {
            delete next[key];
            changed = true;
          }
        }
      }

      if (!changed) return;
      uiState.collections[id] = next;
      persistence.markDirty({ collectionId: id });
      persistence.scheduleFlush();
      emit();
    } catch {
      // ignore
    }
  }

  // ============================================================================
  // Seeded Random & Permutation (for deterministic shuffle)
  // ============================================================================

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededPermutation(n, seed) {
    const rng = mulberry32(seed >>> 0);
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ============================================================================
  // Table Search / Filtering Utilities
  // ============================================================================

  function buildEntrySearchAccessor(entry, { fields = null, collection = null } = {}) {
    const coll = (collection && typeof collection === 'object') ? collection : null;
    const adapter = progressAdapterForCollection(coll);
    const key = adapter?.getKey ? adapter.getKey(entry) : String(getEntryStudyKey(entry) || '').trim();
    const learned = !!(key && adapter?.isLearned && adapter.isLearned(key));
    const focus = !!(key && adapter?.isFocus && adapter.isFocus(key));
    const status = learned ? 'learned' : (focus ? 'focus' : 'null');

    let timesSeen = 0;
    let timeMs = 0;
    let seen = false;
    try {
      if (adapter?.kind === 'grammar') {
        const rec = (key && typeof grammarProgressManager?.getGrammarProgressRecord === 'function')
          ? (grammarProgressManager.getGrammarProgressRecord(key, { collectionKey: coll?.key }) || {})
          : {};
        timesSeen = Math.max(0, Math.round(Number(rec?.timesSeen) || 0));
        timeMs = Math.max(0, Math.round(Number(rec?.timeMs) || 0));
        seen = !!rec?.seen || timesSeen > 0 || timeMs > 0;
      } else {
        const rec = (key && typeof progressManager?.getKanjiProgressRecord === 'function')
          ? (progressManager.getKanjiProgressRecord(key, { collectionKey: coll?.key }) || {})
          : {};
        timesSeen = Math.max(0, Math.round(Number(rec?.timesSeen) || 0));
        timeMs = Math.max(0, Math.round(Number(rec?.timeMs) || 0));
        seen = !!rec?.seen || timesSeen > 0 || timeMs > 0;
      }
    } catch {
      // ignore
    }

    const relatedCounts = getEntryRelatedCounts(entry, coll);
    const dynamic = {
      status,
      studySeen: !!seen,
      studyTimesSeen: timesSeen,
      studyTimeMs: timeMs,
    };
    for (const [name, count] of Object.entries(relatedCounts)) {
      dynamic[`${name}.count`] = Number(count) || 0;
    }

    // Accept explicit `fields` parameter, or fall back to the collection's
    // metadata fields if available. This allows callers that don't pass a
    // `fields` array to still have accurate field presence/type info.
    let metaFields = [];
    if (Array.isArray(fields) && fields.length) {
      metaFields = fields.map(f => (typeof f === 'string' ? { key: String(f), type: null } : { key: String(f?.key || ''), type: f?.type ?? (f?.schema && f.schema.type) ?? null })).filter(f => f.key);
    } else if (coll && coll.metadata && (Array.isArray(coll.metadata.fields) || Array.isArray(coll.metadata.schema))) {
      const fm = Array.isArray(coll.metadata.fields) ? coll.metadata.fields : coll.metadata.schema;
      metaFields = fm.map(f => (typeof f === 'string' ? { key: String(f), type: null } : { key: String(f?.key || ''), type: f?.type ?? (f?.schema && f.schema.type) ?? null })).filter(f => f.key);
    }
    const typeMap = new Map(metaFields.map(f => [String(f.key), f.type ?? null]));
    const metaKeys = metaFields.map(f => String(f.key));
    const dynamicKeys = ['status', 'studySeen', 'studyTimesSeen', 'studyTimeMs', ...Object.keys(relatedCounts).map(name => `${name}.count`)];

    return {
      hasField: (k) => {
        const kk = String(k || '').trim();
        if (!kk) return false;
        if (Object.prototype.hasOwnProperty.call(dynamic, kk)) return true;
        // If caller provided an explicit fields list (metaKeys), treat those
        // fields as present even when the concrete entry object doesn't have
        // the property. This allows queries like `{lexicalClass:}` to match
        // entries where the field is missing / empty when the view defines
        // that column in its metadata.
        if (metaKeys && metaKeys.length) return metaKeys.includes(kk);
        return !!(entry && Object.prototype.hasOwnProperty.call(entry, kk));
      },
      getValue: (k) => {
        const kk = String(k || '').trim();
        if (!kk) return undefined;
        if (Object.prototype.hasOwnProperty.call(dynamic, kk)) return dynamic[kk];
        return entry ? entry[kk] : undefined;
      },
      getFieldType: (k) => {
        const kk = String(k || '').trim();
        if (kk === 'studySeen') return 'boolean';
        if (kk === 'studyTimesSeen' || kk === 'studyTimeMs') return 'number';
        if (kk.endsWith('.count')) return 'number';
        return typeMap.has(kk) ? typeMap.get(kk) : null;
      },
      getAllValues: () => {
        const out = [];
        if (metaKeys.length) {
          for (const mk of metaKeys) out.push(entry ? entry[mk] : undefined);
        } else {
          for (const v of Object.values(entry || {})) out.push(v);
        }
        for (const dk of dynamicKeys) out.push(dynamic[dk]);
        return out;
      },
    };
  }

  function tableSearchFieldsMeta(fields = null, collection = null) {
    const base = Array.isArray(fields)
      ? fields.map(f => (typeof f === 'string' ? { key: String(f), type: null } : { key: String(f?.key || ''), type: f?.type ?? (f?.schema && f.schema.type) ?? null })).filter(f => f.key)
      : [];
    const related = normalizeRelatedCollectionsConfig(collection?.metadata?.relatedCollections)
      .map(rel => ({ key: `${rel.name}.count`, type: 'number' }));
    return [
      ...base,
      { key: 'status', type: null },
      ...related,
      { key: 'studySeen', type: 'boolean' },
      { key: 'studyTimesSeen', type: 'number' },
      { key: 'studyTimeMs', type: 'number' },
    ];
  }

  function entryMatchesTableSearch(entry, { query, fields = null, collection = null } = {}) {
    try {
      const q = String(query || '').trim();
      if (!q) return false;
      const compiled = compileTableSearchQuery(q);
      const accessor = buildEntrySearchAccessor(entry, { fields, collection });
      // Conditional debug logging to help diagnose empty-field matches
      const matched = matchesTableSearch(accessor, compiled, { fields: tableSearchFieldsMeta(fields, collection) });
      return matched;
    } catch (e) {
      return false;
    }
  }

  function filterEntriesAndIndicesByTableSearch(entries, indices, { query, fields = null, collection = null } = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
    const q = String(query || '').trim();
    const label = `collections.filterEntriesAndIndicesByTableSearch (${arr.length}) q=${q.length}`;
    return timed(label, () => {
      if (!q) return { entries: arr.slice(), indices: idx.slice() };
      const compiled = compileTableSearchQuery(q);
      if (!collection) {
        const filtered = filterRecordsAndIndicesByTableSearch(arr, idx, compiled, { fields });
        return { entries: filtered.records, indices: filtered.indices };
      }

      const outEntries = [];
      const outIdx = [];
      const fieldsMeta = tableSearchFieldsMeta(fields, collection);
      for (let i = 0; i < arr.length; i++) {
        const rec = arr[i];
        const accessor = buildEntrySearchAccessor(rec, { fields, collection });
        if (matchesTableSearch(accessor, compiled, { fields: fieldsMeta })) {
          outEntries.push(rec);
          outIdx.push(idx[i]);
        }
      }
      return { entries: outEntries, indices: outIdx };
    });
  }

  // ============================================================================
  // Entry Study Key Extraction
  // ============================================================================

  function getEntryStudyKey(entry) {
    try {
      const base = entry && typeof entry === 'object' ? entry.__baseStudyKey : null;
      if (typeof base === 'string' && base.trim()) return base.trim();
    } catch {}

    if (!entry || typeof entry !== 'object') return '';
    for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function getEntryRawStudyKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  // ============================================================================
  // Collection Expansion Integration
  // ============================================================================

  function getCollectionExpansionConfig(collectionOrKey) {
    const coll = (typeof collectionOrKey === 'string')
      ? (state.collections.find(c => c?.key === collectionOrKey) || null)
      : ((collectionOrKey && typeof collectionOrKey === 'object') ? collectionOrKey : null);

    if (!coll || !collectionUsesJapaneseExpansion(coll)) {
      return {
        type: null,
        supports: { i: false, na: false },
        iBaseItems: [],
        naBaseItems: [],
        iItems: [],
        naItems: [],
      };
    }
    return getJapaneseExpansionControlConfig(coll, { includeActions: true });
  }

  function getCollectionExpansionDeltas(entries, { iForms = [], naForms = [] } = {}) {
    return getJapaneseExpansionDeltas(entries, { iForms, naForms });
  }

  // ============================================================================
  // Collection View (with shuffle, expansion, filtering)
  // ============================================================================

  function normalizeStudyFilterStates(value) {
    const order = ['null', 'focus', 'learned'];
    const arr = Array.isArray(value)
      ? value
      : String(value || '').split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
    const out = [];
    const seen = new Set();

    const add = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (!s || seen.has(s)) return;
      if (s !== 'null' && s !== 'focus' && s !== 'learned') {
        throw new Error(`Invalid studyFilter state: ${s}. Allowed states: null, focus, learned`);
      }
      seen.add(s);
      out.push(s);
    };

    for (const raw of arr) {
      const t = String(raw || '').trim().toLowerCase();
      if (!t) continue;
      add(t);
    }

    return order.filter(s => out.includes(s));
  }

  function parseStudyFilterState(collState = {}) {
    const defaultStates = ['null', 'focus', 'learned'];
    let includeStates = defaultStates.slice();

    if (collState && typeof collState.studyFilter === 'string') {
      const raw = String(collState.studyFilter || '').trim();
      if (raw) {
        const parsed = normalizeStudyFilterStates(raw);
        includeStates = parsed.length ? parsed : defaultStates.slice();
      }
    } else {
      // legacy booleans
      const skipLearned = !!collState?.skipLearned;
      const focusOnly = !!collState?.focusOnly;
      if (focusOnly) includeStates = ['focus'];
      else if (skipLearned) includeStates = ['null', 'focus'];
    }

    const include = new Set(includeStates);
    const skipLearned = !(include.has('learned'));
    const focusOnly = includeStates.length === 1 && include.has('focus');
    return { includeStates, skipLearned, focusOnly };
  }

  function progressAdapterForCollection(coll) {
    const category = String(coll?.metadata?.category || '').trim();
    const isGrammar = category === 'japanese.grammar' || category.endsWith('.grammar') || category.includes('.grammar.');

    if (isGrammar) {
      return {
        kind: 'grammar',
        getKey: (entry) => {
          const p = entry && typeof entry === 'object' ? entry.pattern : '';
          return String(p || '').trim();
        },
        isLearned: (key) => !!(key && typeof grammarProgressManager?.isGrammarLearned === 'function' && grammarProgressManager.isGrammarLearned(key, { collectionKey: coll?.key })),
        isFocus: (key) => !!(key && typeof grammarProgressManager?.isGrammarFocus === 'function' && grammarProgressManager.isGrammarFocus(key, { collectionKey: coll?.key })),
      };
    }

    return {
      kind: 'kanji',
      getKey: (entry) => String(getEntryStudyKey(entry) || '').trim(),
      isLearned: (key) => !!(key && typeof progressManager?.isKanjiLearned === 'function' && progressManager.isKanjiLearned(key, { collectionKey: coll?.key })),
      isFocus: (key) => !!(key && typeof progressManager?.isKanjiFocus === 'function' && progressManager.isKanjiFocus(key, { collectionKey: coll?.key })),
    };
  }

  function applyStudyFilterToView(entries, indices, { includeStates = ['null', 'focus', 'learned'] } = {}, adapter) {
    const arr = Array.isArray(entries) ? entries : [];
    const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
    if (!arr.length) return { entries: [], indices: [] };
    const allowed = new Set(normalizeStudyFilterStates(includeStates));
    if (!allowed.size) return { entries: [], indices: [] };
    if (allowed.has('null') && allowed.has('focus') && allowed.has('learned')) {
      return { entries: arr.slice(), indices: idx.slice() };
    }
    const a = adapter || { getKey: (e) => String(getEntryStudyKey(e) || '').trim(), isLearned: () => false, isFocus: () => true };

    const outEntries = [];
    const outIdx = [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const key = a.getKey(e);
      let state = 'null';
      if (key) {
        if (a.isLearned(key)) state = 'learned';
        else if (a.isFocus(key)) state = 'focus';
      }
      if (!allowed.has(state)) continue;
      outEntries.push(e);
      outIdx.push(idx[i]);
    }
    return { entries: outEntries, indices: outIdx };
  }

  function getCollectionView(originalEntries, collState = {}, opts = { windowSize: 10, collection: null }) {
    const n = Array.isArray(originalEntries) ? originalEntries.length : 0;
    const baseIndices = [];
    const baseEntriesRaw = [];
    for (let i = 0; i < n; i++) {
      const e = originalEntries[i];
      if (!e) continue;
      baseIndices.push(i);
      baseEntriesRaw.push(e);
    }

    const iForms = collState ? (collState.expansion_i ?? collState.expansion_iAdj ?? collState.expansion_i_adjective ?? []) : [];
    const naForms = collState ? (collState.expansion_na ?? collState.expansion_naAdj ?? collState.expansion_na_adjective ?? []) : [];
    const collection = (opts?.collection && typeof opts.collection === 'object') ? opts.collection : null;
    const expanded = (collection && collectionUsesJapaneseExpansion(collection))
      ? expandJapaneseEntriesAndIndices(baseEntriesRaw, baseIndices, { iForms, naForms })
      : { entries: baseEntriesRaw.slice(), indices: baseIndices.slice() };
    const baseEntries = expanded.entries;
    const expandedIndices = expanded.indices;
    const m = baseEntries.length;
    const orderHashInt = (collState && typeof collState.order_hash_int === 'number') ? collState.order_hash_int : null;
    if (orderHashInt !== null && m > 0) {
      const perm = seededPermutation(m, orderHashInt);
      const shuffledEntries = perm.map(i => baseEntries[i]);
      const shuffledIndices = perm.map(i => expandedIndices[i]);
      return { entries: shuffledEntries, indices: shuffledIndices, isShuffled: true, order_hash_int: orderHashInt };
    }
    return { entries: baseEntries, indices: expandedIndices.slice(), isShuffled: false, order_hash_int: null };
  }

  // Like getCollectionView, but also applies per-collection filters that are stored
  // in collection state (studyFilter + heldTableSearch). This is the preferred API
  // for apps so they don't duplicate the same filtering logic.
  function getCollectionViewForCollection(collection, collState = {}, opts = { windowSize: 10 }) {
    const coll = (collection && typeof collection === 'object') ? collection : null;
    const baseEntries = Array.isArray(coll?.entries) ? coll.entries : (Array.isArray(opts?.entries) ? opts.entries : []);
    const stateObj = (collState && typeof collState === 'object') ? collState : {};

    const view = getCollectionView(baseEntries, stateObj, { ...opts, collection: coll });
    let nextEntries = Array.isArray(view.entries) ? view.entries.slice() : [];
    let nextIndices = Array.isArray(view.indices) ? view.indices.slice() : [];

    // Apply per-collection studyFilter (state set: null/focus/learned)
    const { includeStates, skipLearned, focusOnly } = parseStudyFilterState(stateObj);
    {
      const adapter = progressAdapterForCollection(coll);
      const filtered = applyStudyFilterToView(nextEntries, nextIndices, { includeStates }, adapter);
      nextEntries = filtered.entries;
      nextIndices = filtered.indices;
    }

    // Apply persisted held table-search filter (Data view "Hold Filter")
    try {
      const held = String(stateObj?.heldTableSearch || '').trim();
      if (held) {
        const fields = Array.isArray(coll?.metadata?.fields) ? coll.metadata.fields : null;
        const filtered = filterEntriesAndIndicesByTableSearch(nextEntries, nextIndices, { query: held, fields, collection: coll });
        nextEntries = filtered.entries;
        nextIndices = filtered.indices;
      }
    } catch {
      // ignore
    }

    return {
      ...view,
      entries: nextEntries,
      indices: nextIndices,
      includeStates,
      skipLearned,
      focusOnly,
    };
  }

  // Convenience: fetch the active collection, load its persisted state,
  // and return the fully-filtered view. Apps can call this directly.
  function getActiveCollectionView(opts = { windowSize: 10 }) {
    const coll = getActiveCollection();
    if (!coll) {
      return { collection: null, collState: {}, view: { entries: [], indices: [], isShuffled: false, order_hash_int: null, skipLearned: false, focusOnly: false } };
    }
    const collState = loadCollectionState(coll.key) || {};
    const view = getCollectionViewForCollection(coll, collState, opts);
    return { collection: coll, collState, view };
  }

  // Alias with the naming you described: returns just the filtered set/view.
  function getActiveCollectionFilteredSet(opts = { windowSize: 10 }) {
    return getActiveCollectionView(opts).view;
  }

  async function getCollectionEntriesWithRelated(collectionOrKey, opts = { sample: 2 }) {
    const sampleN = Math.max(0, Math.round(Number(opts?.sample || 2) || 0));
    let coll = null;
    try {
      if (!collectionOrKey) return [];
      if (typeof collectionOrKey === 'string') {
        coll = state.collections.find(c => c.key === collectionOrKey) || null;
        if (!coll) {
          // attempt to load it
          try { coll = await loadCollection(collectionOrKey); } catch (e) { coll = null; }
        }
      } else if (collectionOrKey && typeof collectionOrKey === 'object') {
        coll = collectionOrKey;
      }
      if (!coll || !coll.key) return [];

      const baseEntries = Array.isArray(coll.entries) ? coll.entries : [];
      const out = [];
      const relations = normalizeRelatedCollectionsConfig(coll?.metadata?.relatedCollections);
      for (const e of baseEntries) {
        const relatedCounts = getEntryRelatedCounts(e, coll);
        const relatedSamples = {};
        for (const rel of relations) {
          const arr = Array.isArray(e?.relatedCollections?.[rel.name]) ? e.relatedCollections[rel.name] : [];
          relatedSamples[rel.name] = sampleN > 0 ? arr.slice(0, sampleN) : [];
        }

        out.push({ ...e, /* related counts/samples are available via entry.relatedCollections */ });
      }
      return out;
    } catch (err) {
      return [];
    }
  }

  // ============================================================================
  // Collection Actions (state modification operations)
  // ============================================================================

  function serializeStudyFilter({ states = [], skipLearned = false, focusOnly = false } = {}) {
    const order = ['null', 'focus', 'learned'];
    let next = normalizeStudyFilterStates(states);
    if (!next.length) {
      if (focusOnly) next = ['focus'];
      else if (skipLearned) next = ['null', 'focus'];
      else next = order.slice();
    }
    return order.filter(v => next.includes(v)).join(',');
  }

  function shuffleCollection(collKey) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return null;
    const seed = (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues)
      ? (window.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)
      : (Math.floor(Math.random() * 0x100000000) >>> 0);

    saveCollectionState(coll.key, { order_hash_int: seed, isShuffled: true });
    emit();
    return seed;
  }

  function clearCollectionShuffle(collKey) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;
    saveCollectionState(coll.key, { order_hash_int: null, isShuffled: false });
    emit();
    return true;
  }

  function setStudyFilter(collKey, { states = [], skipLearned = false, focusOnly = false } = {}) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;
    saveCollectionState(coll.key, { studyFilter: serializeStudyFilter({ states, skipLearned: !!skipLearned, focusOnly: !!focusOnly }) });
    emit();
    return true;
  }

  function setHeldTableSearch(collKey, { hold = false, query = '' } = {}) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;
    const q = String(query || '').trim();
    // Persist only the held query. The system now always applies the held query
    // (no per-collection "hold" toggle is stored).
    saveCollectionState(coll.key, {
      heldTableSearch: q,
    });
    emit();
    return true;
  }

  function setCollectionExpansionForms(collKey, { iForms = [], naForms = [], iForm = '', naForm = '' } = {}) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;

    const normalizeList = (v, fallbackSingle) => {
      if (v === 'all') return 'all';
      if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
      const s = String(fallbackSingle || '').trim();
      if (!s) return [];
      return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
    };

    const i = normalizeList(iForms, iForm);
    const na = normalizeList(naForms, naForm);
    saveCollectionState(coll.key, {
      expansion_i: i,
      expansion_na: na,
    });
    emit();
    return true;
  }

  function clearLearnedForCollection(collKey) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;
    const entries = Array.isArray(coll.entries) ? coll.entries : [];
    const adapter = progressAdapterForCollection(coll);
    const values = entries.map((e) => String(adapter?.getKey?.(e) || '').trim()).filter(Boolean);
    if (adapter?.kind === 'grammar') {
      if (typeof grammarProgressManager?.clearLearnedGrammarForKeys === 'function') {
        grammarProgressManager.clearLearnedGrammarForKeys(values, { collectionKey: coll.key });
        return true;
      }
    } else if (typeof progressManager?.clearLearnedKanjiForValues === 'function') {
      progressManager.clearLearnedKanjiForValues(values, { collectionKey: coll.key });
      return true;
    }
    if (typeof progressManager?.clearLearnedKanji === 'function') {
      progressManager.clearLearnedKanji({ collectionKey: coll.key });
      return true;
    }
    return false;
  }

  return {
    isCollectionSetVirtualKey,
    parseCollectionSetVirtualKey,
    loadSeedCollections,
    getCollections,
    getAvailableCollections,
    getActiveCollectionId,
    getActiveCollection,
    setActiveCollectionId,
    syncCollectionFromURL,
    listCollectionDir,
    loadCollection,
    prefetchCollectionsInFolder,
    loadCollectionState,
    saveCollectionState,
    deleteCollectionStateKeys,
    getInheritedFolderMetadata,
    collectionSetsDirPath,
    getCollectionExpansionConfig,

    // Debug/read-only runtime inspection helpers (Entity Explorer)
    debugListRuntimeMaps,
    debugGetRuntimeMapDump,

    // Collection view utilities (filtering, expansion, shuffle)
    getCollectionViewForCollection,
    getActiveCollectionView,
    getActiveCollectionFilteredSet,
    getEntryStudyKey,
    entryMatchesTableSearch,
    filterEntriesAndIndicesByTableSearch,
    getCollectionExpansionDeltas,
    getCollectionEntriesWithRelated,

    // Collection actions (state modifications)
    shuffleCollection,
    clearCollectionShuffle,
    setStudyFilter,
    setHeldTableSearch,
    setCollectionExpansionForms,
    clearLearnedForCollection,
  };
}
