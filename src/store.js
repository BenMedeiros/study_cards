import { nowIso, uuid } from './utils/helpers.js';

export function createStore() {
  const subs = new Set();

  const state = {
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
    
    // Update URL with new collection
    const currentHash = location.hash || '#/';
    const [path] = currentHash.slice(1).split('?');
    const newHash = id ? `#${path}?collection=${encodeURIComponent(id)}` : `#${path}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
    
    // Persist shell-level UI state (active collection) to the shared session map
    try {
      const session = loadSessionState();
      session.shell = session.shell || {};
      session.shell.activeCollectionId = state.activeCollectionId;
      saveSessionState(session);
    } catch (e) {
      // ignore
    }

    notify();
  }

  async function loadLanguageMetadata(languagePath) {
    const metadataUrl = `./collections/${languagePath}/metadata.json`;
    const res = await fetch(metadataUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Required metadata.json not found: ${metadataUrl} (status ${res.status})`);
    try {
      const text = await res.text();
      if (!text) throw new Error(`Empty metadata.json at ${metadataUrl}`);
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse metadata.json at ${metadataUrl}: ${err.message}`);
    }
  }

  function mergeMetadata(collection, categoryMetadata) {
    // Start with common fields, then add collection-specific fields
    const commonFieldKeys = new Set(categoryMetadata.commonFields.map(f => f.key));
    const collectionFields = collection.metadata?.fields || [];
    const collectionFieldKeys = new Set(collectionFields.map(f => f.key));
    
    // Use common fields, but allow collection to override
    const mergedFields = [
      ...categoryMetadata.commonFields.filter(f => !collectionFieldKeys.has(f.key)),
      ...collectionFields
    ];
    
    return {
      ...collection,
      metadata: {
        ...collection.metadata,
        fields: mergedFields,
        category: categoryMetadata.category || categoryMetadata.language
      }
    };
  }

  async function loadSeedCollections() {
    const indexRes = await fetch('./collections/index.json', { cache: 'no-store' });
    if (!indexRes.ok) throw new Error(`Failed to load collections index (status ${indexRes.status})`);
    let index;
    try {
      const indexText = await indexRes.text();
      if (!indexText) throw new Error('collections/index.json is empty');
      index = JSON.parse(indexText);
    } catch (err) {
      throw new Error(`Failed to parse collections/index.json: ${err.message}`);
    }
    const paths = Array.isArray(index?.collections) ? index.collections : [];
    
    // Cache category metadata by folder
    const metadataCache = {};
    
    const loaded = [];
    for (const relPath of paths) {
      const url = `./collections/${relPath}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        console.warn(`Failed to load collection: ${relPath}`);
        continue;
      }
      let data;
      try {
        const txt = await res.text();
        if (!txt) {
          console.warn(`Collection file is empty, skipping: ${relPath}`);
          continue;
        }
        data = JSON.parse(txt);
      } catch (err) {
        console.warn(`Invalid JSON in collection ${relPath}: ${err.message}`);
        continue;
      }
      
      // Extract category folder from path
      const pathParts = relPath.split('/');
      if (pathParts.length > 1) {
        const categoryFolder = pathParts[0];
        
        // Load category metadata if not cached
        if (!(categoryFolder in metadataCache)) {
          try {
            metadataCache[categoryFolder] = await loadLanguageMetadata(categoryFolder);
          } catch (err) {
            console.warn(`Failed to load category metadata for ${categoryFolder}: ${err.message}`);
            metadataCache[categoryFolder] = { commonFields: [], category: categoryFolder };
          }
        }

        const categoryMetadata = metadataCache[categoryFolder] || { commonFields: [], category: categoryFolder };
        data = mergeMetadata(data, categoryMetadata);
      }
      
      loaded.push(data);
    }

    return loaded;
  }

  async function initialize() {
    try {
      const seed = await loadSeedCollections();
      state.collections = seed;

      if (!state.activeCollectionId && state.collections.length > 0) {
        // Persist via setter so session state is updated
        await setActiveCollectionId(state.collections[0]?.metadata?.id ?? null);
      }
    } catch (err) {
      console.error(`Failed to initialize collections: ${err.message}`);
      state.collections = [];
      state.activeCollectionId = null;
    }

    notify();
  }

  function syncCollectionFromURL(route) {
    const collectionId = route.query.get('collection');
    if (collectionId && collectionId !== state.activeCollectionId) {
      const exists = state.collections.some(c => c.metadata.id === collectionId);
      if (exists) {
        // Use the setter so the change is persisted to session state and URL updated consistently
        setActiveCollectionId(collectionId);
      }
    }
  }

  // UI state persistence helpers (delegated sessionStorage access)
  // Consolidated session UI state under one top-level key so all apps share one site map.
  const SESSION_KEY = 'studyUIState';

  // Session logging: log objects directly (no custom pretty-printer)

  function loadSessionState() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        console.debug('[Store] loadSessionState', parsed);
        return parsed || {};
      } catch (e) {
        console.debug('[Store] loadSessionState - invalid JSON', raw);
        return {};
      }
    } catch (e) {
      return {};
    }
  }

  // Internal read that does not log. Use this for save/update flows to avoid noisy load logs.
  function readSessionState() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed || {};
      } catch (e) {
        return {};
      }
    } catch (e) {
      return {};
    }
  }

  function saveSessionState(obj) {
    try {
      const raw = JSON.stringify(obj);
      sessionStorage.setItem(SESSION_KEY, raw);
      console.debug('[Store] saveSessionState', obj);
    } catch (e) {
      // ignore
    }
  }

  function loadKanjiUIState() {
    const session = loadSessionState();
    const k = session.kanjiStudyCard;
    if (!k) return null;
    // determine active collection id (prefer in-memory state)
    const collId = state.activeCollectionId || (session.shell && session.shell.activeCollectionId) || null;
    const collState = (collId && k.collections && k.collections[collId]) ? k.collections[collId] : {};
    return {
      // global UI prefs
      fontWeight: k.fontWeight,
      defaultViewMode: k.defaultViewMode,
      autoSpeak: k.autoSpeak,
      // per-collection or fallback
      isShuffled: typeof collState.isShuffled === 'boolean' ? collState.isShuffled : k.isShuffled,
      order: (collState && typeof collState.order !== 'undefined') ? collState.order : k.order || null,
      currentIndex: (collState && typeof collState.currentIndex === 'number') ? collState.currentIndex : (typeof k.currentIndex === 'number' ? k.currentIndex : 0),
    };
  }

  function saveKanjiUIState(stateObj) {
    const session = readSessionState();
    session.kanjiStudyCard = session.kanjiStudyCard || {};
    const k = session.kanjiStudyCard;
    // Persist global UI prefs
    k.fontWeight = stateObj.fontWeight;
    k.defaultViewMode = stateObj.defaultViewMode;
    k.autoSpeak = stateObj.autoSpeak;
    // Persist per-collection state for order/currentIndex/isShuffled
    const collId = state.activeCollectionId || (session.shell && session.shell.activeCollectionId) || null;
    if (collId) {
      k.collections = k.collections || {};
      k.collections[collId] = k.collections[collId] || {};
      k.collections[collId].order = stateObj.order || null;
      k.collections[collId].currentIndex = stateObj.currentIndex;
      k.collections[collId].isShuffled = !!stateObj.isShuffled;
    }
    // Do not store per-collection state at the top-level anymore;
    // per-collection values live only under `kanjiStudyCard.collections`.
    saveSessionState(session);
  }

  return {
    subscribe,
    initialize,
    getCollections,
    getActiveCollectionId,
    getActiveCollection,
    setActiveCollectionId,
    syncCollectionFromURL,
    loadKanjiUIState,
    saveKanjiUIState,
  };
}
