import collectionSettingsController from './collectionSettingsController.js';
import { settingsLogControllers } from '../managers/settingsManager.js';

// Generic view controller factory. Handles common lifecycles: fetching collection,
// ready promise, get/set/reset, subscribe/unsubscribe, and dispose.
function createViewController(collKey, viewName, defaults = {}, validators = {}) {
  if (!collKey) throw new Error('collKey required');
  if (!viewName) throw new Error('viewName required');

  let disposed = false;
  const localSubs = new Set();
  let collection = null;
  settingsLogControllers('controller.create', { collKey, viewName });
  const ready = collectionSettingsController.fetchCollection(collKey).then(c => { collection = c; settingsLogControllers('controller.ready', { collKey, viewName }); return c; });

  function _ensureNotDisposed() { if (disposed) throw new Error('controller disposed'); }

  function get() {
    _ensureNotDisposed();
    settingsLogControllers('controller.get', { collKey, viewName });
    const persisted = collectionSettingsController.getView(collKey, viewName) || {};
    return { ...defaults, ...persisted };
  }

  async function set(patch) {
    _ensureNotDisposed();
    settingsLogControllers('controller.set.start', { collKey, viewName, patch });
    if (!patch || typeof patch !== 'object') throw new Error('patch object required');
    await ready;
    const keys = Object.keys(patch);
    for (const k of keys) {
      const vfn = validators && validators[k];
      if (typeof vfn === 'function') {
        const res = vfn(patch[k], collection);
        if (res && typeof res.then === 'function') await res;
      }
    }
    const res = collectionSettingsController.setView(collKey, viewName, patch);
    settingsLogControllers('controller.set.complete', { collKey, viewName, patch });
    return res;
  }

  function reset() {
    _ensureNotDisposed();
    settingsLogControllers('controller.reset', { collKey, viewName });
    return collectionSettingsController.setView(collKey, viewName, { ...defaults });
  }

  function subscribe(cb) {
    _ensureNotDisposed();
    if (typeof cb !== 'function') throw new Error('callback required');
    settingsLogControllers('controller.subscribe', { collKey, viewName });
    const unsub = collectionSettingsController.subscribe(collKey, (newState, patch) => {
      const viewState = (newState && newState[viewName]) || {};
      const viewPatch = (patch && patch[viewName]) || {};
      cb(viewState, viewPatch, newState, patch);
    });
    localSubs.add(unsub);
    return () => { localSubs.delete(unsub); settingsLogControllers('controller.unsubscribe', { collKey, viewName }); unsub(); };
  }

  function dispose() {
    if (disposed) return; disposed = true;
    settingsLogControllers('controller.dispose', { collKey, viewName });
    for (const u of Array.from(localSubs)) u();
    localSubs.clear();
  }

  return { collKey, ready, get, set, reset, subscribe, dispose };
}

export default { createViewController };
