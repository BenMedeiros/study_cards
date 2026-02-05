import * as idb from '../utils/idb.js';

const PERSIST_KEY = 'studyUIState';

function loadFromLocalStorageFallback() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

function saveToLocalStorageFallback(obj) {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function snapshotUiState(uiState) {
  return {
    shell: uiState.shell || {},
    collections: uiState.collections || {},
    apps: uiState.apps || {},
    kv: uiState.kv || {},
  };
}

// Backward-compatible decompression of older study_time schema
function maybeDecompressStudyTimeRecord(kv, studyTimeKey = 'study_time') {
  try {
    const st = kv?.[studyTimeKey];
    if (!st || typeof st !== 'object') return kv;
    if (st.schema_version !== 2 || !Array.isArray(st.sessions)) return kv;

    const apps = Array.isArray(st.normalization_appIds) ? st.normalization_appIds : [];
    const cols = Array.isArray(st.normalization_collectionIds) ? st.normalization_collectionIds : [];

    const decompressed = [];
    for (const s of st.sessions) {
      if (!s) continue;
      if (Array.isArray(s)) {
        const ai = s[0];
        const ci = s[1];
        const startIso = s[2] || '';
        const endIso = s[3] || '';
        const durationMs = Math.round(Number(s[4]) || 0);
        const appId = (typeof ai === 'number' && ai >= 0 && ai < apps.length) ? apps[ai] : (typeof ai === 'string' ? ai : '');
        const collectionId = (typeof ci === 'number' && ci >= 0 && ci < cols.length) ? cols[ci] : (typeof ci === 'string' ? ci : '');
        decompressed.push({ appId, collectionId, startIso, endIso, durationMs });
      } else if (typeof s === 'object') {
        decompressed.push({
          appId: String(s.appId || ''),
          collectionId: String(s.collectionId || ''),
          startIso: String(s.startIso || ''),
          endIso: String(s.endIso || ''),
          durationMs: Math.round(Number(s.durationMs) || 0),
        });
      }
    }

    return {
      ...kv,
      [studyTimeKey]: { version: st.version || 1, sessions: decompressed },
    };
  } catch {
    return kv;
  }
}

export function createPersistenceManager({ uiState, emitter, kanjiProgressKey = 'kanji_progress', studyTimeKey = 'study_time' }) {
  let persistenceReady = false;
  let idbAvailable = false;
  let idbBroken = false;

  let flushTimer = null;
  let flushInFlight = null;

  let dirtyShell = false;
  let dirtyApps = false;
  const dirtyCollections = new Set();
  const dirtyKv = new Set();

  async function ensureReady() {
    if (persistenceReady) return;
    try {
      idbAvailable = !!idb?.isIndexedDBAvailable?.();
      if (idbAvailable) {
        await idb.openStudyDb().catch((e) => {
          idbBroken = true;
          console.warn('[Persistence] IndexedDB unavailable, falling back to localStorage', e);
        });
      }
    } catch (e) {
      idbAvailable = false;
      idbBroken = true;
    }
    persistenceReady = true;
  }

  function markDirty({ shell = false, apps = false, collectionId = null, kvKey = null } = {}) {
    if (shell) dirtyShell = true;
    if (apps) dirtyApps = true;
    if (collectionId) dirtyCollections.add(String(collectionId));
    if (kvKey) dirtyKv.add(String(kvKey));
  }

  function scheduleFlush({ immediate = false } = {}) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const delay = immediate ? 0 : 800;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delay);
  }

  async function flush() {
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
      const doShell = dirtyShell;
      const doApps = dirtyApps;
      const colls = Array.from(dirtyCollections);
      const kvKeys = Array.from(dirtyKv);

      dirtyShell = false;
      dirtyApps = false;
      dirtyCollections.clear();
      dirtyKv.clear();

      await ensureReady();

      if (idbAvailable && !idbBroken) {
        try {
          const puts = [];
          if (doShell) puts.push(idb.idbPut('kv', { key: 'shell', value: uiState.shell || {} }));
          if (doApps) puts.push(idb.idbPut('kv', { key: 'apps', value: uiState.apps || {} }));
          for (const k of kvKeys) {
            if (k === kanjiProgressKey || k === studyTimeKey) {
              puts.push(idb.idbPut('kv', { key: k, value: uiState.kv?.[k] || {} }));
            } else {
              puts.push(idb.idbPut('kv', { key: k, value: uiState.kv?.[k] || {} }));
            }
          }
          for (const id of colls) {
            puts.push(idb.idbPut('collections', { id, value: uiState.collections?.[id] || {} }));
          }
          if (puts.length) await Promise.all(puts);
          return;
        } catch (e) {
          idbBroken = true;
          console.warn('[Persistence] IndexedDB write failed, falling back to localStorage', e);
        }
      }

      saveToLocalStorageFallback(snapshotUiState(uiState));
    })().finally(() => {
      flushInFlight = null;
    });

    return flushInFlight;
  }

  async function load() {
    await ensureReady();

    let loaded = null;
    if (idbAvailable && !idbBroken) {
      try {
        const shellRec = await idb.idbGet('kv', 'shell');
        const appsRec = await idb.idbGet('kv', 'apps');
        const kanjiProgressRec = await idb.idbGet('kv', kanjiProgressKey);
        const studyTimeRec = await idb.idbGet('kv', studyTimeKey);
        const collRecs = await idb.idbGetAll('collections');

        loaded = {
          shell: (shellRec && shellRec.value && typeof shellRec.value === 'object') ? shellRec.value : {},
          apps: (appsRec && appsRec.value && typeof appsRec.value === 'object') ? appsRec.value : {},
          collections: {},
          kv: {
            [kanjiProgressKey]: (kanjiProgressRec && kanjiProgressRec.value && typeof kanjiProgressRec.value === 'object' && !Array.isArray(kanjiProgressRec.value)) ? kanjiProgressRec.value : {},
            [studyTimeKey]: (studyTimeRec && studyTimeRec.value && typeof studyTimeRec.value === 'object' && !Array.isArray(studyTimeRec.value)) ? studyTimeRec.value : null,
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
        console.warn('[Persistence] IndexedDB read failed, falling back to localStorage', e);
      }
    }

    if (!loaded) {
      loaded = loadFromLocalStorageFallback() || { shell: {}, apps: {}, collections: {}, kv: {} };
    }

    const kvLoaded = (loaded.kv && typeof loaded.kv === 'object') ? { ...loaded.kv } : { [kanjiProgressKey]: {} };
    const kvNormalized = maybeDecompressStudyTimeRecord(kvLoaded, studyTimeKey);

    uiState.shell = (loaded.shell && typeof loaded.shell === 'object') ? loaded.shell : {};
    uiState.apps = (loaded.apps && typeof loaded.apps === 'object') ? loaded.apps : {};
    uiState.collections = (loaded.collections && typeof loaded.collections === 'object') ? loaded.collections : {};
    uiState.kv = kvNormalized;

    emitter?.emit?.();
    return snapshotUiState(uiState);
  }

  function installFlushGuards() {
    try {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') scheduleFlush({ immediate: true });
      });
      window.addEventListener('pagehide', () => scheduleFlush({ immediate: true }));
    } catch {
      // ignore
    }
  }

  return {
    ensureReady,
    load,
    flush,
    scheduleFlush,
    markDirty,
    installFlushGuards,
  };
}
