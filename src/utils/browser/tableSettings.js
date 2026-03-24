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

  if (typeof src.jsonViewerDefaultExpanded === 'boolean') {
    out.jsonViewerDefaultExpanded = src.jsonViewerDefaultExpanded;
  }

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

export const DEFAULT_TABLE_VIRTUALIZATION = {
  enabled: true,
  threshold: 50,
  overscan: 10,
  rowHeightPx: 36,
};

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

export function normalizeTableSettings(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const cols = (src.columns && typeof src.columns === 'object') ? src.columns : {};
  const acts = (src.actions && typeof src.actions === 'object') ? src.actions : {};
  const table = (src.table && typeof src.table === 'object') ? src.table : {};
  const searchQuery = String(table.searchQuery || '').trim();
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
      searchQuery,
    },
  };
}

export function createDefaultTableSettings(actionOrder = []) {
  return {
    columns: {
      orderKeys: [],
      hiddenKeys: [],
      stylesByKey: {},
    },
    actions: {
      orderKeys: normalizeKeyList(actionOrder),
      hiddenKeys: [],
    },
    table: {
      virtualization: normalizeVirtualization(null),
      searchQuery: '',
    },
  };
}
export function resolveOrderedKeys(savedOrder, availableKeys) {
  const current = normalizeKeyList(availableKeys);
  const saved = normalizeKeyList(savedOrder).filter(k => current.includes(k));
  const missing = current.filter(k => !saved.includes(k));
  return [...saved, ...missing];
}

export function applyTableColumnSettings({ headers, rows, tableSettings }) {
  const hs = Array.isArray(headers) ? headers : [];
  const rs = Array.isArray(rows) ? rows : [];
  const settings = normalizeTableSettings(tableSettings);

  const byKey = new Map();
  hs.forEach((h, i) => {
    const key = String((h && typeof h === 'object') ? (h.key || '') : (h || '')).trim();
    if (key && !byKey.has(key)) byKey.set(key, i);
  });

  const allKeys = hs
    .map(h => String((h && typeof h === 'object') ? (h.key || '') : (h || '')).trim())
    .filter(Boolean);

  const orderKeys = resolveOrderedKeys(settings?.columns?.orderKeys, allKeys);
  const hiddenSet = new Set(normalizeKeyList(settings?.columns?.hiddenKeys).filter(k => allKeys.includes(k)));
  const visibleKeys = orderKeys.filter(k => !hiddenSet.has(k));

  const nextHeaders = visibleKeys.map(k => hs[byKey.get(k)]).filter(Boolean);
  const nextRows = rs.map((row) => {
    const out = visibleKeys.map((k) => {
      const idx = byKey.get(k);
      return (idx == null) ? '' : row[idx];
    });
    try { out.__id = row.__id; } catch (e) {}
    return out;
  });

  return {
    headers: nextHeaders,
    rows: nextRows,
    allKeys,
    orderKeys,
    hiddenKeys: Array.from(hiddenSet),
    visibleKeys,
  };
}

export function applyTableColumnStyles({ wrapper, tableSettings }) {
  const settings = normalizeTableSettings(tableSettings);
  const map = (settings?.columns?.stylesByKey && typeof settings.columns.stylesByKey === 'object')
    ? settings.columns.stylesByKey
    : {};

  const rootEl = wrapper || null;
  if (!rootEl) return;

  for (const [rawKey, style] of Object.entries(map)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const nodes = rootEl.querySelectorAll(`th[data-field="${key}"], td[data-field="${key}"]`);
    if (!nodes || !nodes.length) continue;

    const wordBreak = String(style?.wordBreak || '').trim();
    const width = String(style?.width || '').trim();

    for (const node of Array.from(nodes)) {
      if (wordBreak) node.style.wordBreak = wordBreak;
      if (width) {
        node.style.setProperty('text-wrap-mode', 'wrap');
        node.style.width = width;
        node.style.minWidth = width;
        node.style.maxWidth = width;
      }
    }
  }
}

export function applyTableActionSettings({ searchWrap, tableSettings, actionItems = [] }) {
  if (!searchWrap) return;

  const settings = normalizeTableSettings(tableSettings);
  const actionKeys = (Array.isArray(actionItems) ? actionItems : [])
    .map(a => String(a?.key || '').trim())
    .filter(Boolean);

  const order = resolveOrderedKeys(settings?.actions?.orderKeys, actionKeys);
  const hidden = new Set(normalizeKeyList(settings?.actions?.hiddenKeys).filter(k => actionKeys.includes(k)));

  const nodesByKey = new Map();
  for (const key of actionKeys) {
    const node = searchWrap.querySelector(`[data-table-action="${key}"]`);
    if (node) nodesByKey.set(key, node);
  }

  for (const [key, node] of nodesByKey.entries()) {
    node.style.display = hidden.has(key) ? 'none' : '';
  }

  for (const key of order) {
    if (hidden.has(key)) continue;
    const node = nodesByKey.get(key);
    if (node) searchWrap.append(node);
  }
}

