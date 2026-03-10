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

function normalizeSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const cols = (src.columns && typeof src.columns === 'object') ? src.columns : {};
  const acts = (src.actions && typeof src.actions === 'object') ? src.actions : {};
  const table = (src.table && typeof src.table === 'object') ? src.table : {};
  const stylesRaw = (cols.stylesByKey && typeof cols.stylesByKey === 'object') ? cols.stylesByKey : {};
  const stylesByKey = {};
  for (const [k, v] of Object.entries(stylesRaw)) {
    const key = String(k || '').trim();
    if (!key) continue;
    const st = normalizeStyle(v);
    if (Object.keys(st).length) stylesByKey[key] = st;
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
} = {}) {
  return new Promise((resolve) => {
    const inputColumns = Array.isArray(columns) ? columns : [];
    const inputActions = Array.isArray(actions) ? actions : [];

    const columnKeys = inputColumns.map(c => String(c?.key || '').trim()).filter(Boolean);
    const actionKeys = inputActions.map(a => String(a?.key || '').trim()).filter(Boolean);

    const base = normalizeSettings(settings || {});
    const state = cloneJson(base, base) || base;

    state.columns.orderKeys = [
      ...state.columns.orderKeys.filter(k => columnKeys.includes(k)),
      ...columnKeys.filter(k => !state.columns.orderKeys.includes(k)),
    ];
    state.columns.hiddenKeys = state.columns.hiddenKeys.filter(k => columnKeys.includes(k));

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
    const initialSnapshot = JSON.stringify(normalizeSettings(state));

    const columnsSection = el('div', { className: 'table-settings-section' });
    const actionsSection = el('div', { className: 'table-settings-section' });
    const tableSection = el('div', { className: 'table-settings-section' });
    const columnsBody = el('div', { className: 'table-settings-section-body' });
    const actionsBody = el('div', { className: 'table-settings-section-body' });
    const tableBody = el('div', { className: 'table-settings-section-body' });

    const collapsed = { columns: true, actions: true, table: true };
    const expandedDetailsByCol = {};
    let closed = false;
    let saveBtn = null;

    function currentSnapshot() {
      return JSON.stringify(normalizeSettings(state));
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
        close(normalizeSettings(state));
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

    function renderColumns() {
      columnsBody.innerHTML = '';
      const order = state.columns.orderKeys.slice();
      const hidden = new Set(state.columns.hiddenKeys);

      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const meta = inputColumns.find(c => String(c?.key || '') === key) || { key, label: key };
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
      close(normalizeSettings(state));
    });

    controls.append(cancelBtn, saveBtn);

    renderSectionToggle({ section: 'columns', titleText: 'Columns', body: columnsBody, root: columnsSection });
    renderSectionToggle({ section: 'actions', titleText: 'Actions', body: actionsBody, root: actionsSection });
    renderSectionToggle({ section: 'table', titleText: 'Table', body: tableBody, root: tableSection });

    dialog.append(title, info, globalMsg, columnsSection, actionsSection, tableSection, controls);
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

    renderColumns();
    renderActions();
    renderTableSettings();
    updateSaveState();
    try { dialog.focus(); } catch (e) {}
  });
}



























