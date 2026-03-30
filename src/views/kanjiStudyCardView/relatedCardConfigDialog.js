import { el } from '../../utils/browser/ui.js';

const DEFAULT_FIELD_ITEMS = [
  { key: 'title', label: 'Title' },
  { key: 'japanese', label: 'Japanese' },
  { key: 'english', label: 'English' },
  { key: 'notes', label: 'Notes' },
  { key: 'sentences', label: 'Sentences' },
  { key: 'chunks', label: 'Chunks' },
];

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

function normalizeFieldItems(fields) {
  const preferred = Array.isArray(fields) && fields.length ? fields : DEFAULT_FIELD_ITEMS;
  const out = [];
  const seen = new Set();
  for (const raw of preferred) {
    const key = String(raw?.key ?? raw?.value ?? '').trim();
    if (!key || seen.has(key)) continue;
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
  const mount = document.body || document.documentElement;
  if (!mount) return Promise.resolve(null);

  return new Promise((resolve) => {
    let collectionState = buildSelectableState(collectionItems, selectedCollections.length ? selectedCollections : collectionItems.map((item) => item.key));
    let activeTab = 'card';
    let isJsonMode = false;
    const perCollectionState = {};

    for (const item of collectionItems) {
      const fields = normalizeFieldItems(collectionFieldItems?.[item.key]);
      perCollectionState[item.key] = {
        fields,
        config: cloneCollectionConfig(collectionConfigs?.[item.key], fields),
      };
    }

    const backdrop = el('div', { className: 'kanji-study-card-config-backdrop' });
    const dialog = el('div', {
      className: 'kanji-study-card-config-dialog card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': String(title || 'Related Card Settings'),
      },
    });
    dialog.tabIndex = -1;

    const titleEl = el('h2', { text: String(title || 'Related Card Settings') });
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

    function renderTabs() {
      tabs.innerHTML = '';
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
          render();
        });
        tabs.appendChild(btn);
      });
    }

    function renderCollectionSelector() {
      const list = el('div', { className: 'kanji-study-card-config-list' });
      collectionState.forEach((item, index) => {
        const checkbox = el('input', {
          attrs: { type: 'checkbox', 'aria-label': `Show ${item.label}` },
        });
        checkbox.checked = !!item.enabled;
        checkbox.addEventListener('change', () => {
          collectionState[index] = { ...item, enabled: !!checkbox.checked };
          ensureActiveTab();
          render();
        });
        const upBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↑',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
        });
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          collectionState = moveItem(collectionState, index, index - 1);
          render();
        });
        const downBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↓',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
        });
        downBtn.disabled = index === collectionState.length - 1;
        downBtn.addEventListener('click', () => {
          collectionState = moveItem(collectionState, index, index + 1);
          render();
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
      return list;
    }

    function renderCollectionTab(collectionKey) {
      const state = perCollectionState[collectionKey];
      if (!state) return el('p', { className: 'hint kanji-study-card-config-empty', text: 'No settings available for this related collection.' });

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
              const selected = state.config.detailsMode === item.value;
              const btn = el('button', {
                className: `btn small${selected ? ' is-active' : ''}`,
                text: item.label,
                attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
              });
              btn.addEventListener('click', () => {
                state.config.detailsMode = item.value;
                render();
              });
              return btn;
            }),
          }),
        ],
      });

      const collapseCheckbox = el('input', {
        attrs: { type: 'checkbox', 'aria-label': 'Collapse primary text when nested content is expanded' },
      });
      collapseCheckbox.checked = !!state.config.collapsePrimaryWhenExpanded;
      collapseCheckbox.addEventListener('change', () => {
        state.config.collapsePrimaryWhenExpanded = !!collapseCheckbox.checked;
      });

      wrap.append(
        modeItem,
        el('div', {
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
        })
      );

      state.fields.forEach((item, index) => {
        const selected = new Set(state.config.fields);
        const checkbox = el('input', {
          attrs: { type: 'checkbox', 'aria-label': `Show ${item.label}` },
        });
        checkbox.checked = selected.has(item.key);
        checkbox.addEventListener('change', () => {
          const next = state.fields.filter((field) => field.key === item.key ? !!checkbox.checked : selected.has(field.key)).map((field) => field.key);
          state.config.fields = next;
          render();
        });
        const upBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↑',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} up` },
        });
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => {
          state.fields = moveItem(state.fields, index, index - 1);
          state.config.fields = state.fields.filter((field) => selected.has(field.key)).map((field) => field.key);
          render();
        });
        const downBtn = el('button', {
          className: 'icon-button kanji-study-card-config-move',
          text: '↓',
          attrs: { type: 'button', 'aria-label': `Move ${item.label} down` },
        });
        downBtn.disabled = index === state.fields.length - 1;
        downBtn.addEventListener('click', () => {
          state.fields = moveItem(state.fields, index, index + 1);
          state.config.fields = state.fields.filter((field) => selected.has(field.key)).map((field) => field.key);
          render();
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

      return wrap;
    }

    function render() {
      ensureActiveTab();
      const selected = getSelectedCollections();
      summaryEl.textContent = `${selected.length} related collections selected`;
      jsonBtn.classList.toggle('is-active', isJsonMode);
      jsonBtn.setAttribute('aria-pressed', isJsonMode ? 'true' : 'false');
      renderTabs();
      body.innerHTML = '';
      if (isJsonMode) {
        const pre = el('pre', {
          className: 'kanji-study-card-config-json-plain',
          text: JSON.stringify(getSnapshot(), null, 2),
        });
        body.appendChild(pre);
        return;
      }
      if (activeTab === 'card') {
        body.appendChild(renderCollectionSelector());
        return;
      }
      body.appendChild(renderCollectionTab(activeTab));
    }

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

    jsonBtn.addEventListener('click', () => {
      isJsonMode = !isJsonMode;
      render();
    });
    resetBtn.addEventListener('click', () => {
      collectionState = buildSelectableState(collectionItems, collectionItems.map((item) => item.key));
      for (const item of collectionItems) {
        const fields = normalizeFieldItems(collectionFieldItems?.[item.key]);
        perCollectionState[item.key] = {
          fields,
          config: buildDefaultCollectionConfig(fields),
        };
      }
      activeTab = 'card';
      render();
    });
    cancelBtn.addEventListener('click', () => cleanup(null));
    saveBtn.addEventListener('click', () => cleanup(getSnapshot()));

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

export default { openRelatedCardConfigDialog };
