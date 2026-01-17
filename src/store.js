import { detectBackend } from './utils/backend.js';
import { nowIso, uuid } from './utils/time.js';

const SETTINGS_KEY = 'settings';

const APP_IDS = {
  FLASHCARDS: 'flashcards',
  CROSSWORD: 'crossword',
};

export function createStore() {
  const subs = new Set();

  /** @type {{ backend: { connected: boolean, label: string }, collections: any[], activeCollectionId: string | null }} */
  const state = {
    backend: { connected: false, label: 'Backend: unknown' },
    collections: [],
    activeCollectionId: null,
    /** @type {Record<string, Record<string, { activePresetId: string, presets: Record<string, any> }>>} */
    appSettingsByCollection: {},
    legacyCrosswordMaxWords: 14,
    /** @type {Record<string, any>} */
    seedAppSettingsByAppId: {},
  };

  // Debounced backend push for settings.
  let pushTimer = null;
  let pushInFlight = false;
  let pushQueued = false;

  function notify() {
    for (const fn of subs) fn();
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function getBackendState() {
    return state.backend;
  }

  function getCollections() {
    return state.collections;
  }

  function getActiveCollectionId() {
    return state.activeCollectionId;
  }

  function getActiveCollection() {
    return state.collections.find((c) => c.metadata.id === state.activeCollectionId) ?? null;
  }

  function getSeedAppConfig(appId) {
    return state.seedAppSettingsByAppId?.[appId] ?? null;
  }

  async function loadSeedAppSettings() {
    try {
      const indexRes = await fetch('./settings/index.json', { cache: 'no-store' });
      if (!indexRes.ok) throw new Error('Failed to load settings index');
      const index = await indexRes.json();
      const apps = Array.isArray(index?.apps) ? index.apps : [];

      const loaded = {};
      for (const rel of apps) {
        const url = `./settings/${String(rel ?? '').replace(/^\/+/, '')}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const cfg = await res.json();
        if (cfg?.appId) loaded[String(cfg.appId)] = cfg;
      }

      state.seedAppSettingsByAppId = loaded;
    } catch {
      // If seed files are missing, keep working with fallback defaults.
      state.seedAppSettingsByAppId = {};
    }
  }

  function buildPresetsFromSeed({ appId, collectionId, fieldKeys }) {
    const cfg = getSeedAppConfig(appId);
    if (!cfg) return null;

    const modes = Array.isArray(cfg?.modes) ? cfg.modes : [];
    const presets = {};

    const hasAll = (req) => Array.isArray(req) && req.every((k) => fieldKeys.includes(k));

    for (const mode of modes) {
      if (!mode?.id) continue;
      if (Array.isArray(mode.requiresFieldKeys) && !hasAll(mode.requiresFieldKeys)) continue;

      const rawData = mode?.data ?? {};
      const data = { ...(rawData ?? {}) };

      // Special expansion for flashcards.
      if (data.displayFieldKeys === '__ALL__') {
        data.displayFieldKeys = fieldKeys;
      }

      presets[String(mode.id)] = {
        id: String(mode.id),
        name: String(mode.name ?? mode.id),
        appId,
        collectionId,
        data,
      };
    }

    const defaultModeId = String(cfg.defaultModeId ?? '');
    const activePresetId = presets[defaultModeId] ? defaultModeId : (Object.keys(presets)[0] ?? null);
    if (!activePresetId) return null;

    return { activePresetId, presets };
  }

  function ensureDefaultAppSettingsForCollection(collection) {
    if (!collection?.metadata?.id) return false;
    const collectionId = collection.metadata.id;
    const fields = Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : [];
    const fieldKeys = fields.map((f) => f.key).filter(Boolean);

    state.appSettingsByCollection[collectionId] ??= {};
    const bucket = state.appSettingsByCollection[collectionId];
    let changed = false;

    // Always seed/merge from JSON files when available (to pick up new modes)
    const seeded = buildPresetsFromSeed({
      appId: APP_IDS.FLASHCARDS,
      collectionId,
      fieldKeys,
    });

    if (seeded) {
      if (!bucket[APP_IDS.FLASHCARDS]) {
        // First time - use seeded config entirely
        bucket[APP_IDS.FLASHCARDS] = seeded;
        changed = true;
      } else {
        // Merge: add any new presets from seed that don't exist yet
        const existing = bucket[APP_IDS.FLASHCARDS];
        for (const [presetId, preset] of Object.entries(seeded.presets)) {
          if (!existing.presets[presetId]) {
            existing.presets[presetId] = preset;
            changed = true;
          }
        }
      }
    } else if (!bucket[APP_IDS.FLASHCARDS]) {
      // Fallback (in case seed files are missing)
      const presets = {};
      const allId = 'all_fields';
      presets[allId] = {
        id: allId,
        name: 'All fields',
        appId: APP_IDS.FLASHCARDS,
        collectionId,
        data: { displayFieldKeys: fieldKeys },
      };
      if (fieldKeys.includes('kanji') && fieldKeys.includes('reading')) {
        const krId = 'kanji_reading';
        presets[krId] = {
          id: krId,
          name: 'Kanji + Reading',
          appId: APP_IDS.FLASHCARDS,
          collectionId,
          data: { displayFieldKeys: ['kanji', 'reading'] },
        };
      }
      bucket[APP_IDS.FLASHCARDS] = { activePresetId: allId, presets };
      changed = true;
    }

    if (!bucket[APP_IDS.CROSSWORD]) {
      const seeded = buildPresetsFromSeed({
        appId: APP_IDS.CROSSWORD,
        collectionId,
        fieldKeys,
      });

      if (seeded) {
        // Patch default from legacy setting if not present in seed.
        const active = seeded.presets?.[seeded.activePresetId];
        if (active?.data && typeof active.data.maxWords !== 'number') {
          active.data.maxWords = state.legacyCrosswordMaxWords;
        }
        bucket[APP_IDS.CROSSWORD] = seeded;
      } else {
        const presets = {};
        const basicId = 'default';
        presets[basicId] = {
          id: basicId,
          name: 'Default',
          appId: APP_IDS.CROSSWORD,
          collectionId,
          data: { maxWords: state.legacyCrosswordMaxWords },
        };
        bucket[APP_IDS.CROSSWORD] = { activePresetId: basicId, presets };
      }
      changed = true;
    }

    return changed;
  }

  function ensureDefaultAppSettings() {
    let changed = false;
    for (const c of state.collections) {
      changed = ensureDefaultAppSettingsForCollection(c) || changed;
    }
    return changed;
  }

  function getAppSettingsBucket(collectionId, appId) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return null;
    const collection = state.collections.find((c) => c?.metadata?.id === cId);
    if (collection) {
      const didChange = ensureDefaultAppSettingsForCollection(collection);
      if (didChange) saveSettings().catch(() => {});
    }
    return state.appSettingsByCollection?.[cId]?.[appId] ?? null;
  }

  function getAppSettingsPresets(appId, collectionId = null) {
    const bucket = getAppSettingsBucket(collectionId, appId);
    const presets = bucket?.presets ?? {};
    return Object.values(presets).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function getActiveAppSettingsPresetId(appId, collectionId = null) {
    const bucket = getAppSettingsBucket(collectionId, appId);
    return bucket?.activePresetId ?? null;
  }

  function getActiveAppSettingsPreset(appId, collectionId = null) {
    const bucket = getAppSettingsBucket(collectionId, appId);
    if (!bucket) return null;
    const id = bucket.activePresetId;
    return bucket.presets?.[id] ?? null;
  }

  function getActiveAppSettingsData(appId, collectionId = null) {
    return getActiveAppSettingsPreset(appId, collectionId)?.data ?? null;
  }

  async function setActiveAppSettingsPresetId(appId, presetId, collectionId = null) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return;
    state.appSettingsByCollection[cId] ??= {};
    state.appSettingsByCollection[cId][appId] ??= { activePresetId: presetId, presets: {} };

    const bucket = state.appSettingsByCollection[cId][appId];
    if (!bucket.presets?.[presetId]) return;
    bucket.activePresetId = presetId;
    await saveSettings();
    notify();
  }

  async function upsertAppSettingsPreset(appId, preset, collectionId = null) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return;
    if (!preset?.id) return;

    state.appSettingsByCollection[cId] ??= {};
    state.appSettingsByCollection[cId][appId] ??= { activePresetId: preset.id, presets: {} };
    const bucket = state.appSettingsByCollection[cId][appId];

    bucket.presets[preset.id] = {
      id: String(preset.id),
      name: String(preset.name ?? preset.id),
      appId,
      collectionId: cId,
      data: preset.data ?? {},
    };

    if (!bucket.activePresetId) bucket.activePresetId = preset.id;

    await saveSettings();
    notify();
  }

  async function renameAppSettingsPreset(appId, presetId, newName, collectionId = null) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return;
    const bucket = getAppSettingsBucket(cId, appId);
    if (!bucket) return;
    const preset = bucket.presets?.[presetId];
    if (!preset) return;
    preset.name = String(newName ?? '').trim() || preset.name;
    await saveSettings();
    notify();
  }

  async function deleteAppSettingsPreset(appId, presetId, collectionId = null) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return { ok: false, reason: 'no_collection' };
    const bucket = getAppSettingsBucket(cId, appId);
    if (!bucket) return { ok: false, reason: 'no_bucket' };
    const keys = Object.keys(bucket.presets ?? {});
    if (keys.length <= 1) return { ok: false, reason: 'last_mode' };
    if (!bucket.presets?.[presetId]) return { ok: false, reason: 'not_found' };

    delete bucket.presets[presetId];
    if (bucket.activePresetId === presetId) {
      const nextId = Object.keys(bucket.presets)[0] ?? null;
      if (nextId) bucket.activePresetId = nextId;
    }

    await saveSettings();
    notify();
    return { ok: true };
  }

  async function updateActiveAppSettingsData(appId, patch, collectionId = null) {
    const cId = collectionId ?? state.activeCollectionId;
    if (!cId) return;
    const bucket = getAppSettingsBucket(cId, appId);
    if (!bucket) return;
    const preset = bucket.presets?.[bucket.activePresetId];
    if (!preset) return;

    preset.data = { ...(preset.data ?? {}), ...(patch ?? {}) };
    await saveSettings();
    notify();
  }

  async function setActiveCollectionId(id) {
    state.activeCollectionId = id;
    // Ensure defaults exist for new active collection.
    const active = getActiveCollection();
    if (active) ensureDefaultAppSettingsForCollection(active);
    await saveSettings();
    await logEvent({ type: 'collection.setActive', collectionId: id });
    notify();
  }

  async function saveSettings() {
    const settings = {
      activeCollectionId: state.activeCollectionId,
      appSettingsByCollection: state.appSettingsByCollection,
      // Back-compat in case we want to keep old value around.
      crosswordMaxWords: state.legacyCrosswordMaxWords,
      updatedAt: nowIso(),
    };

    // Push settings to backend immediately (if connected).
    if (state.backend.connected) {
      schedulePushSettingsToBackend();
    }
  }

  function schedulePushSettingsToBackend() {
    if (!state.backend?.connected) return;
    pushQueued = true;
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushSettingsToBackend().catch(() => {});
    }, 350);
  }

  async function pushSettingsToBackend() {
    if (!state.backend?.connected) return;
    if (pushInFlight) return;
    if (!pushQueued) return;

    pushQueued = false;
    pushInFlight = true;
    try {
      const payload = {
        activeCollectionId: state.activeCollectionId,
        appSettingsByCollection: state.appSettingsByCollection,
        updatedAt: nowIso(),
      };

      await fetch('./api/sync/pushSettings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      pushInFlight = false;
      if (pushQueued) schedulePushSettingsToBackend();
    }
  }

  async function pullSettingsFromBackend() {
    if (!state.backend?.connected) return;
    try {
      const res = await fetch('./api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const s = json?.settings;
      if (!s || typeof s !== 'object') return;

      if (s?.activeCollectionId) state.activeCollectionId = s.activeCollectionId;
      if (s?.appSettingsByCollection && typeof s.appSettingsByCollection === 'object') {
        state.appSettingsByCollection = s.appSettingsByCollection;
      }
      notify();
    } catch {
      // ignore
    }
  }

  async function loadSettings() {
    // Settings are now loaded from backend only during pullSettingsFromBackend
    // Initialize with defaults here
    state.appSettingsByCollection = {};
  }

  async function refreshBackendState() {
    const info = await detectBackend();
    state.backend = info;
    notify();
  }

  async function loadSeedCollections() {
    // Relative URLs so GitHub Pages subpaths work.
    const indexRes = await fetch('./collections/index.json', { cache: 'no-store' });
    if (!indexRes.ok) throw new Error('Failed to load collections index');
    const index = await indexRes.json();
    const specs = Array.isArray(index?.collections) ? index.collections : [];

    const encodePath = (p) => {
      const raw = String(p ?? '').replace(/^\/+/, '');
      return raw
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    };

    const toPath = (spec) => {
      const raw = typeof spec === 'string' ? spec : spec?.path;
      if (!raw) return null;
      const cleaned = String(raw).replace(/^\/+/, '');
      return cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;
    };

    const loaded = [];
    for (const spec of specs) {
      const relPath = toPath(spec);
      if (!relPath) continue;
      const url = `./collections/${encodePath(relPath)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load collection: ${relPath}`);
      loaded.push(await res.json());
    }

    return loaded;
  }

  async function initialize() {
    await loadSettings();

    // Load seed app settings from JSON files.
    await loadSeedAppSettings();

    const seed = await loadSeedCollections();
    state.collections = seed;

    // Seed per-collection defaults for settings.
    const didSeed = ensureDefaultAppSettings();
    if (didSeed) await saveSettings();

    if (!state.activeCollectionId) {
      state.activeCollectionId = state.collections[0]?.metadata?.id ?? null;
      if (state.activeCollectionId) await saveSettings();
    }

    await refreshBackendState();

    // If backend is connected, pull the last pushed settings (source of truth for local server sync).
    await pullSettingsFromBackend();

    await logEvent({ type: 'app.started' });

    notify();
  }

  async function logEvent(payload) {
    // Events are now fire-and-forget console logs (no persistence)
    const activeCollectionId = state.activeCollectionId;
    const event = {
      id: uuid(),
      ts: nowIso(),
      activeCollectionId,
      ...payload,
    };
    console.log('[Event]', event);
  }

  async function saveCollectionOverride(collection) {
    // If backend connected, push collection to backend
    if (state.backend.connected) {
      try {
        const res = await fetch('./api/sync/pushCollection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collection),
        });
        if (res.ok) {
          await logEvent({ type: 'collection.saved', collectionId: collection.metadata.id });
        }
      } catch (err) {
        console.error('Failed to save collection:', err);
      }
    }
  }

  return {
    subscribe,
    initialize,

    getBackendState,
    refreshBackendState,

    getCollections,
    getActiveCollectionId,
    getActiveCollection,
    setActiveCollectionId,

    getAppSettingsPresets,
    getActiveAppSettingsPresetId,
    getActiveAppSettingsPreset,
    getActiveAppSettingsData,
    setActiveAppSettingsPresetId,
    upsertAppSettingsPreset,
    renameAppSettingsPreset,
    deleteAppSettingsPreset,
    updateActiveAppSettingsData,

    logEvent,
    saveCollectionOverride,
  };
}
