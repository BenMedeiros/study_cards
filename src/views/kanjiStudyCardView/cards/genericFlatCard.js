// Generic flat card: renders an object's top-level keys as labeled rows.
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

function normalizeStyleConfig(styleConfig) {
  if (!styleConfig || typeof styleConfig !== 'object' || Array.isArray(styleConfig)) return {};
  const style = {};
  const labelWidth = String(styleConfig.labelWidth || '').trim();
  const labelSize = String(styleConfig.labelSize || '').trim();
  const labelTone = String(styleConfig.labelTone || '').trim();
  const labelVisibility = String(styleConfig.labelVisibility || '').trim();
  const valueSize = String(styleConfig.valueSize || '').trim();
  const rowPadding = String(styleConfig.rowPadding || '').trim();
  const rowDivider = String(styleConfig.rowDivider || '').trim();
  if (labelWidth) style.labelWidth = labelWidth;
  if (labelSize) style.labelSize = labelSize;
  if (labelTone) style.labelTone = labelTone;
  if (labelVisibility) style.labelVisibility = labelVisibility;
  if (valueSize) style.valueSize = valueSize;
  if (rowPadding) style.rowPadding = rowPadding;
  if (rowDivider) style.rowDivider = rowDivider;
  return style;
}

function normalizeCardConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const next = {};
  if (config.fields && typeof config.fields === 'object' && !Array.isArray(config.fields)) {
    next.fields = {};
    for (const [fieldKey, rawFieldConfig] of Object.entries(config.fields)) {
      const field = String(fieldKey || '').trim();
      if (!field || !rawFieldConfig || typeof rawFieldConfig !== 'object' || Array.isArray(rawFieldConfig)) continue;
      const entry = {};
      if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'hide')) entry.hide = !!rawFieldConfig.hide;
      if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'order') && Number.isFinite(Number(rawFieldConfig.order))) {
        entry.order = Number(rawFieldConfig.order);
      }
      if (Object.prototype.hasOwnProperty.call(rawFieldConfig, 'style')) {
        entry.style = String(rawFieldConfig.style || 'main').trim() || 'main';
      }
      next.fields[field] = entry;
    }
  }
  if (config.styles && typeof config.styles === 'object' && !Array.isArray(config.styles)) {
    const styles = {};
    for (const [styleId, rawStyle] of Object.entries(config.styles)) {
      const id = String(styleId || '').trim();
      if (!id || !rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) continue;
      const style = normalizeStyleConfig(rawStyle);
      styles[id] = {
        name: String(rawStyle.name || '').trim() || (id === 'main' ? 'Main Style' : id),
        ...style,
      };
    }
    if (Object.keys(styles).length) next.styles = styles;
  } else if (config.style || config.customStyles) {
    const styles = normalizeCardConfig({
      styles: {
        ...(config.style ? { main: { name: 'Main Style', ...config.style } } : {}),
        ...((config.customStyles && typeof config.customStyles === 'object' && !Array.isArray(config.customStyles)) ? config.customStyles : {}),
      },
    }).styles;
    if (Object.keys(styles || {}).length) next.styles = styles;
  }
  if (!next.styles?.main) {
    next.styles = {
      ...(next.styles || {}),
      main: {},
    };
  }
  return next;
}

function applyCardStyleVars(target, style = {}) {
  if (!target) return;
  const labelWidth = String(style?.labelWidth || '').trim();
  const labelSize = String(style?.labelSize || '').trim();
  const labelTone = String(style?.labelTone || '').trim();
  const labelVisibility = String(style?.labelVisibility || '').trim();
  const valueSize = String(style?.valueSize || '').trim();
  const rowPadding = String(style?.rowPadding || '').trim();
  const rowDivider = String(style?.rowDivider || '').trim();

  const labelSizeMap = {
    '2xs': 'var(--font-size-2xs)',
    xs: 'var(--font-size-xs)',
    sm: 'var(--font-size-sm)',
    body: 'var(--font-size-body)',
  };
  const labelToneMap = {
    muted: 'var(--muted)',
    default: 'var(--text)',
  };
  const rowPaddingMap = {
    compact: '0.15rem',
    default: '0.3rem',
    relaxed: '0.5rem',
  };
  const valueSizeMap = {
    xs: 'var(--font-size-xs)',
    sm: 'var(--font-size-sm)',
    body: 'var(--font-size-body)',
    lg: 'var(--font-size-lg)',
    xl: 'var(--font-size-xl)',
  };
  const rowDividerMap = {
    show: 'var(--border-1)',
    hide: 'none',
  };

  if (labelWidth) target.style.setProperty('--generic-flat-label-width', labelWidth);
  else target.style.removeProperty('--generic-flat-label-width');

  if (labelSizeMap[labelSize]) target.style.setProperty('--generic-flat-label-size', labelSizeMap[labelSize]);
  else target.style.removeProperty('--generic-flat-label-size');

  if (labelToneMap[labelTone]) target.style.setProperty('--generic-flat-label-color', labelToneMap[labelTone]);
  else target.style.removeProperty('--generic-flat-label-color');

  if (labelVisibility === 'hidden') target.style.setProperty('--generic-flat-label-display', 'none');
  else target.style.removeProperty('--generic-flat-label-display');

  if (valueSizeMap[valueSize]) target.style.setProperty('--generic-flat-value-size', valueSizeMap[valueSize]);
  else target.style.removeProperty('--generic-flat-value-size');

  if (rowPaddingMap[rowPadding]) target.style.setProperty('--generic-flat-row-padding-y', rowPaddingMap[rowPadding]);
  else target.style.removeProperty('--generic-flat-row-padding-y');

  if (rowDividerMap[rowDivider]) target.style.setProperty('--generic-flat-row-border', rowDividerMap[rowDivider]);
  else target.style.removeProperty('--generic-flat-row-border');
}

