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
    notify();
  }

  // Get settings for an app, merging defaults with collection overrides
  function getAppSettings(appId) {
    const collection = getActiveCollection();
    if (!collection) return getDefaultSettingsForApp(appId);
    
    const defaults = getDefaultSettingsForApp(appId);
    const overrides = collection.metadata?.settings?.[appId] ?? {};
    
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

    // Ensure settings structure exists
    if (!collection.metadata.settings) {
      collection.metadata.settings = {};
    }
    if (!collection.metadata.settings[appId]) {
      collection.metadata.settings[appId] = {};
    }

    const defaults = getDefaultSettingsForApp(appId);
    
    // If value equals default, remove it from overrides
    if (defaults[key] === value) {
      delete collection.metadata.settings[appId][key];
      // Clean up empty objects
      if (Object.keys(collection.metadata.settings[appId]).length === 0) {
        delete collection.metadata.settings[appId];
      }
      if (Object.keys(collection.metadata.settings).length === 0) {
        collection.metadata.settings = {};
      }
    } else {
      // Store override
      collection.metadata.settings[appId][key] = value;
    }

    await saveCollection(collection);
    notify();
  }

  // Reset all settings for an app to defaults
  async function resetAppSettings(appId) {
    const collection = getActiveCollection();
    if (!collection) return;

    if (collection.metadata.settings?.[appId]) {
      delete collection.metadata.settings[appId];
      if (Object.keys(collection.metadata.settings).length === 0) {
        collection.metadata.settings = {};
      }
      await saveCollection(collection);
      notify();
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
      
      // Ensure settings structure exists
      if (!data.metadata.settings) {
        data.metadata.settings = {};
      }
      
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
