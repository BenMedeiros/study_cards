import * as idb from '../utils/idb.js';

// Namespaced localStorage key for shell UI state
const SHELL_LS_KEY = 'study_cards:v1';

// Legacy decompression removed — app assumes new per-session store shape.

// Convention: per-app UI state is stored under the namespaced blob at
// `study_cards:v1` -> `apps` using the app/view's module name as the key.
// Example: the entity explorer view persists its settings under
// `apps.entityExplorer` (see src/apps/entityExplorerView.js).

function loadLocalKey(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocalKey(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj || {}));
  } catch {
    // ignore
  }
}

export function createPersistenceManager({ uiState, emitter, kanjiProgressKey = 'kanji_progress', grammarProgressKey = 'grammar_progress', studyTimeKey = 'study_time' }) {
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
          console.warn('[Persistence] IndexedDB unavailable', e);
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
          // Merge updates into a single namespaced blob so shell/apps are
          // stored together under `study_cards:v1`.
          if (doShell || doApps) {
            try {
              const existing = loadLocalKey(SHELL_LS_KEY) || {};
              const blob = (existing && typeof existing === 'object') ? { ...existing } : {};
              if (doShell) blob.shell = uiState.shell || {};
              if (doApps) blob.apps = uiState.apps || {};
              saveLocalKey(SHELL_LS_KEY, blob);
            } catch (e) {
              // fallback to separate writes
              if (doShell) saveLocalKey(SHELL_LS_KEY, uiState.shell || {});
              if (doApps) saveLocalKey('apps', uiState.apps || {});
            }
          }
          for (const k of kvKeys) {
            if (k === kanjiProgressKey) {
              // Write individual kanji progress rows into the generic study_progress store.
              const kp = uiState.kv?.[kanjiProgressKey] || {};
              if (kp && typeof kp === 'object') {
                for (const kid of Object.keys(kp)) {
                  const entryId = String(kid);
                  const rec = { id: `japanese.words|${entryId}`, collection: 'japanese.words', entryKey: entryId, value: kp[kid] };
                  puts.push(idb.idbPut('study_progress', rec));
                }
              }
            } else if (k === grammarProgressKey) {
              // Write individual grammar progress rows into the generic study_progress store.
              const gp = uiState.kv?.[grammarProgressKey] || {};
              if (gp && typeof gp === 'object') {
                for (const gid of Object.keys(gp)) {
                  const entryId = String(gid);
                  const rec = { id: `grammar|${entryId}`, collection: 'grammar', entryKey: entryId, value: gp[gid] };
                  puts.push(idb.idbPut('study_progress', rec));
                }
              }
            } else if (k === studyTimeKey) {
              // study_time sessions are stored in `study_time_sessions`; skip writing the whole blob.
            } else {
              // Store small arbitrary kv entries in localStorage under a prefix.
              try {
                saveLocalKey(`kv__${k}`, uiState.kv?.[k] || {});
              } catch {
                // ignore
              }
            }
          }
          for (const id of colls) {
            puts.push(idb.idbPut('collection_settings', { id, value: uiState.collections?.[id] || {} }));
          }
          if (puts.length) await Promise.all(puts);
          return;
        } catch (e) {
          idbBroken = true;
          console.warn('[Persistence] IndexedDB write failed', e);
        }
      }

      // IndexedDB not available or write failed — do nothing (no fallback).
      console.warn('[Persistence] Skipping persistence; IndexedDB unavailable or broken');
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
        const blobLocal = loadLocalKey(SHELL_LS_KEY) || {};
        // Backwards-compat: if an old `apps` key exists, prefer it for apps
        // unless the namespaced blob already contains apps.
        const legacyApps = loadLocalKey('apps');
        const shellRec = (blobLocal && blobLocal.shell && typeof blobLocal.shell === 'object') ? { value: blobLocal.shell } : null;
        const appsRec = (blobLocal && blobLocal.apps && typeof blobLocal.apps === 'object') ? { value: blobLocal.apps } : (legacyApps ? { value: legacyApps } : null);
        // Prefer new consolidated `study_progress` store; fall back to legacy stores if missing.
        const studyProgressRows = await idb.idbGetAll('study_progress').catch(() => null);
        let kanjiProgressRows = null;
        let grammarProgressRows = null;
        if (Array.isArray(studyProgressRows) && studyProgressRows.length > 0) {
          // Extract per-collection maps from study_progress rows.
          kanjiProgressRows = [];
          grammarProgressRows = [];
          for (const r of studyProgressRows) {
            if (!r || typeof r !== 'object') continue;
            const coll = String(r.collection || '');
            if (coll === 'japanese.words') {
              kanjiProgressRows.push({ id: String(r.entryKey || r.id || ''), value: r.value });
            } else if (coll === 'grammar') {
              grammarProgressRows.push({ id: String(r.entryKey || r.id || ''), value: r.value });
            }
          }
        } else {
          // fallback to legacy per-store reads
          kanjiProgressRows = await idb.idbGetAll('kanji_progress').catch(() => []);
          grammarProgressRows = await idb.idbGetAll('grammar_progress').catch(() => []);
        }
        const studyTimeRows = await idb.idbGetAll('study_time_sessions');
        const collRecs = await idb.idbGetAll('collection_settings');

        const kanjiMap = {};
        for (const r of (Array.isArray(kanjiProgressRows) ? kanjiProgressRows : [])) {
          if (!r || typeof r !== 'object') continue;
          const id = r.id;
          if (!id) continue;
          kanjiMap[id] = (r.value && typeof r.value === 'object') ? r.value : r.value;
        }
        const grammarMap = {};
        for (const r of (Array.isArray(grammarProgressRows) ? grammarProgressRows : [])) {
          if (!r || typeof r !== 'object') continue;
          const id = r.id;
          if (!id) continue;
          grammarMap[id] = (r.value && typeof r.value === 'object') ? r.value : r.value;
        }
        // Build study_time sessions array from per-session rows (sorted by startIso ascending)
        const sessions = [];
        for (const r of (Array.isArray(studyTimeRows) ? studyTimeRows : [])) {
          if (!r || typeof r !== 'object') continue;
          const s = r;
          // store entries may include startIso, endIso, appId, collectionId, durationMs
          const sess = {
            appId: String(s.appId || ''),
            collectionId: String(s.collectionId || ''),
            startIso: String(s.startIso || ''),
            endIso: String(s.endIso || ''),
            durationMs: Math.round(Number(s.durationMs) || 0),
          };
          if (s.heldTableSearch) sess.heldTableSearch = String(s.heldTableSearch);
          if (s.studyFilter) sess.studyFilter = String(s.studyFilter);
          sessions.push(sess);
        }
        sessions.sort((a, b) => String(a.startIso || '').localeCompare(String(b.startIso || '')));

        loaded = {
          shell: (shellRec && shellRec.value && typeof shellRec.value === 'object') ? shellRec.value : {},
          apps: (appsRec && appsRec.value && typeof appsRec.value === 'object') ? appsRec.value : {},
          collections: {},
          kv: {
            [kanjiProgressKey]: kanjiMap,
            [grammarProgressKey]: grammarMap,
            [studyTimeKey]: { version: 1, sessions },
          },
        };

        // Load any small kv entries saved in localStorage under the `kv__` prefix
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('kv__')) continue;
            const realKey = k.slice(4);
            try {
              const parsed = JSON.parse(localStorage.getItem(k));
              if (parsed !== null && parsed !== undefined) loaded.kv[realKey] = parsed;
            } catch {
              // ignore parse errors
            }
          }
        } catch {
          // ignore localStorage iteration errors
        }

        for (const r of (Array.isArray(collRecs) ? collRecs : [])) {
          if (!r || typeof r !== 'object') continue;
          const id = r.id;
          if (!id) continue;
          const v = r.value;
          if (v && typeof v === 'object') loaded.collections[id] = v;
        }
      } catch (e) {
        idbBroken = true;
        console.warn('[Persistence] IndexedDB read failed', e);
      }
    }
    if (!loaded) {
      // IndexedDB not available or read failed — initialize empty state (no localStorage fallback).
      loaded = { shell: {}, apps: {}, collections: {}, kv: {} };
    }

    const kvLoaded = (loaded.kv && typeof loaded.kv === 'object') ? { ...loaded.kv } : { [kanjiProgressKey]: {} };
    const kvNormalized = kvLoaded;

    uiState.shell = (loaded.shell && typeof loaded.shell === 'object') ? loaded.shell : {};
    uiState.apps = (loaded.apps && typeof loaded.apps === 'object') ? loaded.apps : {};
    uiState.collections = (loaded.collections && typeof loaded.collections === 'object') ? loaded.collections : {};
    uiState.kv = kvNormalized;

    emitter?.emit?.();
    return { shell: uiState.shell || {}, apps: uiState.apps || {}, collections: uiState.collections || {}, kv: uiState.kv || {} };
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

  async function appendStudySession(session = {}) {
    try {
      await ensureReady();
      if (!idbAvailable || idbBroken) return;
      const s = session || {};
      const startIso = String(s.startIso || '').trim();
      if (!startIso) return;
      const rec = {
        startIso,
        endIso: String(s.endIso || ''),
        appId: String(s.appId || ''),
        collectionId: String(s.collectionId || ''),
        durationMs: Math.round(Number(s.durationMs) || 0),
        // optional fields (filters) — preserve if provided
        ...(s.heldTableSearch ? { heldTableSearch: String(s.heldTableSearch) } : {}),
        ...(s.studyFilter ? { studyFilter: String(s.studyFilter) } : {}),
      };
      await idb.idbPut('study_time_sessions', rec).catch((e) => {
        idbBroken = true;
        console.warn('[Persistence] Failed to append study session', e);
      });
    } catch (e) {
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
    appendStudySession,
  };
}
