import { el } from '../../utils/browser/ui.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';

function normalizeItems(items = [], selectedItems = []) {
  const source = Array.isArray(items) ? items : [];
  const selected = Array.isArray(selectedItems) ? selectedItems : [];
  const itemMap = new Map();
  source.forEach((raw) => {
    const key = String(raw?.key || '').trim();
    if (!key || itemMap.has(key)) return;
    itemMap.set(key, {
      key,
      label: String(raw?.label || key).trim() || key,
      description: String(raw?.description || raw?.caption || '').trim(),
      lockVisible: raw?.lockVisible === true,
    });
  });

  const selectedMap = new Map();
  selected.forEach((raw) => {
    const key = String(raw?.key || '').trim();
    if (!key || !itemMap.has(key) || selectedMap.has(key)) return;
    selectedMap.set(key, {
      key,
      visible: raw?.visible !== false,
    });
  });

  const out = [];
  selectedMap.forEach((selectedItem, key) => {
    const item = itemMap.get(key);
    if (!item) return;
    out.push({ ...item, visible: item.lockVisible ? true : selectedItem.visible });
  });
  itemMap.forEach((item, key) => {
    if (selectedMap.has(key)) return;
    out.push({ ...item, visible: true });
  });
  return out;
}

function moveItem(state, fromIndex, toIndex) {
  if (fromIndex === toIndex) return state;
  if (fromIndex < 0 || fromIndex >= state.length) return state;
  if (toIndex < 0 || toIndex >= state.length) return state;
  const next = state.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function createConfigItemCopy(label, keyText) {
  return el('div', {
    className: 'kanji-study-card-config-item-copy',
    children: [
      el('div', { className: 'kanji-study-card-config-item-label', text: label }),
      el('div', { className: 'kanji-study-card-config-item-key hint', text: keyText }),
    ],
  });
}

function createConfigItemRow({ main = null, label = '', keyText = '', controls = [] }) {
  return el('div', {
    className: 'kanji-study-card-config-item',
    children: [
      main || createConfigItemCopy(label, keyText),
      controls.length
        ? el('div', {
          className: 'kanji-study-card-config-item-controls',
          children: controls,
        })
        : null,
    ].filter(Boolean),
  });
}

function createMoveButtons({ index, length, label, onMove }) {
  const createButton = (direction, nextIndex, text) => {
    const btn = el('button', {
      className: 'icon-button kanji-study-card-config-move',
      text,
      attrs: { type: 'button', 'aria-label': `Move ${label} ${direction}` },
    });
    btn.disabled = nextIndex < 0 || nextIndex >= length;
    btn.addEventListener('click', () => onMove(nextIndex));
    return btn;
  };
  return [
    createButton('up', index - 1, '↑'),
    createButton('down', index + 1, '↓'),
  ];
}

function createSelectableReorderRow({
  item,
  index,
  length,
  onToggle,
  onMove,
}) {
  const checkbox = el('input', {
    attrs: {
      type: 'checkbox',
      'aria-label': `Show ${item.label}`,
    },
  });
  checkbox.checked = !!item.visible;
  checkbox.disabled = item.lockVisible === true;
  if (item.lockVisible === true) {
    checkbox.title = 'This control stays visible so header settings remain accessible.';
  }
  checkbox.addEventListener('change', () => onToggle(!!checkbox.checked));

  return createConfigItemRow({
    main: el('label', {
      className: 'kanji-study-card-config-item-main',
      children: [
        checkbox,
        createConfigItemCopy(item.label, item.description || item.key),
      ],
    }),
    controls: createMoveButtons({
      index,
      length,
      label: item.label,
      onMove,
    }),
  });
}

function createConfigJsonViewer(value, compareValue) {
  const viewer = createJsonViewer(value, {
    expanded: true,
    maxChars: 200000,
    maxLines: 10000,
    previewLen: 400,
    compareValue,
  });
  viewer.classList.add('kanji-study-card-config-json-viewer');
  return viewer;
}

function createDialogShell({
  title,
  subtitle,
  onRenderSummary,
  onRenderBody,
  onRenderJson,
  onHasChanges,
  onCanReset,
  onCanResetToDefaults,
  onReset,
  onResetToDefaults,
  onSave,
}) {
  const mount = document.body || document.documentElement;
  if (!mount) return Promise.resolve(null);

  return new Promise((resolve) => {
    let isJsonMode = false;

    const backdrop = el('div', { className: 'kanji-study-card-config-backdrop' });
    const dialog = el('div', {
      className: 'kanji-study-card-config-dialog card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': String(title || 'View Header Settings'),
      },
    });
    dialog.tabIndex = -1;

    const titleEl = el('h2', { text: String(title || 'View Header Settings') });
    const subtitleEl = el('p', { className: 'hint', text: String(subtitle || '').trim() });
    const summaryEl = el('div', { className: 'kanji-study-card-config-summary' });
    const headerActionsEl = el('div', { className: 'kanji-study-card-config-header-actions' });
    const jsonBtn = el('button', {
      className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
      text: 'JSON',
      attrs: { type: 'button', title: 'Toggle JSON viewer for this header config' },
    });
    headerActionsEl.append(jsonBtn);
    const header = el('div', {
      className: 'kanji-study-card-config-header',
      children: [
        el('div', { children: [titleEl, subtitleEl, summaryEl] }),
        headerActionsEl,
      ],
    });

    const body = el('div', { className: 'kanji-study-card-config-body' });
    const resetBtn = el('button', { className: 'btn', text: 'Reset', attrs: { type: 'button' } });
    const resetDefaultsBtn = el('button', { className: 'btn', text: 'Reset to Defaults', attrs: { type: 'button' } });
    const cancelBtn = el('button', { className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
    const saveBtn = el('button', { className: 'btn primary', text: 'Save', attrs: { type: 'button' } });
    const footer = el('div', {
      className: 'kanji-study-card-config-footer',
      children: [
        el('div', { className: 'kanji-study-card-config-footer-left', children: [resetBtn, resetDefaultsBtn] }),
        el('div', { className: 'kanji-study-card-config-footer-right', children: [cancelBtn, saveBtn] }),
      ],
    });

    dialog.append(header, body, footer);

    function cleanup(result) {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.removeEventListener('click', onBackdropClick);
      try { dialog.remove(); } catch (e) {}
      try { backdrop.remove(); } catch (e) {}
      resolve(result);
    }

    function onBackdropClick(event) {
      if (event.target !== backdrop) return;
      cleanup(null);
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cleanup(null);
    }

    function render() {
      const hasChanges = typeof onHasChanges === 'function' ? !!onHasChanges() : true;
      const canReset = typeof onCanReset === 'function' ? !!onCanReset() : true;
      const canResetToDefaults = typeof onCanResetToDefaults === 'function' ? !!onCanResetToDefaults() : true;
      summaryEl.textContent = typeof onRenderSummary === 'function' ? (onRenderSummary() || '') : '';
      saveBtn.disabled = !hasChanges;
      saveBtn.setAttribute('aria-disabled', hasChanges ? 'false' : 'true');
      resetBtn.disabled = !canReset;
      resetBtn.setAttribute('aria-disabled', canReset ? 'false' : 'true');
      resetDefaultsBtn.disabled = !canResetToDefaults;
      resetDefaultsBtn.setAttribute('aria-disabled', canResetToDefaults ? 'false' : 'true');
      jsonBtn.classList.toggle('is-active', isJsonMode);
      jsonBtn.setAttribute('aria-pressed', isJsonMode ? 'true' : 'false');
      body.innerHTML = '';
      if (isJsonMode) {
        const jsonNode = typeof onRenderJson === 'function' ? onRenderJson() : null;
        if (jsonNode) body.appendChild(jsonNode);
        return;
      }
      const nextBody = typeof onRenderBody === 'function' ? onRenderBody({ rerender: render }) : null;
      if (nextBody) body.appendChild(nextBody);
    }

    jsonBtn.addEventListener('click', () => {
      isJsonMode = !isJsonMode;
      render();
    });
    resetBtn.addEventListener('click', () => {
      if (typeof onReset === 'function') onReset();
      render();
    });
    resetDefaultsBtn.addEventListener('click', () => {
      if (typeof onResetToDefaults === 'function') onResetToDefaults();
      render();
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    saveBtn.addEventListener('click', () => cleanup(typeof onSave === 'function' ? onSave() : null));

    backdrop.append(dialog);
    mount.append(backdrop);
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown, true);

    render();
    setTimeout(() => {
      try { dialog.focus(); } catch (e) {}
    }, 0);
  });
}

export function openKanjiStudyCardViewConfigDialog({
  title = 'View Header Settings',
  subtitle = 'Choose which fixed header tools are shown and arrange their left-to-right order.',
  items = [],
  selectedItems = [],
  namespace = '',
  collection = '',
} = {}) {
  let state = normalizeItems(items, selectedItems);

  function getSnapshot() {
    return {
      _namespace: String(namespace || '').trim(),
      _collection: String(collection || '').trim(),
      items: state.map((item, index) => ({
        key: item.key,
        visible: item.visible !== false,
        order: index,
      })),
    };
  }

  const initialConfigSnapshot = getSnapshot();
  const initialSnapshot = JSON.stringify(initialConfigSnapshot);
  const defaultConfigSnapshot = {
    _namespace: String(namespace || '').trim(),
    _collection: String(collection || '').trim(),
    items: normalizeItems(items, []).map((item, index) => ({
      key: item.key,
      visible: true,
      order: index,
    })),
  };
  const defaultSnapshot = JSON.stringify(defaultConfigSnapshot);
  const hasChanges = () => JSON.stringify(getSnapshot()) !== initialSnapshot;
  const hasDefaultChanges = () => JSON.stringify(getSnapshot()) !== defaultSnapshot;

  function resetToInitialState() {
    state = normalizeItems(items, initialConfigSnapshot.items);
  }

  function resetToDefaultState() {
    state = normalizeItems(items, defaultConfigSnapshot.items);
  }

  return createDialogShell({
    title,
    subtitle,
    onRenderSummary: () => `${state.filter((item) => item.visible !== false).length} visible of ${state.length}`,
    onRenderBody: ({ rerender }) => {
      const list = el('div', { className: 'kanji-study-card-config-list' });
      if (!state.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No fixed header tools are available.' }));
        return list;
      }
      state.forEach((item, index) => {
        list.append(createSelectableReorderRow({
          item,
          index,
          length: state.length,
          onToggle: (checked) => {
            state[index] = { ...item, visible: checked };
            rerender();
          },
          onMove: (nextIndex) => {
            state = moveItem(state, index, nextIndex);
            rerender();
          },
        }));
      });
      return list;
    },
    onRenderJson: () => createConfigJsonViewer(getSnapshot(), initialConfigSnapshot),
    onHasChanges: hasChanges,
    onCanReset: hasChanges,
    onCanResetToDefaults: hasDefaultChanges,
    onReset: resetToInitialState,
    onResetToDefaults: resetToDefaultState,
    onSave: () => ({
      items: state.map((item, index) => ({
        key: item.key,
        visible: item.visible !== false,
        order: index,
      })),
    }),
  });
}
