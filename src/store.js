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
        state.activeCollectionId = state.collections[0]?.metadata?.id ?? null;
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
        state.activeCollectionId = collectionId;
        notify();
      }
    }
  }

  return {
    subscribe,
    initialize,

    getCollections,
    getActiveCollectionId,
    getActiveCollection,
    setActiveCollectionId,
    syncCollectionFromURL,
  };
}
