import controllerFactory from './controller.js';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../utils/tableSettings.js';

const VIEW = 'studyManagerView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];

const DEFAULT_VIEW = {
  filtersTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  appsTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  sessionsTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
};

function validateTable(v, name) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${name} must be an object`);
  }
  normalizeTableSettings(v);
}

function create(collKey) {
  const base = controllerFactory.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    {
      filtersTable: (v) => validateTable(v, 'filtersTable'),
      appsTable: (v) => validateTable(v, 'appsTable'),
      sessionsTable: (v) => validateTable(v, 'sessionsTable'),
    }
  );

  function get() {
    const state = base.get() || {};
    const filtersTable = normalizeTableSettings(state.filtersTable);
    const appsTable = normalizeTableSettings(state.appsTable);
    const sessionsTable = normalizeTableSettings(state.sessionsTable);
    return { ...state, filtersTable, appsTable, sessionsTable };
  }

  function getFiltersTableSettings() {
    return normalizeTableSettings(get().filtersTable);
  }

  function getAppsTableSettings() {
    return normalizeTableSettings(get().appsTable);
  }

  function getSessionsTableSettings() {
    return normalizeTableSettings(get().sessionsTable);
  }

  async function setFiltersTableSettings(nextTable) {
    return base.set({ filtersTable: normalizeTableSettings(nextTable) });
  }

  async function setAppsTableSettings(nextTable) {
    return base.set({ appsTable: normalizeTableSettings(nextTable) });
  }

  async function setSessionsTableSettings(nextTable) {
    return base.set({ sessionsTable: normalizeTableSettings(nextTable) });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getFiltersTableSettings,
    getAppsTableSettings,
    getSessionsTableSettings,
    setFiltersTableSettings,
    setAppsTableSettings,
    setSessionsTableSettings,
  };
}

function getDefaultFiltersTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function getDefaultAppsTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function getDefaultSessionsTableSettings() {
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
  getDefaultFiltersTableSettings,
  getDefaultAppsTableSettings,
  getDefaultSessionsTableSettings,
};
