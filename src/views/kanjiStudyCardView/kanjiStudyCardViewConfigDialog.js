import { el } from '../../utils/browser/ui.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';

const DEFAULT_HEADER_SETTINGS = Object.freeze({
  showLabels: 'on',
  layoutMode: 'scroll',
  collapseMode: 'off',
  headerWidth: '100%',
});

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

function normalizeSettings(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    showLabels: String(src.showLabels || DEFAULT_HEADER_SETTINGS.showLabels).trim() === 'off' ? 'off' : 'on',
    layoutMode: ['scroll', 'wrap', 'grid'].includes(String(src.layoutMode || '').trim())
      ? String(src.layoutMode || '').trim()
      : DEFAULT_HEADER_SETTINGS.layoutMode,
    collapseMode: ['off', 'badge'].includes(String(src.collapseMode || '').trim())
      ? String(src.collapseMode || '').trim()
      : DEFAULT_HEADER_SETTINGS.collapseMode,
    headerWidth: ['100%', '75%', '50%', 'auto'].includes(String(src.headerWidth || '').trim())
      ? String(src.headerWidth || '').trim()
      : DEFAULT_HEADER_SETTINGS.headerWidth,
  };
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

function createTabButtons(entries, activeKey, onSelect) {
  return entries.map((item) => {
    const key = String(item?.key || '').trim();
    const isActive = activeKey === key;
    const btn = el('button', {
      className: `btn small kanji-study-card-config-tab${isActive ? ' is-active' : ''}`,
      text: String(item?.label || key).trim() || key,
      attrs: { type: 'button', 'aria-pressed': isActive ? 'true' : 'false' },
    });
    btn.addEventListener('click', () => onSelect(key));
    return btn;
  });
}

function createInlineToggleButtons({ item, value, onChange }) {
  return el('div', {
    className: 'btn-group kanji-study-card-config-inline-toggle',
    children: item.items.map((toggleItem) => {
      const selected = value === String(toggleItem.value || '').trim();
      const btn = el('button', {
        className: `btn small${selected ? ' is-active' : ''}`,
        text: toggleItem.label,
        attrs: {
          type: 'button',
          'aria-pressed': selected ? 'true' : 'false',
          title: `${item.label}: ${toggleItem.label}`,
        },
      });
      btn.addEventListener('click', () => onChange(String(toggleItem.value || '').trim()));
      return btn;
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

    const tabs = el('div', { className: 'kanji-study-card-config-tabs' });
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

    dialog.append(header, tabs, body, footer);

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
      tabs.innerHTML = '';
      body.innerHTML = '';
      if (isJsonMode) {
        const jsonNode = typeof onRenderJson === 'function' ? onRenderJson() : null;
        if (jsonNode) body.appendChild(jsonNode);
        return;
      }
      const nextBody = typeof onRenderBody === 'function' ? onRenderBody({ rerender: render }) : null;
      if (nextBody?.tabs && Array.isArray(nextBody.tabs)) {
        nextBody.tabs.forEach((tabEl) => {
          if (tabEl) tabs.appendChild(tabEl);
        });
      }
      if (nextBody?.body) body.appendChild(nextBody.body);
      else if (nextBody) body.appendChild(nextBody);
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
  selectedSettings = {},
  namespace = '',
  collection = '',
} = {}) {
  let state = normalizeItems(items, selectedItems);
  let settingsState = normalizeSettings(selectedSettings);
  let activeTab = 'fields';

  function getSnapshot() {
    return {
      _namespace: String(namespace || '').trim(),
      _collection: String(collection || '').trim(),
      settings: { ...settingsState },
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
    settings: { ...DEFAULT_HEADER_SETTINGS },
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
    settingsState = normalizeSettings(initialConfigSnapshot.settings);
    activeTab = 'fields';
  }

  function resetToDefaultState() {
    state = normalizeItems(items, defaultConfigSnapshot.items);
    settingsState = normalizeSettings(defaultConfigSnapshot.settings);
    activeTab = 'fields';
  }

  return createDialogShell({
    title,
    subtitle,
    onRenderSummary: () => `${state.filter((item) => item.visible !== false).length} visible of ${state.length} • ${settingsState.layoutMode} layout • ${settingsState.headerWidth} width • ${settingsState.collapseMode} collapse`,
    onRenderBody: ({ rerender }) => {
      const list = el('div', { className: 'kanji-study-card-config-list' });
      const tabs = createTabButtons([
        { key: 'fields', label: 'Fields' },
        { key: 'header', label: 'Header' },
      ], activeTab, (nextKey) => {
        activeTab = nextKey;
        rerender();
      });
      if (!state.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No fixed header tools are available.' }));
        return { tabs, body: list };
      }
      if (activeTab === 'header') {
        list.append(createConfigItemRow({
          label: 'Show Labels',
          keyText: 'Show or hide the small captions under each header tool.',
          controls: [createInlineToggleButtons({
            item: {
              label: 'Show Labels',
              items: [
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ],
            },
            value: settingsState.showLabels,
            onChange: (nextValue) => {
              settingsState = { ...settingsState, showLabels: nextValue === 'off' ? 'off' : 'on' };
              rerender();
            },
          })],
        }));
        list.append(createConfigItemRow({
          label: 'Layout',
          keyText: 'Choose how header tools flow when there is not enough horizontal space.',
          controls: [createInlineToggleButtons({
            item: {
              label: 'Layout',
              items: [
                { value: 'scroll', label: 'Scroll' },
                { value: 'wrap', label: 'Wrap' },
                { value: 'grid', label: 'Grid' },
              ],
            },
            value: settingsState.layoutMode,
            onChange: (nextValue) => {
              settingsState = { ...settingsState, layoutMode: normalizeSettings({ ...settingsState, layoutMode: nextValue }).layoutMode };
              rerender();
            },
          })],
        }));
        list.append(createConfigItemRow({
          label: 'Width',
          keyText: 'Set the toolbar width, or let it size to its content.',
          controls: [createInlineToggleButtons({
            item: {
              label: 'Width',
              items: [
                { value: '100%', label: '100%' },
                { value: '75%', label: '75%' },
                { value: '50%', label: '50%' },
                { value: 'auto', label: 'Auto' },
              ],
            },
            value: settingsState.headerWidth,
            onChange: (nextValue) => {
              settingsState = { ...settingsState, headerWidth: normalizeSettings({ ...settingsState, headerWidth: nextValue }).headerWidth };
              rerender();
            },
          })],
        }));
        list.append(createConfigItemRow({
          label: 'Collapse Mode',
          keyText: 'Let the header compress into a compact trigger that can be clicked open again.',
          controls: [createInlineToggleButtons({
            item: {
              label: 'Collapse Mode',
              items: [
                { value: 'off', label: 'Off' },
                { value: 'badge', label: 'Badge' },
              ],
            },
            value: settingsState.collapseMode,
            onChange: (nextValue) => {
              settingsState = { ...settingsState, collapseMode: normalizeSettings({ ...settingsState, collapseMode: nextValue }).collapseMode };
              rerender();
            },
          })],
        }));
        return { tabs, body: list };
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
      return { tabs, body: list };
    },
    onRenderJson: () => createConfigJsonViewer(getSnapshot(), initialConfigSnapshot),
    onHasChanges: hasChanges,
    onCanReset: hasChanges,
    onCanResetToDefaults: hasDefaultChanges,
    onReset: resetToInitialState,
    onResetToDefaults: resetToDefaultState,
    onSave: () => ({
      settings: { ...settingsState },
      items: state.map((item, index) => ({
        key: item.key,
        visible: item.visible !== false,
        order: index,
      })),
    }),
  });
}
