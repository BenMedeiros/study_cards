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

function createCardConfigDialogShell({
  title,
  subtitle,
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
      summaryEl.textContent = typeof onRenderSummary === 'function' ? (onRenderSummary() || '') : '';
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
  namespace = '',
  collection = '',
} = {}) {
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

  let mainStyleState = createStyleState('main', selectedStyles, defaultStyles);
  let customStyleState = Object.entries(customStyles || {}).map(([styleId, config]) => createStyleState(styleId, config, defaultStyles));
  let fieldStyleState = Object.fromEntries(
    Object.entries(fieldStyles || {}).map(([fieldKey, styleId]) => [String(fieldKey || '').trim(), String(styleId || '').trim()])
  );
  let activeTab = hasStyleTabs ? 'fields' : '';

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

  function getStyleUsage(styleId) {
    const id = String(styleId || '').trim();
    if (!id) return [];
    return state
      .filter((item) => fieldStyleState[item.key] === id)
      .map((item) => item.label);
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
      return el('div', {
        className: 'btn-group kanji-study-card-config-inline-toggle',
        children: item.items.map((toggleItem) => {
          const selected = String(item.value || '').trim() === String(toggleItem.value || '').trim();
          const btn = el('button', {
            className: `btn small${selected ? ' is-active' : ''}`,
            text: toggleItem.label,
            attrs: {
              type: 'button',
              'aria-pressed': selected ? 'true' : 'false',
              title: `${item.label}: ${toggleItem.label}`,
            },
          });
          btn.addEventListener('click', () => {
            assignItem(index, { ...item, value: String(toggleItem.value || '').trim() });
            rerender();
          });
          return btn;
        }),
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
    ...(isLayoutMode
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

  function resetToInitialState() {
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
      return `${visibleCount} visible of ${state.length} • ${customStyleState.length} custom styles`;
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
      const viewer = createJsonViewer(getCurrentConfigSnapshot(), {
        expanded: true,
        maxChars: 200000,
        maxLines: 10000,
        previewLen: 400,
        compareValue: initialConfigSnapshot,
      });
      viewer.classList.add('kanji-study-card-config-json-viewer');
      return viewer;
    },
    onHasChanges: () => JSON.stringify(getCurrentConfigSnapshot()) !== initialSnapshot,
    onCanReset: () => JSON.stringify(getCurrentConfigSnapshot()) !== initialSnapshot,
    onCanResetToDefaults: () => JSON.stringify(getCurrentConfigSnapshot()) !== defaultSnapshot,
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
        topLevelTabs = [
          { key: 'fields', label: 'Fields' },
          { key: 'main-style', label: 'Main Style' },
          ...customStyleState.map((item) => ({
            key: item.id,
            label: String(item.name || item.id).trim() || item.id,
          })),
        ].map((item) => {
          const btn = el('button', {
            className: `btn small kanji-study-card-config-tab${activeTab === item.key ? ' is-active' : ''}`,
            text: item.label,
            attrs: { type: 'button' },
          });
          btn.addEventListener('click', () => {
            activeTab = item.key;
            rerender();
          });
          return btn;
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
            const deleteBtn = el('button', {
              className: 'btn small danger',
              text: 'Delete',
              attrs: { type: 'button', title: 'Delete this custom style' },
            });
            deleteBtn.addEventListener('click', () => {
              removeCustomStyle(currentStyleState.id);
              rerender();
            });
            list.append(el('div', {
              className: 'kanji-study-card-config-item',
              children: [
                el('div', {
                  className: 'kanji-study-card-config-item-copy',
                  children: [
                    el('div', { className: 'kanji-study-card-config-item-label', text: 'Style Name' }),
                    el('div', { className: 'kanji-study-card-config-item-key hint', text: currentStyleState.id }),
                  ],
                }),
                el('div', {
                  className: 'kanji-study-card-config-item-controls',
                  children: [nameInput, deleteBtn],
                }),
              ],
            }));
            list.append(el('div', {
              className: 'kanji-study-card-config-item',
              children: [
                el('div', {
                  className: 'kanji-study-card-config-item-copy',
                  children: [
                    el('div', { className: 'kanji-study-card-config-item-label', text: 'Fields Using This Style' }),
                    el('div', {
                      className: 'kanji-study-card-config-item-key hint',
                      text: getStyleUsage(currentStyleState.id).join(', ') || 'No fields currently use this style.',
                    }),
                  ],
                }),
              ],
            }));
          }

          currentStyleState.controls.forEach((item, index) => {
            list.append(el('div', {
              className: 'kanji-study-card-config-item',
              children: [
                el('div', {
                  className: 'kanji-study-card-config-item-copy',
                  children: [
                    el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                    el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                  ],
                }),
                el('div', {
                  className: 'kanji-study-card-config-item-controls',
                  children: [renderOptionControl(item, index, rerender, {
                    setItem: (nextIndex, nextItem) => {
                      currentStyleState.controls[nextIndex] = nextItem;
                    },
                  })],
                }),
              ],
            }));
          });
          return { tabs: topLevelTabs, body: list };
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

          list.append(el('div', {
            className: 'kanji-study-card-config-item',
            children: [
              el('div', {
                className: 'kanji-study-card-config-item-copy',
                children: [
                  el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                  el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                ],
              }),
              el('div', {
                className: 'kanji-study-card-config-item-controls',
                children: [
                  ...attachedControls.map((control) => renderOptionControl(control, control.index, rerender)),
                  dropdown,
                ],
              }),
            ],
          }));
        });
        optionState.forEach((item, index) => {
          if (!isOptionItemVisible(item) || item.attachToLayoutKey) return;
          list.append(el('div', {
            className: 'kanji-study-card-config-item',
            children: [
              el('div', {
                className: 'kanji-study-card-config-item-copy',
                children: [
                  el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                  el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                ],
              }),
              el('div', {
                className: 'kanji-study-card-config-item-controls',
                children: [renderOptionControl(item, index, rerender)],
              }),
            ],
          }));
        });
        return topLevelTabs ? { tabs: topLevelTabs, body: list } : { body: list };
      }

      const styleOptions = hasStyleTabs
        ? [{ value: '', label: 'Main Style' }].concat(customStyleState.map((styleItem) => ({
          value: styleItem.id,
          label: String(styleItem.name || styleItem.id).trim() || styleItem.id,
        })))
        : [];

      state.forEach((item, index) => {
        const checkbox = el('input', {
          attrs: {
            type: 'checkbox',
            'aria-label': `Show ${item.label}`,
          },
        });
        checkbox.checked = !!item.enabled;
        checkbox.addEventListener('change', () => {
          state[index] = { ...item, enabled: !!checkbox.checked };
          if (!checkbox.checked) delete fieldStyleState[item.key];
          rerender();
        });

        const labelWrap = el('label', {
          className: 'kanji-study-card-config-item-main',
          children: [
            checkbox,
            el('div', {
              className: 'kanji-study-card-config-item-copy',
              children: [
                el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
              ],
            }),
          ],
        });

        const upBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↑',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
        });
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          state = moveItem(state, index, index - 1);
          rerender();
        });

        const downBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↓',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
        });
        downBtn.disabled = index === state.length - 1;
        downBtn.addEventListener('click', () => {
          state = moveItem(state, index, index + 1);
          rerender();
        });

        const controlsChildren = [];
        if (hasStyleTabs) {
          controlsChildren.push(createDropdown({
            items: styleOptions,
            value: String(fieldStyleState[item.key] || '').trim(),
            className: 'kanji-study-card-config-select kanji-study-card-config-style-select',
            closeOverlaysOnOpen: false,
            onChange: (nextValue) => {
              const styleId = String(nextValue || '').trim();
              if (!styleId) delete fieldStyleState[item.key];
              else fieldStyleState[item.key] = styleId;
              rerender();
            },
          }));
        }
        controlsChildren.push(upBtn, downBtn);

        list.append(el('div', {
          className: 'kanji-study-card-config-item',
          children: [
            labelWrap,
            el('div', {
              className: 'kanji-study-card-config-item-controls',
              children: controlsChildren,
            }),
          ],
        }));
      });

      return topLevelTabs ? { tabs: topLevelTabs, body: list } : { body: list };
    },
    onReset: resetToInitialState,
    onResetToDefaults: resetToDefaultState,
    onSave: () => (
      isLayoutMode
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
    onRenderJson: () => {
      const viewer = createJsonViewer(getSnapshot(), {
        expanded: true,
        maxChars: 200000,
        maxLines: 10000,
        previewLen: 400,
        compareValue: initialConfigSnapshot,
      });
      viewer.classList.add('kanji-study-card-config-json-viewer');
      return viewer;
    },
    onHasChanges: () => JSON.stringify(getSnapshot()) !== initialSnapshot,
    onCanReset: () => JSON.stringify(getSnapshot()) !== initialSnapshot,
    onCanResetToDefaults: () => JSON.stringify(getSnapshot()) !== defaultSnapshot,
    onRenderBody: ({ rerender }) => {
      ensureActiveTab();
      const tabs = [];
      const selected = getSelectedCollections();
      const entries = [{ key: 'card', label: 'Card Settings' }]
        .concat(selected.map((key) => {
          const found = collectionItems.find((item) => item.key === key);
          return { key, label: found?.label || key };
        }));
      entries.forEach((item) => {
        const btn = el('button', {
          className: `btn small kanji-study-card-config-tab${activeTab === item.key ? ' is-active' : ''}`,
          text: item.label,
          attrs: { type: 'button', 'aria-pressed': activeTab === item.key ? 'true' : 'false' },
        });
        btn.addEventListener('click', () => {
          activeTab = item.key;
          rerender();
        });
        tabs.push(btn);
      });

      if (activeTab === 'card') {
        const list = el('div', { className: 'kanji-study-card-config-list' });
        collectionState.forEach((item, index) => {
          const checkbox = el('input', {
            attrs: { type: 'checkbox', 'aria-label': `Show ${item.label}` },
          });
          checkbox.checked = !!item.enabled;
          checkbox.addEventListener('change', () => {
            collectionState[index] = { ...item, enabled: !!checkbox.checked };
            ensureActiveTab();
            rerender();
          });
          const upBtn = el('button', {
            className: 'icon-button kanji-study-card-config-move',
            text: '↑',
            attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
          });
          upBtn.disabled = index === 0;
          upBtn.addEventListener('click', () => {
            collectionState = moveItem(collectionState, index, index - 1);
            rerender();
          });
          const downBtn = el('button', {
            className: 'icon-button kanji-study-card-config-move',
            text: '↓',
            attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
          });
          downBtn.disabled = index === collectionState.length - 1;
          downBtn.addEventListener('click', () => {
            collectionState = moveItem(collectionState, index, index + 1);
            rerender();
          });
          list.append(el('div', {
            className: 'kanji-study-card-config-item',
            children: [
              el('label', {
                className: 'kanji-study-card-config-item-main',
                children: [
                  checkbox,
                  el('div', {
                    className: 'kanji-study-card-config-item-copy',
                    children: [
                      el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                      el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                    ],
                  }),
                ],
              }),
              el('div', {
                className: 'kanji-study-card-config-item-controls',
                children: [upBtn, downBtn],
              }),
            ],
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
      const modeItem = el('div', {
        className: 'kanji-study-card-config-item',
        children: [
          el('div', {
            className: 'kanji-study-card-config-item-copy',
            children: [
              el('div', { className: 'kanji-study-card-config-item-label', text: 'Nested Content' }),
              el('div', { className: 'kanji-study-card-config-item-key hint', text: 'Choose whether sentences/chunks stay expanded or open on click.' }),
            ],
          }),
          el('div', {
            className: 'btn-group kanji-study-card-config-inline-toggle',
            children: [
              { value: 'click', label: 'Click' },
              { value: 'always', label: 'Always' },
            ].map((item) => {
              const selectedMode = state.config.detailsMode === item.value;
              const btn = el('button', {
                className: `btn small${selectedMode ? ' is-active' : ''}`,
                text: item.label,
                attrs: { type: 'button', 'aria-pressed': selectedMode ? 'true' : 'false' },
              });
              btn.addEventListener('click', () => {
                state.config.detailsMode = item.value;
                rerender();
              });
              return btn;
            }),
          }),
        ],
      });
      wrap.append(modeItem);

      const collapseCheckbox = el('input', {
        attrs: { type: 'checkbox', 'aria-label': 'Collapse primary text when nested content is expanded' },
      });
      collapseCheckbox.checked = !!state.config.collapsePrimaryWhenExpanded;
      collapseCheckbox.addEventListener('change', () => {
        state.config.collapsePrimaryWhenExpanded = !!collapseCheckbox.checked;
      });
      wrap.append(el('div', {
        className: 'kanji-study-card-config-item',
        children: [
          el('label', {
            className: 'kanji-study-card-config-item-main',
            children: [
              collapseCheckbox,
              el('div', {
                className: 'kanji-study-card-config-item-copy',
                children: [
                  el('div', { className: 'kanji-study-card-config-item-label', text: 'Collapse Primary Text When Expanded' }),
                  el('div', { className: 'kanji-study-card-config-item-key hint', text: 'Hide the paragraph/sentence text while its nested children are visible.' }),
                ],
              }),
            ],
          }),
        ],
      }));

      state.fields.forEach((item, index) => {
        const selectedFieldSet = new Set(state.config.fields);
        const checkbox = el('input', {
          attrs: { type: 'checkbox', 'aria-label': `Show ${item.label}` },
        });
        checkbox.checked = selectedFieldSet.has(item.key);
        checkbox.addEventListener('change', () => {
          const next = state.fields
            .filter((field) => (field.key === item.key ? !!checkbox.checked : selectedFieldSet.has(field.key)))
            .map((field) => field.key);
          state.config.fields = next;
          rerender();
        });
        const upBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↑',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
        });
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          state.fields = moveItem(state.fields, index, index - 1);
          state.config.fields = state.fields.filter((field) => selectedFieldSet.has(field.key)).map((field) => field.key);
          rerender();
        });
        const downBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↓',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
        });
        downBtn.disabled = index === state.fields.length - 1;
        downBtn.addEventListener('click', () => {
          state.fields = moveItem(state.fields, index, index + 1);
          state.config.fields = state.fields.filter((field) => selectedFieldSet.has(field.key)).map((field) => field.key);
          rerender();
        });
        wrap.append(el('div', {
          className: 'kanji-study-card-config-item',
          children: [
            el('label', {
              className: 'kanji-study-card-config-item-main',
              children: [
                checkbox,
                el('div', {
                  className: 'kanji-study-card-config-item-copy',
                  children: [
                    el('div', { className: 'kanji-study-card-config-item-label', text: item.label }),
                    el('div', { className: 'kanji-study-card-config-item-key hint', text: item.key }),
                  ],
                }),
              ],
            }),
            el('div', {
              className: 'kanji-study-card-config-item-controls',
              children: [upBtn, downBtn],
            }),
          ],
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
