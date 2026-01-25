import { nowIso, uuid } from './utils/helpers.js';

export function createStore() {
  const subs = new Set();

  const state = {
    collections: [],
    // Path-like key, e.g. "japanese/jp_n5_verbs.json"
    activeCollectionId: null,
    // Folder-browsing tree derived from collections/index.json
    collectionTree: null,
    // Ephemeral UI: do not persist this to sessionStorage
    collectionBrowserPath: null,
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
    return state.collections.find((c) => c.key === state.activeCollectionId) ?? null;
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

  function normalizeFolderPath(folderPath) {
    const p = String(folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    return p;
  }

  function dirname(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    if (parts.length <= 1) return '';
    parts.pop();
    return parts.join('/');
  }

  function basename(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function titleFromFilename(filename) {
    return String(filename || '')
      .replace(/\.json$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
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
    if (folder in cache) return cache[folder];

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
    const paths = Array.isArray(index?.collections) ? index.collections : [];

    // Optional: explicit folder metadata location map to avoid probing missing files.
    const folderMetadataMap = buildFolderMetadataMap(index?.folderMetadata);

    // Build a folder tree for browsing (independent of JSON validity).
    state.collectionTree = buildCollectionTreeFromPaths(paths);

    // Cache folder metadata (inherited resolution) by folder path
    const metadataCache = {};
    
    const loaded = [];
    for (const relPath of paths) {
      const url = `./collections/${relPath}`;
      const res = await fetch(url);
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

      // Path-based key replaces metadata.id
      const key = relPath;

      // Apply inherited folder metadata (nearest `_metadata.json` up the folder chain)
      const folderPath = dirname(relPath);
      const folderMetadata = (await loadInheritedFolderMetadata(folderPath, metadataCache, folderMetadataMap)) || { fields: [], category: folderPath.split('/')[0] || '' };
      data = mergeMetadata(data, folderMetadata);

      // Ensure required bits exist, and avoid relying on metadata.id.
      data.metadata = data.metadata || {};
      if (!data.metadata.name) {
        data.metadata.name = titleFromFilename(basename(relPath));
      }
      // If legacy metadata.id exists, keep it but do not use it anywhere.

      loaded.push({ ...data, key });
    }

    return loaded;
  }

  async function initialize() {
    try {
      const seed = await loadSeedCollections();
      state.collections = seed;

      // Restore from session if possible (before defaulting to first)
      let restored = null;
      try {
        const session = loadSessionState();
        restored = session?.shell?.activeCollectionId || null;
      } catch (e) {
        restored = null;
      }

      if (restored && state.collections.some(c => c.key === restored)) {
        await setActiveCollectionId(restored);
      } else if (!state.activeCollectionId && state.collections.length > 0) {
        // Persist via setter so session state is updated
        await setActiveCollectionId(state.collections[0]?.key ?? null);
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
      const exists = state.collections.some(c => c.key === collectionId);
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

  function getShellVoiceSettings() {
    try {
      const session = readSessionState();
      const v = session?.shell?.voice;
      return (v && typeof v === 'object') ? { ...v } : null;
    } catch (e) {
      return null;
    }
  }

  function setShellVoiceSettings(patch) {
    try {
      const session = readSessionState();
      session.shell = session.shell || {};
      const prev = (session.shell.voice && typeof session.shell.voice === 'object') ? session.shell.voice : {};

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

      session.shell.voice = next;
      saveSessionState(session);
    } catch (e) {
      // ignore
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
    listCollectionDir,
    getCollectionBrowserPath: () => {
      return (typeof state.collectionBrowserPath === 'string') ? state.collectionBrowserPath : null;
    },
    setCollectionBrowserPath: (path) => {
      state.collectionBrowserPath = typeof path === 'string' ? path : String(path || '');
      // Ephemeral UI change: do not notify subscribers to avoid
      // re-rendering the shell while dropdowns/overlays are open.
    },
    getShellVoiceSettings,
    setShellVoiceSettings,
    loadKanjiUIState,
    saveKanjiUIState,
  };
}
