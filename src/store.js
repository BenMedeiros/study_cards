import { detectBackend } from './utils/backend.js';
import { nowIso, uuid } from './utils/time.js';

// Import getDefaultSettings from all apps
import { getDefaultSettings as getFlashcardsDefaults } from './apps/flashcards/flashcards.js';
import { getDefaultSettings as getQaCardsDefaults } from './apps/qaCards/qaCards.js';
import { getDefaultSettings as getCrosswordDefaults } from './apps/crossword/crossword.js';

const APP_DEFAULTS = {
  flashcards: getFlashcardsDefaults,
  qaCards: getQaCardsDefaults,
  crossword: getCrosswordDefaults,
};

export function createStore() {
  const subs = new Set();

  const state = {
    backend: { connected: false, label: 'Backend: unknown' },
    collections: [],
    activeCollectionId: null,
    // Cache for loaded settings: { collectionId: { appId: { ...settings } } }
    settingsCache: {},
  };

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

  async function setActiveCollectionId(id) {
    if (state.activeCollectionId === id) return;
    state.activeCollectionId = id;
    await loadCollectionSettings(id);
    notify();
  }

  // Get settings file path for a collection
  function getSettingsPath(collection) {
    // Extract directory path from collection
    // If collection came from collections/japanese/jp_n5_kanji.json
    // settings should be collections/japanese/jp_n5_kanji.settings.json
    const collectionId = collection.metadata.id;
    
    // Try to find the collection in the loaded list to get its source path
    // For now, assume settings are in same folder as collection JSON
    // We'll use the collection ID to construct the path
    
    // Check if there's a path hint stored on the collection
    if (collection._sourcePath) {
      const basePath = collection._sourcePath.replace(/\.json$/, '');
      return `${basePath}.settings.json`;
    }
    
    // Fallback: assume it's in collections root
    return `./collections/${collectionId}.settings.json`;
  }

  // Load settings for a specific collection
  async function loadCollectionSettings(collectionId) {
    const collection = state.collections.find(c => c.metadata.id === collectionId);
    if (!collection) return;

    const settingsPath = getSettingsPath(collection);
    
    try {
      const res = await fetch(settingsPath, { cache: 'no-store' });
      if (res.ok) {
        const settings = await res.json();
        state.settingsCache[collectionId] = settings || {};
      } else {
        // No settings file exists yet, use empty
        state.settingsCache[collectionId] = {};
      }
    } catch {
      // Settings file doesn't exist or error loading, use empty
      state.settingsCache[collectionId] = {};
    }
  }

  // Get settings for an app, merging defaults with collection overrides
  function getAppSettings(appId) {
    const collection = getActiveCollection();
    if (!collection) return getDefaultSettingsForApp(appId);
    
    const collectionId = collection.metadata.id;
    const defaults = getDefaultSettingsForApp(appId);
    const collectionSettings = state.settingsCache[collectionId] || {};
    const overrides = collectionSettings[appId] || {};
    
    return { ...defaults, ...overrides };
  }

  function getDefaultSettingsForApp(appId) {
    const getDefaults = APP_DEFAULTS[appId];
    if (typeof getDefaults === 'function') {
      return getDefaults();
    }
    return {};
  }

  // Update a single setting for an app
  async function setAppSetting(appId, key, value) {
    const collection = getActiveCollection();
    if (!collection) return;

    const collectionId = collection.metadata.id;
    
    // Ensure settings cache exists for this collection
    if (!state.settingsCache[collectionId]) {
      state.settingsCache[collectionId] = {};
    }
    if (!state.settingsCache[collectionId][appId]) {
      state.settingsCache[collectionId][appId] = {};
    }

    const defaults = getDefaultSettingsForApp(appId);
    
    // If value equals default, remove it from overrides
    if (defaults[key] === value) {
      delete state.settingsCache[collectionId][appId][key];
      // Clean up empty objects
      if (Object.keys(state.settingsCache[collectionId][appId]).length === 0) {
        delete state.settingsCache[collectionId][appId];
      }
    } else {
      // Store override
      state.settingsCache[collectionId][appId][key] = value;
    }

    await saveCollectionSettings(collectionId);
    notify();
  }

  // Reset all settings for an app to defaults
  async function resetAppSettings(appId) {
    const collection = getActiveCollection();
    if (!collection) return;

    const collectionId = collection.metadata.id;
    
    if (state.settingsCache[collectionId]?.[appId]) {
      delete state.settingsCache[collectionId][appId];
      await saveCollectionSettings(collectionId);
      notify();
    }
  }

  // Save settings for a collection to its settings file
  async function saveCollectionSettings(collectionId) {
    const collection = state.collections.find(c => c.metadata.id === collectionId);
    if (!collection) return;

    const settings = state.settingsCache[collectionId] || {};
    
    // If backend connected, push settings to backend
    if (state.backend.connected) {
      try {
        const settingsPath = getSettingsPath(collection);
        const res = await fetch('./api/sync/pushSettings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collectionId,
            settingsPath,
            settings
          }),
        });
        if (res.ok) {
          await logEvent({ type: 'settings.saved', collectionId, appIds: Object.keys(settings) });
        }
      } catch (err) {
        console.error('Failed to save settings:', err);
      }
    }
  }

  async function refreshBackendState() {
    const info = await detectBackend();
    state.backend = info;
    notify();
  }

  async function loadSeedCollections() {
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
      const data = await res.json();
      
      // Store source path for settings file resolution
      data._sourcePath = `./collections/${relPath}`;
      
      loaded.push(data);
    }

    return loaded;
  }

  async function saveCollection(collection) {
    // Update in-memory collection
    const idx = state.collections.findIndex(c => c.metadata.id === collection.metadata.id);
    if (idx >= 0) {
      state.collections[idx] = collection;
    }

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

  async function initialize() {
    const seed = await loadSeedCollections();
    state.collections = seed;

    if (!state.activeCollectionId && state.collections.length > 0) {
      state.activeCollectionId = state.collections[0]?.metadata?.id ?? null;
    }
    
    // Load settings for the active collection
    if (state.activeCollectionId) {
      await loadCollectionSettings(state.activeCollectionId);
    }

    await refreshBackendState();

    // If backend is connected, try to pull latest collections
    if (state.backend.connected) {
      try {
        const res = await fetch('./api/collections', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.collections)) {
            // Merge backend collections with seed collections
            for (const backendCol of data.collections) {
              const idx = state.collections.findIndex(c => c.metadata.id === backendCol.metadata.id);
              if (idx >= 0) {
                // Backend version takes precedence
                state.collections[idx] = backendCol;
              }
            }
          }
        }
      } catch {
        // Ignore backend errors, work with seed data
      }
    }

    await logEvent({ type: 'app.started' });

    notify();
  }

  async function logEvent(payload) {
    const activeCollectionId = state.activeCollectionId;
    const event = {
      id: uuid(),
      ts: nowIso(),
      activeCollectionId,
      ...payload,
    };
    console.log('[Event]', event);
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

    getAppSettings,
    setAppSetting,
    resetAppSettings,

    logEvent,
  };
}
