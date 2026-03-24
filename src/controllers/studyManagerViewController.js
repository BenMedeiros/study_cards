import controllerFactory from './controller.js';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../utils/browser/tableSettings.js';

const VIEW = 'studyManagerView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];
const DEFAULT_CARDS = Object.freeze({
  summary: Object.freeze({ collapsed: false }),
  dailySummary: Object.freeze({ collapsed: false }),
  studyTimeByDate: Object.freeze({ collapsed: false, hideRepeated: false }),
  recommendations: Object.freeze({ collapsed: false, collapsedById: Object.freeze({}), sortKey: 'focusCountDesc', minimumEntryCount: 5, viewMode: 'cards' }),
  studyTimeByFilter: Object.freeze({ collapsed: false }),
  groupByAppId: Object.freeze({ collapsed: false }),
});

const DEFAULT_VIEW = {
  filtersTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  appsTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  recommendationsTable: createDefaultTableSettings(DEFAULT_ACTION_ORDER),
  cards: cloneCardsState(DEFAULT_CARDS),
};

function cloneCardsState(value) {
  const src = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const rawCollapsedById = (src?.recommendations?.collapsedById && typeof src.recommendations.collapsedById === 'object' && !Array.isArray(src.recommendations.collapsedById))
    ? src.recommendations.collapsedById
    : {};
  const collapsedById = Object.fromEntries(
    Object.entries(rawCollapsedById).map(([key, val]) => [String(key || '').trim(), !!val]).filter(([key]) => key)
  );
  return {
    summary: { collapsed: !!src?.summary?.collapsed },
    dailySummary: { collapsed: !!src?.dailySummary?.collapsed },
    studyTimeByDate: {
      collapsed: !!src?.studyTimeByDate?.collapsed,
      hideRepeated: !!src?.studyTimeByDate?.hideRepeated,
    },
    recommendations: {
      collapsed: !!src?.recommendations?.collapsed,
      collapsedById,
      sortKey: String(src?.recommendations?.sortKey || 'focusCountDesc').trim() || 'focusCountDesc',
      minimumEntryCount: Math.max(1, Math.round(Number(src?.recommendations?.minimumEntryCount) || 5)),
      viewMode: String(src?.recommendations?.viewMode || 'cards').trim() === 'table' ? 'table' : 'cards',
    },
    studyTimeByFilter: { collapsed: !!src?.studyTimeByFilter?.collapsed },
    groupByAppId: { collapsed: !!src?.groupByAppId?.collapsed },
  };
}

function validateTable(v, name) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${name} must be an object`);
  }
  normalizeTableSettings(v);
}

function validateCards(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('cards must be an object');
  cloneCardsState(v);
}

function create(collKey) {
  const base = controllerFactory.createViewController(
    collKey,
    VIEW,
    cloneTableSettings(DEFAULT_VIEW, DEFAULT_VIEW),
    {
      filtersTable: (v) => validateTable(v, 'filtersTable'),
      appsTable: (v) => validateTable(v, 'appsTable'),
      recommendationsTable: (v) => validateTable(v, 'recommendationsTable'),
      cards: (v) => validateCards(v),
    }
  );

  function get() {
    const state = base.get() || {};
    const filtersTable = normalizeTableSettings(state.filtersTable);
    const appsTable = normalizeTableSettings(state.appsTable);
    const recommendationsTable = normalizeTableSettings(state.recommendationsTable);
    const cards = cloneCardsState(state.cards);
    return { ...state, filtersTable, appsTable, recommendationsTable, cards };
  }

  function getFiltersTableSettings() {
    return normalizeTableSettings(get().filtersTable);
  }

  function getAppsTableSettings() {
    return normalizeTableSettings(get().appsTable);
  }

  function getCardsState() {
    return cloneCardsState(get().cards);
  }

  function getRecommendationsTableSettings() {
    return normalizeTableSettings(get().recommendationsTable);
  }

  async function setFiltersTableSettings(nextTable) {
    return base.set({ filtersTable: normalizeTableSettings(nextTable) });
  }

  async function setAppsTableSettings(nextTable) {
    return base.set({ appsTable: normalizeTableSettings(nextTable) });
  }

  async function setRecommendationsTableSettings(nextTable) {
    return base.set({ recommendationsTable: normalizeTableSettings(nextTable) });
  }

  async function setCardsState(nextCards) {
    return base.set({ cards: cloneCardsState(nextCards) });
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
    getRecommendationsTableSettings,
    getCardsState,
    setFiltersTableSettings,
    setAppsTableSettings,
    setRecommendationsTableSettings,
    setCardsState,
  };
}

function getDefaultFiltersTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function getDefaultAppsTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function getDefaultRecommendationsTableSettings() {
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
  getDefaultRecommendationsTableSettings,
};
