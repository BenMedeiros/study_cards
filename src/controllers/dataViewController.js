import controllerFactory from './controller.js';

const VIEW = 'dataView';

const DEFAULT_TABLE_VIRTUALIZATION = {
  enabled: true,
  threshold: 50,
  overscan: 10,
  rowHeightPx: 36,
};

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
  table: {
    virtualization: { ...DEFAULT_TABLE_VIRTUALIZATION },
  },
  sources: {
    customized: false,
    relatedColumns: [],
    studyProgressFields: [],
    configByKey: {},
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

function toWholeNumber(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function normalizeVirtualization(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const enabled = (typeof src.enabled === 'boolean') ? src.enabled : DEFAULT_TABLE_VIRTUALIZATION.enabled;
  const threshold = Math.max(0, toWholeNumber(src.threshold, DEFAULT_TABLE_VIRTUALIZATION.threshold));
  const overscan = Math.max(0, toWholeNumber(src.overscan, DEFAULT_TABLE_VIRTUALIZATION.overscan));
  const rowHeightPx = Math.max(16, toWholeNumber(src.rowHeightPx, DEFAULT_TABLE_VIRTUALIZATION.rowHeightPx));
  return { enabled, threshold, overscan, rowHeightPx };
}
const JSON_VIEWER_BUTTON_KEYS = ['maximize', 'copy', 'wrap', 'toggle'];

function normalizeJsonViewerButtons(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};
  for (const k of JSON_VIEWER_BUTTON_KEYS) {
    if (typeof src[k] === 'boolean') out[k] = src[k];
  }
  return out;
}

function normalizeColumnStyle(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};

  const wordBreak = String(src.wordBreak || '').trim();
  if (wordBreak) out.wordBreak = wordBreak;

  const width = toCssSize(src.width ?? src.minWidth ?? src.maxWidth);
  if (width) out.width = width;

  if (typeof src.useJsonViewer === 'boolean') out.useJsonViewer = src.useJsonViewer;
  const jsonViewerButtons = normalizeJsonViewerButtons(src.jsonViewerButtons);
  if (Object.keys(jsonViewerButtons).length) out.jsonViewerButtons = jsonViewerButtons;
  if (typeof src.jsonViewerDefaultExpanded === 'boolean') out.jsonViewerDefaultExpanded = src.jsonViewerDefaultExpanded;

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
  const table = (src.table && typeof src.table === 'object') ? src.table : {};
  const sources = (src.sources && typeof src.sources === 'object') ? src.sources : {};
  const sourceConfigByKey = (sources.configByKey && typeof sources.configByKey === 'object') ? sources.configByKey : {};
  const normalizedConfigByKey = {};
  for (const [rawKey, rawConfig] of Object.entries(sourceConfigByKey)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const cfg = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const mode = String(cfg.mode || '').trim() || 'tokenList';
    const dedupe = (typeof cfg.dedupe === 'boolean') ? cfg.dedupe : (mode !== 'json');
    normalizedConfigByKey[key] = { mode, dedupe };
  }
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
    table: {
      virtualization: normalizeVirtualization(table.virtualization),
    },
    sources: {
      customized: !!sources.customized,
      relatedColumns: normalizeKeyList(sources.relatedColumns),
      studyProgressFields: normalizeKeyList(sources.studyProgressFields),
      configByKey: normalizedConfigByKey,
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







