import { el } from '../ui.js';
import { createDropdown } from '../dropdown.js';
import { confirmDialog } from './confirmDialog.js';

const WORD_BREAK_OPTIONS = [
  { value: '', label: '(default)' },
  { value: 'normal', label: 'normal' },
  { value: 'break-all', label: 'break-all' },
  { value: 'keep-all', label: 'keep-all' },
  { value: 'break-word', label: 'break-word' },
];
const DEFAULT_TABLE_VIRTUALIZATION = {
  enabled: true,
  threshold: 50,
  overscan: 10,
  rowHeightPx: 36,
};

function cloneJson(v, fallback) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return fallback; }
}

function toText(v) {
  return (v == null) ? '' : String(v);
}

function toLengthNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

function toWholeNumber(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function normalizeVirtualizationSettings(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const enabled = (typeof src.enabled === 'boolean') ? src.enabled : DEFAULT_TABLE_VIRTUALIZATION.enabled;
  const threshold = Math.max(0, toWholeNumber(src.threshold, DEFAULT_TABLE_VIRTUALIZATION.threshold));
  const overscan = Math.max(0, toWholeNumber(src.overscan, DEFAULT_TABLE_VIRTUALIZATION.overscan));
  const rowHeightPx = Math.max(16, toWholeNumber(src.rowHeightPx, DEFAULT_TABLE_VIRTUALIZATION.rowHeightPx));
  return { enabled, threshold, overscan, rowHeightPx };
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

const JSON_VIEWER_BUTTON_KEYS = ['maximize', 'copy', 'wrap', 'toggle'];

function normalizeJsonViewerButtons(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};
  for (const k of JSON_VIEWER_BUTTON_KEYS) {
    if (typeof src[k] === 'boolean') out[k] = src[k];
  }
  return out;
}

function normalizeStyle(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};
  const width = String(src.width || src.minWidth || src.maxWidth || '').trim();
  if (width) out.width = width;
  const wb = String(src.wordBreak || '').trim();
  if (wb) out.wordBreak = wb;

  if (typeof src.useJsonViewer === 'boolean') out.useJsonViewer = src.useJsonViewer;
  const jsonViewerButtons = normalizeJsonViewerButtons(src.jsonViewerButtons);
  if (Object.keys(jsonViewerButtons).length) out.jsonViewerButtons = jsonViewerButtons;
  if (typeof src.jsonViewerDefaultExpanded === 'boolean') out.jsonViewerDefaultExpanded = src.jsonViewerDefaultExpanded;

  return out;
}

function normalizeSourceOptions(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const key = String(raw.key || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...raw,
      key,
      label: String(raw.label || key).trim() || key,
      relationName: String(raw.relationName || '').trim(),
      relationLabel: String(raw.relationLabel || raw.relationName || '').trim(),
      description: String(raw.description || '').trim(),
      type: String(raw.type || '').trim(),
      groupedType: String(raw.groupedType || '').trim(),
      sourceMode: String(raw.sourceMode || '').trim(),
      sourceKind: String(raw.sourceKind || '').trim(),
      availableModes: Array.isArray(raw.availableModes) ? raw.availableModes.map((item) => ({
        value: String(item?.value || '').trim(),
        label: String(item?.label || item?.value || '').trim(),
      })).filter(item => item.value) : [],
      defaultSelected: raw.defaultSelected !== false,
    });
  }
  return out;
}

function normalizeSourceConfigByKey(v, sourceOptions = []) {
  const src = (v && typeof v === 'object') ? v : {};
  const optionByKey = new Map((Array.isArray(sourceOptions) ? sourceOptions : []).map(item => [item.key, item]));
  const out = {};
  for (const [rawKey, rawConfig] of Object.entries(src)) {
    const key = String(rawKey || '').trim();
    if (!key || !optionByKey.has(key)) continue;
    const option = optionByKey.get(key) || {};
    const availableModes = Array.isArray(option.availableModes) ? option.availableModes : [];
    const allowedModes = new Set(availableModes.map(item => String(item?.value || '').trim()).filter(Boolean));
    const fallbackMode = String(option.sourceMode || '').trim() || (availableModes[0]?.value || 'tokenList');
    const cfg = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const rawMode = String(cfg.mode || '').trim();
    const mode = (rawMode && (!allowedModes.size || allowedModes.has(rawMode))) ? rawMode : fallbackMode;
    out[key] = { mode };
  }
  for (const option of Array.isArray(sourceOptions) ? sourceOptions : []) {
    const key = String(option?.key || '').trim();
    if (!key || out[key]) continue;
    const fallbackMode = String(option?.sourceMode || '').trim() || (Array.isArray(option?.availableModes) && option.availableModes[0] ? String(option.availableModes[0].value || '').trim() : 'tokenList');
    out[key] = { mode: fallbackMode || 'tokenList' };
  }
  return out;
}

function unwrapArrayTypeOnce(typeText) {
  const txt = String(typeText || '').trim();
  const match = txt.match(/^array<(.*)>$/);
  return match ? String(match[1] || '').trim() : txt;
}

function flattenAllArrayType(typeText) {
  let current = String(typeText || '').trim();
  let prev = '';
  while (current && current !== prev && /^array<.*>$/.test(current)) {
    prev = current;
    current = unwrapArrayTypeOnce(current);
  }
  return current || 'unknown';
}

