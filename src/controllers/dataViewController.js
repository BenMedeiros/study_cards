import controllerFactory from './controller.js';

const VIEW = 'dataView';

const DEFAULT_TABLE_SETTINGS = {
  columns: {
    orderKeys: [],
    hiddenKeys: [],
    stylesByKey: {},
  },
  actions: {
    orderKeys: ['clear', 'copyJson', 'saveFilter', 'copyFullJson'],
    hiddenKeys: [],
  },
};

const DEFAULT_VIEW = {
  dataTable: DEFAULT_TABLE_SETTINGS,
};

function cloneJson(v, fallback) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return fallback; }
}

function normalizeKeyList(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function toCssSize(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `${Math.max(0, Math.round(v))}px`;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return `${Math.max(0, Math.round(Number(s)))}px`;
  return s;
}

function normalizeColumnStyle(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};

  const wordBreak = String(src.wordBreak || '').trim();
  if (wordBreak) out.wordBreak = wordBreak;

  const width = toCssSize(src.width ?? src.minWidth ?? src.maxWidth);
  if (width) out.width = width;

  return out;
}

function normalizeStylesByKey(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};
  for (const [rawKey, rawStyle] of Object.entries(src)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const normalized = normalizeColumnStyle(rawStyle);
    if (Object.keys(normalized).length) out[key] = normalized;
  }
  return out;
}

function normalizeDataTableSettings(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const cols = (src.columns && typeof src.columns === 'object') ? src.columns : {};
  const acts = (src.actions && typeof src.actions === 'object') ? src.actions : {};
  return {
    columns: {
      orderKeys: normalizeKeyList(cols.orderKeys),
      hiddenKeys: normalizeKeyList(cols.hiddenKeys),
      stylesByKey: normalizeStylesByKey(cols.stylesByKey),
    },
    actions: {
      orderKeys: normalizeKeyList(acts.orderKeys),
      hiddenKeys: normalizeKeyList(acts.hiddenKeys),
    },
  };
}

function validateDataTableSettings(v) {
  if (v == null) return;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('dataTable must be an object');
  }
  normalizeDataTableSettings(v);
}

function create(collKey) {
  const base = controllerFactory.createViewController(
    collKey,
    VIEW,
    cloneJson(DEFAULT_VIEW, DEFAULT_VIEW),
    { dataTable: validateDataTableSettings }
  );

  function get() {
    const state = base.get() || {};
    const dataTable = normalizeDataTableSettings(state.dataTable);
    return { ...state, dataTable };
  }

  function getTableSettings() {
    const state = get();
    return normalizeDataTableSettings(state.dataTable);
  }

  async function setTableSettings(nextDataTable) {
    const normalized = normalizeDataTableSettings(nextDataTable);
    return base.set({ dataTable: normalized });
  }

  return {
    collKey: base.collKey,
    ready: base.ready,
    get,
    set: base.set,
    subscribe: base.subscribe,
    dispose: base.dispose,
    getTableSettings,
    setTableSettings,
  };
}

function getDefaultTableSettings() {
  return cloneJson(DEFAULT_TABLE_SETTINGS, DEFAULT_TABLE_SETTINGS);
}

async function forCollection(collKey) {
  const c = create(collKey);
  await c.ready;
  return c;
}

export default {
  create,
  forCollection,
  normalizeDataTableSettings,
  getDefaultTableSettings,
};

