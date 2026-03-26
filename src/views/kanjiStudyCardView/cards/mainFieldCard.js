// Factory for creating the main fixed-layout study card.
import { settingsLog } from '../../../managers/settingsManager.js';

function normalizeAvailableFields(fields) {
  const items = Array.isArray(fields) ? fields : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
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

function normalizeCardConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const next = {};
  if (config.layout && typeof config.layout === 'object' && !Array.isArray(config.layout)) {
    next.layout = {};
    for (const [slotKey, fieldKey] of Object.entries(config.layout)) {
      const slot = String(slotKey || '').trim();
      const field = String(fieldKey || '').trim();
      if (!slot) continue;
      next.layout[slot] = field;
    }
  }
  const mainFlow = String(config.mainFlow || '').trim().toLowerCase();
  if (mainFlow === 'row' || mainFlow === 'column') next.mainFlow = mainFlow;
  return next;
}

export function createMainFieldCard({ entry = null, indexText = '', config = {}, handlers = {} } = {}) {
  settingsLog('[Card:Main] createMainFieldCard()', { entry, indexText, config });
  const root = document.createElement('div');
  root.className = 'card kanji-study-card main-field-card';

  const wrapper = document.createElement('div');
  wrapper.className = 'main-field-card-wrapper';
  wrapper.tabIndex = 0;

  const topRight = document.createElement('div');
  topRight.className = 'kanji-study-card-top-right';

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = indexText || '';

  const actions = document.createElement('div');
  actions.className = 'kanji-study-card-actions';

  const body = document.createElement('div');
  body.className = 'main-field-card-body';

  const topLeft = document.createElement('div');
  topLeft.className = 'main-field-card-top-left';

  const mainWrap = document.createElement('div');
  mainWrap.className = 'main-field-card-main-wrap';

  const main = document.createElement('div');
  main.className = 'main-field-card-main';
  main.style.fontSize = '5rem';

  const mainSecondary = document.createElement('div');
  mainSecondary.className = 'main-field-card-main';
  mainSecondary.style.fontSize = '5rem';

  const bottomLeft = document.createElement('div');
  bottomLeft.className = 'main-field-card-bottom-left';

  const bottomRight = document.createElement('div');
  bottomRight.className = 'main-field-card-bottom-right';

  topRight.append(corner, actions);
  mainWrap.style.display = 'grid';
  mainWrap.style.alignItems = 'center';
  mainWrap.style.justifyContent = 'center';
  mainWrap.style.gap = '0.75rem';
  mainWrap.append(main, mainSecondary);
  body.append(topLeft, mainWrap, bottomLeft, bottomRight);
  wrapper.append(topRight, body);
  root.appendChild(wrapper);

  let currentEntry = entry;
  let availableFields = normalizeAvailableFields(config?.availableFields);
  let cardConfig = normalizeCardConfig(config?.cardConfig);
  const fieldVisibility = {};

  const openConfig = (handlers && typeof handlers.onOpenConfig === 'function')
    ? handlers.onOpenConfig
    : (config && typeof config.onOpenConfig === 'function' ? config.onOpenConfig : null);
  if (typeof openConfig === 'function') {
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'icon-button kanji-study-card-config-btn';
    configBtn.title = 'Configure card';
    configBtn.setAttribute('aria-label', 'Configure card');
    configBtn.textContent = '⚙';
    configBtn.addEventListener('click', () => {
      try {
        openConfig({
          cardId: String(config?.cardId || 'main').trim() || 'main',
          entry: currentEntry,
          cardConfig: { ...cardConfig, layout: { ...(cardConfig.layout || {}) } },
          availableFields: availableFields.slice(),
        });
      } catch (e) {}
    });
    actions.appendChild(configBtn);
  }

  function resolvePath(obj, path) {
    if (!obj || !path) return '';
    const parts = String(path).split(/\.|\//).filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    return (cur == null) ? '' : String(cur);
  }

  function resolveField(entryObj, fieldKey) {
    const key = String(fieldKey || '').trim();
    if (!key) return '';
    return resolvePath(entryObj, key);
  }

  function getLayoutField(slotKey) {
    const slot = String(slotKey || '').trim();
    if (!slot) return '';
    if (cardConfig?.layout && Object.prototype.hasOwnProperty.call(cardConfig.layout, slot)) {
      return String(cardConfig.layout[slot] || '').trim();
    }
    return '';
  }

  function applyVisibility() {
    for (const [fieldKey, isVisible] of Object.entries(fieldVisibility)) {
      setFieldVisible(fieldKey, !!isVisible);
    }
  }

  function setEntry(e) {
    settingsLog('[Card:Main] setEntry()', e);
    currentEntry = e || {};
    const entryObj = currentEntry;
    const mainValue = resolveField(entryObj, getLayoutField('main'));
    const mainSecondaryValue = resolveField(entryObj, getLayoutField('mainSecondary'));
    const bottomLeftValue = resolveField(entryObj, getLayoutField('bottomLeft'));
    const bottomRightValue = resolveField(entryObj, getLayoutField('bottomRight'));
    const topLeftValue = resolveField(entryObj, getLayoutField('topLeft'));

    const centerValues = [mainValue, mainSecondaryValue].filter((value) => String(value || '').trim());
    const longestCenterLength = centerValues.reduce((max, value) => Math.max(max, String(value || '').length), 0);
    const mainFlow = String(cardConfig?.mainFlow || 'row').trim().toLowerCase() === 'column' ? 'column' : 'row';
    const hasSecondary = !!String(getLayoutField('mainSecondary') || '').trim();

    // Auto-scale center field(s) based on text length.
    const length = longestCenterLength;
    let fontSize = 5; // rem
    if (length > 6) fontSize = 3.5;
    else if (length > 5) fontSize = 3.75;
    else if (length > 4) fontSize = 4;
    main.style.fontSize = `${fontSize}rem`;
    mainSecondary.style.fontSize = `${fontSize}rem`;
    mainWrap.style.gridAutoFlow = mainFlow;
    mainWrap.style.gridTemplateColumns = mainFlow === 'row' ? 'repeat(2, auto)' : 'auto';
    mainWrap.style.gridTemplateRows = mainFlow === 'column' ? 'repeat(2, auto)' : 'auto';

    topLeft.style.visibility = '';
    main.style.visibility = '';
    mainSecondary.style.visibility = '';
    bottomLeft.style.visibility = '';
    bottomRight.style.visibility = '';
    main.textContent = mainValue;
    mainSecondary.textContent = mainSecondaryValue;
    mainSecondary.style.display = hasSecondary ? '' : 'none';
    topLeft.textContent = topLeftValue;
    bottomLeft.textContent = bottomLeftValue;
    bottomRight.textContent = bottomRightValue;
    applyVisibility();
  }

  function setIndexText(t) {
    corner.textContent = t || '';
  }

  // Control visibility via inline style (visibility:hidden) per-field.
  function setFieldVisible(field, visible) {
    const v = !!visible;
    const key = String(field || '').trim();
    const topLeftField = getLayoutField('topLeft');
    const mainField = getLayoutField('main');
    const mainSecondaryField = getLayoutField('mainSecondary');
    const bottomLeftField = getLayoutField('bottomLeft');
    const bottomRightField = getLayoutField('bottomRight');
    fieldVisibility[key] = v;
    switch (key) {
      case topLeftField:
        topLeft.style.visibility = v ? '' : 'hidden';
        break;
      case mainField:
        main.style.visibility = v ? '' : 'hidden';
        break;
      case mainSecondaryField:
        mainSecondary.style.visibility = v ? '' : 'hidden';
        break;
      case bottomLeftField:
        bottomLeft.style.visibility = v ? '' : 'hidden';
        break;
      case bottomRightField:
        bottomRight.style.visibility = v ? '' : 'hidden';
        break;
      default:
        break;
    }
  }

  function setFieldsVisible(map) {
    settingsLog('[Card:Main] setFieldsVisible()', map);
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) {
      setFieldVisible(k, !!map[k]);
    }
  }

  function setConfig(nextConfig) {
    cardConfig = normalizeCardConfig(nextConfig);
    setEntry(currentEntry);
  }

  function setAvailableFields(nextFields) {
    availableFields = normalizeAvailableFields(nextFields);
  }

  function destroy() {
    // Remove any listeners in future (none here currently) and detach nodes
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // wire optional handlers (e.g., click to speak)
  if (handlers.onClick) {
    root.addEventListener('click', (ev) => handlers.onClick(ev, { setEntry, setIndexText }));
  }

  // initialize
  setEntry(entry);
  setIndexText(indexText);

  return { el: root, setEntry, setIndexText, setFieldVisible, setFieldsVisible, setConfig, setAvailableFields, destroy };
}
