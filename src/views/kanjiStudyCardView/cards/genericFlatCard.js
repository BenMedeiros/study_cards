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

function normalizeCardConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const next = {};
  if (Array.isArray(config.fields)) {
    next.fields = Array.from(new Set(config.fields.map((field) => String(field || '').trim()).filter(Boolean)));
  }
  if (config.style && typeof config.style === 'object' && !Array.isArray(config.style)) {
    const style = {};
    const labelWidth = String(config.style.labelWidth || '').trim();
    const labelSize = String(config.style.labelSize || '').trim();
    const labelTone = String(config.style.labelTone || '').trim();
    const labelVisibility = String(config.style.labelVisibility || '').trim();
    const valueSize = String(config.style.valueSize || '').trim();
    const rowPadding = String(config.style.rowPadding || '').trim();
    const rowDivider = String(config.style.rowDivider || '').trim();
    if (labelWidth) style.labelWidth = labelWidth;
    if (labelSize) style.labelSize = labelSize;
    if (labelTone) style.labelTone = labelTone;
    if (labelVisibility) style.labelVisibility = labelVisibility;
    if (valueSize) style.valueSize = valueSize;
    if (rowPadding) style.rowPadding = rowPadding;
    if (rowDivider) style.rowDivider = rowDivider;
    if (Object.keys(style).length) next.style = style;
  }
  if (config.customStyles && typeof config.customStyles === 'object' && !Array.isArray(config.customStyles)) {
    const customStyles = {};
    for (const [styleId, rawStyle] of Object.entries(config.customStyles)) {
      const id = String(styleId || '').trim();
      if (!id || !rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) continue;
      const style = normalizeCardConfig({ style: rawStyle }).style || {};
      customStyles[id] = {
        name: String(rawStyle.name || '').trim() || id,
        ...style,
      };
    }
    if (Object.keys(customStyles).length) next.customStyles = customStyles;
  }
  if (config.fieldStyles && typeof config.fieldStyles === 'object' && !Array.isArray(config.fieldStyles)) {
    const validStyleIds = new Set(Object.keys(next.customStyles || {}));
    const fieldStyles = {};
    for (const [fieldKey, styleId] of Object.entries(config.fieldStyles)) {
      const field = String(fieldKey || '').trim();
      const style = String(styleId || '').trim();
      if (!field || !style || !validStyleIds.has(style)) continue;
      fieldStyles[field] = style;
    }
    if (Object.keys(fieldStyles).length) next.fieldStyles = fieldStyles;
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
    if (Array.isArray(cardConfig.fields)) return cardConfig.fields.slice();
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
      const styleId = String(cardConfig?.fieldStyles?.[k] || '').trim();
      const rowStyle = styleId ? cardConfig?.customStyles?.[styleId] : null;
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
    applyCardStyle(root, cardConfig.style);
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
  applyCardStyle(root, cardConfig.style);
  setEntry(entry);
  setIndexText(indexText || config?.cornerCaption || '');

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, setIndexText, setConfig, setAvailableFields, destroy };
}
