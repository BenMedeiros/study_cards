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

function createCardConfigDialogShell({ title, subtitle, onRenderSummary, onRenderBody, onRenderJson, onReset, onSave }) {
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
    const jsonBtn = el('button', {
      className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
      text: 'JSON',
      attrs: { type: 'button', title: 'Toggle JSON viewer for this card config' },
    });
    const header = el('div', {
      className: 'kanji-study-card-config-header',
      children: [
        el('div', { children: [titleEl, subtitleEl, summaryEl] }),
        el('div', { className: 'kanji-study-card-config-header-actions', children: [jsonBtn] }),
      ],
    });

    const tabs = el('div', { className: 'kanji-study-card-config-tabs' });
    const body = el('div', { className: 'kanji-study-card-config-body' });
    const resetBtn = el('button', { className: 'btn', text: 'Reset', attrs: { type: 'button' } });
    const cancelBtn = el('button', { className: 'btn', text: 'Cancel', attrs: { type: 'button' } });
    const saveBtn = el('button', { className: 'btn primary', text: 'Save', attrs: { type: 'button' } });
    const footer = el('div', {
      className: 'kanji-study-card-config-footer',
      children: [
        el('div', { className: 'kanji-study-card-config-footer-left', children: [resetBtn] }),
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
      jsonBtn.classList.toggle('is-active', isJsonMode);
      jsonBtn.setAttribute('aria-pressed', isJsonMode ? 'true' : 'false');
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
  const controls = Array.isArray(optionControls)
    ? optionControls.map((raw) => ({
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

  function renderOptionControl(item, index, rerender) {
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
            optionState[index] = { ...item, value: String(toggleItem.value || '').trim() };
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
        optionState[index] = { ...item, value: String(nextValue || '').trim() };
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
      : { fields: getSelectedFieldOrder() };
    return {
      namespace: String(namespace || '').trim(),
      collection: String(collection || '').trim(),
      ...payload,
    };
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
      return `${visibleCount} visible of ${state.length}`;
    },
    onRenderJson: () => {
      const viewer = createJsonViewer(getCurrentConfigSnapshot(), {
        expanded: true,
        maxChars: 200000,
        maxLines: 10000,
        previewLen: 400,
      });
      viewer.classList.add('kanji-study-card-config-json-viewer');
      return viewer;
    },
    onRenderBody: ({ rerender }) => {
      const list = el('div', { className: 'kanji-study-card-config-list' });

      if (isLayoutMode && !layoutState.length && !optionState.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No card positions are available for this card.' }));
        return { body: list };
      }
      if (!items.length) {
        list.append(el('p', { className: 'hint kanji-study-card-config-empty', text: 'No schema fields are available for this collection.' }));
        return { body: list };
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
        return { body: list };
      }

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

        list.append(el('div', {
          className: 'kanji-study-card-config-item',
          children: [
            labelWrap,
            el('div', {
              className: 'kanji-study-card-config-item-controls',
              children: [upBtn, downBtn],
            }),
          ],
        }));
      });

      return { body: list };
    },
    onReset: () => {
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
    },
    onSave: () => (
      isLayoutMode
        ? {
          layout: getSelectedLayout(),
          ...Object.fromEntries(optionState.map((item) => [item.key, String(item.value || '').trim()])),
        }
        : { fields: getSelectedFieldOrder() }
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
      namespace: String(namespace || '').trim(),
      collection: String(collection || '').trim(),
      collections: selected,
      relatedCollections,
    };
  }

  return createCardConfigDialogShell({
    title,
    subtitle,
    onRenderSummary: () => `${getSelectedCollections().length} related collections selected`,
    onRenderJson: () => el('pre', {
      className: 'kanji-study-card-config-json-plain',
      text: JSON.stringify(getSnapshot(), null, 2),
    }),
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
    onReset: () => {
      collectionState = buildSelectableState(collectionItems, collectionItems.map((item) => item.key));
      for (const item of collectionItems) {
        const fields = normalizeFieldItems(collectionFieldItems?.[item.key], DEFAULT_FIELD_ITEMS);
        perCollectionState[item.key] = {
          fields,
          config: buildDefaultCollectionConfig(fields),
        };
      }
      activeTab = 'card';
    },
    onSave: () => getSnapshot(),
  });
}

export default {
  openGenericFlatCardConfigDialog,
  openRelatedCardConfigDialog,
};
