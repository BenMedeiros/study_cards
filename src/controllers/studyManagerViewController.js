import controllerFactory from './controller.js';
import { normalizeTableSettings, createDefaultTableSettings, cloneTableSettings } from '../utils/browser/tableSettings.js';

const VIEW = 'studyManagerView';
const DEFAULT_ACTION_ORDER = ['clear', 'copyJson', 'copyFullJson'];
const LEGACY_RECOMMENDATIONS_TABLE_ID = '__legacy';

function makeDefaultTableSettings() {
  return createDefaultTableSettings(DEFAULT_ACTION_ORDER);
}

function makeDefaultCardsState() {
  return {
    summary: { collapsed: false },
    dailySummary: { collapsed: false },
    studyTimeByDate: { collapsed: false, hideRepeated: false },
    recommendations: {
      collapsed: false,
      collapsedById: {},
      sortKey: 'focusCountDesc',
      minimumEntryCount: 5,
      viewMode: 'cards',
      tableSettingsById: {},
    },
    studyTimeByFilter: { collapsed: false, tableSettings: makeDefaultTableSettings() },
    groupByAppId: { collapsed: false, tableSettings: makeDefaultTableSettings() },
  };
}

const DEFAULT_VIEW = {
  cards: makeDefaultCardsState(),
};

function normalizeCollapsedById(v) {
  const src = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return Object.fromEntries(
    Object.entries(src).map(([key, val]) => [String(key || '').trim(), !!val]).filter(([key]) => key)
  );
}

function normalizeTableSettingsById(v) {
  const src = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(src)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    out[key] = normalizeTableSettings(rawValue);
  }
  return out;
}

function cloneCardsState(value) {
  const defaults = makeDefaultCardsState();
  const src = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  return {
    summary: { collapsed: !!src?.summary?.collapsed },
    dailySummary: { collapsed: !!src?.dailySummary?.collapsed },
    studyTimeByDate: {
      collapsed: !!src?.studyTimeByDate?.collapsed,
      hideRepeated: !!src?.studyTimeByDate?.hideRepeated,
    },
    recommendations: {
      collapsed: !!src?.recommendations?.collapsed,
      collapsedById: normalizeCollapsedById(src?.recommendations?.collapsedById),
      sortKey: String(src?.recommendations?.sortKey || defaults.recommendations.sortKey).trim() || defaults.recommendations.sortKey,
      minimumEntryCount: Math.max(1, Math.round(Number(src?.recommendations?.minimumEntryCount) || defaults.recommendations.minimumEntryCount)),
      viewMode: String(src?.recommendations?.viewMode || defaults.recommendations.viewMode).trim() === 'table' ? 'table' : 'cards',
      tableSettingsById: normalizeTableSettingsById(src?.recommendations?.tableSettingsById),
    },
    studyTimeByFilter: {
      collapsed: !!src?.studyTimeByFilter?.collapsed,
      tableSettings: normalizeTableSettings(src?.studyTimeByFilter?.tableSettings || defaults.studyTimeByFilter.tableSettings),
    },
    groupByAppId: {
      collapsed: !!src?.groupByAppId?.collapsed,
      tableSettings: normalizeTableSettings(src?.groupByAppId?.tableSettings || defaults.groupByAppId.tableSettings),
    },
  };
}

function normalizeViewState(value) {
  const src = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const cardsSrc = (src.cards && typeof src.cards === 'object' && !Array.isArray(src.cards)) ? src.cards : {};
  const recommendationTableSettingsById = normalizeTableSettingsById(cardsSrc?.recommendations?.tableSettingsById);

  if (!recommendationTableSettingsById[LEGACY_RECOMMENDATIONS_TABLE_ID] && src.recommendationsTable) {
    recommendationTableSettingsById[LEGACY_RECOMMENDATIONS_TABLE_ID] = normalizeTableSettings(src.recommendationsTable);
  }

  return {
    cards: cloneCardsState({
      ...cardsSrc,
      studyTimeByFilter: {
        ...(cardsSrc?.studyTimeByFilter || {}),
        tableSettings: cardsSrc?.studyTimeByFilter?.tableSettings || src.filtersTable || makeDefaultTableSettings(),
      },
      groupByAppId: {
        ...(cardsSrc?.groupByAppId || {}),
        tableSettings: cardsSrc?.groupByAppId?.tableSettings || src.appsTable || makeDefaultTableSettings(),
      },
      recommendations: {
        ...(cardsSrc?.recommendations || {}),
        tableSettingsById: recommendationTableSettingsById,
      },
    }),
  };
}