function getDisplayedSourceType(option, mode) {
  const groupedType = String(option?.groupedType || option?.type || '').trim() || 'array<string>';
  const normalizedMode = String(mode || option?.sourceMode || '').trim();
  if (!normalizedMode || normalizedMode === 'json') return String(option?.type || groupedType).trim() || groupedType;
  if (normalizedMode === 'tokenList') return 'array<string>';
  if (normalizedMode === 'flatten' || normalizedMode === 'flattenUnique') return unwrapArrayTypeOnce(groupedType) || groupedType;
  if (normalizedMode === 'deepFlatten' || normalizedMode === 'deepFlattenUnique') return `array<${flattenAllArrayType(groupedType)}>`;
  return String(option?.type || groupedType).trim() || groupedType;
}

function normalizeSettings(raw, { relatedSources = [], studyProgressSources = [] } = {}) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const cols = (src.columns && typeof src.columns === 'object') ? src.columns : {};
  const acts = (src.actions && typeof src.actions === 'object') ? src.actions : {};
  const table = (src.table && typeof src.table === 'object') ? src.table : {};
  const sources = (src.sources && typeof src.sources === 'object') ? src.sources : {};
  const stylesRaw = (cols.stylesByKey && typeof cols.stylesByKey === 'object') ? cols.stylesByKey : {};
  const stylesByKey = {};
  for (const [k, v] of Object.entries(stylesRaw)) {
    const key = String(k || '').trim();
    if (!key) continue;
    const st = normalizeStyle(v);
    if (Object.keys(st).length) stylesByKey[key] = st;
  }

  const relatedList = normalizeSourceOptions(relatedSources);
  const studyList = normalizeSourceOptions(studyProgressSources);
  const allSourceOptions = [...relatedList, ...studyList];
  const relatedKeySet = new Set(relatedList.map(item => item.key));
  const studyKeySet = new Set(studyList.map(item => item.key));
  const customized = !!sources.customized;

  let relatedColumns = normalizeKeyList(sources.relatedColumns).filter(key => relatedKeySet.has(key));
  let studyProgressFields = normalizeKeyList(sources.studyProgressFields).filter(key => studyKeySet.has(key));

  if (!customized) {
    relatedColumns = relatedList.filter(item => item.defaultSelected !== false).map(item => item.key);
    studyProgressFields = studyList.filter(item => item.defaultSelected !== false).map(item => item.key);
  }

  const selectedSourceKeys = new Set([...relatedColumns, ...studyProgressFields]);
  const allConfigByKey = normalizeSourceConfigByKey(sources.configByKey, allSourceOptions);
  const configByKey = {};
  for (const key of selectedSourceKeys) {
    if (!allConfigByKey[key]) continue;
    configByKey[key] = allConfigByKey[key];
  }

  return {
    columns: {
      orderKeys: normalizeKeyList(cols.orderKeys),
      hiddenKeys: normalizeKeyList(cols.hiddenKeys),
      stylesByKey,
    },
    actions: {
      orderKeys: normalizeKeyList(acts.orderKeys),
      hiddenKeys: normalizeKeyList(acts.hiddenKeys),
    },
    table: {
      virtualization: normalizeVirtualizationSettings(table.virtualization),
    },
    sources: {
      customized,
      relatedColumns,
      studyProgressFields,
      configByKey,
    },
  };
}

function reorderKey(list, key, delta) {
  const idx = list.indexOf(key);
  if (idx < 0) return list;
  const next = idx + delta;
  if (next < 0 || next >= list.length) return list;
  const out = list.slice();
  const tmp = out[idx];
  out[idx] = out[next];
  out[next] = tmp;
  return out;
}

function normalizeCssSizeInput(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return { ok: true, value: '' };
  if (/^\d+(\.\d+)?$/.test(txt)) return { ok: true, value: `${Math.max(0, Number(txt))}px` };
  if (/^\d+(\.\d+)?(px|rem|em|ch|vh|vw|%)$/i.test(txt)) return { ok: true, value: txt };
  if (/^(auto|min-content|max-content|fit-content)$/i.test(txt)) return { ok: true, value: txt };
  return { ok: false, error: 'Use number, px/rem/em/ch/vh/vw/%, or auto/min-content/max-content/fit-content.' };
}

function normalizeNonNegativeIntegerInput(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return { ok: false, error: 'Required.' };
  if (!/^\d+$/.test(txt)) return { ok: false, error: 'Use a whole number (0+).' };
  return { ok: true, value: Math.max(0, Math.round(Number(txt))) };
}

function normalizeMinIntegerInput(raw, minValue, label) {
  const txt = String(raw || '').trim();
  if (!txt) return { ok: false, error: 'Required.' };
  if (!/^\d+$/.test(txt)) return { ok: false, error: `Use a whole number (${minValue}+).` };
  const n = Math.round(Number(txt));
  if (n < minValue) return { ok: false, error: `${label || 'Value'} must be ${minValue} or higher.` };
  return { ok: true, value: n };
}

