import { el } from '../../utils/browser/ui.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';

const DEFAULT_FIELD_ITEMS = [
  { key: 'title', label: 'Title' },
  { key: 'japanese', label: 'Japanese' },
  { key: 'english', label: 'English' },
  { key: 'notes', label: 'Notes' },
  { key: 'sentences', label: 'Sentences' },
  { key: 'chunks', label: 'Chunks' },
];

function normalizeFieldItems(fields, fallbackItems = null) {
  const preferred = Array.isArray(fields) && fields.length ? fields : (Array.isArray(fallbackItems) ? fallbackItems : fields);
  const items = Array.isArray(preferred) ? preferred : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const key = String(raw?.key ?? raw?.value ?? '').trim();
    if (!key || key.startsWith('__') || raw?.kind === 'action' || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(raw?.label ?? raw?.left ?? key).trim() || key,
    });
  }
  return out;
}

function buildSelectableState(items, selectedKeys) {
  const selectedList = Array.isArray(selectedKeys)
    ? selectedKeys.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedList);
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const out = [];
  const seen = new Set();
  for (const key of selectedList) {
    const item = itemByKey.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, enabled: true });
  }
  for (const item of items) {
    if (seen.has(item.key)) continue;
    out.push({ ...item, enabled: selectedSet.has(item.key) });
  }
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

function getLayoutValue(layout, slotKey, fallbackLayout) {
  const slot = String(slotKey || '').trim();
  if (!slot) return '';
  if (layout && typeof layout === 'object' && Object.prototype.hasOwnProperty.call(layout, slot)) {
    return String(layout[slot] || '').trim();
  }
  if (fallbackLayout && typeof fallbackLayout === 'object' && Object.prototype.hasOwnProperty.call(fallbackLayout, slot)) {
    return String(fallbackLayout[slot] || '').trim();
  }
  return '';
}

