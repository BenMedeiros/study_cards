// Simple Collection Settings Controller
// Responsibilities:
// - Provide an in-memory API for per-collection settings
// - Persist changes via store.collections.saveCollectionState
// - Provide subscribe/notify for UI wiring

let _store = null;
const cache = new Map();
const subs = new Map(); // collKey -> Set(callback)
import { settingsLogControllers } from '../managers/settingsManager.js';

const DEFAULTS = {
  expansion_i: [],
  expansion_na: [],
  heldTableSearch: '',
  savedTableSearches: [],
  isShuffled: false,
  order_hash_int: null,
  studyFilter: 'null,focus,learned',
};


const collectionDefaults = {
  collection: "japanese/japanese_words.json",
  savedTableSearches: [
    "{type:i-adjective}",
    "{type:godan-verb} & {kanji:%む}",
    "{type:godan-verb} & {kanji:%ぶ}",
    "{type:godan-verb} & {kanji:%ぬ}",
    "{type:godan-verb} & {kanji:%る}",
    "{type:godan-verb} & {kanji:%う}",
    "{type:godan-verb} & {kanji:%つ}",
    "{type:godan-verb} & {kanji:%く}",
    "{type:godan-verb} & {kanji:%ぐ}",
    "{type:godan-verb} & {kanji:%す}",
    "{type:godan-verb} & {kanji:%ふ}",
    "%pokemon%",
    "%animal%",
    "%color%"
  ]
};

// Apply any collection-specific defaults for a given collection key.
function applyCollectionDefaults(collKey, target) {
  if (!collKey || !target) return;
  if (collKey !== collectionDefaults.collection) return;
  for (const [k, v] of Object.entries(collectionDefaults)) {
    // skip the collection identifier key itself
    if (k === 'collection') continue;
    const cur = target[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(cur) || cur.length === 0) target[k] = v.slice();
    } else if (cur === undefined || cur === null || cur === '') {
      target[k] = v;
    }
  }
}

// Apply and persist collection-specific defaults for a collection key.
function applyDefaults(collKey) {
  if (!collKey) throw new Error('collKey required');
  if (!_store) throw new Error('controller not initialized');
  settingsLogControllers('collectionSettingsController.applyDefaults', { collKey });
  const current = get(collKey) || {};
  const next = { ...current };
  applyCollectionDefaults(collKey, next);
  const patch = {};
  for (const [k, v] of Object.entries(collectionDefaults)) {
    if (k === 'collection') continue;
    const curVal = current[k];
    const nextVal = next[k];
    const curStr = (curVal === undefined) ? undefined : JSON.stringify(curVal);
    const nextStr = (nextVal === undefined) ? undefined : JSON.stringify(nextVal);
    if (curStr !== nextStr) patch[k] = nextVal;
  }
  if (Object.keys(patch).length === 0) return current;
  _store.collections.saveCollectionState(collKey, patch);
  cache.set(collKey, next);
  _notify(collKey, next, patch);
  return next;
}

function init({ store }) {
  _store = store;
  settingsLogControllers('collectionSettingsController.init', { storePresent: !!store });
}

function _load(collKey) {
  if (!_store) throw new Error('controller not initialized');
  const raw = _store.collections.loadCollectionState(collKey) || {};
  const merged = { ...DEFAULTS, ...raw };
  applyCollectionDefaults(collKey, merged);
  cache.set(collKey, merged);
  return merged;
}

function get(collKey) {
  if (!collKey) return null;
  if (cache.has(collKey)) return cache.get(collKey);
  return _load(collKey);
}

function set(collKey, patch) {
  if (!collKey) return null;
  if (!_store) throw new Error('controller not initialized');
  settingsLogControllers('collectionSettingsController.set', { collKey, patch });
  const current = get(collKey) || {};
  const next = { ...current, ...patch };
  _store.collections.saveCollectionState(collKey, patch);
  cache.set(collKey, next);
  _notify(collKey, next, patch);
  return next;
}

function getView(collKey, viewName) {
  const st = get(collKey) || {};
  return (st[viewName] && typeof st[viewName] === 'object') ? { ...st[viewName] } : {};
}

function setView(collKey, viewName, patch) {
  if (!collKey) return null;
  settingsLogControllers('collectionSettingsController.setView', { collKey, viewName, patch });
  const current = get(collKey) || {};
  const curView = (current[viewName] && typeof current[viewName] === 'object') ? current[viewName] : {};
  const nextView = { ...curView, ...patch };
  const patchObj = { [viewName]: nextView };
  _store.collections.saveCollectionState(collKey, patchObj);
  const next = { ...current, [viewName]: nextView };
  cache.set(collKey, next);
  _notify(collKey, next, patchObj);
  return nextView;
}

function subscribe(collKey, cb) {
  if (!collKey) throw new Error('collKey required');
  if (typeof cb !== 'function') throw new Error('callback required');
  settingsLogControllers('collectionSettingsController.subscribe', { collKey });
  let set = subs.get(collKey);
  if (!set) { set = new Set(); subs.set(collKey, set); }
  set.add(cb);
  return () => { set.delete(cb); };
}

function _notify(collKey, newState, patch) {
  const set = subs.get(collKey);
  if (!set) return;
  settingsLogControllers('collectionSettingsController._notify.start', { collKey, subscribers: set.size, patch });
  for (const cb of Array.from(set)) cb(newState, patch);
  settingsLogControllers('collectionSettingsController._notify.complete', { collKey, subscribers: set.size });
}

function getStore() {
  return _store;
}

// Shared helpers for view controllers
function ensureArray(v, name) {
  if (!Array.isArray(v)) throw new Error(`${name} must be an array`);
  return v.slice();
}

async function fetchCollection(collKey) {
  if (!collKey) throw new Error('collKey required');
  const store = getStore();
  if (!store) throw new Error('controller not initialized');
  settingsLogControllers('collectionSettingsController.fetchCollection', { collKey });
  // Prefer collections.loadCollection (manager API); fall back to collectionDB.getCollection
  if (store.collections && typeof store.collections.loadCollection === 'function') {
    return await store.collections.loadCollection(collKey);
  }
  if (store.collectionDB && typeof store.collectionDB.getCollection === 'function') {
    return await store.collectionDB.getCollection(collKey);
  }
  throw new Error('collections manager not available on store');
}

export default {
  init,
  get,
  set,
  getView,
  setView,
  subscribe,
  getStore,
  ensureArray,
  fetchCollection,
  applyDefaults,
};