function mergeCardsState(currentCards, patchCards) {
  const current = cloneCardsState(currentCards);
  const patch = (patchCards && typeof patchCards === 'object' && !Array.isArray(patchCards)) ? patchCards : {};
  return cloneCardsState({
    ...current,
    ...patch,
    studyTimeByDate: {
      ...current.studyTimeByDate,
      ...(patch.studyTimeByDate || {}),
    },
    recommendations: {
      ...current.recommendations,
      ...(patch.recommendations || {}),
      collapsedById: {
        ...current.recommendations.collapsedById,
        ...(patch?.recommendations?.collapsedById || {}),
      },
      tableSettingsById: {
        ...current.recommendations.tableSettingsById,
        ...(patch?.recommendations?.tableSettingsById || {}),
      },
    },
    studyTimeByFilter: {
      ...current.studyTimeByFilter,
      ...(patch.studyTimeByFilter || {}),
      tableSettings: normalizeTableSettings(patch?.studyTimeByFilter?.tableSettings || current.studyTimeByFilter.tableSettings),
    },
    groupByAppId: {
      ...current.groupByAppId,
      ...(patch.groupByAppId || {}),
      tableSettings: normalizeTableSettings(patch?.groupByAppId?.tableSettings || current.groupByAppId.tableSettings),
    },
  });
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
      cards: (v) => validateCards(v),
    }
  );

  function get() {
    const state = base.get() || {};
    return normalizeViewState(state);
  }

  async function replaceState(nextState) {
    const normalized = normalizeViewState(nextState);
    return base.replace(normalized);
  }

  function getCardsState() {
    return cloneCardsState(get().cards);
  }

  function getFiltersTableSettings() {
    return normalizeTableSettings(get().cards?.studyTimeByFilter?.tableSettings || makeDefaultTableSettings());
  }

  function getAppsTableSettings() {
    return normalizeTableSettings(get().cards?.groupByAppId?.tableSettings || makeDefaultTableSettings());
  }

  function getRecommendationsTableSettings(recommendationId = '') {
    const cards = get().cards;
    const id = String(recommendationId || '').trim();
    const byId = cards?.recommendations?.tableSettingsById || {};
    return normalizeTableSettings(byId[id] || byId[LEGACY_RECOMMENDATIONS_TABLE_ID] || makeDefaultTableSettings());
  }

  async function setFiltersTableSettings(nextTable) {
    const cards = get().cards;
    const nextCards = mergeCardsState(cards, {
      studyTimeByFilter: { tableSettings: normalizeTableSettings(nextTable) },
    });
    return replaceState({ cards: nextCards });
  }

  async function setAppsTableSettings(nextTable) {
    const cards = get().cards;
    const nextCards = mergeCardsState(cards, {
      groupByAppId: { tableSettings: normalizeTableSettings(nextTable) },
    });
    return replaceState({ cards: nextCards });
  }

  async function setRecommendationsTableSettings(nextTable, { recommendationId = '' } = {}) {
    const cards = get().cards;
    const id = String(recommendationId || '').trim() || LEGACY_RECOMMENDATIONS_TABLE_ID;
    const nextCards = mergeCardsState(cards, {
      recommendations: {
        tableSettingsById: {
          [id]: normalizeTableSettings(nextTable),
        },
      },
    });
    return replaceState({ cards: nextCards });
  }

  async function setCardsState(nextCards) {
    const merged = mergeCardsState(get().cards, nextCards);
    return replaceState({ cards: merged });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    replace: replaceState,
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
  return makeDefaultTableSettings();
}

function getDefaultAppsTableSettings() {
  return makeDefaultTableSettings();
}

function getDefaultRecommendationsTableSettings() {
  return makeDefaultTableSettings();
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
