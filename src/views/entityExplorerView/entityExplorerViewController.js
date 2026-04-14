import controllerUtils from '../../utils/common/controllerUtils.mjs';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../../utils/browser/tableSettings.js';

const VIEW = 'entityExplorerView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson', 'downloadJson', 'downloadFullJson'];

const DEFAULT_VIEW = {
  storageTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
};

function validateTable(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('storageTable must be an object');
  }
  normalizeTableSettings(v);
}

function create(collKey) {
  const base = controllerUtils.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    { storageTable: validateTable }
  );

  function get() {
    const state = base.get() || {};
    const storageTable = normalizeTableSettings(state.storageTable);
    return { ...state, storageTable };
  }

  function getStorageTableSettings() {
    return normalizeTableSettings(get().storageTable);
  }

  async function setStorageTableSettings(nextTable) {
    const normalized = normalizeTableSettings(nextTable);
    return base.set({ storageTable: normalized });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getStorageTableSettings,
    setStorageTableSettings,
  };
}

function getDefaultStorageTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

async function forCollection(collKey) {
  const c = create(collKey);
  await c.ready;
  return c;
}

export default {
  create,
  forCollection,
  getDefaultStorageTableSettings,
};