export function openTableSettingsDialog({
  tableName = 'Table',
  sourceInfo = '',
  columns = [],
  actions = [],
  settings = null,
  relatedSources = [],
  studyProgressSources = [],
} = {}) {
  return new Promise((resolve) => {
    const inputColumns = Array.isArray(columns) ? columns : [];
    const inputActions = Array.isArray(actions) ? actions : [];
    const inputRelatedSources = normalizeSourceOptions(relatedSources);
    const inputStudyProgressSources = normalizeSourceOptions(studyProgressSources);
    const sourceColumnKeys = new Set([
      ...inputRelatedSources.map(item => item.key),
      ...inputStudyProgressSources.map(item => item.key),
    ]);
    const baseColumns = inputColumns.filter((item) => !sourceColumnKeys.has(String(item?.key || '').trim()));
    const allSourceOptions = [...inputRelatedSources, ...inputStudyProgressSources];
    const allSourceOptionByKey = new Map(allSourceOptions.map(item => [item.key, item]));

    const columnKeys = inputColumns.map(c => String(c?.key || '').trim()).filter(Boolean);
    const actionKeys = inputActions.map(a => String(a?.key || '').trim()).filter(Boolean);

    const base = normalizeSettings(settings || {}, {
      relatedSources: inputRelatedSources,
      studyProgressSources: inputStudyProgressSources,
    });
    const state = cloneJson(base, base) || base;

    function getSelectedSourceKeys() {
      return normalizeKeyList([
        ...(state.sources.relatedColumns || []),
        ...(state.sources.studyProgressFields || []),
      ]);
    }

    function getEffectiveColumns() {
      const selected = getSelectedSourceKeys();
      const dynamicSourceColumns = selected.map((key) => {
        const option = allSourceOptionByKey.get(key) || {};
        const existing = inputColumns.find(col => String(col?.key || '').trim() === key) || {};
        const mode = String(state.sources.configByKey?.[key]?.mode || option.sourceMode || '').trim();
        const displayedType = getDisplayedSourceType(option, mode);
        return {
          ...option,
          ...existing,
          key,
          label: String(existing.label || option.label || key).trim() || key,
          type: displayedType,
          sourceMode: mode,
          description: String(option.description || existing.description || '').trim(),
          sourceKind: String(option.sourceKind || existing.sourceKind || '').trim(),
          hasObjectData: !!existing.hasObjectData || /^array<.*object.*>$/.test(displayedType) || /^array<.*array<.*>$/.test(displayedType),
        };
      });
      return [...baseColumns, ...dynamicSourceColumns];
    }

    function normalizeColumnStateToEffectiveColumns() {
      const effectiveKeys = getEffectiveColumns().map(c => String(c?.key || '').trim()).filter(Boolean);
      state.columns.orderKeys = [
        ...state.columns.orderKeys.filter(k => effectiveKeys.includes(k)),
        ...effectiveKeys.filter(k => !state.columns.orderKeys.includes(k)),
      ];
      state.columns.hiddenKeys = state.columns.hiddenKeys.filter(k => effectiveKeys.includes(k));
      for (const key of Object.keys(state.columns.stylesByKey || {})) {
        if (!effectiveKeys.includes(key)) delete state.columns.stylesByKey[key];
      }
    }

    normalizeColumnStateToEffectiveColumns();

    state.actions.orderKeys = [
      ...state.actions.orderKeys.filter(k => actionKeys.includes(k)),
      ...actionKeys.filter(k => !state.actions.orderKeys.includes(k)),
    ];
    state.actions.hiddenKeys = state.actions.hiddenKeys.filter(k => actionKeys.includes(k));

    const validation = { byCol: {}, byTable: {} };

    const backdrop = el('div', { className: 'table-settings-backdrop' });
    const dialog = el('div', {
      className: 'table-settings-dialog card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `${tableName} settings`,
      },
    });

    const title = el('h2', { className: 'table-settings-title', text: `${tableName} Settings` });

    const info = el('div', { className: 'table-settings-info' });
    info.append(el('span', { className: 'hint', text: `Columns: ${columnKeys.length}` }));
    if (sourceInfo) {
      for (const part of String(sourceInfo).split('|').map(s => String(s || '').trim()).filter(Boolean)) {
        info.append(el('span', { className: 'hint', text: part }));
      }
    }

    const globalMsg = el('div', { className: 'table-settings-global-msg hint', text: '' });
    const initialSnapshot = JSON.stringify(normalizeSettings(state, { relatedSources: inputRelatedSources, studyProgressSources: inputStudyProgressSources }));

    if (inputRelatedSources.length) info.append(el('span', { className: 'hint', text: `Related options: ${inputRelatedSources.length}` }));
    if (inputStudyProgressSources.length) info.append(el('span', { className: 'hint', text: `Study metrics: ${inputStudyProgressSources.length}` }));

    const sourcesSection = el('div', { className: 'table-settings-section' });
    const columnsSection = el('div', { className: 'table-settings-section' });
    const actionsSection = el('div', { className: 'table-settings-section' });
    const tableSection = el('div', { className: 'table-settings-section' });
    const sourcesBody = el('div', { className: 'table-settings-section-body' });
    const columnsBody = el('div', { className: 'table-settings-section-body' });
    const actionsBody = el('div', { className: 'table-settings-section-body' });
    const tableBody = el('div', { className: 'table-settings-section-body' });

    const collapsed = { sources: false, columns: true, actions: true, table: true };
    const expandedDetailsByCol = {};
    let closed = false;
    let saveBtn = null;

    function currentSnapshot() {
      return JSON.stringify(normalizeSettings(state, { relatedSources: inputRelatedSources, studyProgressSources: inputStudyProgressSources }));
    }

    function isDirty() {
      return currentSnapshot() !== initialSnapshot;
    }

    function updateSaveState() {
      if (!saveBtn) return;
      const dirty = isDirty();
      const invalid = hasValidationErrors();
      saveBtn.disabled = !dirty || invalid;
      saveBtn.classList.toggle('primary', dirty && !invalid);
    }

    function renderSectionToggle({ section, titleText, body, root }) {
      const btn = el('button', { className: 'btn small table-settings-section-toggle' });
      btn.type = 'button';
      const label = el('span', { text: titleText });
      const icon = el('span', { className: 'table-settings-section-toggle-icon', text: collapsed[section] ? '▸' : '▾' });
      btn.append(icon, label);
      btn.addEventListener('click', () => {
        collapsed[section] = !collapsed[section];
        icon.textContent = collapsed[section] ? '▸' : '▾';
        body.style.display = collapsed[section] ? 'none' : '';
      });
      root.innerHTML = '';
      root.append(btn, body);
      body.style.display = collapsed[section] ? 'none' : '';
    }

    function close(out) {
      if (closed) return;
      closed = true;
      try { document.removeEventListener('keydown', onKeydown, true); } catch (e) {}
      try { document.removeEventListener('pointerdown', dropdownGuard, true); } catch (e) {}
      try { dialog.classList.remove('open'); } catch (e) {}
      try { backdrop.classList.remove('show'); } catch (e) {}

      const cleanup = () => {
        try { backdrop.remove(); } catch (e) {}
      };
      let done = false;
      function finish() { if (done) return; done = true; cleanup(); }
      try { dialog.addEventListener('transitionend', finish); } catch (e) {}
      setTimeout(finish, 220);
      resolve(out);
    }

    async function attemptClose() {
      if (closed) return;
      if (!isDirty()) {
        close(null);
        return;
      }

      const res = await confirmDialog({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Save, discard, or cancel?',
        detail: '',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        saveText: 'Save',
        hasSave: true,
        danger: true,
      });

      if (!res || res === 'cancel') return;
      if (res === 'save') {
        if (hasValidationErrors()) {
          globalMsg.textContent = 'Please fix invalid table settings before saving.';
          updateSaveState();
          return;
        }
        globalMsg.textContent = '';
        close(normalizeSettings(state, { relatedSources: inputRelatedSources, studyProgressSources: inputStudyProgressSources }));
        return;
      }

      close(null);
    }

    function setColFieldError(colKey, field, message) {
      const key = String(colKey || '').trim();
      const f = String(field || '').trim();
      if (!key || !f) return;
      if (!validation.byCol[key]) validation.byCol[key] = {};
      if (!message) delete validation.byCol[key][f];
      else validation.byCol[key][f] = String(message);
      if (validation.byCol[key] && Object.keys(validation.byCol[key]).length === 0) delete validation.byCol[key];
    }

    function getColMessages(colKey) {
      const key = String(colKey || '').trim();
      if (!key || !validation.byCol[key]) return [];
      return Object.values(validation.byCol[key]);
    }

    function setTableFieldError(field, message) {
      const f = String(field || '').trim();
      if (!f) return;
      if (!message) delete validation.byTable[f];
      else validation.byTable[f] = String(message);
    }

    function getTableMessages() {
      return Object.values(validation.byTable || {});
    }

    function hasValidationErrors() {
      return Object.keys(validation.byCol).length > 0 || Object.keys(validation.byTable).length > 0;
    }

    function makeWordBreakDropdown(key) {
      const current = String(state.columns.stylesByKey[key]?.wordBreak || '').trim();
      const wrap = el('label', { className: 'table-settings-style-item' });
      const cap = el('span', { className: 'table-settings-style-label', text: 'word-break' });

      const dd = createDropdown({
        items: WORD_BREAK_OPTIONS.map(o => ({ value: o.value, label: o.label })),
        value: current,
        className: 'table-settings-wordbreak-dropdown',
        closeOverlaysOnOpen: true,
        portalZIndex: 1505,
        onChange: (next) => {
          const cur = { ...(state.columns.stylesByKey[key] || {}) };
          const val = String(next || '').trim();
          if (val) cur.wordBreak = val;
          else delete cur.wordBreak;
          if (Object.keys(cur).length) state.columns.stylesByKey[key] = cur;
          else delete state.columns.stylesByKey[key];
          updateSaveState();
        },
      });

      wrap.append(cap, dd);
      return wrap;
    }

    function makeWidthInput(key, msgEl, meta = null) {
      const current = toText(state.columns.stylesByKey[key]?.width || '');
      const wrap = el('label', { className: 'table-settings-style-item' });
      const cap = el('span', { className: 'table-settings-style-label', text: 'width' });
      const rec = String(meta?.recommendedWidthPlaceholder || '').trim();
      const inp = el('input', { className: 'input small', attrs: { type: 'text', value: current, placeholder: rec || 'e.g. 120px' } });

      function renderMsg() {
        const msgs = getColMessages(key);
        msgEl.textContent = msgs.join(' ');
        msgEl.style.display = msgs.length ? '' : 'none';
      }

      inp.addEventListener('input', () => {
        const parsed = normalizeCssSizeInput(inp.value);
        const cur = { ...(state.columns.stylesByKey[key] || {}) };
        if (!parsed.ok) {
          inp.classList.add('invalid');
          setColFieldError(key, 'width', parsed.error || 'Invalid value.');
        } else {
          inp.classList.remove('invalid');
          setColFieldError(key, 'width', '');
          if (!parsed.value) delete cur.width;
          else cur.width = parsed.value;
        }
        if (Object.keys(cur).length) state.columns.stylesByKey[key] = cur;
        else delete state.columns.stylesByKey[key];
        renderMsg();
        updateSaveState();
      });

      wrap.append(cap, inp);
      return wrap;
    }

    function makeBooleanSetting({ key, styleKey, label, defaultValue = false, compact = false }) {
      const wrap = el('label', { className: compact ? 'table-settings-bool table-settings-bool-compact' : 'table-settings-bool' });
      const box = el('input', { attrs: { type: 'checkbox' } });
      const cur = state.columns.stylesByKey[key] || {};
      const current = (typeof cur[styleKey] === 'boolean') ? cur[styleKey] : defaultValue;
      box.checked = !!current;
      box.addEventListener('change', () => {
        const next = { ...(state.columns.stylesByKey[key] || {}) };
        next[styleKey] = !!box.checked;
        if (Object.keys(next).length) state.columns.stylesByKey[key] = next;
        else delete state.columns.stylesByKey[key];
        updateSaveState();
      });
      wrap.append(box, el('span', { className: 'table-settings-bool-label', text: label }));
      return wrap;
    }

    function makeJsonViewerButtonsControl(key) {
      const wrap = el('div', { className: 'table-settings-json-buttons' });
      wrap.append(el('div', { className: 'table-settings-style-label', text: 'json buttons' }));

      const row = el('div', { className: 'table-settings-json-buttons-row' });
      const cfg = state.columns.stylesByKey[key] || {};
      const buttons = (cfg.jsonViewerButtons && typeof cfg.jsonViewerButtons === 'object') ? cfg.jsonViewerButtons : {};

      function addToggle(btnKey, label) {
        const ctl = el('label', { className: 'table-settings-bool table-settings-bool-compact' });
        const box = el('input', { attrs: { type: 'checkbox' } });
        box.checked = buttons[btnKey] !== false;
        box.addEventListener('change', () => {
          const next = { ...(state.columns.stylesByKey[key] || {}) };
          const nextButtons = { ...(next.jsonViewerButtons || {}) };
          nextButtons[btnKey] = !!box.checked;
          next.jsonViewerButtons = nextButtons;
          if (Object.keys(next).length) state.columns.stylesByKey[key] = next;
          else delete state.columns.stylesByKey[key];
          updateSaveState();
        });
        ctl.append(box, el('span', { className: 'table-settings-bool-label', text: label }));
        row.append(ctl);
      }

      addToggle('maximize', 'Max');
      addToggle('copy', 'Copy');
      addToggle('wrap', 'Wrap');
      addToggle('toggle', 'Expand');

      wrap.append(row);
      return wrap;
    }
    function makeHideControl({ checked, onChange }) {
      const hide = el('label', { className: 'table-settings-hide-control' });
      const hideBox = el('input', { attrs: { type: 'checkbox' } });
      hideBox.checked = !!checked;
      hideBox.addEventListener('change', () => {
        onChange(!!hideBox.checked);
        updateSaveState();
      });
      hide.append(hideBox, el('span', { className: 'table-settings-hide-label', text: 'hide' }));
      return hide;
    }

    function renderSources() {
      sourcesBody.innerHTML = '';

      const sourceHint = el('div', {
        className: 'hint table-settings-sources-intro',
        text: 'Choose which related collection fields and study metrics become real table columns. Source shaping happens here first, then the Columns section only handles the active shaped columns.',
      });
      sourcesBody.append(sourceHint);

      const relatedSelected = new Set(state.sources.relatedColumns || []);
      const studySelected = new Set(state.sources.studyProgressFields || []);
      const relatedGroups = new Map();

      for (const item of inputRelatedSources) {
        const relKey = String(item.relationName || 'related').trim() || 'related';
        const bucket = relatedGroups.get(relKey) || {
          name: relKey,
          label: String(item.relationLabel || item.relationName || relKey).trim() || relKey,
          items: [],
        };
        bucket.items.push(item);
        relatedGroups.set(relKey, bucket);
      }

      function setSourceMode(key, mode) {
        const sourceKey = String(key || '').trim();
        if (!sourceKey) return;
        const option = allSourceOptionByKey.get(sourceKey) || {};
        const availableModes = Array.isArray(option.availableModes) ? option.availableModes : [];
        const allowed = new Set(availableModes.map(item => String(item?.value || '').trim()).filter(Boolean));
        const fallback = String(option.sourceMode || '').trim() || (availableModes[0]?.value || 'tokenList');
        const nextMode = String(mode || '').trim();
        state.sources.configByKey[sourceKey] = {
          mode: (nextMode && (!allowed.size || allowed.has(nextMode))) ? nextMode : fallback,
        };
      }

      function appendSourceOptionRow({ item, selectedSet, onToggle }) {
        const optionRow = el('div', { className: 'table-settings-source-option' });
        const box = el('input', { attrs: { type: 'checkbox' } });
        const isSelected = selectedSet.has(item.key);
        box.checked = isSelected;
        box.addEventListener('change', () => {
          onToggle(!!box.checked);
          state.sources.customized = true;
          if (!box.checked) delete state.sources.configByKey[item.key];
          else setSourceMode(item.key, state.sources.configByKey?.[item.key]?.mode || item.sourceMode || 'tokenList');
          normalizeColumnStateToEffectiveColumns();
          renderSources();
          renderColumns();
          updateSaveState();
        });

        const textWrap = el('div', { className: 'table-settings-source-option-text' });
        const top = el('div', { className: 'table-settings-source-option-top' });
        top.append(
          el('strong', { text: item.label || item.key }),
          el('span', { className: 'hint', text: item.key })
        );
        const currentType = getDisplayedSourceType(item, state.sources.configByKey?.[item.key]?.mode || item.sourceMode || '');
        if (currentType) top.append(el('span', { className: 'hint table-settings-col-type', text: `type: ${currentType}` }));
        if (item.groupedType && item.groupedType !== currentType) {
          top.append(el('span', { className: 'hint table-settings-col-type', text: `raw: ${item.groupedType}` }));
        }
        textWrap.append(top);
        if (item.description) textWrap.append(el('span', { className: 'hint table-settings-source-option-desc', text: item.description }));

        const controls = el('div', { className: 'table-settings-source-controls' });
        if (isSelected && Array.isArray(item.availableModes) && item.availableModes.length) {
          const modeWrap = el('label', { className: 'table-settings-source-mode' });
          modeWrap.append(el('span', { className: 'table-settings-style-label', text: 'shape' }));
          const select = el('select', { className: 'select small', attrs: { 'aria-label': `${item.label || item.key} shape mode` } });
          for (const modeItem of item.availableModes) {
            const optionEl = document.createElement('option');
            optionEl.value = String(modeItem.value || '');
            optionEl.textContent = String(modeItem.label || modeItem.value || '');
            if (optionEl.value === String(state.sources.configByKey?.[item.key]?.mode || item.sourceMode || '')) optionEl.selected = true;
            select.append(optionEl);
          }
          select.addEventListener('change', () => {
            state.sources.customized = true;
            setSourceMode(item.key, select.value);
            normalizeColumnStateToEffectiveColumns();
            renderSources();
            renderColumns();
            updateSaveState();
          });
          modeWrap.append(select);
          controls.append(modeWrap);
        }
        if (controls.childNodes.length) textWrap.append(controls);

        optionRow.append(box, textWrap);
        return optionRow;
      }

      if (relatedGroups.size) {
        for (const group of Array.from(relatedGroups.values())) {
          const row = el('div', { className: 'table-settings-row table-settings-source-row' });
          const head = el('div', { className: 'table-settings-source-group-head' });
          head.append(
            el('strong', { text: group.label }),
            el('div', { className: 'hint', text: `${group.items.filter(item => relatedSelected.has(item.key)).length} selected` })
          );

          const optionsGrid = el('div', { className: 'table-settings-source-grid' });
          for (const item of group.items) {
            optionsGrid.append(appendSourceOptionRow({
              item,
              selectedSet: relatedSelected,
              onToggle: (checked) => {
                const next = new Set(state.sources.relatedColumns || []);
                if (checked) next.add(item.key);
                else next.delete(item.key);
                state.sources.relatedColumns = Array.from(next);
              },
            }));
          }

          row.append(head, optionsGrid);
          sourcesBody.append(row);
        }
      }

      if (inputStudyProgressSources.length) {
        const row = el('div', { className: 'table-settings-row table-settings-source-row' });
        const head = el('div', { className: 'table-settings-source-group-head' });
        head.append(
          el('strong', { text: 'Study Progress' }),
          el('div', { className: 'hint', text: `${inputStudyProgressSources.filter(item => studySelected.has(item.key)).length} selected` })
        );

        const optionsGrid = el('div', { className: 'table-settings-source-grid' });
        for (const item of inputStudyProgressSources) {
          optionsGrid.append(appendSourceOptionRow({
            item,
            selectedSet: studySelected,
            onToggle: (checked) => {
              const next = new Set(state.sources.studyProgressFields || []);
              if (checked) next.add(item.key);
              else next.delete(item.key);
              state.sources.studyProgressFields = Array.from(next);
            },
          }));
        }

        row.append(head, optionsGrid);
        sourcesBody.append(row);
      }

      if (!relatedGroups.size && !inputStudyProgressSources.length) {
        sourcesBody.append(el('div', { className: 'hint', text: 'No configurable related or study source fields are available for this table.' }));
      }
    }

    function renderColumns() {
      columnsBody.innerHTML = '';
      normalizeColumnStateToEffectiveColumns();
      const effectiveColumns = getEffectiveColumns();
      const metaByKey = new Map(effectiveColumns.map(item => [String(item?.key || '').trim(), item]));
      const order = state.columns.orderKeys.slice();
      const hidden = new Set(state.columns.hiddenKeys);

      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const meta = metaByKey.get(key) || { key, label: key };
        const row = el('div', { className: 'table-settings-row' });

        const head = el('div', { className: 'table-settings-row-head' });
        const left = el('div', { className: 'table-settings-row-left' });

        const titleRow = el('div', { className: 'table-settings-name-row' });
        titleRow.append(
          el('strong', { text: toText(meta.label || key) }),
          el('span', { className: 'hint', text: `(${key})` })
        );

        const typeText = String(meta?.type || '').trim();
        if (typeText) {
          titleRow.append(el('span', { className: 'hint table-settings-col-type', text: `type: ${typeText}` }));
        }

        const isSourceColumn = sourceColumnKeys.has(key);
        if (isSourceColumn) {
          const mode = String(state.sources.configByKey?.[key]?.mode || meta?.sourceMode || '').trim();
          if (mode) titleRow.append(el('span', { className: 'hint table-settings-col-type', text: `shape: ${mode}` }));
        }

        const stats = meta?.stats && typeof meta.stats === 'object' ? meta.stats : null;
        const hasStats = !!stats && (Number(stats?.count || 0) > 0 || Number(stats?.max || 0) > 0);

        left.append(titleRow);
        if (hasStats) {
          const min = toLengthNumber(stats?.min || 0);
          const avg = toLengthNumber(stats?.avg || 0);
          const max = toLengthNumber(stats?.max || 0);
          left.append(el('div', {
            className: 'hint table-settings-col-stats',
            text: `chars: [${min},${avg},${max}]`,
          }));
        }

        const descText = String(meta?.description || '').trim();
        if (descText) {
          const descBtn = el('button', {
            className: 'btn small table-settings-desc-toggle',
            text: expandedDetailsByCol[key] ? 'Hide Description' : 'Show Description',
          });
          descBtn.type = 'button';
          const descBody = el('div', {
            className: 'table-settings-col-desc hint',
            text: descText,
          });
          descBody.style.display = expandedDetailsByCol[key] ? '' : 'none';
          descBtn.addEventListener('click', () => {
            expandedDetailsByCol[key] = !expandedDetailsByCol[key];
            descBody.style.display = expandedDetailsByCol[key] ? '' : 'none';
            descBtn.textContent = expandedDetailsByCol[key] ? 'Hide Description' : 'Show Description';
          });
          left.append(descBtn, descBody);
        }

        const right = el('div', { className: 'table-settings-row-right' });

        const hideControl = makeHideControl({
          checked: hidden.has(key),
          onChange: (isHidden) => {
            const next = new Set(state.columns.hiddenKeys);
            if (isHidden) next.add(key);
            else next.delete(key);
            state.columns.hiddenKeys = Array.from(next);
          },
        });

        const upBtn = el('button', { className: 'btn small', text: 'Up' });
        upBtn.type = 'button';
        upBtn.disabled = i === 0;
        upBtn.addEventListener('click', () => {
          state.columns.orderKeys = reorderKey(state.columns.orderKeys, key, -1);
          renderColumns();
          updateSaveState();
        });

        const downBtn = el('button', { className: 'btn small', text: 'Down' });
        downBtn.type = 'button';
        downBtn.disabled = i === order.length - 1;
        downBtn.addEventListener('click', () => {
          state.columns.orderKeys = reorderKey(state.columns.orderKeys, key, 1);
          renderColumns();
          updateSaveState();
        });

        right.append(hideControl, upBtn, downBtn);
        head.append(left, right);

        const msg = el('div', { className: 'table-settings-row-msg hint', text: '' });
        const styles = el('div', { className: 'table-settings-style-grid table-settings-style-grid-simple' });
        styles.append(
          makeWidthInput(key, msg, meta),
          makeWordBreakDropdown(key)
        );

        let jsonSettings = null;
        if (meta?.hasObjectData) {
          jsonSettings = el('div', { className: 'table-settings-json-settings' });
          jsonSettings.append(
            makeBooleanSetting({ key, styleKey: 'useJsonViewer', label: 'use json viewer', defaultValue: true }),
            makeBooleanSetting({ key, styleKey: 'jsonViewerDefaultExpanded', label: 'start expanded', defaultValue: false }),
            makeJsonViewerButtonsControl(key)
          );
        }

        const messages = getColMessages(key);
        msg.textContent = messages.join(' ');
        msg.style.display = messages.length ? '' : 'none';

        row.append(head, styles);
        if (jsonSettings) row.append(jsonSettings);
        row.append(msg);
        columnsBody.append(row);
      }
    }
    function renderActions() {
      actionsBody.innerHTML = '';
      const order = state.actions.orderKeys.slice();
      const hidden = new Set(state.actions.hiddenKeys);

      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const meta = inputActions.find(a => String(a?.key || '') === key) || { key, label: key };
        const row = el('div', { className: 'table-settings-row table-settings-row-simple' });

        const left = el('div', {
          className: 'table-settings-row-left',
          children: [el('strong', { text: toText(meta.label || key) })],
        });

        const right = el('div', { className: 'table-settings-row-right' });

        const hideControl = makeHideControl({
          checked: hidden.has(key),
          onChange: (isHidden) => {
            const next = new Set(state.actions.hiddenKeys);
            if (isHidden) next.add(key);
            else next.delete(key);
            state.actions.hiddenKeys = Array.from(next);
          },
        });

        const upBtn = el('button', { className: 'btn small', text: 'Up' });
        upBtn.type = 'button';
        upBtn.disabled = i === 0;
        upBtn.addEventListener('click', () => {
          state.actions.orderKeys = reorderKey(state.actions.orderKeys, key, -1);
          renderActions();
    renderTableSettings();
    updateSaveState();
        });

        const downBtn = el('button', { className: 'btn small', text: 'Down' });
        downBtn.type = 'button';
        downBtn.disabled = i === order.length - 1;
        downBtn.addEventListener('click', () => {
          state.actions.orderKeys = reorderKey(state.actions.orderKeys, key, 1);
          renderActions();
    renderTableSettings();
    updateSaveState();
        });

        right.append(hideControl, upBtn, downBtn);
        const msg = el('div', { className: 'table-settings-row-msg hint', text: '' });
        msg.style.display = 'none';
        row.append(left, right, msg);
        actionsBody.append(row);
      }
    }
    function renderTableSettings() {
      tableBody.innerHTML = '';
      const row = el('div', { className: 'table-settings-row table-settings-row-table' });

      const head = el('div', { className: 'table-settings-row-head' });
      const left = el('div', {
        className: 'table-settings-row-left',
        children: [
          el('strong', { text: 'Virtual Scrolling' }),
          el('div', { className: 'hint', text: 'Used for larger tables to improve render performance.' }),
        ],
      });
      head.append(left);

      const bodyWrap = el('div', { className: 'table-settings-table-grid' });

      const enabledWrap = el('label', { className: 'table-settings-bool' });
      const enabledBox = el('input', { attrs: { type: 'checkbox' } });
      enabledBox.checked = state.table.virtualization.enabled !== false;
      enabledBox.addEventListener('change', () => {
        state.table.virtualization.enabled = !!enabledBox.checked;
        updateSaveState();
      });
      enabledWrap.append(enabledBox, el('span', { className: 'table-settings-bool-label', text: 'Enable virtualization' }));
      bodyWrap.append(enabledWrap);

      const msg = el('div', { className: 'table-settings-row-msg hint', text: '' });

      function renderTableMsg() {
        const messages = getTableMessages();
        msg.textContent = messages.join(' ');
        msg.style.display = messages.length ? '' : 'none';
      }

      function makeNumInput({ field, label, value, parseFn }) {
        const item = el('label', { className: 'table-settings-style-item' });
        const cap = el('span', { className: 'table-settings-style-label', text: label });
        const inp = el('input', { className: 'input small', attrs: { type: 'text', value: String(value ?? '') } });
        inp.addEventListener('input', () => {
          const parsed = parseFn(inp.value);
          if (!parsed.ok) {
            inp.classList.add('invalid');
            setTableFieldError(field, parsed.error || 'Invalid value.');
          } else {
            inp.classList.remove('invalid');
            setTableFieldError(field, '');
            state.table.virtualization[field] = parsed.value;
          }
          renderTableMsg();
          updateSaveState();
        });
        item.append(cap, inp);
        return item;
      }

      bodyWrap.append(
        makeNumInput({
          field: 'threshold',
          label: 'threshold',
          value: state.table.virtualization.threshold,
          parseFn: normalizeNonNegativeIntegerInput,
        }),
        makeNumInput({
          field: 'overscan',
          label: 'overscan',
          value: state.table.virtualization.overscan,
          parseFn: normalizeNonNegativeIntegerInput,
        }),
        makeNumInput({
          field: 'rowHeightPx',
          label: 'row height (px)',
          value: state.table.virtualization.rowHeightPx,
          parseFn: (raw) => normalizeMinIntegerInput(raw, 16, 'Row height'),
        })
      );

      renderTableMsg();
      row.append(head, bodyWrap, msg);
      tableBody.append(row);
    }
    const controls = el('div', { className: 'table-settings-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => { void attemptClose(); });

    saveBtn = el('button', { className: 'btn small', text: 'Save' });
    saveBtn.type = 'button';
    saveBtn.disabled = true;
    saveBtn.addEventListener('click', () => {
      if (!isDirty()) return;
      if (hasValidationErrors()) {
        globalMsg.textContent = 'Please fix invalid table settings before saving.';
        updateSaveState();
        return;
      }
      globalMsg.textContent = '';
      close(normalizeSettings(state, { relatedSources: inputRelatedSources, studyProgressSources: inputStudyProgressSources }));
    });

    controls.append(cancelBtn, saveBtn);

    renderSectionToggle({ section: 'sources', titleText: 'Sources', body: sourcesBody, root: sourcesSection });
    renderSectionToggle({ section: 'columns', titleText: 'Columns', body: columnsBody, root: columnsSection });
    renderSectionToggle({ section: 'actions', titleText: 'Actions', body: actionsBody, root: actionsSection });
    renderSectionToggle({ section: 'table', titleText: 'Table', body: tableBody, root: tableSection });

    dialog.append(title, info, globalMsg, sourcesSection, columnsSection, actionsSection, tableSection, controls);
    backdrop.append(dialog);
    let lastDropdownInteractionAt = 0;
    const dropdownGuard = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.custom-dropdown') || target.closest('.custom-dropdown-menu')) {
        lastDropdownInteractionAt = Date.now();
      }
    };
    document.addEventListener('pointerdown', dropdownGuard, true);

    backdrop.addEventListener('click', (e) => {
      if (e.target !== backdrop) return;
      if ((Date.now() - lastDropdownInteractionAt) < 250) return;
      void attemptClose();
    });

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        void attemptClose();
      }
    }
    document.addEventListener('keydown', onKeydown, true);
    document.body.append(backdrop);
    requestAnimationFrame(() => {
      try { backdrop.classList.add('show'); } catch (e) {}
      try { dialog.classList.add('open'); } catch (e) {}
    });

    renderSources();
    renderColumns();
    renderActions();
    renderTableSettings();
    updateSaveState();
    try { dialog.focus(); } catch (e) {}
  });
}



