function normalizeControlItems(controls) {
  return Array.isArray(controls)
    ? controls.map((raw) => ({
      key: String(raw?.key || '').trim(),
      label: String(raw?.label || raw?.key || '').trim(),
      showWhen: raw?.showWhen || null,
      attachToLayoutKey: String(raw?.attachToLayoutKey || '').trim(),
      renderAs: String(raw?.renderAs || '').trim(),
      items: Array.isArray(raw?.items)
        ? raw.items.map((item) => ({
          value: String(item?.value || '').trim(),
          label: String(item?.label || item?.value || '').trim(),
        })).filter((item) => item.value)
        : [],
    })).filter((item) => item.key && item.items.length)
    : [];
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
  checked,
  onToggle,
  onMove,
  extraControls = [],
}) {
  const checkbox = el('input', {
    attrs: {
      type: 'checkbox',
      'aria-label': `Show ${item.label}`,
    },
  });
  checkbox.checked = !!checked;
  checkbox.addEventListener('change', () => onToggle(!!checkbox.checked));

  return createConfigItemRow({
    main: el('label', {
      className: 'kanji-study-card-config-item-main',
      children: [
        checkbox,
        createConfigItemCopy(item.label, item.key),
      ],
    }),
    controls: extraControls.concat(createMoveButtons({
      index,
      length,
      label: item.label,
      onMove,
    })),
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

function cloneDialogValue(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function createCardConfigDialogShell({
  title,
  subtitle,
  onRenderHeaderMeta,
  onRenderSummary,
  onRenderHeaderActions,
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
        'aria-label': String(title || 'Card Settings'),
      },
    });
    dialog.tabIndex = -1;

    const titleEl = el('h2', { text: String(title || 'Card Settings') });
    const subtitleEl = el('p', { className: 'hint', text: String(subtitle || '').trim() });
    const headerMetaEl = el('div', { className: 'kanji-study-card-config-header-meta' });
    const summaryEl = el('div', { className: 'kanji-study-card-config-summary' });
    const headerActionsEl = el('div', { className: 'kanji-study-card-config-header-actions' });
    const jsonBtn = el('button', {
      className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
      text: 'JSON',
      attrs: { type: 'button', title: 'Toggle JSON viewer for this card config' },
    });
    headerActionsEl.append(jsonBtn);
    const header = el('div', {
      className: 'kanji-study-card-config-header',
      children: [
        el('div', { children: [titleEl, subtitleEl, headerMetaEl, summaryEl] }),
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
      summaryEl.textContent = typeof onRenderSummary === 'function' ? (onRenderSummary() || '') : '';
      headerMetaEl.innerHTML = '';
      const headerMeta = typeof onRenderHeaderMeta === 'function'
        ? onRenderHeaderMeta({ rerender: render })
        : null;
      if (Array.isArray(headerMeta)) {
        headerMeta.forEach((item) => {
          if (item) headerMetaEl.appendChild(item);
        });
      }
      const hasChanges = typeof onHasChanges === 'function' ? !!onHasChanges() : true;
      const canReset = typeof onCanReset === 'function' ? !!onCanReset() : true;
      const canResetToDefaults = typeof onCanResetToDefaults === 'function' ? !!onCanResetToDefaults() : true;
      saveBtn.disabled = !hasChanges;
      saveBtn.setAttribute('aria-disabled', hasChanges ? 'false' : 'true');
      resetBtn.disabled = !canReset;
      resetBtn.setAttribute('aria-disabled', canReset ? 'false' : 'true');
      resetDefaultsBtn.disabled = !canResetToDefaults;
      resetDefaultsBtn.setAttribute('aria-disabled', canResetToDefaults ? 'false' : 'true');
      jsonBtn.classList.toggle('is-active', isJsonMode);
      jsonBtn.setAttribute('aria-pressed', isJsonMode ? 'true' : 'false');
      headerActionsEl.innerHTML = '';
      const extraActions = typeof onRenderHeaderActions === 'function'
        ? onRenderHeaderActions({ rerender: render })
        : null;
      if (Array.isArray(extraActions)) {
        extraActions.forEach((actionEl) => {
          if (actionEl) headerActionsEl.appendChild(actionEl);
        });
      }
      headerActionsEl.append(jsonBtn);
      tabs.innerHTML = '';
      body.innerHTML = '';
      if (isJsonMode) {
        const jsonNode = typeof onRenderJson === 'function' ? onRenderJson() : null;
        if (jsonNode) body.appendChild(jsonNode);
        return;
      }
      const next = typeof onRenderBody === 'function'
        ? onRenderBody({
          tabs,
          body,
          rerender: render,
        })
        : null;
      if (next?.tabs && Array.isArray(next.tabs)) {
        tabs.innerHTML = '';
        next.tabs.forEach((tabEl) => {
          if (tabEl) tabs.appendChild(tabEl);
        });
      }
      if (next?.body) {
        body.innerHTML = '';
        body.appendChild(next.body);
      }
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

export function openGenericFlatCardConfigDialog({
  title = 'Generic Card Settings',
  subtitle = '',
  fields = [],
  selectedFields = [],
  layoutSlots = [],
  selectedLayout = {},
  defaultLayout = {},
  optionControls = [],
  selectedOptions = {},
  defaultOptions = {},
  styleControls = [],
  selectedStyles = {},
  defaultStyles = {},
  customStyles = {},
  fieldStyles = {},
  styles = null,
  savedConfigs = null,
  activeConfigId = 'system',
  namespace = '',
  collection = '',
} = {}) {
  const CODE_DEFAULT_CONFIG_ID = '__system__';
  const items = normalizeFieldItems(fields);
  const slots = Array.isArray(layoutSlots)
    ? layoutSlots.map((raw) => ({
      key: String(raw?.key || '').trim(),
      label: String(raw?.label || raw?.key || '').trim(),
      allowEmpty: raw?.allowEmpty !== false,
      showWhen: raw?.showWhen || null,
    })).filter((item) => item.key)
    : [];
  const controls = normalizeControlItems(optionControls);
  const styleControlsState = normalizeControlItems(styleControls);
  const stylesSource = styles && typeof styles === 'object' && !Array.isArray(styles)
    ? styles
    : {
      main: {
        name: 'Main Style',
        ...(selectedStyles && typeof selectedStyles === 'object' && !Array.isArray(selectedStyles) ? selectedStyles : {}),
      },
      ...((customStyles && typeof customStyles === 'object' && !Array.isArray(customStyles)) ? customStyles : {}),
    };

  let state = buildSelectableState(items, selectedFields);
  let layoutState = slots.map((slot) => ({
    ...slot,
    value: getLayoutValue(selectedLayout, slot.key, defaultLayout),
  }));
  let optionState = controls.map((control) => ({
    ...control,
    value: getLayoutValue(selectedOptions, control.key, defaultOptions) || control.items[0]?.value || '',
  }));
  const isLayoutMode = slots.length > 0 || controls.length > 0;
  const hasStyleTabs = !isLayoutMode && styleControlsState.length > 0;
  let styleIdCounter = 1;

  function createStyleState(styleId, src = {}, fallback = {}) {
    const normalizedId = String(styleId || '').trim() || `style-${styleIdCounter++}`;
    return {
      id: normalizedId,
      name: String(src?.name || '').trim() || normalizedId,
      controls: styleControlsState.map((control) => ({
        ...control,
        value: getLayoutValue(src, control.key, fallback) || control.items[0]?.value || '',
      })),
    };
  }

  let mainStyleState = createStyleState('main', stylesSource.main || selectedStyles, defaultStyles);
  let customStyleState = Object.entries(stylesSource || {})
    .filter(([styleId]) => String(styleId || '').trim() && String(styleId || '').trim() !== 'main')
    .map(([styleId, config]) => createStyleState(styleId, config, defaultStyles));
  let fieldStyleState = Object.fromEntries(
    Object.entries(fieldStyles || {}).map(([fieldKey, styleId]) => [String(fieldKey || '').trim(), String(styleId || '').trim()])
  );
  let activeTab = hasStyleTabs ? 'fields' : '';
  const supportsSavedConfigs = !isLayoutMode && hasStyleTabs;
  let activeSavedConfigId = String(activeConfigId || 'system').trim() || 'system';
  let savedConfigState = supportsSavedConfigs && savedConfigs && typeof savedConfigs === 'object' && !Array.isArray(savedConfigs)
    ? Object.fromEntries(
      Object.entries(savedConfigs).map(([rawId, rawConfig]) => {
        const id = String(rawId || '').trim();
        if (!id) return [null, null];
        return [id, {
          id,
          name: String(rawConfig?.name || id).trim() || id,
          parentId: id === CODE_DEFAULT_CONFIG_ID
            ? ''
            : String(rawConfig?.parentId || (id === 'system' ? CODE_DEFAULT_CONFIG_ID : 'system')).trim(),
          inheritsFromParent: id === CODE_DEFAULT_CONFIG_ID ? false : !!rawConfig?.inheritsFromParent,
          config: cloneDialogValue(rawConfig?.config) || cloneDialogValue(rawConfig?.effectiveConfig) || {},
          effectiveConfig: null,
        }];
      }).filter(([id, preset]) => id && preset)
    )
    : null;

  function getSavedConfigDisplayName(configOrId) {
    const id = typeof configOrId === 'object'
      ? String(configOrId?.id || '').trim()
      : String(configOrId || '').trim();
    if (id === CODE_DEFAULT_CONFIG_ID) return CODE_DEFAULT_CONFIG_ID;
    const rawName = typeof configOrId === 'object'
      ? String(configOrId?.name || '').trim()
      : '';
    if (rawName === CODE_DEFAULT_CONFIG_ID) return CODE_DEFAULT_CONFIG_ID;
    return rawName || id;
  }

  function getSelectedFieldOrder() {
    return state.filter((item) => item.enabled).map((item) => item.key);
  }

  function getSelectedLayout() {
    const out = {};
    layoutState.forEach((item) => {
      out[item.key] = String(item.value || '').trim();
    });
    return out;
  }

  function getSelectedOptionValue(optionKey) {
    const key = String(optionKey || '').trim();
    if (!key) return '';
    const found = optionState.find((item) => item.key === key);
    return String(found?.value || '').trim();
  }

  function getStylePayload(styleState) {
    const out = {};
    (styleState?.controls || []).forEach((item) => {
      const value = String(item.value || '').trim();
      if (!value) return;
      out[item.key] = value;
    });
    return out;
  }

  function getSelectedCustomStyles() {
    const out = {};
    customStyleState.forEach((styleState) => {
      const id = String(styleState?.id || '').trim();
      if (!id) return;
      out[id] = {
        name: String(styleState?.name || '').trim() || id,
        ...getStylePayload(styleState),
      };
    });
    return out;
  }

  function getSelectedFieldStyles() {
    const selectedFieldSet = new Set(getSelectedFieldOrder());
    const validStyleIds = new Set(customStyleState.map((item) => item.id));
    const out = {};
    Object.entries(fieldStyleState).forEach(([fieldKey, styleId]) => {
      const field = String(fieldKey || '').trim();
      const style = String(styleId || '').trim();
      if (!field || !style) return;
      if (!selectedFieldSet.has(field)) return;
      if (!validStyleIds.has(style)) return;
      out[field] = style;
    });
    return out;
  }

  function getAllStyleOptions() {
    return [{ value: 'main', label: 'Main Style' }].concat(customStyleState.map((styleItem) => ({
      value: styleItem.id,
      label: String(styleItem.name || styleItem.id).trim() || styleItem.id,
    })));
  }

  function buildCurrentFieldConfigMap() {
    const out = {};
    state.forEach((item, index) => {
      const styleId = String(fieldStyleState[item.key] || 'main').trim() || 'main';
      out[item.key] = {
        hide: !item.enabled,
        order: index,
        style: styleId,
      };
    });
    return out;
  }

  function normalizeDialogFieldStyles(fieldStyles, fields) {
    const selectedFieldSet = new Set(Array.isArray(fields) ? fields : []);
    const validStyleIds = new Set(customStyleState.map((item) => item.id));
    const out = {};
    Object.entries(fieldStyles || {}).forEach(([fieldKey, styleId]) => {
      const field = String(fieldKey || '').trim();
      const style = String(styleId || '').trim();
      if (!field || !style) return;
      if (!selectedFieldSet.has(field)) return;
      if (!validStyleIds.has(style)) return;
      out[field] = style;
    });
    return out;
  }

  function getEditableStyleConfig() {
    return {
      fields: buildCurrentFieldConfigMap(),
    };
  }

  function applyEditableStyleConfig(config = {}) {
    const defaults = items.map((item, index) => ({
      key: item.key,
      label: item.label,
      enabled: true,
      order: index,
      style: 'main',
    }));
    const merged = defaults.map((item) => {
      const raw = (config.fields && typeof config.fields === 'object' && !Array.isArray(config.fields))
        ? config.fields[item.key]
        : null;
      return {
        ...item,
        enabled: raw?.hide === true ? false : true,
        order: Number.isFinite(raw?.order) ? Number(raw.order) : item.order,
        style: String(raw?.style || 'main').trim() || 'main',
      };
    }).sort((a, b) => a.order - b.order);
    state = merged.map(({ order, style, ...item }) => item);
    fieldStyleState = Object.fromEntries(
      merged
        .map((item) => [item.key, String(item.style || 'main').trim() || 'main'])
        .filter(([, styleId]) => styleId && styleId !== 'main')
    );
  }

  function getDefaultSavedConfigFields() {
    return Object.fromEntries(
      items.map((item, index) => [item.key, {
        hide: false,
        order: index,
        style: 'main',
      }])
    );
  }

  function resolveSavedConfigFields(configId, seen = new Set()) {
    const id = String(configId || 'system').trim() || 'system';
    if (seen.has(id)) return getDefaultSavedConfigFields();
    const preset = savedConfigState[id] || savedConfigState.system;
    if (!preset) return getDefaultSavedConfigFields();
    if (preset.id === CODE_DEFAULT_CONFIG_ID) {
      return preset.config?.fields && typeof preset.config.fields === 'object' && !Array.isArray(preset.config.fields)
        ? cloneDialogValue(preset.config.fields) || getDefaultSavedConfigFields()
        : getDefaultSavedConfigFields();
    }
    if (!preset.inheritsFromParent) {
      return preset.config?.fields && typeof preset.config.fields === 'object' && !Array.isArray(preset.config.fields)
        ? cloneDialogValue(preset.config.fields) || getDefaultSavedConfigFields()
        : getDefaultSavedConfigFields();
    }
    seen.add(id);
    const parentFields = resolveSavedConfigFields(preset.parentId || 'system', seen);
    seen.delete(id);
    const out = cloneDialogValue(parentFields) || getDefaultSavedConfigFields();
    Object.entries(preset.config?.fields || {}).forEach(([fieldKey, overrides]) => {
      const field = String(fieldKey || '').trim();
      if (!field || !out[field]) return;
      out[field] = {
        ...out[field],
        ...(overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}),
      };
    });
    return out;
  }

  function resolveSavedConfigEffective(configId, seen = new Set()) {
    const id = String(configId || 'system').trim() || 'system';
    if (seen.has(id)) {
      const fields = getDefaultSavedConfigFields();
      return { fields, fieldStyles: {} };
    }
    const preset = savedConfigState[id] || savedConfigState.system;
    if (!preset) {
      const fields = getDefaultSavedConfigFields();
      return { fields, fieldStyles: {} };
    }
    if (preset.id === CODE_DEFAULT_CONFIG_ID) {
      const fields = resolveSavedConfigFields(CODE_DEFAULT_CONFIG_ID);
      return {
        fields,
        fieldStyles: {},
      };
    }
    if (!preset.inheritsFromParent) {
      const fields = resolveSavedConfigFields(preset.id);
      return {
        fields,
        fieldStyles: {},
      };
    }
    seen.add(id);
    const parentEffective = resolveSavedConfigEffective(preset.parentId || 'system', seen);
    seen.delete(id);
    const fields = resolveSavedConfigFields(preset.id);
    return {
      fields,
      fieldStyles: {},
    };
  }

  function syncSavedConfigEffectiveStates() {
    if (!supportsSavedConfigs) return;
    Object.values(savedConfigState).forEach((preset) => {
      preset.effectiveConfig = resolveSavedConfigEffective(preset.id);
    });
  }

  function updateSavedConfigOverride(preset, configOverride = null) {
    if (!supportsSavedConfigs || !preset) return;
    const currentConfig = cloneDialogValue(configOverride) || getEditableStyleConfig();
    if (preset.id === CODE_DEFAULT_CONFIG_ID || !preset.inheritsFromParent) {
      preset.config = currentConfig;
      preset.effectiveConfig = cloneDialogValue(currentConfig);
      return;
    }
    const parentFields = resolveSavedConfigFields(preset.parentId || 'system');
    const nextConfig = { fields: {} };
    const allFieldKeys = new Set([...Object.keys(parentFields || {}), ...Object.keys(currentConfig.fields || {})]);
    allFieldKeys.forEach((fieldKey) => {
      const base = parentFields?.[fieldKey] || { hide: false, order: 0, style: 'main' };
      const next = currentConfig.fields?.[fieldKey] || base;
      const entry = {};
      if (!!next.hide !== !!base.hide) entry.hide = !!next.hide;
      if (Number(next.order) !== Number(base.order)) entry.order = Number(next.order);
      if (String(next.style || 'main').trim() !== String(base.style || 'main').trim()) {
        entry.style = String(next.style || 'main').trim() || 'main';
      }
      if (Object.keys(entry).length) nextConfig.fields[fieldKey] = entry;
    });
    if (!Object.keys(nextConfig.fields).length) delete nextConfig.fields;
    preset.config = nextConfig;
    preset.effectiveConfig = cloneDialogValue(currentConfig);
  }

  function ensureSavedConfigState() {
    if (!supportsSavedConfigs) return;
    if (!savedConfigState || !savedConfigState.system) {
      savedConfigState = {
        [CODE_DEFAULT_CONFIG_ID]: {
          id: CODE_DEFAULT_CONFIG_ID,
          name: 'Code Defaults',
          parentId: '',
          inheritsFromParent: false,
          config: { fields: getDefaultSavedConfigFields() },
          effectiveConfig: null,
        },
        system: {
          id: 'system',
          name: 'System Defaults',
          parentId: CODE_DEFAULT_CONFIG_ID,
          inheritsFromParent: true,
          config: {},
          effectiveConfig: null,
        },
      };
    }
    if (!savedConfigState[CODE_DEFAULT_CONFIG_ID]) {
      savedConfigState[CODE_DEFAULT_CONFIG_ID] = {
        id: CODE_DEFAULT_CONFIG_ID,
        name: 'Code Defaults',
        parentId: '',
        inheritsFromParent: false,
        config: { fields: getDefaultSavedConfigFields() },
        effectiveConfig: null,
      };
    }
    Object.values(savedConfigState).forEach((preset) => {
      if (!preset || typeof preset !== 'object') return;
      preset.id = String(preset.id || '').trim() || 'system';
      preset.name = String(preset.name || preset.id).trim() || preset.id;
      preset.parentId = preset.id === CODE_DEFAULT_CONFIG_ID ? '' : String(preset.parentId || (preset.id === 'system' ? CODE_DEFAULT_CONFIG_ID : 'system')).trim();
      preset.inheritsFromParent = preset.id === CODE_DEFAULT_CONFIG_ID ? false : !!preset.inheritsFromParent;
      if (!preset.config || typeof preset.config !== 'object' || Array.isArray(preset.config)) {
        preset.config = {};
      }
    });
    if (!savedConfigState[activeSavedConfigId]) activeSavedConfigId = 'system';
    syncSavedConfigEffectiveStates();
  }

  function syncActiveSavedConfig() {
    if (!supportsSavedConfigs) return;
    ensureSavedConfigState();
    if (savedConfigState[activeSavedConfigId]) {
      updateSavedConfigOverride(savedConfigState[activeSavedConfigId]);
      syncSavedConfigEffectiveStates();
    }
  }

  function loadSavedConfig(configId) {
    if (!supportsSavedConfigs) return;
    ensureSavedConfigState();
    const nextId = String(configId || '').trim();
    if (!savedConfigState[nextId]) return;
    activeSavedConfigId = nextId;
    applyEditableStyleConfig(savedConfigState[nextId].effectiveConfig || {});
  }

  function createSavedConfigName(baseName = 'Config') {
    ensureSavedConfigState();
    const used = new Set(Object.values(savedConfigState).map((preset) => String(preset?.name || '').trim()).filter(Boolean));
    if (!used.has(baseName)) return baseName;
    let index = 2;
    while (used.has(`${baseName} ${index}`)) index += 1;
    return `${baseName} ${index}`;
  }

  function createSavedConfigId(baseName = 'config') {
    ensureSavedConfigState();
    const slugBase = String(baseName || 'config').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'config';
    let candidate = slugBase;
    let index = 2;
    while (savedConfigState[candidate]) {
      candidate = `${slugBase}-${index}`;
      index += 1;
    }
    return candidate;
  }

  function isSavedConfigDescendant(targetId, parentId) {
    const target = String(targetId || '').trim();
    const parent = String(parentId || '').trim();
    if (!target || !parent || target === parent) return false;
    let current = savedConfigState[target];
    const seen = new Set();
    while (current && current.parentId && !seen.has(current.id)) {
      if (current.parentId === parent) return true;
      seen.add(current.id);
      current = savedConfigState[current.parentId];
    }
    return false;
  }

  function createNewSavedConfig({ copyFromActive = false } = {}) {
    if (!supportsSavedConfigs) return;
    ensureSavedConfigState();
    syncActiveSavedConfig();
    const source = copyFromActive ? savedConfigState[activeSavedConfigId] : savedConfigState.system;
    const sourceName = String(source?.name || (copyFromActive ? 'Copy' : 'Config')).trim() || 'Config';
    const name = createSavedConfigName(copyFromActive ? `${sourceName} Copy` : 'New Config');
    const id = createSavedConfigId(name);
    savedConfigState[id] = {
      id,
      name,
      parentId: copyFromActive ? activeSavedConfigId : 'system',
      inheritsFromParent: true,
      config: {},
      effectiveConfig: cloneDialogValue(source?.effectiveConfig || { fields: getDefaultSavedConfigFields() }),
    };
    loadSavedConfig(id);
  }

  function createSavedConfigPresetBar(rerender) {
    ensureSavedConfigState();
    const visiblePresets = Object.values(savedConfigState)
      .filter((preset) => preset.id !== CODE_DEFAULT_CONFIG_ID)
    const presetOptions = visiblePresets.map((preset) => ({
      value: preset.id,
      label: getSavedConfigDisplayName(preset),
    }));
    const presetDropdown = createDropdown({
      items: presetOptions,
      value: activeSavedConfigId,
      className: 'kanji-study-card-config-select kanji-study-card-config-preset-select',
      closeOverlaysOnOpen: false,
      onChange: (nextValue) => {
        syncActiveSavedConfig();
        loadSavedConfig(nextValue);
        rerender();
      },
    });
    const newBtn = el('button', {
      className: 'btn small',
      text: 'New',
      attrs: { type: 'button', title: 'Create a new config from System Defaults' },
    });
    newBtn.addEventListener('click', () => {
      createNewSavedConfig({ copyFromActive: false });
      rerender();
    });
    const copyBtn = el('button', {
      className: 'btn small',
      text: 'Copy',
      attrs: { type: 'button', title: 'Create a child config from the current config' },
    });
    copyBtn.addEventListener('click', () => {
      createNewSavedConfig({ copyFromActive: true });
      rerender();
    });
    const deleteBtn = el('button', {
      className: 'btn small danger',
      text: 'Delete',
      attrs: { type: 'button', title: 'Delete the current config' },
    });
    deleteBtn.disabled = visiblePresets.length <= 1;
    deleteBtn.addEventListener('click', () => {
      if (visiblePresets.length <= 1) return;
      const deleteId = activeSavedConfigId;
      if (!savedConfigState[deleteId] || deleteId === CODE_DEFAULT_CONFIG_ID) return;
      const fallbackId = visiblePresets.find((preset) => preset.id !== deleteId)?.id || 'system';
      delete savedConfigState[deleteId];
      Object.values(savedConfigState).forEach((preset) => {
        if (!preset || preset.id === CODE_DEFAULT_CONFIG_ID) return;
        if (preset.parentId !== deleteId) return;
        preset.parentId = fallbackId;
      });
      loadSavedConfig(fallbackId);
      rerender();
    });
    return el('div', {
      className: 'kanji-study-card-config-preset-bar',
      children: [presetDropdown, newBtn, copyBtn, deleteBtn],
    });
  }

  if (supportsSavedConfigs) {
    ensureSavedConfigState();
    loadSavedConfig(activeSavedConfigId);
  }

  function getStyleUsage(styleId) {
    const id = String(styleId || '').trim();
    if (!id) return [];
    const labelByKey = new Map(items.map((item) => [item.key, item.label]));
    if (!supportsSavedConfigs) {
      return state
        .filter((item) => fieldStyleState[item.key] === id)
        .map((item) => item.label);
    }
    syncActiveSavedConfig();
    const out = [];
    Object.values(savedConfigState || {}).forEach((preset) => {
      const fieldMap = preset?.id === activeSavedConfigId
        ? getEditableStyleConfig().fields
        : preset?.effectiveConfig?.fields;
      Object.entries(fieldMap || {}).forEach(([fieldKey, fieldConfig]) => {
        if (String(fieldConfig?.style || 'main').trim() !== id) return;
        out.push(`${getSavedConfigDisplayName(preset)}: ${labelByKey.get(fieldKey) || fieldKey}`);
      });
    });
    return out;
  }

  function addCustomStyle() {
    let styleId = '';
    do {
      styleId = `style-${styleIdCounter++}`;
    } while (customStyleState.some((item) => item.id === styleId));
    customStyleState.push(createStyleState(styleId, { name: styleId }, defaultStyles));
    activeTab = styleId;
  }

  function removeCustomStyle(styleId) {
    const id = String(styleId || '').trim();
    if (!id) return;
    if (getStyleUsage(id).length) return;
    customStyleState = customStyleState.filter((item) => item.id !== id);
    Object.keys(fieldStyleState).forEach((fieldKey) => {
      if (fieldStyleState[fieldKey] === id) delete fieldStyleState[fieldKey];
    });
    if (activeTab === id) activeTab = 'fields';
  }

  function matchesVisibilityRule(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return true;
    const optionKey = String(rule.option || '').trim();
    if (!optionKey) return true;
    const actual = getSelectedOptionValue(optionKey);
    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) return actual === String(rule.equals || '').trim();
    if (Array.isArray(rule.oneOf)) return rule.oneOf.map((item) => String(item || '').trim()).includes(actual);
    return true;
  }

  function isLayoutItemVisible(item) {
    return matchesVisibilityRule(item?.showWhen);
  }

  function isOptionItemVisible(item) {
    return matchesVisibilityRule(item?.showWhen);
  }

  function getAttachedOptionItems(layoutKey) {
    const key = String(layoutKey || '').trim();
    if (!key) return [];
    return optionState
      .map((item, index) => ({ ...item, index }))
      .filter((item) => item.attachToLayoutKey === key && isOptionItemVisible(item));
  }

  function renderOptionControl(item, index, rerender, { setItem } = {}) {
    const assignItem = typeof setItem === 'function'
      ? setItem
      : ((nextIndex, nextItem) => {
        optionState[nextIndex] = nextItem;
      });
    if (item.renderAs === 'toggle' && item.items.length) {
      return createInlineToggleButtons({
        item,
        value: String(item.value || '').trim(),
        onChange: (nextValue) => {
          assignItem(index, { ...item, value: nextValue });
          rerender();
        },
      });
    }

    return createDropdown({
      items: item.items,
      value: String(item.value || '').trim(),
      className: 'kanji-study-card-config-select',
      closeOverlaysOnOpen: false,
      onChange: (nextValue) => {
        assignItem(index, { ...item, value: String(nextValue || '').trim() });
        rerender();
      },
    });
  }

  function getCurrentConfigSnapshot() {
    if (supportsSavedConfigs) {
      syncActiveSavedConfig();
        return {
          _namespace: String(namespace || '').trim(),
          _collection: String(collection || '').trim(),
          styles: {
            main: {
              name: 'Main Style',
              ...getStylePayload(mainStyleState),
            },
            ...getSelectedCustomStyles(),
          },
          activeConfigId: activeSavedConfigId,
          savedConfigs: Object.fromEntries(
            Object.entries(savedConfigState || {})
              .filter(([configId]) => configId !== CODE_DEFAULT_CONFIG_ID)
              .map(([configId, preset]) => [configId, {
              name: String(preset?.name || configId).trim() || configId,
              parentId: String(preset?.parentId || '').trim(),
              inheritsFromParent: !!preset?.inheritsFromParent,
              config: cloneDialogValue(preset?.config) || {},
            }])
          ),
        };
    }
    const payload = isLayoutMode
      ? {
        layout: getSelectedLayout(),
        ...Object.fromEntries(optionState.map((item) => [item.key, String(item.value || '').trim()])),
      }
      : {
        fields: getSelectedFieldOrder(),
        ...(hasStyleTabs ? {
          style: getStylePayload(mainStyleState),
          customStyles: getSelectedCustomStyles(),
          fieldStyles: getSelectedFieldStyles(),
        } : {}),
      };
    return {
      _namespace: String(namespace || '').trim(),
      _collection: String(collection || '').trim(),
      ...payload,
    };
  }

  const initialConfigSnapshot = getCurrentConfigSnapshot();
  const initialSnapshot = JSON.stringify(initialConfigSnapshot);
  const defaultConfigSnapshot = {
    _namespace: String(namespace || '').trim(),
    _collection: String(collection || '').trim(),
    ...(supportsSavedConfigs
      ? {
        styles: {
          main: {
            name: 'Main Style',
            ...getStylePayload(createStyleState('main', defaultStyles, defaultStyles)),
          },
        },
        activeConfigId: 'system',
        savedConfigs: {
          system: {
            name: 'System Defaults',
            parentId: CODE_DEFAULT_CONFIG_ID,
            inheritsFromParent: true,
            config: {},
          },
        },
      }
      : isLayoutMode
      ? {
        layout: Object.fromEntries(slots.map((slot) => [slot.key, String(defaultLayout?.[slot.key] || '').trim()])),
        ...Object.fromEntries(controls.map((item) => [item.key, getLayoutValue(defaultOptions, item.key, defaultOptions) || item.items[0]?.value || ''])),
      }
      : {
        fields: items.map((item) => item.key),
        ...(hasStyleTabs ? {
          style: getStylePayload(createStyleState('main', defaultStyles, defaultStyles)),
          customStyles: {},
          fieldStyles: {},
        } : {}),
      }),
  };
  const defaultSnapshot = JSON.stringify(defaultConfigSnapshot);
  const hasChanges = () => JSON.stringify(getCurrentConfigSnapshot()) !== initialSnapshot;
  const hasDefaultChanges = () => JSON.stringify(getCurrentConfigSnapshot()) !== defaultSnapshot;

  function resetToInitialState() {
    if (supportsSavedConfigs) {
      mainStyleState = createStyleState('main', initialConfigSnapshot.styles?.main, defaultStyles);
      customStyleState = Object.entries(initialConfigSnapshot.styles || {})
        .filter(([styleId]) => styleId !== 'main')
        .map(([styleId, config]) => createStyleState(styleId, config, defaultStyles));
      savedConfigState = cloneDialogValue(initialConfigSnapshot.savedConfigs) || {};
      activeSavedConfigId = String(initialConfigSnapshot.activeConfigId || 'system').trim() || 'system';
      ensureSavedConfigState();
      loadSavedConfig(activeSavedConfigId);
      activeTab = 'fields';
      return;
    }
    state = buildSelectableState(items, initialConfigSnapshot.fields || selectedFields);
    layoutState = slots.map((slot) => ({
      ...slot,
      value: getLayoutValue(initialConfigSnapshot.layout, slot.key, defaultLayout),
    }));
    optionState = controls.map((control) => ({
      ...control,
      value: getLayoutValue(initialConfigSnapshot, control.key, defaultOptions) || control.items[0]?.value || '',
    }));
    if (hasStyleTabs) {
      mainStyleState = createStyleState('main', initialConfigSnapshot.style, defaultStyles);
      customStyleState = Object.entries(initialConfigSnapshot.customStyles || {}).map(([styleId, config]) => createStyleState(styleId, config, defaultStyles));
      fieldStyleState = Object.fromEntries(
        Object.entries(initialConfigSnapshot.fieldStyles || {}).map(([fieldKey, styleId]) => [String(fieldKey || '').trim(), String(styleId || '').trim()])
      );
      activeTab = 'fields';
    }
  }

  function resetToDefaultState() {
    if (supportsSavedConfigs) {
      mainStyleState = createStyleState('main', defaultConfigSnapshot.styles?.main, defaultStyles);
      customStyleState = [];
      savedConfigState = cloneDialogValue(defaultConfigSnapshot.savedConfigs) || {};
      activeSavedConfigId = 'system';
      ensureSavedConfigState();
      loadSavedConfig(activeSavedConfigId);
      activeTab = 'fields';
      return;
    }
    if (isLayoutMode) {
      layoutState = slots.map((slot) => ({
        ...slot,
        value: String(defaultLayout?.[slot.key] || '').trim(),
      }));
      optionState = controls.map((control) => ({
        ...control,
        value: getLayoutValue(defaultOptions, control.key, defaultOptions) || control.items[0]?.value || '',
      }));
      return;
    }
    state = items.map((item) => ({ ...item, enabled: true }));
    if (hasStyleTabs) {
      mainStyleState = createStyleState('main', defaultStyles, defaultStyles);
      customStyleState = [];
      fieldStyleState = {};
      activeTab = 'fields';
    }
  }

  return createCardConfigDialogShell({
    title,
    subtitle: String(subtitle || '').trim() || (isLayoutMode
      ? 'Choose which collection field appears in each fixed position on the card.'
      : 'Choose which fields appear on the generic card and arrange their top-to-bottom order.'),
    onRenderHeaderMeta: () => [],
    onRenderSummary: () => {
      if (isLayoutMode) {
        const visibleLayoutState = layoutState.filter((item) => isLayoutItemVisible(item));
        const visibleOptionState = optionState.filter((item) => isOptionItemVisible(item));
        const mappedCount = visibleLayoutState.filter((item) => item.value).length;
        const configuredCount = visibleOptionState.filter((item) => item.value).length;
        const totalCount = visibleLayoutState.length + visibleOptionState.length;
        return `${mappedCount + configuredCount} configured of ${totalCount}`;
      }
      const visibleCount = state.filter((item) => item.enabled).length;
      if (!hasStyleTabs) return `${visibleCount} visible of ${state.length}`;
      const presetName = supportsSavedConfigs ? getSavedConfigDisplayName(savedConfigState?.[activeSavedConfigId] || activeSavedConfigId) : '';
      const presetLabel = activeTab === 'fields' && presetName ? ` • ${presetName}` : '';
      return `${visibleCount} visible of ${state.length} • ${customStyleState.length} extra styles${presetLabel}`;
    },
    onRenderHeaderActions: ({ rerender }) => {
      if (!hasStyleTabs) return [];
      const addStyleBtn = el('button', {
        className: 'btn small',
        text: 'Add Style',
        attrs: { type: 'button', title: 'Create a new custom field style' },
      });
      addStyleBtn.addEventListener('click', () => {
        addCustomStyle();
        rerender();
      });
      return [addStyleBtn];
    },
    onRenderJson: () => {
      return createConfigJsonViewer(getCurrentConfigSnapshot(), initialConfigSnapshot);
    },
    onHasChanges: hasChanges,
    onCanReset: hasChanges,
    onCanResetToDefaults: hasDefaultChanges,
    onRenderBody: ({ rerender }) => {
      const list = el('div', { className: 'kanji-study-card-config-list' });
      let topLevelTabs = null;

      if (isLayoutMode && !layoutState.length && !optionState.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No card positions are available for this card.' }));
        return { body: list };
      }
      if (!items.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No schema fields are available for this collection.' }));
        return { body: list };
      }

      if (hasStyleTabs) {
        const tabEntries = [
          { key: 'fields', label: 'Fields' },
          { key: 'main-style', label: 'Main Style' },
          ...customStyleState.map((item) => ({
            key: item.id,
            label: String(item.name || item.id).trim() || item.id,
          })),
        ];
        topLevelTabs = createTabButtons(tabEntries, activeTab, (nextKey) => {
          activeTab = nextKey;
          rerender();
        });

        if (activeTab === 'main-style' || customStyleState.some((item) => item.id === activeTab)) {
          const currentStyleState = activeTab === 'main-style'
            ? mainStyleState
            : customStyleState.find((item) => item.id === activeTab);
          if (!currentStyleState) return { tabs: topLevelTabs, body: list };

          if (activeTab !== 'main-style') {
            const nameInput = el('input', {
              className: 'kanji-study-card-config-name-input',
              attrs: {
                type: 'text',
                maxlength: '48',
                placeholder: 'Style name',
                value: String(currentStyleState.name || '').trim(),
                'aria-label': 'Style name',
              },
            });
            nameInput.addEventListener('input', () => {
              currentStyleState.name = String(nameInput.value || '').trim() || currentStyleState.id;
            });
            nameInput.addEventListener('change', () => {
              rerender();
            });
            nameInput.addEventListener('blur', () => {
              rerender();
            });
            const styleUsage = getStyleUsage(currentStyleState.id);
            const deleteBtn = el('button', {
              className: 'btn small danger',
              text: 'Delete',
               attrs: {
                 type: 'button',
                 title: styleUsage.length ? 'This style is still assigned to fields.' : 'Delete this style',
               },
             });
            deleteBtn.disabled = styleUsage.length > 0;
            deleteBtn.addEventListener('click', () => {
              if (styleUsage.length) return;
              removeCustomStyle(currentStyleState.id);
              rerender();
            });
            list.append(createConfigItemRow({
              label: 'Style Name',
              keyText: currentStyleState.id,
              controls: [nameInput, deleteBtn],
            }));
            list.append(createConfigItemRow({
              label: 'Fields Using This Style',
              keyText: styleUsage.join(', ') || 'No fields currently use this style.',
            }));
          }

          currentStyleState.controls.forEach((item, index) => {
            list.append(createConfigItemRow({
              label: item.label,
              keyText: item.key,
              controls: [renderOptionControl(item, index, rerender, {
                setItem: (nextIndex, nextItem) => {
                  currentStyleState.controls[nextIndex] = nextItem;
                },
              })],
            }));
          });
          return { tabs: topLevelTabs, body: list };
        }
      }

      if (supportsSavedConfigs) {
        const currentPreset = savedConfigState?.[activeSavedConfigId];
        if (currentPreset && activeTab === 'fields') {
          list.append(createSavedConfigPresetBar(rerender));
          const nameInput = el('input', {
            className: 'kanji-study-card-config-name-input',
            attrs: {
              type: 'text',
              maxlength: '48',
              placeholder: 'Config name',
              value: String(currentPreset.name || '').trim(),
              'aria-label': 'Config name',
            },
          });
          nameInput.addEventListener('input', () => {
            currentPreset.name = String(nameInput.value || '').trim() || currentPreset.id;
          });
          nameInput.addEventListener('change', () => rerender());
          nameInput.addEventListener('blur', () => rerender());
          list.append(createConfigItemRow({
            label: 'Config Name',
            keyText: currentPreset.id,
            controls: [nameInput],
          }));

          const parentOptions = Object.values(savedConfigState)
            .filter((preset) => preset.id !== activeSavedConfigId && !isSavedConfigDescendant(preset.id, activeSavedConfigId))
            .map((preset) => ({ value: preset.id, label: getSavedConfigDisplayName(preset) }));
          list.append(createConfigItemRow({
            label: 'Parent Config',
            keyText: getSavedConfigDisplayName(savedConfigState[currentPreset.parentId] || currentPreset.parentId || CODE_DEFAULT_CONFIG_ID),
            controls: [createDropdown({
              items: parentOptions,
              value: currentPreset.parentId || 'system',
              className: 'kanji-study-card-config-select',
              closeOverlaysOnOpen: false,
              onChange: (nextValue) => {
                currentPreset.parentId = String(nextValue || 'system').trim() || 'system';
                rerender();
              },
            })],
          }));
          list.append(createConfigItemRow({
            label: 'Follow Parent',
            keyText: currentPreset.inheritsFromParent
              ? `Uses ${getSavedConfigDisplayName(savedConfigState[currentPreset.parentId] || currentPreset.parentId)} except for this config's changes.`
              : 'Stores a standalone snapshot of this config.',
            controls: [createInlineToggleButtons({
              item: {
                label: 'Follow Parent',
                items: [
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ],
              },
              value: currentPreset.inheritsFromParent ? 'on' : 'off',
              onChange: (nextValue) => {
                const preservedConfig = cloneDialogValue(getEditableStyleConfig());
                currentPreset.inheritsFromParent = nextValue === 'on';
                updateSavedConfigOverride(currentPreset, preservedConfig);
                syncSavedConfigEffectiveStates();
                applyEditableStyleConfig(preservedConfig);
                rerender();
              },
            })],
          }));
        }
      }

      if (isLayoutMode) {
        layoutState.forEach((item, index) => {
          if (!isLayoutItemVisible(item)) return;
          const attachedControls = getAttachedOptionItems(item.key);
          const dropdown = createDropdown({
            items: [
              ...(item.allowEmpty ? [{ value: '', label: 'None' }] : []),
              ...items.map((fieldItem) => ({
                value: fieldItem.key,
                label: fieldItem.label,
                right: fieldItem.key,
              })),
            ],
            value: String(item.value || '').trim(),
            className: 'kanji-study-card-config-select',
            closeOverlaysOnOpen: false,
            onChange: (nextValue) => {
              layoutState[index] = { ...item, value: String(nextValue || '').trim() };
              rerender();
            },
          });

          list.append(createConfigItemRow({
            label: item.label,
            keyText: item.key,
            controls: attachedControls.map((control) => renderOptionControl(control, control.index, rerender)).concat(dropdown),
          }));
        });
        optionState.forEach((item, index) => {
          if (!isOptionItemVisible(item) || item.attachToLayoutKey) return;
          list.append(createConfigItemRow({
            label: item.label,
            keyText: item.key,
            controls: [renderOptionControl(item, index, rerender)],
          }));
        });
        return topLevelTabs ? { tabs: topLevelTabs, body: list } : { body: list };
      }

      const styleOptions = hasStyleTabs ? getAllStyleOptions() : [];

      state.forEach((item, index) => {
        const controlsChildren = [];
        if (hasStyleTabs) {
          controlsChildren.push(createDropdown({
            items: styleOptions,
            value: String(fieldStyleState[item.key] || 'main').trim() || 'main',
            className: 'kanji-study-card-config-select kanji-study-card-config-style-select',
            closeOverlaysOnOpen: false,
            onChange: (nextValue) => {
              const styleId = String(nextValue || 'main').trim() || 'main';
              if (styleId === 'main') delete fieldStyleState[item.key];
              else fieldStyleState[item.key] = styleId;
              rerender();
            },
          }));
        }
        list.append(createSelectableReorderRow({
          item,
          index,
          length: state.length,
          checked: item.enabled,
          onToggle: (checked) => {
            state[index] = { ...item, enabled: checked };
            if (!checked) delete fieldStyleState[item.key];
            rerender();
          },
          onMove: (nextIndex) => {
            state = moveItem(state, index, nextIndex);
            rerender();
          },
          extraControls: controlsChildren,
        }));
      });

      return topLevelTabs ? { tabs: topLevelTabs, body: list } : { body: list };
    },
    onReset: resetToInitialState,
    onResetToDefaults: resetToDefaultState,
    onSave: () => (
      supportsSavedConfigs
        ? (() => {
          syncActiveSavedConfig();
          return {
            styles: {
              main: {
                name: 'Main Style',
                ...getStylePayload(mainStyleState),
              },
              ...getSelectedCustomStyles(),
            },
            activeConfigId: activeSavedConfigId,
            configs: Object.fromEntries(
              Object.entries(savedConfigState || {})
              .filter(([configId]) => configId !== CODE_DEFAULT_CONFIG_ID)
              .map(([configId, preset]) => [configId, {
                id: configId,
                name: String(preset?.name || configId).trim() || configId,
                parentId: configId === 'system'
                  ? CODE_DEFAULT_CONFIG_ID
                  : String(preset?.parentId || '').trim(),
                inheritsFromParent: !!preset?.inheritsFromParent,
                config: cloneDialogValue(preset?.config) || {},
                effectiveConfig: cloneDialogValue(preset?.effectiveConfig) || {},
              }])
            ),
          };
        })()
      : isLayoutMode
        ? {
          layout: getSelectedLayout(),
          ...Object.fromEntries(optionState.map((item) => [item.key, String(item.value || '').trim()])),
        }
        : {
          fields: getSelectedFieldOrder(),
          ...(hasStyleTabs ? {
            style: getStylePayload(mainStyleState),
            customStyles: getSelectedCustomStyles(),
            fieldStyles: getSelectedFieldStyles(),
          } : {}),
        }
    ),
  });
}

function normalizeCollectionItems(collections) {
  const items = Array.isArray(collections) ? collections : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const key = String(raw?.key ?? raw?.name ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(raw?.label ?? raw?.title ?? key).trim() || key,
    });
  }
  return out;
}

function buildDefaultCollectionConfig(fields) {
  return {
    fields: fields.map((item) => item.key),
    detailsMode: 'click',
    collapsePrimaryWhenExpanded: false,
  };
}

function cloneCollectionConfig(config, fields) {
  const defaultConfig = buildDefaultCollectionConfig(fields);
  const src = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {};
  const allowed = new Set(fields.map((item) => item.key));
  const selected = Array.isArray(src.fields)
    ? src.fields.map((item) => String(item || '').trim()).filter((item) => allowed.has(item))
    : defaultConfig.fields.slice();
  return {
    fields: selected.length ? selected : defaultConfig.fields.slice(),
    detailsMode: String(src.detailsMode || '').trim().toLowerCase() === 'always' ? 'always' : 'click',
    collapsePrimaryWhenExpanded: !!src.collapsePrimaryWhenExpanded,
  };
}

export function openRelatedCardConfigDialog({
  title = 'Related Card Settings',
  subtitle = 'Choose which related collections are shown, then configure each collection tab.',
  collections = [],
  selectedCollections = [],
  collectionFieldItems = {},
  collectionConfigs = {},
  namespace = '',
  collection = '',
} = {}) {
  const collectionItems = normalizeCollectionItems(collections);
  let collectionState = buildSelectableState(collectionItems, selectedCollections.length ? selectedCollections : collectionItems.map((item) => item.key));
  let activeTab = 'card';
  const perCollectionState = {};

  for (const item of collectionItems) {
    const fields = normalizeFieldItems(collectionFieldItems?.[item.key], DEFAULT_FIELD_ITEMS);
    perCollectionState[item.key] = {
      fields,
      config: cloneCollectionConfig(collectionConfigs?.[item.key], fields),
    };
  }

  function getSelectedCollections() {
    return collectionState.filter((item) => item.enabled).map((item) => item.key);
  }

  function ensureActiveTab() {
    if (activeTab === 'card') return;
    if (!getSelectedCollections().includes(activeTab)) activeTab = 'card';
  }

  function getSnapshot() {
    const selected = getSelectedCollections();
    const relatedCollections = {};
    for (const key of selected) {
      const state = perCollectionState[key];
      if (!state) continue;
      relatedCollections[key] = {
        fields: Array.isArray(state.config.fields) ? state.config.fields.slice() : [],
        detailsMode: state.config.detailsMode || 'click',
        collapsePrimaryWhenExpanded: !!state.config.collapsePrimaryWhenExpanded,
      };
    }
    return {
      _namespace: String(namespace || '').trim(),
      _collection: String(collection || '').trim(),
      collections: selected,
      relatedCollections,
    };
  }

  const initialConfigSnapshot = getSnapshot();
  const initialSnapshot = JSON.stringify(initialConfigSnapshot);
  const defaultConfigSnapshot = {
    _namespace: String(namespace || '').trim(),
    _collection: String(collection || '').trim(),
    collections: collectionItems.map((item) => item.key),
    relatedCollections: Object.fromEntries(collectionItems.map((item) => {
      const fields = normalizeFieldItems(collectionFieldItems?.[item.key], DEFAULT_FIELD_ITEMS);
      return [item.key, buildDefaultCollectionConfig(fields)];
    })),
  };
  const defaultSnapshot = JSON.stringify(defaultConfigSnapshot);
  const hasChanges = () => JSON.stringify(getSnapshot()) !== initialSnapshot;
  const hasDefaultChanges = () => JSON.stringify(getSnapshot()) !== defaultSnapshot;

  function resetToInitialState() {
    collectionState = buildSelectableState(collectionItems, initialConfigSnapshot.collections || []);
    for (const item of collectionItems) {
      const fields = normalizeFieldItems(collectionFieldItems?.[item.key], DEFAULT_FIELD_ITEMS);
      perCollectionState[item.key] = {
        fields,
        config: cloneCollectionConfig(initialConfigSnapshot.relatedCollections?.[item.key], fields),
      };
    }
    activeTab = 'card';
  }

  function resetToDefaultState() {
    collectionState = buildSelectableState(collectionItems, collectionItems.map((item) => item.key));
    for (const item of collectionItems) {
      const fields = normalizeFieldItems(collectionFieldItems?.[item.key], DEFAULT_FIELD_ITEMS);
      perCollectionState[item.key] = {
        fields,
        config: buildDefaultCollectionConfig(fields),
      };
    }
    activeTab = 'card';
  }

  return createCardConfigDialogShell({
    title,
    subtitle,
    onRenderSummary: () => `${getSelectedCollections().length} related collections selected`,
    onRenderJson: () => createConfigJsonViewer(getSnapshot(), initialConfigSnapshot),
    onHasChanges: hasChanges,
    onCanReset: hasChanges,
    onCanResetToDefaults: hasDefaultChanges,
    onRenderBody: ({ rerender }) => {
      ensureActiveTab();
      const selected = getSelectedCollections();
      const entries = [{ key: 'card', label: 'Card Settings' }]
        .concat(selected.map((key) => {
          const found = collectionItems.find((item) => item.key === key);
          return { key, label: found?.label || key };
        }));
      const tabs = createTabButtons(entries, activeTab, (nextKey) => {
        activeTab = nextKey;
        rerender();
      });

      if (activeTab === 'card') {
        const list = el('div', { className: 'kanji-study-card-config-list' });
        collectionState.forEach((item, index) => {
          list.append(createSelectableReorderRow({
            item,
            index,
            length: collectionState.length,
            checked: item.enabled,
            onToggle: (checked) => {
              collectionState[index] = { ...item, enabled: checked };
              ensureActiveTab();
              rerender();
            },
            onMove: (nextIndex) => {
              collectionState = moveItem(collectionState, index, nextIndex);
              rerender();
            },
          }));
        });
        return { tabs, body: list };
      }

      const state = perCollectionState[activeTab];
      if (!state) {
        return {
          tabs,
          body: el('p', { className: 'hint kanji-study-card-config-empty', text: 'No settings available for this related collection.' }),
        };
      }

      const wrap = el('div', { className: 'kanji-study-card-config-list' });
      wrap.append(createConfigItemRow({
        label: 'Nested Content',
        keyText: 'Choose whether sentences/chunks stay expanded or open on click.',
        controls: [createInlineToggleButtons({
          item: {
            label: 'Nested Content',
            items: [
              { value: 'click', label: 'Click' },
              { value: 'always', label: 'Always' },
            ],
          },
          value: state.config.detailsMode,
          onChange: (nextValue) => {
            state.config.detailsMode = nextValue;
            rerender();
          },
        })],
      }));

      const collapseCheckbox = el('input', {
        attrs: { type: 'checkbox', 'aria-label': 'Collapse primary text when nested content is expanded' },
      });
      collapseCheckbox.checked = !!state.config.collapsePrimaryWhenExpanded;
      collapseCheckbox.addEventListener('change', () => {
        state.config.collapsePrimaryWhenExpanded = !!collapseCheckbox.checked;
      });
      wrap.append(createConfigItemRow({
        main: el('label', {
          className: 'kanji-study-card-config-item-main',
          children: [
            collapseCheckbox,
            createConfigItemCopy(
              'Collapse Primary Text When Expanded',
              'Hide the paragraph/sentence text while its nested children are visible.'
            ),
          ],
        }),
      }));

      state.fields.forEach((item, index) => {
        const selectedFieldSet = new Set(state.config.fields);
        wrap.append(createSelectableReorderRow({
          item,
          index,
          length: state.fields.length,
          checked: selectedFieldSet.has(item.key),
          onToggle: (checked) => {
            const next = state.fields
              .filter((field) => (field.key === item.key ? checked : selectedFieldSet.has(field.key)))
              .map((field) => field.key);
            state.config.fields = next;
            rerender();
          },
          onMove: (nextIndex) => {
            state.fields = moveItem(state.fields, index, nextIndex);
            state.config.fields = state.fields.filter((field) => selectedFieldSet.has(field.key)).map((field) => field.key);
            rerender();
          },
        }));
      });

      return { tabs, body: wrap };
    },
    onReset: resetToInitialState,
    onResetToDefaults: resetToDefaultState,
    onSave: () => getSnapshot(),
  });
}

export default {
  openGenericFlatCardConfigDialog,
  openRelatedCardConfigDialog,
};
