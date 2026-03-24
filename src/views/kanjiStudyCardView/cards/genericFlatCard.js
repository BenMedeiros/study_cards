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
  return next;
}

export function createGenericFlatCard({ entry = null, config = {}, handlers = {} } = {}) {
  settingsLog('[Card:Generic] createGenericFlatCard()', { entry, config });
  const root = document.createElement('div');
  root.className = 'card generic-flat-card';

  const topRight = document.createElement('div');
  topRight.className = 'kanji-study-card-top-right';

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = String(config?.cornerCaption || '').trim();

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

  function setConfig(nextConfig) {
    cardConfig = normalizeCardConfig(nextConfig);
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
  setEntry(entry);

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, setConfig, setAvailableFields, destroy };
}
