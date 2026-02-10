import { basename, dirname, normalizeFolderPath, titleFromFilename } from '../utils/helpers.js';
import { buildHashRoute, parseHashRoute } from '../utils/helpers.js';
import { timed } from '../utils/timing.js';

export function createCollectionsManager({ state, uiState, persistence, emitter, progressManager, grammarProgressManager = null }) {
  // Folder metadata helpers/storage used for lazy loads
  let folderMetadataMap = null;
  const metadataCache = {};
  const pendingFolderMetadataLoads = new Map();

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
  // Sentences cache: baseFolder -> Array of sentence objects collected from loaded collection files' top-level `sentences` arrays
  const sentencesCache = new Map();
  // Sentences ref index: baseFolder -> Map(refKey -> Array of sentence objects)
  const sentencesRefIndex = new Map();

  // Dedup helpers for sentences/examples.
  // - Per top-folder, track which sentence records were already indexed from a specific source file.
  // - When associating sentences to entries, avoid repeated pushes across rebuilds.
  const sentenceSourceIdBySentence = new WeakMap();
  const seenSentenceSourceIdsByTop = new Map(); // top -> Set(sourceId)
  const seenRefSentenceSourceIdsByTop = new Map(); // top -> Map(refKey -> Set(sourceId))
  const entrySentenceKeys = new WeakMap(); // entry -> Set(uniqueKey)

  // Word↔sentence association should be built once per top-folder, after relevant collections load.
  // This prevents incremental "rebuild" churn during background prefetch.
  const wordSentenceIndexFinalizedByTop = new Map(); // top -> boolean
  const wordSentenceIndexFinalizeInFlightByTop = new Map(); // top -> Promise

  function getOrCreateSet(map, k) {
    const key = String(k ?? '');
    const existing = map.get(key);
    if (existing) return existing;
    const created = new Set();
    map.set(key, created);
    return created;
  }

  function sentenceUniqueKey(ex) {
    if (!ex || typeof ex !== 'object') return '';
    const sid = sentenceSourceIdBySentence.get(ex);
    if (sid) return String(sid);
    // Fallback: content-ish key. This can dedupe identical sentences even across different files,
    // but it's only used when we don't know the source.
    const ja = (typeof ex.ja === 'string') ? ex.ja.trim() : '';
    const en = (typeof ex.en === 'string') ? ex.en.trim() : '';
    if (ja || en) return `${ja}\n${en}`;
    return '';
  }

  function ensureEntrySentenceKeySet(entry) {
    if (!entry || typeof entry !== 'object') return null;
    let set = entrySentenceKeys.get(entry);
    if (set) return set;
    set = new Set();
    try {
      if (Array.isArray(entry.sentences)) {
        for (const ex of entry.sentences) {
          const k = sentenceUniqueKey(ex);
          if (k) set.add(k);
        }
      }
    } catch {
      // ignore
    }
    entrySentenceKeys.set(entry, set);
    return set;
  }

  function attachSentenceToEntry(entry, ex) {
    if (!entry || typeof entry !== 'object') return;
    if (!ex || typeof ex !== 'object') return;
    if (!Array.isArray(entry.sentences)) entry.sentences = [];
    const set = ensureEntrySentenceKeySet(entry);
    const k = sentenceUniqueKey(ex);
    if (set && k) {
      if (set.has(k)) return;
      set.add(k);
    } else {
      // no key, last-ditch: avoid pushing same object twice
      if (entry.sentences.includes(ex)) return;
    }
    entry.sentences.push(ex);
  }

  function hasAnyCollectionUnder(prefix) {
    const p = String(prefix || '').trim();
    if (!p) return false;
    const full = p.endsWith('/') ? p : `${p}/`;
    return (state._availableCollectionPaths || []).some(k => typeof k === 'string' && k.startsWith(full));
  }

  async function ensureWordSentenceIndexBuiltForTop(top, { force = false } = {}) {
    const t = String(top || '').trim();
    if (!t) return;
    if (!force && wordSentenceIndexFinalizedByTop.get(t) === true) return;
    if (!force && wordSentenceIndexFinalizeInFlightByTop.has(t)) {
      return wordSentenceIndexFinalizeInFlightByTop.get(t);
    }

    return timed(`collections.ensureWordSentenceIndexBuiltForTop ${t}`, async () => {
      const p = (async () => {
        // Load relevant data for the top folder.
        // Japanese is the main case: words + sentences + examples.
        try {
          if (t === 'japanese') {
            if (hasAnyCollectionUnder('japanese/words')) await ensureCollectionsLoadedInFolder('japanese/words', { excludeCollectionSets: true });
            if (hasAnyCollectionUnder('japanese/sentences')) await ensureCollectionsLoadedInFolder('japanese/sentences', { excludeCollectionSets: true });
            if (hasAnyCollectionUnder('japanese/examples')) await ensureCollectionsLoadedInFolder('japanese/examples', { excludeCollectionSets: true });
          } else {
            await ensureCollectionsLoadedInFolder(t, { excludeCollectionSets: true });
          }
        } catch {
          // ignore load failures; we'll still try to associate what we have
        }

        // Rebuild the entry index for this top folder once, and attach sentences via sentencesRefIndex.
        try {
          folderEntryIndexCache.delete(t);
          buildFolderEntryIndex(t);
        } catch {
          // ignore
        }
        wordSentenceIndexFinalizedByTop.set(t, true);
        emit();
      })();

      wordSentenceIndexFinalizeInFlightByTop.set(t, p);
      try {
        return await p;
      } finally {
        wordSentenceIndexFinalizeInFlightByTop.delete(t);
      }
    });
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
          sentencesCount: Array.isArray(entry.sentences) ? entry.sentences.length : 0,
        } : null,
      });
      i++;
      if (i >= lim) break;
    }
    return out;
  }

  function debugSerializeSentence(ex) {
    if (!ex || typeof ex !== 'object') return null;
    return {
      ja: ex.ja ?? null,
      en: ex.en ?? null,
      chunksCount: Array.isArray(ex.chunks) ? ex.chunks.length : 0,
      notes: ex.notes ?? null,
    };
  }

  function debugSerializeSentencesRefIndex(refMap, { limit = DEBUG_PREVIEW_LIMIT, includeSample = false } = {}) {
    const lim = debugPreviewLimit(limit);
    const out = [];
    if (!(refMap instanceof Map)) return out;
    let i = 0;
    for (const [ref, arr] of refMap.entries()) {
      const row = { ref: String(ref || ''), count: Array.isArray(arr) ? arr.length : 0 };
      if (includeSample && Array.isArray(arr) && arr.length) {
        row.sample = debugSerializeSentence(arr[0]);
      }
      out.push(row);
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
    items.push({ id: 'sentencesCache', label: 'sentencesCache' });
    items.push({ id: 'sentencesRefIndex', label: 'sentencesRefIndex' });
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

    if (id === 'sentencesCache') {
      const out = [];
      for (const [top, arr] of sentencesCache.entries()) {
        out.push({ top: String(top || ''), count: Array.isArray(arr) ? arr.length : 0 });
        if (out.length >= limit) break;
      }
      return out;
    }
    if (id.startsWith('sentencesCache:')) {
      const top = id.slice('sentencesCache:'.length);
      const arr = sentencesCache.get(top) || [];
      return (Array.isArray(arr) ? arr : []).slice(0, limit).map(debugSerializeSentence);
    }

    if (id === 'sentencesRefIndex') {
      const out = [];
      for (const [top, refMap] of sentencesRefIndex.entries()) {
        out.push({ top: String(top || ''), refCount: (refMap instanceof Map) ? refMap.size : 0 });
        if (out.length >= limit) break;
      }
      return out;
    }
    if (id.startsWith('sentencesRefIndex:')) {
      const top = id.slice('sentencesRefIndex:'.length);
      const refMap = sentencesRefIndex.get(top);
      return debugSerializeSentencesRefIndex(refMap, { limit, includeSample: !!opts?.includeSample });
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
    const folder = normalizeFolderPath(baseFolder);
    if (collectionSetsCache.has(folder)) return collectionSetsCache.get(folder);
    if (pendingCollectionSetsLoads.has(folder)) return pendingCollectionSetsLoads.get(folder);

    const p = timed(`collections.loadCollectionSetsForFolder ${folder || '(root)'}`, async () => {
      if (!hasCollectionSetsFile(folder)) {
        collectionSetsCache.set(folder, null);
        return null;
      }
      const rel = folder ? `${folder}/${COLLECTION_SETS_FILE}` : COLLECTION_SETS_FILE;
      const url = `./collections/${rel}`;
      let res;
      try {
        res = await fetch(url);
      } catch (err) {
        throw new Error(`Failed to fetch collection sets ${rel}: ${err.message}`);
      }
      if (!res.ok) {
        collectionSetsCache.set(folder, null);
        return null;
      }

      let data;
      try {
        const txt = await res.text();
        if (!txt) throw new Error('empty response');
        data = JSON.parse(txt);
      } catch (err) {
        throw new Error(`Invalid JSON in collection sets ${rel}: ${err.message}`);
      }

      const sets = Array.isArray(data?.sets) ? data.sets : [];
      const normalized = {
        name: data?.name || null,
        version: typeof data?.version === 'number' ? data.version : null,
        description: data?.description || null,
        sets: sets
          .filter(s => s && typeof s === 'object')
          .map(s => ({
            id: String(s.id || '').trim(),
            label: s.label || null,
            description: s.description || null,
            kanjiFilter: Array.isArray(s.kanjiFilter) ? s.kanjiFilter.slice() : null,
            kanji: Array.isArray(s.kanji) ? s.kanji.slice() : []
          }))
          .filter(s => s.id.length > 0)
      };

      collectionSetsCache.set(folder, normalized);
      return normalized;
    });

    pendingCollectionSetsLoads.set(folder, p);
    try {
      return await p;
    } finally {
      pendingCollectionSetsLoads.delete(folder);
    }
  }

  async function ensureCollectionsLoadedInFolder(baseFolder, opts = { excludeCollectionSets: true }) {
    const folder = normalizeFolderPath(baseFolder);
    const prefix = folder ? `${folder}/` : '';
    const excludeCollectionSets = opts?.excludeCollectionSets !== false;

    const keys = state._availableCollectionPaths
      .filter(k => (prefix ? k.startsWith(prefix) : true))
      .filter(k => {
        if (!excludeCollectionSets) return true;
        return basename(k) !== COLLECTION_SETS_FILE;
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
    if (Array.isArray(entry.sentences) && entry.sentences.length) {
      let hasJa = false;
      let hasEn = false;
      for (const ex of entry.sentences) {
        if (!hasJa && typeof ex?.ja === 'string' && ex.ja.trim()) hasJa = true;
        if (!hasEn && typeof ex?.en === 'string' && ex.en.trim()) hasEn = true;
        if (hasJa && hasEn) break;
      }
      if (hasJa) score += 1;
      if (hasEn) score += 1;
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

    try {
      const refMap = sentencesRefIndex.get(folder) || new Map();
      for (const [ref, arr] of refMap.entries()) {
        if (!ref || !Array.isArray(arr) || arr.length === 0) continue;
        const entry = index.get(ref);
        if (!entry || typeof entry !== 'object') continue;
        for (const ex of arr) {
          if (!ex || typeof ex !== 'object') continue;
          attachSentenceToEntry(entry, ex);
        }
      }
    } catch {
      // ignore
    }

      return index;
    });
  }

  async function resolveVirtualSetRecord(record, baseFolder, setObj) {
    const folder = normalizeFolderPath(baseFolder);
    return timed(`collections.resolveVirtualSetRecord ${folder || '(root)'}`, async () => {
      await ensureCollectionsLoadedInFolder(folder, { excludeCollectionSets: true });

      folderEntryIndexCache.delete(folder);
      const index = buildFolderEntryIndex(folder);

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
            const rec = progressMap[entryKey];
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
    const folder = normalizeFolderPath(baseFolder);
    return collectionSetsCache.has(folder) ? collectionSetsCache.get(folder) : undefined;
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
      // Exact match first
      let rel = folderMetadataMapParam.get(folder);

      // If no exact mapping, try to find a mapping that points to
      // a metadata file located under this folder (e.g. an index that
      // had "japanese": "words/_metadata.json" -> stored as
      // "japanese/words/_metadata.json")
      if (!rel) {
        const want1 = `${folder}/_metadata.json`;
        const want2 = `${folder}/metadata.json`;
        for (const [, v] of folderMetadataMapParam.entries()) {
          if (v === want1 || v === want2) {
            rel = v;
            break;
          }
        }
      }

      if (!rel) return null;

      const metadataUrl = `./collections/${rel}`;
      try {
        const res = await fetch(metadataUrl);
        if (!res.ok) return null;
        const text = await res.text();
        if (!text) return null;
        return JSON.parse(text);
      } catch (err) {
        console.warn(`Failed to load folder metadata at ${metadataUrl}: ${err.message}`);
        return null;
      }
    }

    const base = folder ? `./collections/${folder}` : './collections';
    const candidates = [`${base}/_metadata.json`, `${base}/metadata.json`];

    for (const metadataUrl of candidates) {
      let res;
      try {
        res = await fetch(metadataUrl);
      } catch {
        continue;
      }
      if (!res.ok) continue;
      try {
        const text = await res.text();
        if (!text) continue;
        return JSON.parse(text);
      } catch (err) {
        console.warn(`Failed to parse folder metadata at ${metadataUrl}: ${err.message}`);
        return null;
      }
    }

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
      const baseFolder = dirname(folder);
      const parentDir = baseFolder;
      const cs = collectionSetsCache.get(baseFolder) || null;
      const files = Array.isArray(cs?.sets)
        ? cs.sets
            .map(s => ({
              filename: s.id,
              key: `${collectionSetsDirPath(baseFolder)}/${s.id}`,
              label: s.label || titleFromFilename(s.id)
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : [];
      return { dir: folder, parentDir, folders: [], files };
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
      const indexRes = await fetch('./collections/index.json');
      if (!indexRes.ok) throw new Error(`Failed to load collections index (status ${indexRes.status})`);
      let index;
      try {
        const indexText = await indexRes.text();
        if (!indexText) throw new Error('collections/index.json is empty');
        index = JSON.parse(indexText);
      } catch (err) {
        throw new Error(`Failed to parse collections/index.json: ${err.message}`);
      }

      const rawCollections = Array.isArray(index?.collections) ? index.collections : [];
      const paths = rawCollections.map(c => (typeof c === 'string' ? c : (c.path || ''))).filter(Boolean);

      folderMetadataMap = buildFolderMetadataMap(index?.folderMetadata);
      state.collectionTree = buildCollectionTreeFromPaths(paths);
      state._availableCollectionPaths = paths.slice();

      availableCollectionsMap = new Map();
      for (const raw of rawCollections) {
        if (typeof raw === 'string') {
          availableCollectionsMap.set(raw, { path: raw, name: null, description: null, entries: null });
        } else if (raw && typeof raw.path === 'string') {
          availableCollectionsMap.set(raw.path, {
            path: raw.path,
            name: raw.name || null,
            description: raw.description || null,
            entries: (typeof raw.entries === 'number') ? raw.entries : null
          });
        }
      }

      emit();
      // Prefetch all collections in background to avoid lazy-loading surprises.
      // Run async/non-blocking so UI startup isn't delayed.
      try {
        Promise.resolve().then(() => {
          try {
            prefetchCollectionsInFolder('');
            // Also prefetch per-folder collection sets (/_collectionSets.json)
            // so UI won't lazily fetch them later when browsing folders.
            try {
              const tops = new Set((state._availableCollectionPaths || []).map(p => {
                const parts = String(p || '').split('/').filter(Boolean);
                return parts.length ? parts[0] : '';
              }).filter(Boolean));
              for (const t of tops) {
                // fire-and-forget
                loadCollectionSetsForFolder(t).catch(() => null);
              }
            } catch (e) {
              // ignore
            }
          } catch (e) {
            // ignore
          }
        });
      } catch (e) {
        // ignore
      }

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
        const { baseFolder, setId } = virtual;
        const cs = await loadCollectionSetsForFolder(baseFolder);
        if (!cs || !Array.isArray(cs.sets)) {
          throw new Error(`Collection sets not available for folder: ${baseFolder || '(root)'}`);
        }
        const set = cs.sets.find(s => s.id === setId);
        if (!set) {
          throw new Error(`Collection set not found: ${setId}`);
        }

        let entries = [];
        if (Array.isArray(set.kanjiFilter) && set.kanjiFilter.length) {
          entries = [];
        } else {
          entries = (Array.isArray(set.kanji) ? set.kanji : []).map(v => {
            const term = String(v || '').trim();
            return { kanji: term, text: term };
          }).filter(e => e.kanji);
        }

        const record = {
          key,
          entries,
          metadata: {
            name: set.label || titleFromFilename(set.id),
            description: set.description || cs.description || null,
            fields: [ { key: 'kanji', label: 'Kanji' } ],
            category: (baseFolder || '').split('/')[0] || baseFolder || ''
          }
        };

        state.collections.push(record);
        state.collections.sort((a, b) => {
          const ai0 = state._availableCollectionPaths.indexOf(a.key);
          const bi0 = state._availableCollectionPaths.indexOf(b.key);
          const ai = ai0 === -1 ? Number.MAX_SAFE_INTEGER : ai0;
          const bi = bi0 === -1 ? Number.MAX_SAFE_INTEGER : bi0;
          return ai - bi;
        });

        Promise.resolve()
          .then(() => resolveVirtualSetRecord(record, baseFolder, set))
          .catch((err) => console.warn('[Collections] Failed to resolve virtual set entries:', err?.message || err));

        if (opts?.notify !== false) emit();
        return record;
      }

      if (!state._availableCollectionPaths.includes(key)) {
        throw new Error(`Collection not found in index: ${key}`);
      }

      const url = `./collections/${key}`;
      let res;
      try {
        res = await fetch(url);
      } catch (err) {
        throw new Error(`Failed to fetch collection ${key}: ${err.message}`);
      }
      if (!res.ok) {
        throw new Error(`Failed to load collection ${key} (status ${res.status})`);
      }

      let data;
      try {
        const txt = await res.text();
        if (!txt) throw new Error('empty response');
        data = JSON.parse(txt);
      } catch (err) {
        throw new Error(`Invalid JSON in collection ${key}: ${err.message}`);
      }

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

      try {
        // Support sentence collections that place sentences under `sentences`
        // or legacy `entries` (common for example files located under */examples/*).
        let sentences = Array.isArray(data.sentences) ? data.sentences : null;
        if (!sentences && Array.isArray(data.entries) && String(key || '').includes('/examples/')) {
          sentences = data.entries.slice();
          // Clear data.entries so these sentence files are not treated as regular collections
          data.entries = [];
        }
        if (sentences) {
          const top = topFolderOfKey(key) || '';
          // Track which sentences have already been indexed for this top-folder.
          // Use sourceId = `${collectionKey}#${index}` so re-loading the same file doesn't duplicate.
          const seenSourceIds = getOrCreateSet(seenSentenceSourceIdsByTop, top);

          const prev = sentencesCache.get(top) || [];
          const append = [];
          for (let i = 0; i < sentences.length; i++) {
            const ex = sentences[i];
            if (!ex || typeof ex !== 'object') continue;
            const sourceId = `${String(key)}#${i}`;
            sentenceSourceIdBySentence.set(ex, sourceId);
            if (seenSourceIds.has(sourceId)) continue;
            seenSourceIds.add(sourceId);
            append.push(ex);
          }
          if (append.length) sentencesCache.set(top, prev.concat(append));
          // Update sentencesRefIndex for quick lookup by ref key
          try {
            let refMap = sentencesRefIndex.get(top) || new Map();
            const refSeenByKey = (seenRefSentenceSourceIdsByTop.get(top) instanceof Map)
              ? seenRefSentenceSourceIdsByTop.get(top)
              : new Map();
            for (const ex of sentences) {
              if (!ex || typeof ex !== 'object') continue;
              if (!Array.isArray(ex.chunks)) continue;
              const sourceId = sentenceSourceIdBySentence.get(ex) || '';
              for (const ch of ex.chunks) {
                if (!ch || typeof ch !== 'object') continue;
                if (!Array.isArray(ch.refs)) continue;
                for (const r of ch.refs) {
                  if (r == null) continue;
                  const keyStr = String(r || '').trim();
                  if (!keyStr) continue;

                  if (sourceId) {
                    let seenSet = refSeenByKey.get(keyStr);
                    if (!seenSet) {
                      seenSet = new Set();
                      refSeenByKey.set(keyStr, seenSet);
                    }
                    if (seenSet.has(sourceId)) continue;
                    seenSet.add(sourceId);
                  }

                  const arr = refMap.get(keyStr) || [];
                  arr.push(ex);
                  refMap.set(keyStr, arr);
                }
              }
            }
            sentencesRefIndex.set(top, refMap);
            seenRefSentenceSourceIdsByTop.set(top, refSeenByKey);
          } catch (e) {
            // ignore
          }

          if (Array.isArray(data.entries) && data.entries.length) {
            for (const ex of sentences) {
              if (!ex || typeof ex !== 'object') continue;
              // Collect refs from chunks in the sentence
              const refs = [];
              if (Array.isArray(ex.chunks)) {
                for (const ch of ex.chunks) {
                  if (!ch || typeof ch !== 'object') continue;
                  if (Array.isArray(ch.refs)) {
                    for (const r of ch.refs) {
                      if (r == null) continue;
                      const s = String(r || '').trim();
                      if (s) refs.push(s);
                    }
                  }
                }
              }
              for (const rawKey of refs) {
                const keyStr = String(rawKey || '').trim();
                if (!keyStr) continue;
                const entry = data.entries.find(e => e && String(e.kanji || '').trim() === keyStr);
                if (!entry) continue;
                attachSentenceToEntry(entry, ex);
              }
            }
          }
        }
      } catch {
        // ignore
      }

      const record = { ...data, key };
      state.collections.push(record);

      try {
        const top = topFolderOfKey(key);
        if (top) folderEntryIndexCache.delete(top);
      } catch {
        // ignore
      }

      state.collections.sort((a, b) => {
        const ai0 = state._availableCollectionPaths.indexOf(a.key);
        const bi0 = state._availableCollectionPaths.indexOf(b.key);
        const ai = ai0 === -1 ? Number.MAX_SAFE_INTEGER : ai0;
        const bi = bi0 === -1 ? Number.MAX_SAFE_INTEGER : bi0;
        return ai - bi;
      });

      if (opts.notify !== false) emit();

      // Kick off a one-time association build for this top folder.
      // Do this in the background so lazy loads don't block UI.
      try {
        const top = topFolderOfKey(key) || '';
        if (top && wordSentenceIndexFinalizedByTop.get(top) !== true) {
          Promise.resolve().then(() => ensureWordSentenceIndexBuiltForTop(top).catch(() => null));
        }
      } catch {
        // ignore
      }
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
    const folder = normalizeFolderPath(baseFolder);
    const prefix = folder ? `${folder}/` : '';
    const excludeCollectionSets = prefetchOpts.excludeCollectionSets !== false;
    const shouldNotify = prefetchOpts.notify === true;
    const keys = state._availableCollectionPaths
      .filter(k => (prefix ? k.startsWith(prefix) : true))
      .filter(k => {
        if (!excludeCollectionSets) return true;
        return basename(k) !== COLLECTION_SETS_FILE;
      });

    Promise.resolve().then(async () => {
      const loads = [];
      for (const k of keys) {
        if (!k) continue;
        if (state.collections.some(c => c.key === k)) continue;
        if (pendingLoads.has(k)) continue;
        loads.push(loadCollectionInternal(k, { notify: false }).catch(() => null));
      }
      if (loads.length) {
        await Promise.all(loads);
        if (shouldNotify) emit();
      }
    });
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
          console.warn(`[Collections] Failed to load collection ${nextId}: ${err.message}`);
          return;
        }
      }
    }

    // Ensure word↔sentence association for this top folder is built.
    try {
      const top = topFolderOfKey(nextId) || '';
      if (top) {
        Promise.resolve().then(() => ensureWordSentenceIndexBuiltForTop(top).catch(() => null));
      }
    } catch {
      // ignore
    }

    if (!same) state.activeCollectionId = nextId;

    try {
      syncHashCollectionParam(nextId);
    } catch {
      // ignore
    }

    try {
      uiState.shell = uiState.shell || {};
      uiState.shell.activeCollectionId = state.activeCollectionId;
      // Also persist active collection path and base entries count for shell display
      try {
        const activeColl = state.collections.find(c => c.key === state.activeCollectionId) || null;
        uiState.shell.activeCollectionPath = activeColl?.key || null;
        uiState.shell.activeCollectionEntriesCount = Array.isArray(activeColl?.entries) ? activeColl.entries.length : 0;
      } catch (e) {
        // ignore
      }
      if (location.hash) {
        uiState.shell.lastRoute = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
      }
      persistence.markDirty({ shell: true });
      persistence.scheduleFlush();
    } catch {
      // ignore
    }

    if (!same) emit();
  }

  function syncCollectionFromURL(route) {
    const collectionId = route.query.get('collection');
    if (collectionId && collectionId !== state.activeCollectionId) {
      setActiveCollectionId(collectionId);
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

  function makeTableSearchRegex(query) {
    const s = String(query || '');
    if (!s.trim()) return null;
    let pat = s;
    if (!pat.includes('%')) pat = `%${pat}%`;
    pat = pat.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
    pat = pat.replace(/%/g, '.*');
    try {
      return new RegExp(pat, 'i');
    } catch {
      return null;
    }
  }

  // parse optional field-specific query syntaxes supported by the table UI.
  // Supported forms: '{{field}:term}' and '{field:term}'
  function parseFieldQuery(q) {
    const s = String(q || '').trim();
    if (!s) return { field: null, term: '' };
    const m1 = s.match(/^\{\{\s*([^}\s]+)\s*\}\s*:\s*(.*)\}$/);
    if (m1) {
      const field = String(m1[1] || '').trim();
      let term = String(m1[2] || '').trim();
      if (term === '') term = '%';
      return { field, term };
    }
    const m2 = s.match(/^\{\s*([^:\s}]+)\s*:\s*(.*)\}$/);
    if (m2) {
      const field = String(m2[1] || '').trim();
      let term = String(m2[2] || '').trim();
      if (term === '') term = '%';
      return { field, term };
    }
    return { field: null, term: s };
  }

  function fieldKeyListFromMetadataFields(fields) {
    if (!Array.isArray(fields)) return [];
    return fields
      .map(f => (f && typeof f === 'object' ? f.key : f))
      .map(k => String(k || '').trim())
      .filter(Boolean);
  }

  function shallowEntryValueStrings(entry, fieldKeys) {
    if (!entry || typeof entry !== 'object') return [];
    const out = [];

    const pushVal = (v) => {
      if (v == null) return;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out.push(String(v));
        return;
      }
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item != null && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
            out.push(String(item));
          }
        }
      }
    };

    if (Array.isArray(fieldKeys) && fieldKeys.length) {
      for (const k of fieldKeys) pushVal(entry[k]);
      return out;
    }

    for (const v of Object.values(entry)) pushVal(v);
    return out;
  }

  function entryMatchesTableSearch(entry, { query, regex = null, fields = null } = {}) {
    try {
      // New matching semantics (compatible with table component):
      // - `;` splits AND-parts
      // - `{field:...}` restricts to a single field; inside, `|` separates OR alternatives
      // - `%` acts as wildcard (converted to regex); no automatic wrapping
      // - Numeric comparisons allowed inside field: <=, >=, <, >, = and can be chained
      const q = String(query || '').trim();
      if (!q) return false;

      function escapeRegex(s) {
        return String(s || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      }

      function buildRegexFromWildcard(term) {
        const esc = escapeRegex(term).replace(/%/g, '.*');
        return new RegExp(`^${esc}$`, 'i');
      }

      function isNumericType(t) {
        if (!t && t !== 0) return false;
        const s = String(t || '').toLowerCase();
        return /int|float|number|numeric|double/.test(s);
      }

      function evalComparators(valueNum, comps) {
        for (const c of comps) {
          const v = c.val;
          switch (c.op) {
            case '<': if (!(valueNum < v)) return false; break;
            case '<=': if (!(valueNum <= v)) return false; break;
            case '>': if (!(valueNum > v)) return false; break;
            case '>=': if (!(valueNum >= v)) return false; break;
            case '=': if (!(valueNum === v)) return false; break;
            default: return false;
          }
        }
        return true;
      }

      const parts = q.split(';').map(s => String(s || '').trim()).filter(Boolean);
      if (!parts.length) return false;

      const fieldKeys = fieldKeyListFromMetadataFields(fields);

      for (const part of parts) {
        const parsed = parseFieldQuery(part);
        const term = parsed.term ?? '';
        if (!term) continue;

        // detect numeric comparators in term: sequence like <=23 or >3
        const compRe = /([<>]=?|=)\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
        const comps = [];
        let m;
        while ((m = compRe.exec(term)) !== null) {
          comps.push({ op: m[1], val: Number(m[2]) });
        }

        if (parsed.field) {
          const f = String(parsed.field || '').trim();
          if (!f) return false;
          if (!Object.prototype.hasOwnProperty.call(entry, f)) return false;
          const cellVal = entry[f];

          if (comps.length) {
            // numeric comparators only allowed when metadata indicates numeric type
            const metaField = (Array.isArray(fields) ? fields.find(x => String((x && x.key) || '') === f) : null);
            const metaType = metaField ? (metaField.type ?? (metaField.schema && metaField.schema.type) ?? null) : null;
            if (!isNumericType(metaType)) return false;
            const n = Number(cellVal);
            if (Number.isNaN(n)) return false;
            if (!evalComparators(n, comps)) return false;
            continue;
          }

          const alts = term.split('|').map(s => String(s || '').trim()).filter(Boolean);
          let anyAltMatch = false;
          for (const alt of alts) {
            if (alt.includes('%')) {
              const rx = buildRegexFromWildcard(alt);
              if (rx.test(String(cellVal ?? ''))) { anyAltMatch = true; break; }
            } else {
              if (String(cellVal ?? '').trim().toLowerCase() === alt.toLowerCase()) { anyAltMatch = true; break; }
            }
          }
          if (!anyAltMatch) return false;
          continue;
        } else {
          // global: comparators not allowed
          if (comps.length) return false;
          const alts = term.split('|').map(s => String(s || '').trim()).filter(Boolean);
          let anyAltMatch = false;
          let values = shallowEntryValueStrings(entry, fieldKeys);
          for (const alt of alts) {
            for (const v of values) {
              if (alt.includes('%')) {
                const rx = buildRegexFromWildcard(alt);
                if (rx.test(String(v ?? ''))) { anyAltMatch = true; break; }
              } else {
                if (String(v ?? '').trim().toLowerCase() === alt.toLowerCase()) { anyAltMatch = true; break; }
              }
            }
            if (anyAltMatch) break;
          }
          // (no fallback) only consider metadata-specified fields for global matches
          if (!anyAltMatch) return false;
          continue;
        }
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  function filterEntriesAndIndicesByTableSearch(entries, indices, { query, fields = null } = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
    const q = String(query || '').trim();
    const label = `collections.filterEntriesAndIndicesByTableSearch (${arr.length}) q=${q.length}`;
    return timed(label, () => {
      if (!q) return { entries: arr.slice(), indices: idx.slice() };
      const outEntries = [];
      const outIdx = [];
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (entryMatchesTableSearch(e, { query: q, fields })) {
          outEntries.push(e);
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
  // Adjective Form Expansion
  // ============================================================================

  function normalizeType(v) {
    return String(v || '').trim().toLowerCase();
  }

  function normalizeExpansionForms(v) {
    if (Array.isArray(v)) {
      return v.map(s => String(s || '').trim()).filter(Boolean);
    }
    const s = String(v || '').trim();
    if (!s) return [];
    return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
  }

  function uniqueInOrder(values) {
    const out = [];
    const seen = new Set();
    for (const v of (Array.isArray(values) ? values : [])) {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function expandJapaneseAdjectiveEntry(entry, { kind = '', form = '', baseStudyKey = '' } = {}) {
    if (!entry || typeof entry !== 'object') return entry;
    const typeRaw = String(entry.type || '').trim();
    const type = normalizeType(typeRaw);
    const isI = kind === 'i';
    const isNa = kind === 'na';

    if (!form) return entry;

    const next = { ...entry };
    if (baseStudyKey) next.__baseStudyKey = baseStudyKey;

    const surfaceKeys = ['kanji', 'character', 'text', 'word'];
    const readingKeys = ['reading', 'kana'];

    const inflect = (s) => {
      if (isI) return inflectIAdjective(s, form);
      if (isNa) return inflectNaAdjective(s, form);
      return String(s || '');
    };

    for (const k of surfaceKeys) {
      if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
    }
    for (const k of readingKeys) {
      if (typeof next[k] === 'string' && next[k].trim()) next[k] = inflect(next[k]);
    }

    const baseType = typeRaw || (isI ? 'i-adjective' : (isNa ? 'na-adjective' : ''));
    next.type = baseType ? `${baseType}::${form}` : `::${form}`;
    return next;
  }

  function inflectIAdjective(s, form) {
    const str = String(s || '').trim();
    if (!str) return str;
    if (!str.endsWith('い')) return str;
    const stem = str.slice(0, -1);
    switch (form) {
      case 'plain': return str;
      case 'negative': return `${stem}くない`;
      case 'past': return `${stem}かった`;
      case 'pastNegative': return `${stem}くなかった`;
      case 'te': return `${stem}くて`;
      case 'adverb': return `${stem}く`;
      default: return str;
    }
  }

  function inflectNaAdjective(s, form) {
    const str = String(s || '').trim();
    if (!str) return str;
    switch (form) {
      case 'plain': return `${str}だ`;
      case 'negative': return `${str}じゃない`;
      case 'past': return `${str}だった`;
      case 'pastNegative': return `${str}じゃなかった`;
      case 'te': return `${str}で`;
      case 'adverb': return `${str}に`;
      default: return str;
    }
  }

  function expandEntriesAndIndicesByAdjectiveForms(entries, indices, { iForms = [], naForms = [] } = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
    if (!arr.length) return { entries: [], indices: [] };

    const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
    const naSel = uniqueInOrder(normalizeExpansionForms(naForms));

    if (!iSel.length && !naSel.length) return { entries: arr.slice(), indices: idx.slice() };

    const outEntries = [];
    const outIndices = [];

    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i];
      const originalIndex = idx[i];
      if (!entry || typeof entry !== 'object') {
        outEntries.push(entry);
        outIndices.push(originalIndex);
        continue;
      }

      const typeRaw = String(entry.type || '').trim();
      const type = normalizeType(typeRaw);
      const isI = type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
      const isNa = type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';

      const forms = isI ? iSel : (isNa ? naSel : []);

      if (!forms.length) {
        outEntries.push(entry);
        outIndices.push(originalIndex);
        continue;
      }

      const baseStudyKey = getEntryRawStudyKey(entry);
      const kind = isI ? 'i' : 'na';

      for (const form of forms) {
        outEntries.push(expandJapaneseAdjectiveEntry(entry, { kind, form, baseStudyKey }));
        outIndices.push(originalIndex);
      }
    }

    return { entries: outEntries, indices: outIndices };
  }

  function expandEntriesByAdjectiveForm(entries, { iForms = [], naForms = [], iForm = '', naForm = '' } = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    if (!arr.length) return [];
    const nextIForms = (iForms && Array.isArray(iForms)) ? iForms : (iForm ? [iForm] : []);
    const nextNaForms = (naForms && Array.isArray(naForms)) ? naForms : (naForm ? [naForm] : []);
    return expandEntriesAndIndicesByAdjectiveForms(arr, null, { iForms: nextIForms, naForms: nextNaForms }).entries;
  }

  // Report how many extra rows adjective expansion adds.
  // This is useful for UI summaries (e.g., Data View corner caption).
  // NOTE: Expansion replaces each adjective entry with N "form" rows; the delta is (N-1) per matching entry.
  function getAdjectiveExpansionDeltas(entries, { iForms = [], naForms = [] } = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    const iSel = uniqueInOrder(normalizeExpansionForms(iForms));
    const naSel = uniqueInOrder(normalizeExpansionForms(naForms));

    let iBaseCount = 0;
    let naBaseCount = 0;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const type = normalizeType(String(entry.type || '').trim());
      const isI = type === 'i-adjective' || type === 'i_adj' || type === 'i-adj';
      const isNa = type === 'na-adjective' || type === 'na_adj' || type === 'na-adj';
      if (isI) iBaseCount++;
      else if (isNa) naBaseCount++;
    }

    const iFormsCount = iSel.length;
    const naFormsCount = naSel.length;
    const iDelta = (iFormsCount > 0) ? (iBaseCount * Math.max(0, iFormsCount - 1)) : 0;
    const naDelta = (naFormsCount > 0) ? (naBaseCount * Math.max(0, naFormsCount - 1)) : 0;

    return {
      iDelta,
      naDelta,
      totalDelta: iDelta + naDelta,
      iBaseCount,
      naBaseCount,
      iFormsCount,
      naFormsCount,
    };
  }

  // ============================================================================
  // Collection View (with shuffle, expansion, filtering)
  // ============================================================================

  function parseStudyFilterState(collState = {}) {
    let skipLearned = false;
    let focusOnly = false;
    if (collState && typeof collState.studyFilter === 'string') {
      const raw = String(collState.studyFilter || '').trim();
      if (raw) {
        const parts = raw.split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
        const set = new Set(parts);
        skipLearned = set.has('skipLearned') || set.has('skip_learned') || set.has('skip-learned');
        focusOnly = set.has('focusOnly') || set.has('focus_only') || set.has('focus') || set.has('morePractice') || set.has('more_practice');
      }
    } else {
      // legacy booleans
      skipLearned = !!collState?.skipLearned;
      focusOnly = !!collState?.focusOnly;
    }
    return { skipLearned, focusOnly };
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
        isLearned: (key) => !!(key && typeof grammarProgressManager?.isGrammarLearned === 'function' && grammarProgressManager.isGrammarLearned(key)),
        isFocus: (key) => !!(key && typeof grammarProgressManager?.isGrammarFocus === 'function' && grammarProgressManager.isGrammarFocus(key)),
      };
    }

    return {
      kind: 'kanji',
      getKey: (entry) => String(getEntryStudyKey(entry) || '').trim(),
      isLearned: (key) => !!(key && typeof progressManager?.isKanjiLearned === 'function' && progressManager.isKanjiLearned(key)),
      isFocus: (key) => !!(key && typeof progressManager?.isKanjiFocus === 'function' && progressManager.isKanjiFocus(key)),
    };
  }

  function applyStudyFilterToView(entries, indices, { skipLearned = false, focusOnly = false } = {}, adapter) {
    const arr = Array.isArray(entries) ? entries : [];
    const idx = Array.isArray(indices) ? indices : arr.map((_, i) => i);
    if (!arr.length) return { entries: [], indices: [] };
    if (!skipLearned && !focusOnly) return { entries: arr.slice(), indices: idx.slice() };
    const a = adapter || { getKey: (e) => String(getEntryStudyKey(e) || '').trim(), isLearned: () => false, isFocus: () => true };

    const outEntries = [];
    const outIdx = [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const key = a.getKey(e);
      if (!key) {
        outEntries.push(e);
        outIdx.push(idx[i]);
        continue;
      }
      if (skipLearned && a.isLearned(key)) continue;
      if (focusOnly && !a.isFocus(key)) continue;
      outEntries.push(e);
      outIdx.push(idx[i]);
    }
    return { entries: outEntries, indices: outIdx };
  }

  function getCollectionView(originalEntries, collState = {}, opts = { windowSize: 10 }) {
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
    const expanded = expandEntriesAndIndicesByAdjectiveForms(baseEntriesRaw, baseIndices, { iForms, naForms });
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

    const view = getCollectionView(baseEntries, stateObj, opts);
    let nextEntries = Array.isArray(view.entries) ? view.entries.slice() : [];
    let nextIndices = Array.isArray(view.indices) ? view.indices.slice() : [];

    // Apply per-collection studyFilter (skipLearned/focusOnly)
    const { skipLearned, focusOnly } = parseStudyFilterState(stateObj);
    if (skipLearned || focusOnly) {
      const adapter = progressAdapterForCollection(coll);
      const filtered = applyStudyFilterToView(nextEntries, nextIndices, { skipLearned, focusOnly }, adapter);
      nextEntries = filtered.entries;
      nextIndices = filtered.indices;
    }

    // Apply persisted held table-search filter (Data view "Hold Filter")
    try {
      const held = String(stateObj?.heldTableSearch || '').trim();
      if (held) {
        const fields = Array.isArray(coll?.metadata?.fields) ? coll.metadata.fields : null;
        const filtered = filterEntriesAndIndicesByTableSearch(nextEntries, nextIndices, { query: held, fields });
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

  // Return entries for a collection augmented with consolidated example info.
  // Ensures the top-folder sentence↔entry index is built so `entry.sentences`
  // are available, then returns shallow copies of entries with convenience
  // properties: `__examplesCount` and `__examplesSample` (array).
  async function getCollectionEntriesWithExamples(collectionOrKey, opts = { sample: 2 }) {
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

      const top = topFolderOfKey(coll.key) || '';
      if (top) {
        try { await ensureWordSentenceIndexBuiltForTop(top); } catch (e) { /* ignore */ }
      }

      // Rebuild folder index to ensure sentences were attached to entries.
      try { buildFolderEntryIndex(top); } catch (e) { /* ignore */ }

      const baseEntries = Array.isArray(coll.entries) ? coll.entries : [];
      const out = [];
      for (const e of baseEntries) {
        const sentences = Array.isArray(e.sentences) ? e.sentences : [];
        const sample = sampleN > 0 ? sentences.slice(0, sampleN).map(s => ({ ja: s?.ja ?? null, en: s?.en ?? null })) : [];
        out.push({ ...e, __examplesCount: sentences.length, __examplesSample: sample });
      }
      return out;
    } catch (err) {
      return [];
    }
  }

  // ============================================================================
  // Collection Actions (state modification operations)
  // ============================================================================

  function serializeStudyFilter({ skipLearned, focusOnly }) {
    const parts = [];
    if (skipLearned) parts.push('skipLearned');
    if (focusOnly) parts.push('focusOnly');
    return parts.join(',');
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

  function setStudyFilter(collKey, { skipLearned = false, focusOnly = false } = {}) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;
    saveCollectionState(coll.key, { studyFilter: serializeStudyFilter({ skipLearned: !!skipLearned, focusOnly: !!focusOnly }) });
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

  function setAdjectiveExpansionForms(collKey, { iForms = [], naForms = [], iForm = '', naForm = '' } = {}) {
    const coll = collKey ? getCollections().find(c => c?.key === collKey) : getActiveCollection();
    if (!coll) return false;

    const normalizeList = (v, fallbackSingle) => {
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
    const values = entries.map(getEntryStudyKey).filter(Boolean);
    if (typeof progressManager?.clearLearnedKanjiForValues === 'function') {
      progressManager.clearLearnedKanjiForValues(values);
      return true;
    }
    if (typeof progressManager?.clearLearnedKanji === 'function') {
      progressManager.clearLearnedKanji();
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
    loadCollectionSetsForFolder,
    getCachedCollectionSetsForFolder,
    loadCollection,
    prefetchCollectionsInFolder,
    loadCollectionState,
    saveCollectionState,
    deleteCollectionStateKeys,
    getInheritedFolderMetadata,
    collectionSetsDirPath,

    // Debug/read-only runtime inspection helpers (Entity Explorer)
    debugListRuntimeMaps,
    debugGetRuntimeMapDump,

    // Platform-level association build control
    ensureWordSentenceIndexBuiltForTop,

    // Collection view utilities (filtering, expansion, shuffle)
    getCollectionViewForCollection,
    getActiveCollectionView,
    getActiveCollectionFilteredSet,
    getEntryStudyKey,
    entryMatchesTableSearch,
    filterEntriesAndIndicesByTableSearch,
    expandEntriesByAdjectiveForm,
    expandEntriesAndIndicesByAdjectiveForms,
    getAdjectiveExpansionDeltas,
    getCollectionEntriesWithExamples,

    // Collection actions (state modifications)
    shuffleCollection,
    clearCollectionShuffle,
    setStudyFilter,
    setHeldTableSearch,
    setAdjectiveExpansionForms,
    clearLearnedForCollection,
  };
}