function extractCellTextForStats(cell) {
  if (cell == null) return '';
  if (typeof HTMLElement !== 'undefined' && cell instanceof HTMLElement) {
    const searchValue = String(cell?.dataset?.searchValue || '').trim();
    if (searchValue) return searchValue;
    return String(cell.textContent || '').trim();
  }
  if (typeof cell === 'string') return cell.trim();
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  try {
    return String(JSON.stringify(cell) || '').trim();
  } catch (e) {
    return String(cell || '').trim();
  }
}

function computeColumnStats(rows, count) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const colCount = Math.max(0, Number(count) || 0);
  const stats = Array.from({ length: colCount }, () => ({ min: 0, avg: 0, max: 0, count: 0 }));

  for (let colIndex = 0; colIndex < colCount; colIndex++) {
    let min = Infinity;
    let max = 0;
    let sum = 0;
    let used = 0;

    for (const row of safeRows) {
      if (!Array.isArray(row)) continue;
      const text = extractCellTextForStats(row[colIndex]);
      if (!text) continue;
      const len = text.length;
      min = Math.min(min, len);
      max = Math.max(max, len);
      sum += len;
      used += 1;
    }

    if (used > 0) {
      stats[colIndex] = {
        min,
        max,
        avg: sum / used,
        count: used,
      };
    }
  }

  return stats;
}

function computeObjectColumns(rows, count) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const colCount = Math.max(0, Number(count) || 0);
  const out = Array.from({ length: colCount }, () => false);

  for (const row of safeRows) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < colCount; i++) {
      const cell = row[i];
      if (!cell) continue;
      if (typeof HTMLElement !== 'undefined' && cell instanceof HTMLElement) continue;
      if (typeof cell === 'object') out[i] = true;
    }
  }

  return out;
}
function normalizeSchemaByKey(schemaFields) {
  const out = {};
  const arr = Array.isArray(schemaFields) ? schemaFields : [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const key = String(raw.key || '').trim();
    if (!key) continue;
    out[key] = {
      type: (raw.type == null) ? '' : String(raw.type).trim(),
      description: (raw.description == null) ? '' : String(raw.description).trim(),
      label: (raw.label == null) ? '' : String(raw.label).trim(),
    };
  }
  return out;
}

function roundLen(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (num >= 10) return Math.round(num);
  return Math.round(num * 10) / 10;
}

function getRecommendedWidthPlaceholder(stats) {
  const max = Number(stats?.max || 0);
  const avg = Number(stats?.avg || 0);
  if (!(max > 0 && avg > 0)) return '';
  if (max > (2 * avg)) return `${roundLen(avg)}rem`;
  return '';
}

export function buildTableColumnItems(headers, rows = [], { schemaFields = [] } = {}) {
  const hs = Array.isArray(headers) ? headers : [];
  const statsByCol = computeColumnStats(rows, hs.length);
  const objectFlags = computeObjectColumns(rows, hs.length);
  const schemaByKey = normalizeSchemaByKey(schemaFields);
  const out = [];

  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    const key = String((h && typeof h === 'object') ? (h.key || '') : (h || '')).trim();
    if (!key) continue;

    let label = '';
    let type = '';
    if (h && typeof h === 'object') {
      label = String(h.label || h.key || '').trim();
      type = (h.type == null) ? '' : String(h.type).trim();
    } else {
      label = key;
    }

    const schemaMeta = schemaByKey[key] || {};
    const stats = statsByCol[i] || { min: 0, avg: 0, max: 0, count: 0 };
    out.push({
      key,
      label: label || schemaMeta.label || key,
      type: type || schemaMeta.type || '',
      description: schemaMeta.description || '',
      stats: {
        min: Number(stats.min || 0),
        avg: Number(roundLen(stats.avg || 0)),
        max: Number(stats.max || 0),
        count: Number(stats.count || 0),
      },
      recommendedWidthPlaceholder: getRecommendedWidthPlaceholder(stats),
      hasObjectData: !!objectFlags[i],
    });
  }

  return out;
}

export function attachCardTableSettingsButton({
  cardEl,
  onClick,
  className = 'btn small table-card-settings-btn',
  text = 'Table',
  title = 'Table settings',
} = {}) {
  if (!cardEl || typeof onClick !== 'function') return null;
  const corner = cardEl.querySelector('.card-corner-caption');
  if (!corner) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = String(text || 'Table');
  btn.title = String(title || 'Table settings');
  btn.addEventListener('click', () => { onClick(); });

  corner.insertAdjacentElement('afterend', btn);
  try {
    const w = Math.max(96, (corner.offsetWidth || 0) + 16);
    btn.style.right = `${w}px`;
  } catch (e) {}

  return btn;
}

export function cloneTableSettings(v, fallback = null) {
  return cloneJson(v, fallback);
}