function applyCardStyle(root, style = {}) {
  if (!root) return;
  applyCardStyleVars(root, style);
}

function applyRowStyle(rowRecord, style = {}) {
  const row = rowRecord?.row;
  if (!row) return;
  applyCardStyleVars(row, style);
  const labelHidden = String(style?.labelVisibility || '').trim() === 'hidden';
  row.style.gridTemplateColumns = labelHidden ? '1fr' : '';
}

export function createGenericFlatCard({ entry = null, indexText = '', config = {}, handlers = {} } = {}) {
  settingsLog('[Card:Generic] createGenericFlatCard()', { entry, indexText, config });
  const root = document.createElement('div');
  root.className = 'card kanji-study-card generic-flat-card';

  const topRight = document.createElement('div');
  topRight.className = 'kanji-study-card-top-right';

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = String(indexText || config?.cornerCaption || '').trim();

  const actions = document.createElement('div');
  actions.className = 'kanji-study-card-actions';

  const body = document.createElement('div');
  body.className = 'generic-flat-body';

  root.append(topRight, body);

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
          cardId: String(config?.cardId || 'genericFlatCard').trim() || 'genericFlatCard',
          entry: currentEntry,
          cardConfig: { ...cardConfig },
          availableFields: availableFields.slice(),
        });
      } catch (e) {}
    });
    actions.appendChild(configBtn);
  }

  topRight.append(corner, actions);

  function makeRow(labelText) {
    const row = document.createElement('div');
    row.className = 'kanji-full-row';
    const label = document.createElement('div');
    label.className = 'kanji-full-label';
    label.textContent = labelText || '';
    const value = document.createElement('div');
    value.className = 'kanji-full-value';
    row.append(label, value);
    return { row, label, value };
  }

  // Maintain rows map so setFieldsVisible can operate per field.
  let rows = {};

  function formatValue(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.join(', ');
    // Avoid JSON.stringify to prevent unexpected exceptions (circular structures). Use generic string conversion.
    return String(v);
  }

  function getDefaultFieldOrder(entryObj) {
    if (availableFields.length) return availableFields.map((field) => field.key);
    return Object.keys(entryObj || {});
  }

  function getRenderFieldKeys(entryObj) {
    if (cardConfig.fields && typeof cardConfig.fields === 'object' && !Array.isArray(cardConfig.fields)) {
      return Object.entries(cardConfig.fields)
        .map(([fieldKey, fieldConfig]) => ({
          key: fieldKey,
          hide: !!fieldConfig?.hide,
          order: Number.isFinite(Number(fieldConfig?.order)) ? Number(fieldConfig.order) : Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a.order - b.order)
        .filter((item) => !item.hide)
        .map((item) => item.key);
    }
    return getDefaultFieldOrder(entryObj);
  }

  function getLabelForField(fieldKey) {
    const key = String(fieldKey || '').trim();
    if (!key) return '';
    const found = availableFields.find((field) => field.key === key);
    return found?.label || key;
  }

  function setEntry(e) {
    settingsLog('[Card:Generic] setEntry()', e);
    currentEntry = e || {};
    const entryObj = currentEntry;
    rows = {};
    body.innerHTML = '';

    const keys = getRenderFieldKeys(entryObj);
    if (!keys.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No fields selected for this card.';
      body.appendChild(empty);
      return;
    }

    for (const k of keys) {
      const { row, label, value } = makeRow(getLabelForField(k));
      value.textContent = formatValue(entryObj[k]);
      rows[k] = { row, label, value };
      const styleId = String(cardConfig?.fields?.[k]?.style || 'main').trim() || 'main';
      const rowStyle = cardConfig?.styles?.[styleId] || cardConfig?.styles?.main || null;
      if (rowStyle) applyRowStyle(rows[k], rowStyle);
      body.appendChild(row);
    }
    for (const [fieldKey, isVisible] of Object.entries(fieldVisibility)) {
      setFieldVisible(fieldKey, !!isVisible);
    }
  }

  function setFieldVisible(field, visible) {
    const k = String(field || '');
    const v = !!visible;
    fieldVisibility[k] = v;
    const r = rows[k];
    if (!r) return;
    r.value.style.visibility = v ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function setIndexText(text) {
    corner.textContent = String(text || '').trim();
  }

  function setConfig(nextConfig) {
    cardConfig = normalizeCardConfig(nextConfig);
    applyCardStyle(root, cardConfig?.styles?.main || {});
    setEntry(currentEntry);
  }

  function setAvailableFields(nextFields) {
    availableFields = normalizeAvailableFields(nextFields);
    setEntry(currentEntry);
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // initialize
  applyCardStyle(root, cardConfig?.styles?.main || {});
  setEntry(entry);
  setIndexText(indexText || config?.cornerCaption || '');

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, setIndexText, setConfig, setAvailableFields, destroy };
}
