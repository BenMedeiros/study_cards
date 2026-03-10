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

function cloneJson(v, fallback) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return fallback; }
}

function toText(v) {
  return (v == null) ? '' : String(v);
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

function normalizeStyle(v) {
  const src = (v && typeof v === 'object') ? v : {};
  const out = {};
  const width = String(src.width || src.minWidth || src.maxWidth || '').trim();
  if (width) out.width = width;
  const wb = String(src.wordBreak || '').trim();
  if (wb) out.wordBreak = wb;
  return out;
}

function normalizeSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const cols = (src.columns && typeof src.columns === 'object') ? src.columns : {};
  const acts = (src.actions && typeof src.actions === 'object') ? src.actions : {};
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

    const validation = { byCol: {} };

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
    const columnsBody = el('div', { className: 'table-settings-section-body' });
    const actionsBody = el('div', { className: 'table-settings-section-body' });

    const collapsed = { columns: true, actions: true };
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
          globalMsg.textContent = 'Please fix invalid width values before saving.';
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

    function hasValidationErrors() {
      return Object.keys(validation.byCol).length > 0;
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

    function makeWidthInput(key, msgEl) {
      const current = toText(state.columns.stylesByKey[key]?.width || '');
      const wrap = el('label', { className: 'table-settings-style-item' });
      const cap = el('span', { className: 'table-settings-style-label', text: 'width' });
      const inp = el('input', { className: 'input small', attrs: { type: 'text', value: current, placeholder: 'e.g. 120px' } });

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
        const left = el('div', {
          className: 'table-settings-row-left',
          children: [
            el('strong', { text: toText(meta.label || key) }),
            el('span', { className: 'hint', text: `(${key})` }),
          ],
        });

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
          makeWidthInput(key, msg),
          makeWordBreakDropdown(key)
        );

        const messages = getColMessages(key);
        msg.textContent = messages.join(' ');
        msg.style.display = messages.length ? '' : 'none';

        row.append(head, styles, msg);
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
          updateSaveState();
        });

        const downBtn = el('button', { className: 'btn small', text: 'Down' });
        downBtn.type = 'button';
        downBtn.disabled = i === order.length - 1;
        downBtn.addEventListener('click', () => {
          state.actions.orderKeys = reorderKey(state.actions.orderKeys, key, 1);
          renderActions();
          updateSaveState();
        });

        right.append(hideControl, upBtn, downBtn);
        const msg = el('div', { className: 'table-settings-row-msg hint', text: '' });
        msg.style.display = 'none';
        row.append(left, right, msg);
        actionsBody.append(row);
      }
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
        globalMsg.textContent = 'Please fix invalid width values before saving.';
        updateSaveState();
        return;
      }
      globalMsg.textContent = '';
      close(normalizeSettings(state));
    });

    controls.append(cancelBtn, saveBtn);

    renderSectionToggle({ section: 'columns', titleText: 'Columns', body: columnsBody, root: columnsSection });
    renderSectionToggle({ section: 'actions', titleText: 'Actions', body: actionsBody, root: actionsSection });

    dialog.append(title, info, globalMsg, columnsSection, actionsSection, controls);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) void attemptClose(); });

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
    updateSaveState();
    try { dialog.focus(); } catch (e) {}
  });
}




