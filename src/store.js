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
      
      loaded.push(data);
    }

    return loaded;
  }

  async function initialize() {
    const seed = await loadSeedCollections();
    state.collections = seed;

    if (!state.activeCollectionId && state.collections.length > 0) {
      state.activeCollectionId = state.collections[0]?.metadata?.id ?? null;
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

    getCollections,
    getActiveCollectionId,
    getActiveCollection,
    setActiveCollectionId,

    logEvent,
  };
}
