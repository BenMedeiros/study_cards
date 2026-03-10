import controllerFactory from './controller.js';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../utils/tableSettings.js';

const VIEW = 'manageCollectionsView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];

const DEFAULT_VIEW = {
  historyTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
};

function validateTable(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('historyTable must be an object');
  }
  normalizeTableSettings(v);
}

function create(collKey) {
  const base = controllerFactory.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    { historyTable: validateTable }
  );

  function get() {
    const state = base.get() || {};
    const historyTable = normalizeTableSettings(state.historyTable);
    return { ...state, historyTable };
  }

  function getHistoryTableSettings() {
    const state = get();
    return normalizeTableSettings(state.historyTable);
  }

  async function setHistoryTableSettings(nextTable) {
    const normalized = normalizeTableSettings(nextTable);
    return base.set({ historyTable: normalized });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getHistoryTableSettings,
    setHistoryTableSettings,
  };
}

function getDefaultHistoryTableSettings() {
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
  getDefaultHistoryTableSettings,
};
