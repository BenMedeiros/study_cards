import controllerFactory from './controller.js';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../utils/browser/tableSettings.js';

const VIEW = 'collectionsView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];

const DEFAULT_VIEW = {
  collectionsTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
};

function validateTable(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('collectionsTable must be an object');
  }
  normalizeTableSettings(v);
}

function create(collKey) {
  const base = controllerFactory.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    { collectionsTable: validateTable }
  );

  function get() {
    const state = base.get() || {};
    const collectionsTable = normalizeTableSettings(state.collectionsTable);
    return { ...state, collectionsTable };
  }

  function getCollectionsTableSettings() {
    const state = get();
    return normalizeTableSettings(state.collectionsTable);
  }

  async function setCollectionsTableSettings(nextTable) {
    const normalized = normalizeTableSettings(nextTable);
    return base.set({ collectionsTable: normalized });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getCollectionsTableSettings,
    setCollectionsTableSettings,
  };
}

function getDefaultCollectionsTableSettings() {
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
  getDefaultCollectionsTableSettings,
};
