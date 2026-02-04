import { nowIso, uuid } from './utils/helpers.js';
import { basename, dirname, normalizeFolderPath, titleFromFilename } from './utils/helpers.js';
import { buildHashRoute, parseHashRoute } from './utils/helpers.js';

export function createStore() {
  // Persistent UI state (previously stored in sessionStorage under `studyUIState`).
  // Kept in-memory for fast synchronous reads; flushed to durable storage async.
  const PERSIST_KEY = 'studyUIState';

  // IndexedDB-backed persistence (with localStorage fallback).
  // Store schema:
  // - kv: { key: 'shell'|'apps'|'kanji_progress'|'study_time', value: object }
  // - collections: { id: '<collectionId>', value: object }
  let persistenceReady = false;
  let idbAvailable = false;
  let idbBroken = false;

  // In-memory UI state cache. Apps read/write through store methods.
  const uiState = {
    shell: {},
    apps: {},
    collections: {},
    kv: {
      // Map<string, KanjiProgressRecord>
      // KanjiProgressRecord: { state, seen, timeMsStudiedInKanjiStudyCard, timesSeenInKanjiStudyCard, ... }
      kanji_progress: {},
      // StudyTimeRecord
      // { version: 1, sessions: StudySession[], statsByCollection: object, statsByAppCollection: object }
      // StudySession: { appId, collectionId, startIso, endIso, durationMs }
      study_time: null,
    },
  };

  const KANJI_PROGRESS_KEY = 'kanji_progress';
  const STUDY_TIME_KEY = 'study_time';

  let flushTimer = null;
  let flushInFlight = null;
  let dirtyShell = false;
  let dirtyApps = false;
  const dirtyCollections = new Set();
  const dirtyKv = new Set();

  async function ensurePersistence() {
    if (persistenceReady) return;
    // Dynamic import so store still loads in environments without IndexedDB.
    try {
      const mod = await import('./utils/idb.js');
      idbAvailable = !!mod?.isIndexedDBAvailable?.();
      if (idbAvailable) {
        await mod.openStudyDb().catch((e) => {
          idbBroken = true;
          console.warn('[Store] IndexedDB unavailable, falling back to localStorage', e);
        });
      }
    } catch (e) {
      idbAvailable = false;
      idbBroken = true;
    }
    persistenceReady = true;
  }

  function loadFromLocalStorageFallback() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveToLocalStorageFallback(obj) {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(obj));
    } catch (e) {
      // ignore
    }
  }

  function snapshotUiState() {
    // Produce a plain object for persistence/debugging.
    return {
      shell: uiState.shell || {},
      collections: uiState.collections || {},
      apps: uiState.apps || {},
      kv: uiState.kv || {},
    };
  }

  function scheduleFlush({ immediate = false } = {}) {
    // Debounce frequent updates (e.g. currentIndex changes).
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const delay = immediate ? 0 : 800;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPersistedState();
    }, delay);
  }

  async function flushPersistedState() {
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
      const doShell = dirtyShell;
      const doApps = dirtyApps;
      const colls = Array.from(dirtyCollections);
      const kvKeys = Array.from(dirtyKv);

      // Clear dirty flags optimistically; if persistence fails we will fall back.
      dirtyShell = false;
      dirtyApps = false;
      dirtyCollections.clear();
      dirtyKv.clear();

      await ensurePersistence();

      // IndexedDB path (preferred)
      if (idbAvailable && !idbBroken) {
        try {
          const { idbPut } = await import('./utils/idb.js');
          const puts = [];
          if (doShell) puts.push(idbPut('kv', { key: 'shell', value: uiState.shell || {} }));
          if (doApps) puts.push(idbPut('kv', { key: 'apps', value: uiState.apps || {} }));
          for (const k of kvKeys) {
            if (k === KANJI_PROGRESS_KEY || k === STUDY_TIME_KEY) {
              puts.push(idbPut('kv', { key: k, value: uiState.kv?.[k] || {} }));
            }
          }
          for (const id of colls) {
            puts.push(idbPut('collections', { id, value: uiState.collections?.[id] || {} }));
          }
          if (puts.length) await Promise.all(puts);
          return;
        } catch (e) {
          idbBroken = true;
          console.warn('[Store] IndexedDB write failed, falling back to localStorage', e);
        }
      }

      // Fallback: store full snapshot in localStorage.
      // This is less efficient but keeps data durable if IDB is unavailable.
      saveToLocalStorageFallback(snapshotUiState());
    })().finally(() => {
      flushInFlight = null;
    });

    return flushInFlight;
  }

  const subs = new Set();

  const state = {
    collections: [],
    // Path-like key, e.g. "japanese/jp_n5_verbs.json"
    activeCollectionId: null,
    // Folder-browsing tree derived from collections/index.json
    collectionTree: null,
    // Ephemeral UI: do not persist this to durable storage
    collectionBrowserPath: null,
    // available collection paths discovered from index.json (not yet loaded)
    _availableCollectionPaths: [],
  };

  function normalizeKanjiValue(v) {
    const s = String(v ?? '').trim();
    return s;
  }

  function ensureKanjiProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[KANJI_PROGRESS_KEY];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      uiState.kv[KANJI_PROGRESS_KEY] = {};
    }
    return uiState.kv[KANJI_PROGRESS_KEY];
  }

  function ensureStudyTimeRecord() {
    uiState.kv = uiState.kv || {};
    let v = uiState.kv[STUDY_TIME_KEY];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      v = { version: 1, sessions: [], statsByCollection: {}, statsByAppCollection: {} };
      uiState.kv[STUDY_TIME_KEY] = v;
      return v;
    }
    // Normalize fields for older records.
    if (typeof v.version !== 'number') v.version = 1;
    if (!Array.isArray(v.sessions)) v.sessions = [];
    if (!v.statsByCollection || typeof v.statsByCollection !== 'object' || Array.isArray(v.statsByCollection)) v.statsByCollection = {};
    if (!v.statsByAppCollection || typeof v.statsByAppCollection !== 'object' || Array.isArray(v.statsByAppCollection)) v.statsByAppCollection = {};
    return v;
  }

  function appCollectionKey(appId, collectionId) {
    return `${String(appId || '').trim()}::${String(collectionId || '').trim()}`;
  }

  function getKanjiProgressRecord(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const map = ensureKanjiProgressMap();
    const rec = map[k];
    return (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : null;
  }

  function setKanjiProgressRecord(v, patch, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const map = ensureKanjiProgressMap();
    const prev = getKanjiProgressRecord(k) || {};
    const patchObj = (patch && typeof patch === 'object') ? patch : {};
    map[k] = { ...prev, ...patchObj };
    dirtyKv.add(KANJI_PROGRESS_KEY);
    scheduleFlush({ immediate: !!opts.immediate });
    if (!opts.silent) notify();
    return map[k];
  }

  function getKanjiState(v) {
    const rec = getKanjiProgressRecord(v);
    const s = rec?.state;
    return (typeof s === 'string' && s.trim()) ? s.trim() : null;
  }

  function setKanjiState(v, nextState, opts = {}) {
    const state = (typeof nextState === 'string' && nextState.trim()) ? nextState.trim() : null;
    return setKanjiProgressRecord(v, { state }, opts);
  }

  function isKanjiLearned(v) {
    return getKanjiState(v) === 'learned';
  }

  function isKanjiFocus(v) {
    return getKanjiState(v) === 'focus';
  }

  function toggleKanjiLearned(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k);
    const next = (cur === 'learned') ? null : 'learned';
    setKanjiState(k, next);
    return getKanjiState(k) === 'learned';
  }

  function toggleKanjiFocus(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k);
    const next = (cur === 'focus') ? null : 'focus';
    setKanjiState(k, next);
    return getKanjiState(k) === 'focus';
  }

  function recordKanjiSeenInKanjiStudyCard(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return;
    const prev = getKanjiProgressRecord(k) || {};
    const prevTimes = Number.isFinite(Number(prev.timesSeenInKanjiStudyCard)) ? Number(prev.timesSeenInKanjiStudyCard) : 0;
    setKanjiProgressRecord(k, {
      seen: true,
      timesSeenInKanjiStudyCard: prevTimes + 1,
    }, { silent: opts.silent !== false, immediate: !!opts.immediate });
  }

  function addTimeMsStudiedInKanjiStudyCard(v, deltaMs, opts = {}) {
    const k = normalizeKanjiValue(v);
    const d = Math.round(Number(deltaMs));
    if (!k) return;
    if (!Number.isFinite(d) || d <= 0) return;
    const prev = getKanjiProgressRecord(k) || {};
    const prevTime = Number.isFinite(Number(prev.timeMsStudiedInKanjiStudyCard)) ? Math.round(Number(prev.timeMsStudiedInKanjiStudyCard)) : 0;
    setKanjiProgressRecord(k, {
      timeMsStudiedInKanjiStudyCard: Math.max(0, prevTime + d),
    }, { silent: opts.silent !== false, immediate: !!opts.immediate });
  }

  function recordAppCollectionStudySession({ appId, collectionId, startIso, endIso, durationMs } = {}) {
    const a = String(appId || '').trim();
    const c = String(collectionId || '').trim();
    if (!a || !c) return;
    const d = Math.round(Number(durationMs));
    if (!Number.isFinite(d) || d <= 0) return;

    const rec = ensureStudyTimeRecord();
    const start = String(startIso || '').trim();
    const end = String(endIso || '').trim();
    const session = {
      appId: a,
      collectionId: c,
      startIso: start || nowIso(),
      endIso: end || nowIso(),
      durationMs: d,
    };

    rec.sessions.push(session);
    // Cap growth to avoid unbounded IndexedDB records.
    const MAX_SESSIONS = 2000;
    if (rec.sessions.length > MAX_SESSIONS) {
      rec.sessions.splice(0, rec.sessions.length - MAX_SESSIONS);
    }

    // Update aggregate stats for the collection.
    const colPrev = rec.statsByCollection[c] && typeof rec.statsByCollection[c] === 'object'
      ? rec.statsByCollection[c]
      : { totalMs: 0, lastEndIso: null, lastDurationMs: null };
    const colTotal = Math.max(0, (Number(colPrev.totalMs) || 0) + d);
    rec.statsByCollection[c] = {
      totalMs: colTotal,
      lastEndIso: session.endIso,
      lastDurationMs: d,
    };

    // Update aggregate stats for the app+collection.
    const key = appCollectionKey(a, c);
    const acPrev = rec.statsByAppCollection[key] && typeof rec.statsByAppCollection[key] === 'object'
      ? rec.statsByAppCollection[key]
      : { totalMs: 0, lastEndIso: null, lastDurationMs: null };
    const acTotal = Math.max(0, (Number(acPrev.totalMs) || 0) + d);
    rec.statsByAppCollection[key] = {
      totalMs: acTotal,
      lastEndIso: session.endIso,
      lastDurationMs: d,
    };

    dirtyKv.add(STUDY_TIME_KEY);
    scheduleFlush();
    // Notify UI subscribers so views (e.g. Collections) refresh immediately
    notify();
  }

  function getStudyTimeRecord() {
    return ensureStudyTimeRecord();
  }

  function sumSessionDurations({ windowMs, collectionId = null } = {}) {
    const win = Math.round(Number(windowMs));
    const hasWindow = Number.isFinite(win) && win > 0;
    const c = collectionId ? String(collectionId).trim() : null;
    const now = Date.now();
    const cutoff = hasWindow ? (now - win) : null;

    const rec = ensureStudyTimeRecord();
    let total = 0;
    for (let i = rec.sessions.length - 1; i >= 0; i--) {
      const s = rec.sessions[i];
      if (!s || typeof s !== 'object') continue;
      if (c && s.collectionId !== c) continue;
      if (hasWindow) {
        const end = new Date(String(s.endIso || '')).getTime();
        if (!Number.isFinite(end) || Number.isNaN(end)) continue;
        if (end < cutoff) break; // sessions are append-only; older ones are earlier in the array
      }
      const d = Math.round(Number(s.durationMs));
      if (Number.isFinite(d) && d > 0) total += d;
    }
    return total;
  }

  function getCollectionStudyStats(collectionId) {
    const id = String(collectionId || '').trim();
    if (!id) return null;
    const rec = ensureStudyTimeRecord();
    const base = rec.statsByCollection?.[id] && typeof rec.statsByCollection[id] === 'object'
      ? rec.statsByCollection[id]
      : { totalMs: 0, lastEndIso: null, lastDurationMs: null };
    const last24h = sumSessionDurations({ windowMs: 24 * 60 * 60 * 1000, collectionId: id });
    const last48h = sumSessionDurations({ windowMs: 48 * 60 * 60 * 1000, collectionId: id });
    const last72h = sumSessionDurations({ windowMs: 72 * 60 * 60 * 1000, collectionId: id });
    const last7d = sumSessionDurations({ windowMs: 7 * 24 * 60 * 60 * 1000, collectionId: id });
    return {
      collectionId: id,
      totalMs: Math.max(0, Number(base.totalMs) || 0),
      lastEndIso: base.lastEndIso || null,
      lastDurationMs: Number.isFinite(Number(base.lastDurationMs)) ? Math.round(Number(base.lastDurationMs)) : null,
      last24h,
      last48h,
      last72h,
      last7d,
    };
  }

  function getAllCollectionsStudyStats() {
    const rec = ensureStudyTimeRecord();
    const out = [];
    for (const id of Object.keys(rec.statsByCollection || {})) {
      const st = getCollectionStudyStats(id);
      if (st) out.push(st);
    }
    return out;
  }

  function getRecentStudySessions(limit = 10) {
    const n = Math.max(0, Math.min(100, Math.round(Number(limit) || 0)));
    const rec = ensureStudyTimeRecord();
    if (!n) return [];
    return rec.sessions.slice(-n).reverse();
  }

  function getFocusKanjiValues(limit = 24) {
    const n = Math.max(0, Math.min(200, Math.round(Number(limit) || 0)));
    if (!n) return [];
    const map = ensureKanjiProgressMap();
    const out = [];
    for (const [k, r] of Object.entries(map)) {
      if (!r || typeof r !== 'object') continue;
      if (r.state === 'focus') out.push(k);
      if (out.length >= n) break;
    }
    return out;
  }

  function clearLearnedKanji() {
    try {
      const map = ensureKanjiProgressMap();
      let changed = false;
      for (const [k, rec] of Object.entries(map)) {
        if (!rec || typeof rec !== 'object') continue;
        if (rec.state === 'learned') {
          map[k] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;
      dirtyKv.add(KANJI_PROGRESS_KEY);
      scheduleFlush({ immediate: true });
      notify();
    } catch (e) {
      // ignore
    }
  }

  function clearLearnedKanjiForValues(values) {
    try {
      if (!Array.isArray(values) || values.length === 0) return;
      const toClear = new Set(values.map(normalizeKanjiValue).filter(Boolean));
      if (toClear.size === 0) return;

      const map = ensureKanjiProgressMap();
      let changed = false;
      for (const v of toClear) {
        const rec = map[v];
        if (rec && typeof rec === 'object' && rec.state === 'learned') {
          map[v] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;

      dirtyKv.add(KANJI_PROGRESS_KEY);
      scheduleFlush({ immediate: true });
      notify();
    } catch (e) {
      // ignore
    }
  }

  // Folder metadata helpers/storage used for lazy loads
  let folderMetadataMap = null;
  const metadataCache = {};
  // Dedupe concurrent folder-metadata loads (folderPath -> Promise)
  const pendingFolderMetadataLoads = new Map();
  // map of available collection path -> lightweight metadata from index.json
  let availableCollectionsMap = new Map();
  // Track in-flight collection fetch promises to avoid duplicate fetches
  const pendingLoads = new Map();

  // Collection sets (tags) support: per-folder `_collectionSets.json`
  const COLLECTION_SETS_FILE = '_collectionSets.json';
  const COLLECTION_SETS_DIRNAME = '__collectionSets';
  // baseFolder (e.g. "japanese") -> parsed collectionSets json
  const collectionSetsCache = new Map();
  // baseFolder -> in-flight load promise
  const pendingCollectionSetsLoads = new Map();

  // Folder-level entry index cache used to resolve set terms to real entries.
  // baseFolder -> Map(termString -> entryObject)
  const folderEntryIndexCache = new Map();
  // Examples cache: baseFolder -> Array of example objects collected from loaded collection files' top-level `examples` arrays
  const examplesCache = new Map();

  function notify() {
    for (const fn of subs) fn();
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
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
    // Only update the URL if a hash route is already present. This prevents
    // initialization from creating a default '#/?collection=...' hash which
    // would block restoring the persisted lastRoute.
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

  function getLastRoute() {
    try {
      const v = uiState?.shell?.lastRoute;
      return (typeof v === 'string' && v.trim()) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function setLastRoute(routeOrPath) {
    try {
      let path = null;
      if (routeOrPath && typeof routeOrPath === 'object') {
        const pathname = typeof routeOrPath.pathname === 'string' ? routeOrPath.pathname : '/';
        const query = routeOrPath.query;
        const search = (query && typeof query.toString === 'function') ? query.toString() : '';
        path = search ? `${pathname}?${search}` : pathname;
      } else {
        path = String(routeOrPath || '').trim();
      }

      if (!path) return;
      if (!path.startsWith('/')) path = `/${path.replace(/^#+/, '')}`;

      uiState.shell = uiState.shell || {};
      if (uiState.shell.lastRoute === path) return;
      uiState.shell.lastRoute = path;
      dirtyShell = true;
      scheduleFlush();
    } catch (e) {
      // ignore
    }
  }

  async function setActiveCollectionId(id) {
    const nextId = id || null;
    const same = state.activeCollectionId === nextId;

    // If activating a collection that hasn't been loaded yet, load it first.
    if (!same && nextId) {
      const alreadyLoaded = state.collections.some(c => c.key === nextId);
      if (!alreadyLoaded) {
        try {
          await loadCollection(nextId);
        } catch (err) {
          console.warn(`[Store] Failed to load collection ${nextId}: ${err.message}`);
          return; // do not switch active collection if load failed
        }
      }
    }

    if (!same) {
      state.activeCollectionId = nextId;
    }

    // Keep the current URL in sync (preserving other query params).
    try {
      syncHashCollectionParam(nextId);
    } catch (e) {
      // ignore
    }
    
    // Persist shell-level UI state (active collection) via the durable UI state cache.
    try {
      uiState.shell = uiState.shell || {};
      uiState.shell.activeCollectionId = state.activeCollectionId;
      // If a route exists, keep lastRoute aligned with the current hash.
      if (location.hash) {
        uiState.shell.lastRoute = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
      }
      dirtyShell = true;
      scheduleFlush();
    } catch (e) {
      // ignore
    }

    if (!same) notify();
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

    const p = (async () => {
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
        // treat missing/invalid as not available; do not spam console
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

      // minimal validation/normalization
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
            // New: kanjiFilter is an array of filter expressions (AND semantics).
            // Back-compat: keep `kanji` if present.
            kanjiFilter: Array.isArray(s.kanjiFilter) ? s.kanjiFilter.slice() : null,
            kanji: Array.isArray(s.kanji) ? s.kanji.slice() : []
          }))
          .filter(s => s.id.length > 0)
      };

      collectionSetsCache.set(folder, normalized);
      return normalized;
    })();

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
      await Promise.all(loads);
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
    // Examples are stored separately on `entry.examples` (array of example objects).
    if (Array.isArray(entry.examples) && entry.examples.length) {
      let hasJa = false;
      let hasEn = false;
      for (const ex of entry.examples) {
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
    // Attach any loaded examples (examplesCache) by matching example.refWords -> entry.kanji
    try {
      const examples = examplesCache.get(folder) || [];
      if (Array.isArray(examples) && examples.length) {
        for (const ex of examples) {
          if (!ex || typeof ex !== 'object') continue;
          const refs = Array.isArray(ex.refWords) ? ex.refWords : [];
          for (const rawKey of refs) {
            const key = String(rawKey || '').trim();
            if (!key) continue;
            const entry = index.get(key);
            if (!entry || typeof entry !== 'object') continue;
            if (!Array.isArray(entry.examples)) entry.examples = [];
            entry.examples.push(ex);
          }
        }
      }
    } catch (e) {
      // ignore
    }

    return index;
  }

  async function resolveVirtualSetRecord(record, baseFolder, setObj) {
    const folder = normalizeFolderPath(baseFolder);
    // Eagerly load everything in that folder so we can match terms.
    await ensureCollectionsLoadedInFolder(folder, { excludeCollectionSets: true });

    // (Re)build term index after load.
    folderEntryIndexCache.delete(folder);
    const index = buildFolderEntryIndex(folder);

    // If the set defines `kanjiFilter[]`, resolve entries by filtering all loaded
    // entries in the folder using simple filter expressions (AND semantics).
    const resolved = [];
    if (Array.isArray(setObj?.kanjiFilter) && setObj.kanjiFilter.length) {
      // Helper: parse a single filter string into { field, op, value }
      function parseFilter(f) {
        const s = String(f || '').trim();
        if (!s) return null;
        // support `field.startsWith[val]`, `field.endsWith[val]`, `field.in[val]`
        const mStarts = s.match(/^(.+?)\.startsWith\[(.*)\]$/);
        if (mStarts) return { field: mStarts[1], op: 'startsWith', value: mStarts[2] };
        const mEnds = s.match(/^(.+?)\.endsWith\[(.*)\]$/);
        if (mEnds) return { field: mEnds[1], op: 'endsWith', value: mEnds[2] };
        const mIn = s.match(/^(.+?)\.in\[(.*)\]$/);
        if (mIn) return { field: mIn[1], op: 'in', value: mIn[2] };
        // support != first, then =
        const mNeq = s.match(/^(.+?)!=([\s\S]*)$/);
        if (mNeq) return { field: mNeq[1], op: 'neq', value: mNeq[2] };
        const mEq = s.match(/^(.+?)=([\s\S]*)$/);
        if (mEq) return { field: mEq[1], op: 'eq', value: mEq[2] };
        return null;
      }

      function matchesAll(entry, filters) {
        const progressMap = ensureKanjiProgressMap();
        const keyCandidates = ['kanji', 'character', 'text', 'word', 'kana', 'reading'];

        function entryKeyForProgress(e) {
          if (!e || typeof e !== 'object') return '';
          for (const k of keyCandidates) {
            const v = e[k];
            if (v !== undefined && v !== null && String(v || '').trim()) return normalizeKanjiValue(v);
          }
          return '';
        }

        for (const f of filters) {
          const parsed = parseFilter(f);
          if (!parsed) return false;

          // Support nested-field access for kanji progress: "kanji_progress.fieldName"
          if (String(parsed.field).startsWith('kanji_progress.')) {
            const parts = String(parsed.field).split('.');
            const fieldName = parts.slice(1).join('.');
            const entryKey = entryKeyForProgress(entry);
            if (!entryKey) return false;
            const rec = progressMap[entryKey];
            if (!rec || typeof rec !== 'object') {
              // treat missing record as null/undefined
              if (parsed.op === 'neq') {
                // comparing to a value: missing !== value -> true only if value is not empty/null
                const cmpVal = String(parsed.value || '').trim();
                if (cmpVal === '') return false;
                // missing rec means field !== value
                continue;
              }
              return false;
            }

            const raw = rec[fieldName];

            // Evaluate comparison smartly based on raw type
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
                const parts = String(parsed.value || '').split(',').map(x => x.trim()).filter(Boolean);
                if (parts.length === 0) return false;
                if (!parts.includes(sval)) return false;
              }
            } else {
              return false;
            }

            continue;
          }

          // Fallback: match against entry's own fields (coerce to string)
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
            // value is comma-separated list
            const parts = String(parsed.value || '').split(',').map(x => x.trim()).filter(Boolean);
            if (parts.length === 0) return false;
            if (!parts.includes(val)) return false;
          } else if (parsed.op === 'neq') {
            if (val === v) return false;
          } else {
            return false;
          }
        }
        return true;
      }

      // Iterate all loaded collections' entries and select matching ones.
      for (const coll of state.collections.slice()) {
        // skip virtual set records and only consider collections inside the same top folder
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

    // Apply inherited folder metadata fields (so Flashcards renders meaningful rows)
    const fm = (await loadInheritedFolderMetadata(folder, metadataCache, folderMetadataMap)) || null;
    const fields = Array.isArray(fm?.fields) ? fm.fields : null;

    record.entries = resolved;
    record.metadata = record.metadata || {};
    if (fields) record.metadata.fields = fields;

    notify();
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
    // folderMetadata can be:
    // - { "japanese": "japanese/_metadata.json", "numbers": "_metadata.json", ... }
    // Keys are folder paths relative to ./collections ("" means root).
    // Values can be relative paths (with or without the folder prefix).
    if (!folderMetadata || typeof folderMetadata !== 'object') return null;

    const map = new Map();
    for (const [rawFolder, rawFile] of Object.entries(folderMetadata)) {
      const folder = normalizeFolderPath(rawFolder);
      let fileRel = normalizeIndexRelativePath(rawFile);
      if (!fileRel) continue;

      // If the value is just a filename (e.g. "_metadata.json"), interpret it as inside the folder.
      if (!fileRel.includes('/')) {
        fileRel = folder ? `${folder}/${fileRel}` : fileRel;
      }

      map.set(folder, fileRel);
    }

    return map;
  }

  async function tryLoadFolderMetadata(folderPath, folderMetadataMap) {
    const folder = normalizeFolderPath(folderPath);
    // If index provides an explicit mapping, only load what it declares (no guesswork / no 404 probing).
    if (folderMetadataMap instanceof Map) {
      const rel = folderMetadataMap.get(folder);
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

    // Fallback behavior (legacy): probe for `_metadata.json` then `metadata.json`.
    const base = folder ? `./collections/${folder}` : './collections';
    const candidates = [`${base}/_metadata.json`, `${base}/metadata.json`];

    for (const metadataUrl of candidates) {
      let res;
      try {
        res = await fetch(metadataUrl);
      } catch (err) {
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

  async function loadInheritedFolderMetadata(folderPath, cache, folderMetadataMap) {
    const folder = normalizeFolderPath(folderPath);
    if (Object.prototype.hasOwnProperty.call(cache, folder)) return cache[folder];

    if (pendingFolderMetadataLoads.has(folder)) {
      return pendingFolderMetadataLoads.get(folder);
    }

    const p = (async () => {
      const direct = await tryLoadFolderMetadata(folder, folderMetadataMap);
      if (direct) {
        cache[folder] = direct;
        return direct;
      }

      const parent = dirname(folder);
      if (parent === folder) {
        cache[folder] = null;
        return null;
      }

      const inherited = folder ? await loadInheritedFolderMetadata(parent, cache, folderMetadataMap) : null;
      cache[folder] = inherited;
      return inherited;
    })();

    pendingFolderMetadataLoads.set(folder, p);
    try {
      return await p;
    } finally {
      pendingFolderMetadataLoads.delete(folder);
    }
  }
  

  // Public helper: return the inherited folder metadata for a collection key or folder path.
  // This exposes the result of `loadInheritedFolderMetadata` (cached) so UI can show
  // the root/_metadata.json values that apply to a collection.
  async function getInheritedFolderMetadata(collectionKeyOrFolder) {
    if (!collectionKeyOrFolder) return null;
    // If caller passed a collection key (contains '/'), treat it as a path and get its dirname
    const folder = (typeof collectionKeyOrFolder === 'string' && collectionKeyOrFolder.includes('/'))
      ? dirname(collectionKeyOrFolder)
      : normalizeFolderPath(collectionKeyOrFolder);

    const meta = await loadInheritedFolderMetadata(folder, metadataCache, folderMetadataMap);
    return meta || null;
  }

  function mergeMetadata(collection, categoryMetadata) {
    // Start with common fields, then add collection-specific fields
    const fields = Array.isArray(categoryMetadata?.fields) ? categoryMetadata.fields : [];
    const commonFieldKeys = new Set(fields.map(f => f.key));
    const collectionFields = collection.metadata?.fields || [];
    const collectionFieldKeys = new Set(collectionFields.map(f => f.key));
    
    // Use common fields, but allow collection to override
    const mergedFields = [
      ...fields.filter(f => !collectionFieldKeys.has(f.key)),
      ...collectionFields
    ];
    
    return {
      ...collection,
      metadata: {
        ...collection.metadata,
        fields: mergedFields,
        category: categoryMetadata?.category || categoryMetadata?.language
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

    // Virtual dir: <baseFolder>/__collectionSets
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
    // Index may contain either an array of paths (legacy) or an array of
    // objects { path, name, description, entries } produced by rebuild_index.js.
    const rawCollections = Array.isArray(index?.collections) ? index.collections : [];
    const paths = rawCollections.map(c => (typeof c === 'string' ? c : (c.path || ''))).filter(Boolean);

    // Optional: explicit folder metadata location map to avoid probing missing files.
    folderMetadataMap = buildFolderMetadataMap(index?.folderMetadata);

    // Build a folder tree for browsing (independent of JSON validity).
    state.collectionTree = buildCollectionTreeFromPaths(paths);

    // Keep list of available paths but do NOT fetch each collection now.
    state._availableCollectionPaths = paths.slice();

    // Build a map of path -> metadata records for quick access in the UI.
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

    // Notify so UI can render collection browser immediately.
    notify();

    return paths;
  }

  // Return lightweight collection records from the index (preserves index order)
  function getAvailableCollections() {
    return state._availableCollectionPaths.map(p => availableCollectionsMap.get(p) || { path: p, name: null, description: null, entries: null });
  }

  async function loadCollection(key) {
    return loadCollectionInternal(key, { notify: true });
  }

  async function loadCollectionInternal(key, opts = { notify: true }) {
    if (!key) throw new Error('collection key required');
    // If already loaded, return it
    const existing = state.collections.find(c => c.key === key);
    if (existing) return existing;

    // If a load is in-flight, return the same promise
    if (pendingLoads.has(key)) return pendingLoads.get(key);

    const p = (async () => {
      // Virtual collection: <baseFolder>/__collectionSets/<setId>
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

        // Start with placeholders so the UI can switch immediately.
        // If this set uses `kanjiFilter[]` we can't produce literal term placeholders,
        // so start with an empty entries array and resolve in background.
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
            fields: [
              { key: 'kanji', label: 'Kanji' }
            ],
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

        // Resolve to real entries in the background (after eagerly loading folder).
        Promise.resolve()
          .then(() => resolveVirtualSetRecord(record, baseFolder, set))
          .catch((err) => {
            console.warn('[Store] Failed to resolve virtual set entries:', err?.message || err);
          });

        if (opts?.notify !== false) notify();
        return record;
      }

      // Only allow loading known paths (avoid fetching arbitrary files)
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

      // Support legacy "examples-only" files which are plain arrays: normalize
      // a top-level array into an object shape { metadata: {}, examples: [...] }
      if (Array.isArray(data)) {
        data = { metadata: {}, examples: data };
      }

      // Apply inherited folder metadata (nearest `_metadata.json` up the folder chain)
      const folderPath = dirname(key);
      const fm = (await loadInheritedFolderMetadata(folderPath, metadataCache, folderMetadataMap)) || { fields: [], category: folderPath.split('/')[0] || '' };
      data = mergeMetadata(data, fm);

      // Apply collection-level defaults to entries (shallow merge where entry lacks the key)
      if (data && data.defaults && Array.isArray(data.entries)) {
        const defs = data.defaults;
        data.entries = data.entries.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const merged = { ...entry };
          for (const [k, v] of Object.entries(defs)) {
            if (typeof merged[k] === 'undefined') merged[k] = v;
          }
          return merged;
        });
      }

      // Ensure required bits exist, and avoid relying on metadata.id.
      data.metadata = data.metadata || {};
      if (!data.metadata.name) {
        data.metadata.name = titleFromFilename(basename(key));
      }

      // Register examples from this collection file (if present).
      try {
        const examples = Array.isArray(data.examples) ? data.examples : null;
        if (examples) {
          const top = topFolderOfKey(key) || '';
          const prev = examplesCache.get(top) || [];
          examplesCache.set(top, prev.concat(examples));

          // Attach examples to entries within this collection by matching refWords -> entry.kanji
          if (Array.isArray(data.entries) && data.entries.length) {
            for (const ex of examples) {
              if (!ex || typeof ex !== 'object') continue;
              const refs = Array.isArray(ex.refWords) ? ex.refWords : [];
              for (const rawKey of refs) {
                const keyStr = String(rawKey || '').trim();
                if (!keyStr) continue;
                const entry = data.entries.find(e => e && String(e.kanji || '').trim() === keyStr);
                if (!entry) continue;
                if (!Array.isArray(entry.examples)) entry.examples = [];
                entry.examples.push(ex);
              }
            }
          }
        }
      } catch (e) {
        // ignore
      }

      const record = { ...data, key };
      state.collections.push(record);

      // Invalidate folder entry index cache for this top folder (so set resolution sees new data).
      try {
        const top = topFolderOfKey(key);
        if (top) folderEntryIndexCache.delete(top);
      } catch (e) {}
      // Keep collections consistent order with available list where possible
      state.collections.sort((a, b) => {
        const ai0 = state._availableCollectionPaths.indexOf(a.key);
        const bi0 = state._availableCollectionPaths.indexOf(b.key);
        const ai = ai0 === -1 ? Number.MAX_SAFE_INTEGER : ai0;
        const bi = bi0 === -1 ? Number.MAX_SAFE_INTEGER : bi0;
        return ai - bi;
      });

      if (opts?.notify !== false) notify();
      return record;
    })();

    pendingLoads.set(key, p);
    try {
      const result = await p;
      return result;
    } finally {
      pendingLoads.delete(key);
    }
  }

  // Prefetch all collections under a folder (e.g. 'japanese'), in the background.
  // This keeps lazy-loading as default, but makes virtual-set navigation fast.
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

    // Fire-and-forget. Load quietly and notify once at the end.
    Promise.resolve().then(async () => {
      const loads = [];
      for (const k of keys) {
        if (!k) continue;
        if (state.collections.some(c => c.key === k)) continue;
        if (pendingLoads.has(k)) continue;
        loads.push(
          loadCollectionInternal(k, { notify: false }).catch(() => null)
        );
      }
      if (loads.length) {
        await Promise.all(loads);
        if (shouldNotify) notify();
      }
    });
  }

  async function initialize() {
    try {
      // Load persisted UI state (durable across browser restarts).
      await ensurePersistence();
      let loaded = null;
      if (idbAvailable && !idbBroken) {
        try {
          const { idbGet, idbGetAll } = await import('./utils/idb.js');
          const shellRec = await idbGet('kv', 'shell');
          const appsRec = await idbGet('kv', 'apps');
          const kanjiProgressRec = await idbGet('kv', KANJI_PROGRESS_KEY);
          const studyTimeRec = await idbGet('kv', STUDY_TIME_KEY);
          const collRecs = await idbGetAll('collections');
          loaded = {
            shell: (shellRec && shellRec.value && typeof shellRec.value === 'object') ? shellRec.value : {},
            apps: (appsRec && appsRec.value && typeof appsRec.value === 'object') ? appsRec.value : {},
            collections: {},
            kv: {
              [KANJI_PROGRESS_KEY]: (kanjiProgressRec && kanjiProgressRec.value && typeof kanjiProgressRec.value === 'object' && !Array.isArray(kanjiProgressRec.value)) ? kanjiProgressRec.value : {},
              [STUDY_TIME_KEY]: (studyTimeRec && studyTimeRec.value && typeof studyTimeRec.value === 'object' && !Array.isArray(studyTimeRec.value)) ? studyTimeRec.value : null,
            },
          };
          for (const r of (Array.isArray(collRecs) ? collRecs : [])) {
            if (!r || typeof r !== 'object') continue;
            const id = r.id;
            if (!id) continue;
            const v = r.value;
            if (v && typeof v === 'object') loaded.collections[id] = v;
          }
        } catch (e) {
          idbBroken = true;
          console.warn('[Store] IndexedDB read failed, falling back to localStorage', e);
        }
      }
      if (!loaded) {
        loaded = loadFromLocalStorageFallback() || { shell: {}, apps: {}, collections: {}, kv: {} };
      }
      uiState.shell = (loaded.shell && typeof loaded.shell === 'object') ? loaded.shell : {};
      uiState.apps = (loaded.apps && typeof loaded.apps === 'object') ? loaded.apps : {};
      uiState.collections = (loaded.collections && typeof loaded.collections === 'object') ? loaded.collections : {};
      uiState.kv = (loaded.kv && typeof loaded.kv === 'object') ? loaded.kv : { [KANJI_PROGRESS_KEY]: {} };
      // Ensure `kanji_progress` is present and well-formed.
      ensureKanjiProgressMap();
      // Ensure `study_time` is present and well-formed.
      ensureStudyTimeRecord();

      const paths = await loadSeedCollections();
      // Do not eagerly load collection JSONs; start with none loaded.
      state.collections = [];

      // Restore from persisted UI state if possible (before defaulting to first)
      let restored = null;
      try {
        restored = uiState?.shell?.activeCollectionId || null;
      } catch (e) {
        restored = null;
      }

      if (restored && (state._availableCollectionPaths.includes(restored) || isCollectionSetVirtualKey(restored))) {
        await setActiveCollectionId(restored);
        // If restore failed (e.g., stale virtual key), fall back to first available.
        if (!state.activeCollectionId && Array.isArray(paths) && paths.length > 0) {
          await setActiveCollectionId(paths[0]);
        }
      } else if (!state.activeCollectionId && Array.isArray(paths) && paths.length > 0) {
        // Persist via setter so session state is updated
        await setActiveCollectionId(paths[0]);
      }
    } catch (err) {
      console.error(`Failed to initialize collections: ${err.message}`);
      state.collections = [];
      state.activeCollectionId = null;
    }

    notify();

    // Flush any outstanding persistence work when the tab is backgrounded/closed.
    try {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          scheduleFlush({ immediate: true });
        }
      });
      window.addEventListener('pagehide', () => {
        scheduleFlush({ immediate: true });
      });
    } catch (e) {
      // ignore
    }
  }

  function syncCollectionFromURL(route) {
    const collectionId = route.query.get('collection');
    if (collectionId && collectionId !== state.activeCollectionId) {
      // Attempt to activate the collection. `setActiveCollectionId` will
      // lazily load it if necessary.
      setActiveCollectionId(collectionId);
    }
  }

  // UI state persistence: in-memory cache + async flush to durable storage.
  // All store getters remain synchronous by reading from `uiState`.

  // Helpers to read/write collection-scoped state directly
  function loadCollectionState(collId) {
    try {
      if (!uiState.collections) return null;
      return uiState.collections[collId] || null;
    } catch (e) {
      return null;
    }
  }

  function saveCollectionState(collId, patch) {
    try {
      uiState.collections = uiState.collections || {};
      const prev = uiState.collections[collId] || {};
      uiState.collections[collId] = { ...prev, ...(patch || {}) };
      dirtyCollections.add(collId);
      scheduleFlush();
    } catch (e) {
      // ignore
    }
  }


  function getShellVoiceSettings() {
    try {
      const v = uiState?.shell?.voice;
      return (v && typeof v === 'object') ? { ...v } : null;
    } catch (e) {
      return null;
    }
  }

  function getShellState() {
    try {
      const v = uiState?.shell;
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch (e) {
      return {};
    }
  }

  function setShellState(patch, opts = {}) {
    try {
      uiState.shell = uiState.shell || {};
      const prev = (uiState.shell && typeof uiState.shell === 'object') ? uiState.shell : {};
      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      uiState.shell = { ...prev, ...patchObj };
      dirtyShell = true;
      scheduleFlush();
      // By default, notify subscribers so UI updates. Callers can pass
      // { silent: true } to persist without triggering a re-render.
      if (!opts.silent) notify();
    } catch (e) {
      // ignore
    }
  }

  function setShellVoiceSettings(patch) {
    try {
      uiState.shell = uiState.shell || {};
      const prev = (uiState.shell.voice && typeof uiState.shell.voice === 'object') ? uiState.shell.voice : {};

      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      const next = { ...prev, ...patchObj };

      // Deep-merge per-language voice settings
      if (patchObj.engVoice && typeof patchObj.engVoice === 'object') {
        const prevEng = (prev.engVoice && typeof prev.engVoice === 'object') ? prev.engVoice : {};
        next.engVoice = { ...prevEng, ...patchObj.engVoice };
      }
      if (patchObj.jpVoice && typeof patchObj.jpVoice === 'object') {
        const prevJp = (prev.jpVoice && typeof prev.jpVoice === 'object') ? prev.jpVoice : {};
        next.jpVoice = { ...prevJp, ...patchObj.jpVoice };
      }

      // Normalize empties to null to keep session clean
      for (const key of ['engVoice', 'jpVoice']) {
        const obj = next[key];
        if (!obj || typeof obj !== 'object') continue;
        if (obj.voiceURI === '') obj.voiceURI = null;
        if (obj.voiceName === '') obj.voiceName = null;
      }

      uiState.shell.voice = next;
      dirtyShell = true;
      scheduleFlush();
    } catch (e) {
      // ignore
    }
  }

  // App-level state helpers. Apps can persist small UI state under `apps.<appId>`.
  function getAppState(appId) {
    try {
      if (!appId) return {};
      const v = uiState?.apps?.[appId];
      return (v && typeof v === 'object') ? { ...v } : {};
    } catch (e) {
      return {};
    }
  }

  function setAppState(appId, patch, opts = {}) {
    try {
      if (!appId) return;
      uiState.apps = uiState.apps || {};
      const prev = (uiState.apps[appId] && typeof uiState.apps[appId] === 'object') ? uiState.apps[appId] : {};
      const patchObj = (patch && typeof patch === 'object') ? patch : {};
      uiState.apps[appId] = { ...prev, ...patchObj };
      dirtyApps = true;
      scheduleFlush();
      if (!opts.silent) notify();
    } catch (e) {
      // ignore
    }
  }

  return {
    subscribe,
    initialize,
    collections: {
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
      getInheritedFolderMetadata,
    },
    shell: {
      getLastRoute,
      setLastRoute,
      getCollectionBrowserPath: () => {
        return (typeof state.collectionBrowserPath === 'string') ? state.collectionBrowserPath : null;
      },
      setCollectionBrowserPath: (path) => {
        state.collectionBrowserPath = typeof path === 'string' ? path : String(path || '');
        // Ephemeral UI change: do not notify subscribers to avoid
        // re-rendering the shell while dropdowns/overlays are open.
      },
      getVoiceSettings: getShellVoiceSettings,
      setVoiceSettings: setShellVoiceSettings,
      getState: getShellState,
      setState: setShellState,
    },
    apps: {
      getState: getAppState,
      setState: setAppState,
    },
    kanjiProgress: {
      isKanjiLearned,
      isKanjiFocus,
      toggleKanjiLearned,
      toggleKanjiFocus,
      clearLearnedKanji,
      clearLearnedKanjiForValues,
      // Per-item progress/stats
      getKanjiProgressRecord,
      recordKanjiSeenInKanjiStudyCard,
      addTimeMsStudiedInKanjiStudyCard,
      getFocusKanjiValues,
    },
    studyTime: {
      // Cross-app study time (app x collection)
      recordAppCollectionStudySession,
      getStudyTimeRecord,
      getRecentStudySessions,
      getCollectionStudyStats,
      getAllCollectionsStudyStats,
      sumSessionDurations,
    },
  };
}
