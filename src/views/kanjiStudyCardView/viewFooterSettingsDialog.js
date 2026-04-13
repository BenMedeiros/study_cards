import { el, safeId } from '../../utils/browser/ui.js';
import { openViewFooterCustomButtonDialog } from './viewFooterCustomButtonDialog.js';
import { confirmDialog } from '../../components/dialogs/confirmDialog.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { createJsonViewer } from '../../components/shared/jsonViewer.js';
import { getLanguageCode } from '../../utils/browser/speech.js';

// Autoplay constraints
const AUTOPLAY_MIN_MS = 500;
const AUTOPLAY_MAX_MS = 10000;
const AUTOPLAY_STEP_MS = 500;

function clampAutoplayMs(ms) {
  const n = Number(ms || 0) || 0;
  const stepped = Math.round(n / AUTOPLAY_STEP_MS) * AUTOPLAY_STEP_MS;
  return Math.max(AUTOPLAY_MIN_MS, Math.min(AUTOPLAY_MAX_MS, stepped));
}

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function asString(v) {
  return (v == null) ? '' : String(v);
}

const COMMON_ICON_CHOICES = [
  { value: '', label: '—', title: '(none)' },
  { value: '🔊', label: '🔊', title: 'speaker' },
  { value: '🎯', label: '🎯', title: 'target' },
  { value: '✅', label: '✅', title: 'check' },
  { value: '→', label: '→', title: 'next' },
  { value: '←', label: '←', title: 'prev' },
  { value: '🔍', label: '🔍', title: 'search' },
  { value: '📘', label: '📘', title: 'book' },
  { value: '⭐', label: '⭐', title: 'star' },
  { value: '🧠', label: '🧠', title: 'brain' },
  { value: '📝', label: '📝', title: 'notes' },
  { value: '🧹', label: '🧹', title: 'clear' },
  { value: '⚙️', label: '⚙️', title: 'settings' },
  { value: '➕', label: '➕', title: 'add' },
  { value: '➖', label: '➖', title: 'remove' },
];

function createIconDropdown({ value = '', onChange } = {}) {
  const current = asString(value).trim();
  const baseItems = COMMON_ICON_CHOICES.map(it => ({ ...it }));
  if (current && !baseItems.some(it => asString(it.value) === current)) {
    baseItems.unshift({ value: current, label: current, title: 'custom' });
  }

  return createDropdown({
    items: baseItems,
    value: current,
    className: 'view-footer-icon-dropdown',
    closeOverlaysOnOpen: false,
    portalZIndex: 1400,
    getButtonLabel: ({ selectedItem }) => {
      const icon = asString(selectedItem?.value).trim();
      return icon || '—';
    },
    renderOption: ({ item }) => {
      const node = el('span', { text: asString(item?.label || '—') });
      node.className = 'view-footer-icon-option';
      const title = asString(item?.title || '');
      if (title) node.title = title;
      return node;
    },
    onChange: (nextVal) => {
      if (typeof onChange === 'function') onChange(asString(nextVal).trim());
    },
  });
}
function isCustomToken(key) {
  return typeof key === 'string' && (key.startsWith('__custom:') || key.startsWith('_custom:'));
}

function customTokenFromId(id) {
  return `__custom:${asString(id).trim()}`;
}

function normalizeCustomToken(token) {
  const t = asString(token).trim();
  if (!isCustomToken(t)) return t;
  const id = t.startsWith('__custom:')
    ? t.slice('__custom:'.length).trim()
    : (t.startsWith('_custom:') ? t.slice('_custom:'.length).trim() : '');
  return customTokenFromId(id);
}

function normalizeCustomButtons(raw = []) {
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(raw) ? raw : [])) {
    if (!item || typeof item !== 'object') continue;
    const id = asString(item.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const actions = [];
    for (const step of (Array.isArray(item.actions) ? item.actions : [])) {
      if (!step || typeof step !== 'object') continue;
      const actionId = asString(step.actionId).trim();
      if (!actionId) continue;
      actions.push({ actionId });
    }
    out.push({
      id,
      icon: asString(item.icon),
      text: asString(item.text) || 'Custom',
      caption: asString(item.caption),
      shortcut: asString(item.shortcut),
      actions,
    });
  }
  return out;
}

function isControlDescriptor(item) {
  return !!(item && typeof item === 'object' && !(item instanceof Element) && item.key);
}

function shortcutToCaption(shortcut) {
  const s = asString(shortcut);
  if (!s) return '';
  if (s === ' ') return 'Space';
  if (s === 'ArrowLeft') return '←';
  if (s === 'ArrowRight') return '→';
  if (s === 'ArrowUp') return '↑';
  if (s === 'ArrowDown') return '↓';
  if (s === 'Enter') return 'Enter';
  if (/^[a-z]$/i.test(s)) return s.toUpperCase();
  return s;
}

function normalizeBaseControls(baseControls = []) {
  const out = [];
  for (const raw of baseControls) {
    if (!isControlDescriptor(raw)) continue;
    const item = {
      key: String(raw.key || '').trim(),
      text: asString(raw.text),
      icon: asString(raw.icon),
      caption: asString(raw.caption),
      shortcut: asString(raw.shortcut),
      actionKey: asString(raw.actionKey),
      fnName: asString(raw.fnName),
      states: Array.isArray(raw.states)
        ? raw.states
          .filter(s => s && s.name)
          .map(s => ({
            name: String(s.name),
            text: asString(s.text),
            icon: asString(s.icon),
            caption: asString(s.caption),
            shortcut: asString(s.shortcut),
            actionKey: asString(s.actionKey),
            fnName: asString(s.fnName),
          }))
        : [],
    };
    if (!item.key) continue;
    out.push(item);
  }
  return out;
}

function ensureDefaultConfig(config) {
  const c = (config && typeof config === 'object') ? config : {};
  return {
    id: String(c.id || 'default'),
    name: asString(c.name || 'Default') || 'Default',
    order: Array.isArray(c.order) ? c.order.map(v => String(v || '').trim()).filter(Boolean) : [],
    controls: (c.controls && typeof c.controls === 'object') ? deepClone(c.controls) : {},
    customButtons: normalizeCustomButtons(c.customButtons),
    hotkeysDisabled: !!c.hotkeysDisabled,
    restrictToCollectionKey: asString(c.restrictToCollectionKey),
  };
}

function normalizeAppPrefs(raw, baseControls, { customOnly = false } = {}) {
  const baseKeys = baseControls.map(c => c.key);
  const src = (raw && typeof raw === 'object') ? raw : {};
  const rawConfigs = Array.isArray(src.configs) ? src.configs : [];
  const byId = new Map();

  for (const c of rawConfigs) {
    const n = ensureDefaultConfig(c);
    const id = String(n.id || '').trim();
    if (!id) continue;
    n.id = id;
    n.order = normalizeOrder(n.order, baseKeys, n.customButtons, { customOnly });
    byId.set(n.id, n);
  }

  const configs = Array.from(byId.values());
  const preferredActiveId = asString(src.activeConfigId).trim();
  const activeConfigId = byId.has(preferredActiveId)
    ? preferredActiveId
    : (configs[0] ? asString(configs[0].id).trim() : '');
  return { activeConfigId, configs };
}

function normalizeOrder(order, baseKeys, customButtons = [], { customOnly = false } = {}) {
  const customTokens = new Set((Array.isArray(customButtons) ? customButtons : []).map(btn => customTokenFromId(btn.id)));
  const seen = new Set();
  const out = [];
  const source = Array.isArray(order) ? order : [];
  for (const key of source) {
    const k = normalizeCustomToken(String(key || '').trim());
    // allow placeholder token '__empty' to be included in the order
    const isPlaceholder = (k === '__empty');
    const allowedBase = !customOnly && baseKeys.includes(k);
    const allowedCustom = customTokens.has(k);
    if (!k || (!isPlaceholder && seen.has(k)) || (!isPlaceholder && !allowedBase && !allowedCustom)) continue;
    if (!isPlaceholder) seen.add(k);
    out.push(k);
  }
  for (const token of customTokens) {
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  if (!customOnly) {
    for (const k of baseKeys) {
      if (!seen.has(k)) out.push(k);
    }
  }
  return out;
}

function getConfigById(prefs, configId) {
  if (!prefs || !Array.isArray(prefs.configs)) return null;
  const id = String(configId || '').trim();
  return prefs.configs.find(c => c.id === id) || null;
}

function getControlOverride(config, key) {
  if (!config || !config.controls || typeof config.controls !== 'object') return {};
  const v = config.controls[key];
  if (!v || typeof v !== 'object') return {};
  return v;
}

function normalizeHotkeyEvent(e) {
  if (!e || typeof e.key !== 'string') return { ok: false, reason: 'Press a single key.' };
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return { ok: false, reason: 'Modifiers are not allowed (Ctrl/Alt/Meta).' };
  }

  const key = e.key;
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
    return { ok: false, reason: 'Press a non-modifier key.' };
  }

  if (key === ' ') return { ok: true, shortcut: ' ', caption: 'Space' };
  if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
    return { ok: true, shortcut: key, caption: shortcutToCaption(key) };
  }
  if (key === 'Enter') return { ok: true, shortcut: 'Enter', caption: 'Enter' };

  if (/^[a-z]$/i.test(key)) {
    const shortcut = key.toLowerCase();
    return { ok: true, shortcut, caption: shortcut.toUpperCase() };
  }

  if (/^[0-9]$/.test(key)) {
    return { ok: true, shortcut: key, caption: key };
  }

  return { ok: false, reason: 'Only letters, numbers, arrows, Enter, and Space are allowed.' };
}

function openHotkeyCaptureDialog({ currentShortcut = '', isTaken = null } = {}) {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'view-footer-hotkey-backdrop' });
    const dialog = el('div', {
      className: 'view-footer-hotkey-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Set footer hotkey',
      }
    });
    dialog.tabIndex = -1;

    const title = el('div', { className: 'view-footer-hotkey-title', text: 'Set Hotkey' });
    const hint = el('div', { className: 'hint', text: 'Press one key (letters, numbers, arrows, Enter, Space).' });
    const current = el('div', { className: 'hint', text: `Current: ${shortcutToCaption(currentShortcut) || 'None'}` });
    const captured = el('div', { className: 'view-footer-hotkey-captured', text: 'Waiting for key…' });
    const error = el('div', { className: 'view-footer-hotkey-error hint', text: '' });

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    const useBtn = el('button', { className: 'btn small', text: 'Use Key' });
    useBtn.type = 'button';
    useBtn.disabled = true;

    actions.append(cancelBtn, useBtn);
    dialog.append(title, hint, current, captured, error, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);

    let closed = false;
    let picked = null;

    function close(result = null) {
      if (closed) return;
      closed = true;
      try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
      try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
      try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      resolve(result);
    }

    function setError(msg) {
      error.textContent = asString(msg || '');
    }

    function setPicked(next) {
      picked = next;
      if (!picked) {
        captured.textContent = 'Waiting for key…';
        useBtn.disabled = true;
        return;
      }
      captured.textContent = `Captured: ${picked.caption}`;
      useBtn.disabled = false;
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const parsed = normalizeHotkeyEvent(e);
      if (!parsed.ok) {
        setPicked(null);
        setError(parsed.reason);
        return;
      }

      if (typeof isTaken === 'function') {
        const takenMsg = isTaken(parsed.shortcut);
        if (takenMsg) {
          setPicked(null);
          setError(takenMsg);
          return;
        }
      }

      setError('');
      setPicked({ shortcut: parsed.shortcut, caption: parsed.caption });
    }

    cancelBtn.addEventListener('click', () => close(null));
    useBtn.addEventListener('click', () => {
      if (!picked) return;
      close({ shortcut: picked.shortcut, caption: picked.caption });
    });
    backdrop.addEventListener('click', () => close(null));

    document.addEventListener('keydown', onKeyDown, true);
    try { dialog.focus(); } catch (e) {}
  });
}

function openDeleteConfigConfirmDialog({ configName = '' } = {}) {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'view-footer-hotkey-backdrop' });
    const dialog = el('div', {
      className: 'view-footer-hotkey-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Delete footer config',
      }
    });
    dialog.tabIndex = -1;

    const title = el('div', { className: 'view-footer-hotkey-title', text: 'Delete Footer Config' });
    const message = el('div', { className: 'hint', text: `Delete "${asString(configName || 'this config')}"?` });
    const detail = el('div', { className: 'hint', text: 'This action cannot be undone.' });

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    const deleteBtn = el('button', { className: 'btn small danger', text: 'Delete' });
    deleteBtn.type = 'button';
    actions.append(cancelBtn, deleteBtn);

    dialog.append(title, message, detail, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);

    let closed = false;

    function close(result) {
      if (closed) return;
      closed = true;
      try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
      try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
      try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      resolve(!!result);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    }

    cancelBtn.addEventListener('click', () => close(false));
    deleteBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', () => close(false));

    document.addEventListener('keydown', onKeyDown, true);
    try { deleteBtn.focus(); } catch (e) { try { dialog.focus(); } catch (e2) {} }
  });
}

export function openViewFooterSettingsDialog({
  appId = 'viewFooter',
  baseControls = [],
  availableActions = [],
  appPrefs = null,
  defaultAppPrefs = null,
  customOnly = false,
  collectionLabel = '',
  currentCollectionKey = '',
  getSpeechConfig = null,
  onChange = null,
} = {}) {
  const controls = normalizeBaseControls(baseControls);
  const baseKeys = controls.map(c => c.key);
  let prefs = normalizeAppPrefs(appPrefs, controls, { customOnly: !!customOnly });
  let selectedConfigId = prefs.activeConfigId;
  let savedPrefs = null;
  let isDirty = false;
  let expandedRows = new Set();
  let isConfigListCollapsed = false;
  const availableActionList = Array.isArray(availableActions) ? availableActions.slice() : [];
  const availableActionById = new Map(availableActionList.map(a => [asString(a.id).trim(), a]));
  const templatePrefs = normalizeAppPrefs(defaultAppPrefs, controls, { customOnly: !!customOnly });
  const normalizedCollectionKey = asString(currentCollectionKey || collectionLabel).trim();
  ensureSelectedConfigIsAvailable();
  savedPrefs = deepClone(prefs);

  function normalizeActionFieldKey(fieldKey = '') {
    const raw = asString(fieldKey).trim();
    if (!raw) return '';
    return raw.startsWith('entry.') ? raw.slice('entry.'.length).trim() : raw;
  }

  function resolveSpeakFieldLang(fieldKey = '') {
    const key = normalizeActionFieldKey(fieldKey);
    if (!key) return '';
    try {
      const speechConfig = (typeof getSpeechConfig === 'function') ? (getSpeechConfig() || {}) : {};
      const fieldLang = asString(speechConfig?.fields?.[key]?.lang).trim();
      if (fieldLang) return fieldLang;
    } catch (e) {}
    return asString(getLanguageCode(key, normalizedCollectionKey)).trim();
  }

  function isConfigAvailableForCollection(config, collectionKey = normalizedCollectionKey) {
    const restrictedKey = asString(config?.restrictToCollectionKey).trim();
    if (!restrictedKey) return true;
    return !!collectionKey && restrictedKey === collectionKey;
  }

  function availableConfigs() {
    return (Array.isArray(prefs?.configs) ? prefs.configs : []).filter(cfg => isConfigAvailableForCollection(cfg));
  }

  function ensureSelectedConfigIsAvailable() {
    const available = availableConfigs();
    const hasSelected = available.some(cfg => asString(cfg?.id).trim() === asString(selectedConfigId).trim());
    if (hasSelected) {
      prefs.activeConfigId = selectedConfigId;
      return;
    }
    const nextId = asString(available[0]?.id).trim();
    selectedConfigId = nextId;
    prefs.activeConfigId = nextId;
  }

  function getDefaultTemplateConfig() {
    return getConfigById(templatePrefs, 'default') || getConfigById(prefs, 'default') || {
      id: 'default',
      name: 'Default',
      order: customOnly ? [] : baseKeys.slice(),
      controls: {},
      customButtons: [],
      hotkeysDisabled: false,
    };
  }

  function buildStateActionDisplay(base, st) {
    const actionId = asString(st.actionKey || `${base.key}:${st.name}`).trim();
    const mapped = availableActionById.get(actionId) || null;
    return {
      actionId,
      title: asString(st.name || st.text || actionId),
      fnName: asString(st.fnName || mapped?.fnName || actionId),
      icon: asString(st.icon || mapped?.icon || ''),
      text: asString(st.text || mapped?.text || ''),
      shortcut: asString(st.shortcut || mapped?.shortcut || ''),
    };
  }

  function buildControlActionDisplay(base) {
    const actionId = asString(base.actionKey || base.key).trim();
    const mapped = availableActionById.get(actionId) || null;
    return {
      actionId,
      title: asString(base.text || base.key),
      fnName: asString(base.fnName || mapped?.fnName || actionId),
      icon: asString(base.icon || mapped?.icon || ''),
      text: asString(base.text || mapped?.text || ''),
      shortcut: asString(base.shortcut || mapped?.shortcut || ''),
    };
  }

  function formatCustomActionLabel(action) {
    const fnName = asString(action?.fnName).trim();
    const actionField = asString(action?.actionField).trim();
    if (!fnName) return asString(action?.id).trim();
    if (!actionField) return fnName;
    if (fnName === 'action.delay') return `${fnName}[${actionField}]`;
    if (/^manager\.studyProgress\.(setState|toggleState)$/.test(fnName)) return `${fnName}[${actionField}]`;
    if (fnName === 'entry.speakField') {
      const lang = resolveSpeakFieldLang(actionField);
      return lang ? `${fnName}[${actionField}][${lang}]` : `${fnName}[${actionField}]`;
    }
    if (/^app\.kanjiStudyCardView\.entryFields\.(setOff|setOn|toggle)$/.test(fnName)) return `${fnName}[${actionField}]`;
    if (fnName === 'link.open') return `${fnName}[${actionField}]`;
    return fnName;
  }

  function enforceCollectionScope(targetPrefs = prefs) {
    if (!normalizedCollectionKey || !Array.isArray(targetPrefs?.configs)) return targetPrefs;
    for (const cfg of targetPrefs.configs) {
      if (!cfg || typeof cfg !== 'object') continue;
      if (asString(cfg.restrictToCollectionKey).trim()) continue;
      cfg.restrictToCollectionKey = normalizedCollectionKey;
    }
    return targetPrefs;
  }

  function emitSave(nextPrefs = prefs) {
    try {
      const payload = deepClone(enforceCollectionScope(nextPrefs));
      if (typeof onChange === 'function') onChange(payload);
    } catch (e) {
      // ignore
    }
  }

  function selectedConfig() {
    ensureSelectedConfigIsAvailable();
    return getConfigById(prefs, selectedConfigId) || availableConfigs()[0] || null;
  }

  function ensureSelectedOrder(config) {
    if (!config) return;
    config.order = normalizeOrder(config.order, baseKeys, config.customButtons || [], { customOnly: !!customOnly });
  }

  function getCustomButton(config, token) {
    if (!config || !isCustomToken(token)) return null;
    const t = asString(token).trim();
    const id = t.startsWith('__custom:')
      ? t.slice('__custom:'.length).trim()
      : (t.startsWith('_custom:') ? t.slice('_custom:'.length).trim() : '');
    if (!id) return null;
    const list = Array.isArray(config.customButtons) ? config.customButtons : [];
    return list.find(btn => btn && btn.id === id) || null;
  }

  function upsertCustomButton(config, nextButton) {
    if (!config || !nextButton || typeof nextButton !== 'object') return;
    if (!Array.isArray(config.customButtons)) config.customButtons = [];
    const id = asString(nextButton.id).trim();
    if (!id) return;
    const idx = config.customButtons.findIndex(btn => btn && btn.id === id);
    if (idx < 0) config.customButtons.push(nextButton);
    else config.customButtons[idx] = nextButton;
  }

  function removeCustomButton(config, token) {
    if (!config || !Array.isArray(config.customButtons)) return;
    const t = asString(token).trim();
    const id = t.startsWith('__custom:')
      ? t.slice('__custom:'.length).trim()
      : (t.startsWith('_custom:') ? t.slice('_custom:'.length).trim() : '');
    if (!id) return;
    config.customButtons = config.customButtons.filter(btn => btn && btn.id !== id);
  }

  function setControlOverride(config, key, next) {
    if (!config) return;
    if (!config.controls || typeof config.controls !== 'object') config.controls = {};
    const cleaned = (next && typeof next === 'object') ? next : {};
    const hasValues = Object.keys(cleaned).length > 0;
    if (!hasValues) delete config.controls[key];
    else config.controls[key] = cleaned;
  }

  function resetControlToDefault(config, key) {
    if (!config || !config.controls) return;
    delete config.controls[key];
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function collectDiffEntries(left, right, path = 'prefs', out = [], limit = 20) {
    if (out.length >= limit) return out;
    if (left === right) return out;

    const leftIsArray = Array.isArray(left);
    const rightIsArray = Array.isArray(right);
    if (leftIsArray || rightIsArray) {
      if (!leftIsArray || !rightIsArray) {
        out.push({ path, before: right, after: left, reason: 'type-mismatch' });
        return out;
      }
      if (left.length !== right.length) {
        out.push({ path: `${path}.length`, before: right.length, after: left.length, reason: 'array-length' });
        if (out.length >= limit) return out;
      }
      const max = Math.max(left.length, right.length);
      for (let i = 0; i < max && out.length < limit; i += 1) {
        collectDiffEntries(left[i], right[i], `${path}[${i}]`, out, limit);
      }
      return out;
    }

    const leftIsObject = isPlainObject(left);
    const rightIsObject = isPlainObject(right);
    if (leftIsObject || rightIsObject) {
      if (!leftIsObject || !rightIsObject) {
        out.push({ path, before: right, after: left, reason: 'type-mismatch' });
        return out;
      }
      const keys = new Set([...Object.keys(right), ...Object.keys(left)]);
      for (const key of keys) {
        if (out.length >= limit) break;
        collectDiffEntries(left[key], right[key], `${path}.${key}`, out, limit);
      }
      return out;
    }

    out.push({ path, before: right, after: left, reason: 'value' });
    return out;
  }

  function logDirtyDiff(context = 'markDirty') {
    try {
      const diffs = collectDiffEntries(prefs, savedPrefs);
      console.debug('[viewFooterSettingsDialog] dirty diff', {
        context,
        diffCount: diffs.length,
        diffs,
        currentActiveConfigId: prefs?.activeConfigId,
        savedActiveConfigId: savedPrefs?.activeConfigId,
        selectedConfigId,
      });
    } catch (e) {}
  }

  function formatDiffValue(value) {
    if (typeof value === 'undefined') return '(missing)';
    if (value === null) return 'null';
    if (typeof value === 'string') return value || '""';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch (e) {}
    return String(value);
  }

  function renderPendingDiffSummary() {
    if (!pendingDiffSummary) return;
    pendingDiffSummary.innerHTML = '';
    if (!isDirty) {
      pendingDiffSummary.style.display = 'none';
      return;
    }
    const diffs = collectDiffEntries(prefs, savedPrefs, 'prefs', [], 12);
    if (!diffs.length) {
      pendingDiffSummary.style.display = 'none';
      return;
    }
    pendingDiffSummary.style.display = 'block';
    pendingDiffSummary.appendChild(el('div', {
      className: 'view-footer-pending-diff-title',
      text: 'Pending changes',
    }));
    for (const diff of diffs) {
      pendingDiffSummary.appendChild(el('div', {
        className: 'view-footer-pending-diff-line',
        text: `${diff.path}: ${formatDiffValue(diff.before)} -> ${formatDiffValue(diff.after)}`,
      }));
    }
  }

  function openJsonDialog({ title: dialogTitle = 'JSON', hint = '', data = null } = {}) {
    const mount = document.body || document.documentElement;
    if (!mount) return;

    const backdrop = el('div');
    const dialog = el('div', {
      className: 'card',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Footer config JSON',
      },
    });
    dialog.tabIndex = -1;

    try {
      backdrop.style.position = 'fixed';
      backdrop.style.inset = '0';
      backdrop.style.background = 'rgba(0, 0, 0, 0.45)';
      backdrop.style.zIndex = '1400';
      dialog.style.position = 'fixed';
      dialog.style.left = '50%';
      dialog.style.top = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
      dialog.style.width = 'min(960px, calc(100vw - 2rem))';
      dialog.style.maxHeight = 'calc(100vh - 2rem)';
      dialog.style.display = 'flex';
      dialog.style.flexDirection = 'column';
      dialog.style.gap = '0.75rem';
      dialog.style.padding = '0.9rem';
      dialog.style.zIndex = '1401';
      dialog.style.background = 'var(--surface, #1f2937)';
      dialog.style.border = '1px solid var(--border-color, rgba(255, 255, 255, 0.16))';
      dialog.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.35)';
      dialog.style.borderRadius = '0.75rem';
    } catch (e) {}

    const header = el('div', {
      children: [
        el('div', { text: asString(dialogTitle).trim() || 'JSON' }),
        el('div', { className: 'hint', text: asString(hint).trim() }),
      ],
    });
    try {
      header.style.display = 'flex';
      header.style.flexDirection = 'column';
      header.style.gap = '0.2rem';
      header.style.color = 'var(--text, #f9fafb)';
    } catch (e) {}
    try {
      if (header.firstChild) {
        header.firstChild.style.fontSize = '1rem';
        header.firstChild.style.fontWeight = '700';
        header.firstChild.style.color = 'var(--text, #f9fafb)';
      }
      if (header.lastChild) {
        header.lastChild.style.color = 'var(--muted, #cbd5e1)';
      }
    } catch (e) {}

    const viewer = createJsonViewer(deepClone(data), {
      expanded: true,
      maxChars: 200000,
      maxLines: 10000,
      previewLen: 400,
    });
    viewer.classList.add('kanji-study-card-config-json-viewer');
    const viewerBody = el('div', { children: [viewer] });
    try {
      viewerBody.style.minHeight = '0';
      viewerBody.style.overflow = 'auto';
      viewerBody.style.flex = '1 1 auto';
    } catch (e) {}

    const closeJsonBtn = el('button', { className: 'btn', text: 'Close', attrs: { type: 'button' } });
    const footer = el('div', { children: [closeJsonBtn] });
    try {
      footer.style.display = 'flex';
      footer.style.justifyContent = 'flex-end';
    } catch (e) {}

    dialog.append(header, viewerBody, footer);

    function closeJsonDialog() {
      try { dialog.remove(); } catch (e) {}
      try { backdrop.remove(); } catch (e) {}
      try { dialog.removeEventListener('keydown', onJsonKeyDown); } catch (e) {}
    }

    function onJsonKeyDown(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeJsonDialog();
    }

    closeJsonBtn.addEventListener('click', closeJsonDialog);
    backdrop.addEventListener('click', closeJsonDialog);
    dialog.addEventListener('keydown', onJsonKeyDown);

    mount.append(backdrop, dialog);
    try { dialog.focus(); } catch (e) {}
  }

  function openCurrentConfigJsonDialog() {
    const cfg = selectedConfig();
    if (!cfg) return;
    openJsonDialog({
      title: `Footer Settings Config - ${asString(cfg.name || cfg.id).trim() || 'Selected config'}`,
      hint: `localStorage["study_cards:settings"]["apps.viewFooter.configs"]["${appId}"].configs[]`,
      data: cfg,
    });
  }

  function openStoredFooterPrefsJsonDialog() {
    openJsonDialog({
      title: `Footer Settings Store - ${appId}`,
      hint: `localStorage["study_cards:settings"]["apps.viewFooter.configs"]["${appId}"]`,
      data: prefs,
    });
  }

  function markDirty(context = 'markDirty') {
    const nextDirty = JSON.stringify(prefs) !== JSON.stringify(savedPrefs);
    if (nextDirty) logDirtyDiff(context);
    isDirty = nextDirty;
    if (saveBtn) saveBtn.disabled = !isDirty;
    renderPendingDiffSummary();
  }

  function createNewConfig() {
    const stamp = Date.now().toString(36).slice(-5);
    const id = `cfg-${safeId(`${appId}-${stamp}`) || stamp}`;
    const defaultCfg = ensureDefaultConfig(deepClone(getDefaultTemplateConfig()));
    const next = {
      id,
      name: `Config ${prefs.configs.length + 1}`,
      order: customOnly
        ? normalizeOrder(defaultCfg?.order || [], baseKeys, defaultCfg?.customButtons || [], { customOnly: true })
        : baseKeys.slice(),
      controls: {},
      customButtons: customOnly ? normalizeCustomButtons(defaultCfg?.customButtons || []) : [],
      hotkeysDisabled: !!(defaultCfg && defaultCfg.hotkeysDisabled),
      restrictToCollectionKey: normalizedCollectionKey,
    };
    prefs.configs.push(next);
    prefs.activeConfigId = id;
    selectedConfigId = id;
    markDirty();
  }

  function duplicateSelectedConfig() {
    const src = selectedConfig();
    if (!src) return;
    const stamp = Date.now().toString(36).slice(-5);
    const id = `cfg-${safeId(`${src.id}-${stamp}`) || stamp}`;
    const next = ensureDefaultConfig(deepClone(src));
    next.id = id;
    next.name = `${src.name || 'Config'} Copy`;
    next.restrictToCollectionKey = normalizedCollectionKey;
    prefs.configs.push(next);
    prefs.activeConfigId = id;
    selectedConfigId = id;
    markDirty();
  }

  function deleteSelectedConfig() {
    const current = selectedConfig();
    if (!current) return;
    prefs.configs = prefs.configs.filter(c => c.id !== current.id);
    const nextActive = (prefs.configs[0] && asString(prefs.configs[0].id).trim()) || '';
    prefs.activeConfigId = nextActive;
    selectedConfigId = nextActive;
    markDirty();
  }

  function moveControl(config, key, delta) {
    if (!config) return;
    ensureSelectedOrder(config);
    const idx = config.order.indexOf(key);
    if (idx < 0) return;
    const nextIdx = idx + Number(delta || 0);
    if (nextIdx < 0 || nextIdx >= config.order.length) return;
    const arr = config.order.slice();
    const tmp = arr[idx];
    arr[idx] = arr[nextIdx];
    arr[nextIdx] = tmp;
    config.order = arr;
    markDirty();
  }

  function getBaseControl(key) {
    return controls.find(c => c.key === key) || null;
  }

  function upsertStateOverride(override, stateName, updater) {
    const out = (override && typeof override === 'object') ? deepClone(override) : {};
    const states = (out.states && typeof out.states === 'object') ? { ...out.states } : {};
    const nextState = (states[stateName] && typeof states[stateName] === 'object') ? { ...states[stateName] } : {};
    updater(nextState);
    const keepState = Object.keys(nextState).length > 0;
    if (keepState) states[stateName] = nextState;
    else delete states[stateName];
    if (Object.keys(states).length > 0) out.states = states;
    else delete out.states;
    return out;
  }

  function resolveShortcut(base, override) {
    const ov = (override && typeof override === 'object') ? override : {};
    return asString(ov.shortcut || base.shortcut || '');
  }

  function resolveStateShortcut(baseState, stateOverride) {
    const ov = (stateOverride && typeof stateOverride === 'object') ? stateOverride : {};
    return asString(ov.shortcut || baseState.shortcut || '');
  }

  async function openCustomButtonEditor(config, existing = null) {
    if (!config) return;
    const picked = await openViewFooterCustomButtonDialog({
      availableActions: availableActionList,
    });
    const actionIds = Array.isArray(picked?.actionIds)
      ? picked.actionIds.map(id => asString(id).trim()).filter(Boolean)
      : [asString(picked && picked.actionId).trim()].filter(Boolean);
    if (!actionIds.length) return;

    const source = existing ? deepClone(existing) : {
      id: `custom-${Date.now().toString(36).slice(-6)}`,
      icon: '',
      text: 'Custom',
      caption: '',
      shortcut: '',
      actions: [],
    };

    const id = asString(source.id || '').trim() || `custom-${Date.now().toString(36).slice(-6)}`;
    const actions = Array.isArray(source.actions)
      ? source.actions.map(a => ({
        actionId: asString(a && a.actionId).trim(),
      })).filter(a => a.actionId)
      : [];
    for (const actionId of actionIds) {
      actions.push({ actionId });
    }

    const normalized = {
      id,
      icon: asString(source.icon),
      text: asString(source.text || 'Custom'),
      caption: asString(source.caption),
      shortcut: asString(source.shortcut),
      actions,
    };

    upsertCustomButton(config, normalized);
    const token = customTokenFromId(normalized.id);
    if (!Array.isArray(config.order)) config.order = [];
    if (!config.order.includes(token)) config.order.push(token);
    markDirty();
    renderEditor();
  }

  function getAssignedShortcutMap(config, { skipKey = null, skipState = null } = {}) {
    const map = new Map();
    if (!config) return map;

    for (const key of config.order || []) {
      if (isCustomToken(key)) {
        const custom = getCustomButton(config, key);
        if (!custom) continue;
        const override = getControlOverride(config, key);
        if (override.hidden) continue;
        if (key === skipKey && !skipState) continue;
        const shortcut = asString(custom.shortcut);
        if (shortcut) map.set(shortcut.toUpperCase(), `${key}`);
        continue;
      }

      const base = getBaseControl(key);
      if (!base) continue;
      const override = getControlOverride(config, key);
      if (override.hidden) continue;

      if (!Array.isArray(base.states) || base.states.length === 0) {
        if (key === skipKey && !skipState) continue;
        const shortcut = resolveShortcut(base, override);
        if (shortcut) map.set(shortcut.toUpperCase(), `${key}`);
        continue;
      }

      for (const st of base.states) {
        if (!st || !st.name) continue;
        if (key === skipKey && st.name === skipState) continue;
        const stOv = (override.states && override.states[st.name]) ? override.states[st.name] : {};
        const shortcut = resolveStateShortcut(st, stOv);
        if (!shortcut) continue;
        map.set(shortcut.toUpperCase(), `${key}:${st.name}`);
      }
    }

    return map;
  }

  function isControlDefault(config, key) {
    if (isCustomToken(key)) {
      const ov = getControlOverride(config, key);
      if (!ov || typeof ov !== 'object') return true;
      const keys = Object.keys(ov);
      if (keys.length === 0) return true;
      if (keys.length === 1 && keys[0] === 'hidden' && !ov.hidden) return true;
      return false;
    }

    const ov = getControlOverride(config, key);
    if (!ov || typeof ov !== 'object') return true;
    // keys other than states
    const otherKeys = Object.keys(ov).filter(k => k !== 'states');
    if (otherKeys.length > 0) return false;
    if (ov.states && typeof ov.states === 'object') {
      for (const stName of Object.keys(ov.states)) {
        const st = ov.states[stName];
        if (st && typeof st === 'object' && Object.keys(st).length > 0) return false;
      }
    }
    return true;
  }

  // Close any existing overlays first.
  try { document.dispatchEvent(new CustomEvent('ui:closeOverlays')); } catch (e) {}

  const backdrop = el('div', { className: 'view-footer-settings-backdrop' });
  const dialog = el('div', {
    className: 'view-footer-settings-dialog',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Footer Settings',
    }
  });
  dialog.tabIndex = -1;

  const chromeActions = el('div', { className: 'view-footer-settings-actions' });
  const dialogJsonBtn = el('button', {
    className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
    text: 'JSON',
    attrs: { type: 'button', title: 'Open JSON viewer for saved footer settings' },
  });
  const closeBtn = el('button', { className: 'view-footer-settings-close btn small', text: '✕' });
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close footer settings');
  chromeActions.append(dialogJsonBtn, closeBtn);

  const title = el('div', { className: 'view-footer-settings-title', text: 'Footer Settings' });
  const subtitle = el('div', { className: 'hint', text: `App: ${appId}` });

  const left = el('div', { className: 'view-footer-settings-left' });
  const right = el('div', { className: 'view-footer-settings-right' });

  const leftTitle = el('button', { className: 'hint view-footer-config-list-title', text: 'Saved Configurations' });
  leftTitle.type = 'button';
  const configList = el('div', { className: 'view-footer-config-list' });
  const leftActions = el('div', { className: 'view-footer-config-actions' });

  const newBtn = el('button', { className: 'btn small', text: 'New' });
  newBtn.type = 'button';
  const dupBtn = el('button', { className: 'btn small', text: 'Duplicate' });
  dupBtn.type = 'button';
  const delBtn = el('button', { className: 'btn small danger', text: 'Delete' });
  delBtn.type = 'button';

  leftActions.append(newBtn, dupBtn, delBtn);
  left.append(leftTitle, configList, leftActions);

  const rightTop = el('div', { className: 'view-footer-editor-top' });
  const nameLabel = el('div', { className: 'hint', text: 'Config Name' });
  const nameInput = el('input', { className: 'view-footer-config-name', attrs: { type: 'text', maxlength: '64' } });
  const addEmptyBtn = el('button', { className: 'btn small', text: 'Add Empty' });
  addEmptyBtn.type = 'button';
  const addCustomBtn = el('button', { className: 'btn small', text: 'Add Button' });
  addCustomBtn.type = 'button';
  const disableHotkeysBtn = el('button', { className: 'btn small', text: 'Disable Hotkeys' });
  disableHotkeysBtn.type = 'button';
  const jsonBtn = el('button', {
    className: 'btn small table-card-settings-btn kanji-study-card-config-json-btn',
    text: 'JSON',
    attrs: { type: 'button', title: 'Open JSON viewer for the current config' },
  });
  const saveBtn = el('button', { className: 'btn small primary', text: 'Save' });
  saveBtn.type = 'button';
  saveBtn.disabled = true;

  const expandCollapseAllBtn = el('button', { className: 'btn small', text: 'Collapse All' });
  expandCollapseAllBtn.type = 'button';
  const validationWarning = el('div', { className: 'view-footer-validation-warning hint' });
  const pendingDiffSummary = el('div', { className: 'view-footer-pending-diff hint' });

  rightTop.append(nameLabel, nameInput, expandCollapseAllBtn, saveBtn);

  const controlsTitle = el('div', { className: 'hint', text: 'Controls' });
  const controlsList = el('div', { className: 'view-footer-controls-editor-list' });
  // place action buttons directly in the controls wrapper (no extra actions wrapper)
  const controlsWrapper = el('div', { className: 'view-footer-editor-controls', children: [controlsTitle, addEmptyBtn, addCustomBtn, disableHotkeysBtn, jsonBtn] });
  right.append(rightTop, validationWarning, pendingDiffSummary, controlsWrapper, controlsList);

  const shell = el('div', { className: 'view-footer-settings-shell', children: [left, right] });
  dialog.append(chromeActions, title, subtitle, shell);

  function updateConfigListCollapseUi() {
    const cfg = selectedConfig();
    const cfgName = asString(cfg?.name || cfg?.id).trim();
    const collapsedText = cfgName ? `Saved Configurations (${cfgName})` : 'Saved Configurations';
    left.classList.toggle('collapsed', !!isConfigListCollapsed);
    leftTitle.setAttribute('aria-expanded', isConfigListCollapsed ? 'false' : 'true');
    leftTitle.textContent = isConfigListCollapsed ? collapsedText : 'Saved Configurations';
  }

  function getConfigValidationWarnings(config) {
    const warnings = [];
    if (!config || !Array.isArray(config.customButtons)) return warnings;
    for (const button of config.customButtons) {
      const buttonName = asString(button?.text || button?.id || 'Custom').trim() || 'Custom';
      for (const step of (Array.isArray(button?.actions) ? button.actions : [])) {
        const actionId = asString(step?.actionId).trim();
        if (!actionId) continue;
        const action = availableActionById.get(actionId);
        if (action) continue;
        warnings.push(`${buttonName}: action "${actionId}" is not available for ${normalizedCollectionKey || 'this collection'}.`);
      }
    }
    return warnings;
  }

  function renderValidationWarning() {
    const cfg = selectedConfig();
    const warnings = getConfigValidationWarnings(cfg);
    validationWarning.innerHTML = '';
    if (!warnings.length) {
      validationWarning.style.display = 'none';
      return;
    }
    validationWarning.style.display = '';
    validationWarning.appendChild(el('div', {
      className: 'view-footer-validation-warning-title',
      text: 'This config uses actions that are not available for the current collection.',
    }));
    for (const warning of warnings) {
      validationWarning.appendChild(el('div', { text: warning }));
    }
  }

  function renderConfigList() {
    configList.innerHTML = '';
    ensureSelectedConfigIsAvailable();
    for (const cfg of availableConfigs()) {
      const row = el('button', { className: 'view-footer-config-item btn small', text: cfg.name || cfg.id });
      row.type = 'button';
      if (cfg.id === prefs.activeConfigId) row.classList.add('active');
      if (cfg.id === selectedConfigId) row.classList.add('selected');
      row.addEventListener('click', () => {
        const prevActive = prefs.activeConfigId;
        selectedConfigId = cfg.id;
        prefs.activeConfigId = cfg.id;
        if (prevActive !== cfg.id) {
          const nextSavedPrefs = deepClone(savedPrefs);
          nextSavedPrefs.activeConfigId = cfg.id;
          emitSave(nextSavedPrefs);
          savedPrefs = nextSavedPrefs;
        }
        markDirty();
        renderAll();
      });
      configList.appendChild(row);
    }
    updateConfigListCollapseUi();
  }

  function renderEditor() {
    const cfg = selectedConfig();
    if (!cfg) {
      nameInput.value = '';
      dupBtn.disabled = true;
      delBtn.disabled = true;
      controlsList.innerHTML = '';
      renderValidationWarning();
      updateConfigListCollapseUi();
      return;
    }

    ensureSelectedOrder(cfg);
    nameInput.value = cfg.name || cfg.id;
    dupBtn.disabled = false;
    delBtn.disabled = false;
    renderValidationWarning();
    updateConfigListCollapseUi();

    controlsList.innerHTML = '';
    for (let i = 0; i < cfg.order.length; i++) {
      const key = cfg.order[i];
      const base = getBaseControl(key);
      const isCustom = isCustomToken(key);
      const customBtn = isCustom ? getCustomButton(cfg, key) : null;
      if (!base && key !== '__empty' && !customBtn) continue;
      const override = getControlOverride(cfg, key);
      const row = el('div', { className: 'view-footer-control-row' });
      const rowId = (key === '__empty') ? `__empty:${i}` : key;
      try { row.dataset.rowId = rowId; } catch (e) {}
      const rowTop = el('div', { className: 'view-footer-control-row-top' });

      // per-row collapse toggle
      const collapseBtn = el('button', { className: 'btn small view-footer-collapse-btn', text: '+' });
      collapseBtn.type = 'button';
      collapseBtn.title = 'Toggle details';
      function updateCollapseBtnText() {
        try { collapseBtn.textContent = row.classList.contains('collapsed') ? '+' : '-'; } catch (e) {}
      }

      const visibility = el('input', { attrs: { type: 'checkbox' } });
      visibility.checked = !override.hidden;
      const visibilityLabel = el('label', { className: 'view-footer-visible-label' });
      const visibilityText = el('span', { className: 'view-footer-visible-text', text: 'Show' });
      visibilityLabel.append(visibility, visibilityText);

      const keyBadge = el('div', { className: 'view-footer-control-key', text: isCustom ? asString(customBtn?.text || 'Custom') : key });
      const moveUp = el('button', { className: 'btn small', text: '↑' });
      moveUp.type = 'button';
      const moveDown = el('button', { className: 'btn small', text: '↓' });
      moveDown.type = 'button';
      const resetControlBtn = el('button', { className: 'btn small', text: 'Reset' });
      resetControlBtn.type = 'button';
      if(isCustom) resetControlBtn.style.display = 'none';
      try { resetControlBtn.disabled = isControlDefault(cfg, key); } catch (e) {}

      // If this is an empty placeholder slot, render simplified UI
      if (key === '__empty') {
        const emptyLabel = el('div', { className: 'view-footer-control-key', text: 'Empty Slot' });
        const removeBtn = el('button', { className: 'btn small danger', text: 'Remove' });
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
          // remove this placeholder at index i
          cfg.order.splice(i, 1);
          markDirty();
          renderEditor();
        });
        // keep collapse button in the DOM for consistent layout, but hide it visually
        try { collapseBtn.style.visibility = 'hidden'; } catch (e) {}
        // initialize collapsed state from expandedRows
        try {
          if (!expandedRows.has(rowId)) row.classList.add('collapsed');
          else row.classList.remove('collapsed');
        } catch (e) {}
        updateCollapseBtnText();
        rowTop.append(collapseBtn, emptyLabel, moveUp, moveDown, removeBtn);
        // no fields for placeholders
        row.append(rowTop);
        controlsList.appendChild(row);
        // ensure collapse button state
        collapseBtn.addEventListener('click', () => {
          row.classList.toggle('collapsed');
          try {
            if (row.classList.contains('collapsed')) expandedRows.delete(rowId);
            else expandedRows.add(rowId);
          } catch (e) {}
          updateCollapseBtnText();
          updateExpandCollapseBtnText();
        });
        // support moving this specific empty-slot by index (there may be multiple placeholders)
        moveUp.addEventListener('click', () => {
          if (!cfg || !Array.isArray(cfg.order)) return;
          if (i <= 0) return;
          const arr = cfg.order.slice();
          const tmp = arr[i - 1];
          arr[i - 1] = arr[i];
          arr[i] = tmp;
          cfg.order = arr;
          markDirty();
          renderEditor();
        });

        moveDown.addEventListener('click', () => {
          if (!cfg || !Array.isArray(cfg.order)) return;
          if (i >= cfg.order.length - 1) return;
          const arr = cfg.order.slice();
          const tmp = arr[i + 1];
          arr[i + 1] = arr[i];
          arr[i] = tmp;
          cfg.order = arr;
          markDirty();
          renderEditor();
        });
        continue;
      }

      rowTop.append(collapseBtn, visibilityLabel, keyBadge, moveUp, moveDown, resetControlBtn);
      let removeCustomBtn = null;
      if (isCustom && customBtn) {
        removeCustomBtn = el('button', { className: 'btn small danger', text: 'Remove' });
        removeCustomBtn.type = 'button';
        rowTop.appendChild(removeCustomBtn);
      }

      const fields = el('div', { className: 'view-footer-control-fields' });

      // Autoplay controls (checkbox + delay +/- .5s)
      const autoplayWrap = el('div', { className: 'view-footer-autoplay-fields' });
      const autoplayChk = el('input', { attrs: { type: 'checkbox' } });
      const autoplayLabel = el('label', { className: 'view-footer-autoplay-label', text: 'Autoplay' });
      autoplayLabel.prepend(autoplayChk);
      const delayMinus = el('button', { className: 'btn small view-footer-autoplay-minus', text: '-' });
      delayMinus.type = 'button';
      const delayVal = el('div', { className: 'view-footer-custom-delay-value', text: '0.0s' });
      const delayPlus = el('button', { className: 'btn small view-footer-autoplay-plus', text: '+' });
      delayPlus.type = 'button';
      autoplayWrap.append(autoplayLabel, delayMinus, delayVal, delayPlus);
      fields.appendChild(autoplayWrap);

      if (isCustom && customBtn) {
        const actionCount = Array.isArray(customBtn.actions) ? customBtn.actions.length : 0;

        const buttonHeader = el('div', { className: 'view-footer-button-header' });
        const iconField = el('label', { className: 'view-footer-button-header-field' });
        iconField.append(
          el('span', { className: 'view-footer-button-header-label', text: 'Icon' }),
        );
        const actionWrap = el('div', { className: 'view-footer-action-list view-footer-custom-action-list' });

        const stIcon = createIconDropdown({
          value: asString(customBtn.icon || ''),
          onChange: (iconValue) => {
            const next = deepClone(customBtn) || {};
            if (!iconValue) delete next.icon; else next.icon = iconValue;
            upsertCustomButton(cfg, next);
            markDirty();
            try { resetControlBtn.disabled = isControlDefault(cfg, key); } catch (e) {}
          },
        });
        iconField.append(stIcon);

        const nameField = el('label', { className: 'view-footer-button-header-field' });
        nameField.append(
          el('span', { className: 'view-footer-button-header-label', text: 'Name' }),
        );
        const stText = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: customBtn.text || '' } });
        stText.value = asString(customBtn.text || '');
        nameField.append(stText);

        const hotkeyField = el('div', { className: 'view-footer-button-header-field' });
        hotkeyField.append(el('span', { className: 'view-footer-button-header-label', text: 'Hotkey' }));
        const stHotkeyBtn = el('button', { className: 'btn small view-footer-hotkey-btn', text: shortcutToCaption(asString(customBtn.shortcut)) || 'Set' });
        stHotkeyBtn.type = 'button';
        hotkeyField.append(stHotkeyBtn);

        const addActionField = el('div', { className: 'view-footer-button-header-field' });
        addActionField.append(el('span', { className: 'view-footer-button-header-label', text: 'Actions' }));
        const addActionBtn = el('button', { className: 'btn small view-footer-edit-btn', text: 'Add' });
        addActionBtn.type = 'button';
        addActionField.append(addActionBtn);

        buttonHeader.append(iconField, nameField, hotkeyField, addActionField);
        fields.appendChild(buttonHeader);

        const header = el('div', { className: 'view-footer-action-row view-footer-action-row-header view-footer-custom-action-row' });
        header.append(
          el('div', { className: 'view-footer-action-name', text: '' }),
          el('div', { className: 'view-footer-action-name', text: 'Function' }),
          el('div', { className: 'view-footer-action-name', text: 'Remove' }),
        );
        actionWrap.appendChild(header);
        stText.addEventListener('input', () => {
          const next = deepClone(customBtn) || {};
          const v = asString(stText.value).trim();
          if (!v) delete next.text; else next.text = v;
          upsertCustomButton(cfg, next);
          markDirty();
          try { resetControlBtn.disabled = isControlDefault(cfg, key); } catch (e) {}
        });

        try { if (cfg.hotkeysDisabled) stHotkeyBtn.style.visibility = 'hidden'; } catch (e) {}
        stHotkeyBtn.addEventListener('click', async () => {
          try { if (cfg.hotkeysDisabled) return; } catch (e) {}
          const taken = getAssignedShortcutMap(cfg, { skipKey: key, skipState: null });
          const currentShortcut = asString(customBtn.shortcut || '');
          const result = await openHotkeyCaptureDialog({
            currentShortcut,
            isTaken: (nextShortcut) => {
              const hit = taken.get(String(nextShortcut || '').toUpperCase());
              return hit ? `That key is already used by ${hit}.` : '';
            },
          });
          if (!result) return;
          const next = deepClone(customBtn) || {};
          next.shortcut = result.shortcut;
          next.caption = result.caption;
          upsertCustomButton(cfg, next);
          markDirty();
          renderEditor();
        });

        addActionBtn.addEventListener('click', () => {
          openCustomButtonEditor(cfg, customBtn);
        });

        const customActions = Array.isArray(customBtn.actions) ? customBtn.actions.slice() : [];
        let draggedCustomActionIndex = null;
        let touchDraggingActionIndex = null;
        let touchDragPointerId = null;
        let hoverDragOverIndex = null;
        let hoverDragPlacement = 'before';
        let loggedHoverTargetIndex = null;

        function logCustomActionDrag(eventName, details = {}) {
          try {
            console.debug('[viewFooter][customActionDrag]', {
              event: eventName,
              configId: asString(cfg?.id).trim(),
              buttonId: asString(customBtn?.id).trim(),
              draggedCustomActionIndex,
              touchDraggingActionIndex,
              hoverDragOverIndex,
              hoverDragPlacement,
              customActionCount: customActions.length,
              ...details,
            });
          } catch (err) {}
        }

        function clearCustomActionDragState() {
          if (Number.isInteger(loggedHoverTargetIndex)) {
            logCustomActionDrag('targetExit', { targetIndex: loggedHoverTargetIndex });
          }
          draggedCustomActionIndex = null;
          touchDraggingActionIndex = null;
          touchDragPointerId = null;
          hoverDragOverIndex = null;
          hoverDragPlacement = 'before';
          loggedHoverTargetIndex = null;
          try {
            actionWrap.querySelectorAll('.view-footer-custom-action-row').forEach((node) => {
              node.classList.remove('dragging');
              node.classList.remove('drag-over');
              node.classList.remove('drag-over-before');
              node.classList.remove('drag-over-after');
            });
          } catch (err) {}
        }

        function setCustomActionDragIndicator(nextIndex, placement = 'before') {
          try {
            actionWrap.querySelectorAll('.view-footer-custom-action-row').forEach((node, idx) => {
              const active = nextIndex === idx;
              node.classList.toggle('drag-over', active);
              node.classList.toggle('drag-over-before', active && placement === 'before');
              node.classList.toggle('drag-over-after', active && placement === 'after');
            });
          } catch (err) {}
        }

        function resolveCustomActionDropState(fromIndex, hoverIndex) {
          let state = null;
          if (!Number.isInteger(hoverIndex) || hoverIndex < 0) {
            state = { insertIndex: fromIndex, markerIndex: null, markerPlacement: 'before' };
          } else if (hoverIndex === fromIndex) {
            state = { insertIndex: fromIndex, markerIndex: null, markerPlacement: 'before' };
          } else if (fromIndex > hoverIndex) {
            state = { insertIndex: hoverIndex, markerIndex: hoverIndex, markerPlacement: 'before' };
          } else {
            state = { insertIndex: hoverIndex, markerIndex: hoverIndex, markerPlacement: 'after' };
          }
          return state;
        }

        function refreshCustomActionDragIndicator(fromIndex, hoverIndex) {
          if (loggedHoverTargetIndex !== hoverIndex) {
            if (Number.isInteger(loggedHoverTargetIndex)) {
              logCustomActionDrag('targetExit', { targetIndex: loggedHoverTargetIndex });
            }
            if (Number.isInteger(hoverIndex)) {
              logCustomActionDrag('targetEnter', { sourceIndex: fromIndex, targetIndex: hoverIndex });
            }
            loggedHoverTargetIndex = Number.isInteger(hoverIndex) ? hoverIndex : null;
          }
          hoverDragOverIndex = Number.isInteger(hoverIndex) ? hoverIndex : null;
          const state = resolveCustomActionDropState(fromIndex, hoverIndex);
          hoverDragPlacement = state.markerPlacement;
          if (state.markerIndex == null) {
            setCustomActionDragIndicator(null, 'before');
            return state;
          }
          setCustomActionDragIndicator(state.markerIndex, state.markerPlacement);
          return state;
        }

        for (let stepIndex = 0; stepIndex < customActions.length; stepIndex++) {
          const step = customActions[stepIndex];
          if (!step || typeof step !== 'object') continue;
          const actionId = asString(step.actionId).trim();
          if (!actionId) continue;

          const mapped = availableActionById.get(actionId) || null;
          const stepRow = el('div', { className: 'view-footer-action-row view-footer-custom-action-row' });

          const dragHandle = el('button', { className: 'btn small view-footer-drag-handle', text: '⋮⋮' });
          dragHandle.type = 'button';
          dragHandle.title = 'Drag to reorder';
          dragHandle.setAttribute('aria-label', 'Drag to reorder');
          dragHandle.draggable = true;
          const fnText = el('div', { className: 'view-footer-action-fn', text: formatCustomActionLabel(mapped || { id: actionId, fnName: actionId }) });
          const removeStepBtn = el('button', { className: 'btn small danger view-footer-remove-step-btn' });
          removeStepBtn.type = 'button';
          removeStepBtn.title = 'Remove action';
          removeStepBtn.setAttribute('aria-label', 'Remove action');
          removeStepBtn.appendChild(el('span', { className: 'view-footer-close-icon' }));

          const writeCustomActions = (updater) => {
            const nextBtn = deepClone(getCustomButton(cfg, key) || customBtn) || {};
            const nextActions = Array.isArray(nextBtn.actions)
              ? nextBtn.actions.map(a => ({
                actionId: asString(a && a.actionId).trim(),
              })).filter(a => a.actionId)
              : [];
            updater(nextActions);
            nextBtn.actions = nextActions;
            upsertCustomButton(cfg, nextBtn);
            markDirty();
            renderEditor();
          };

          dragHandle.addEventListener('dragstart', (e) => {
            draggedCustomActionIndex = stepIndex;
            stepRow.classList.add('dragging');
            logCustomActionDrag('dragstart', {
              sourceIndex: stepIndex,
              sourceActionId: actionId,
              sourceLabel: formatCustomActionLabel(mapped || { id: actionId, fnName: actionId }),
            });
            try {
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(stepIndex));
              }
            } catch (err) {}
          });

          dragHandle.addEventListener('dragend', () => {
            clearCustomActionDragState();
          });

          stepRow.addEventListener('dragover', (e) => {
            if (draggedCustomActionIndex == null || draggedCustomActionIndex === stepIndex) return;
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (err) {}
            refreshCustomActionDragIndicator(draggedCustomActionIndex, stepIndex);
          });

          stepRow.addEventListener('dragleave', () => {
            stepRow.classList.remove('drag-over');
            stepRow.classList.remove('drag-over-before');
            stepRow.classList.remove('drag-over-after');
          });

          stepRow.addEventListener('drop', (e) => {
            if (draggedCustomActionIndex == null || draggedCustomActionIndex === stepIndex) return;
            e.preventDefault();
            writeCustomActions((arr) => {
              if (draggedCustomActionIndex == null) return;
              const fromIndex = draggedCustomActionIndex;
              const state = resolveCustomActionDropState(fromIndex, hoverDragOverIndex);
              const toIndex = state.insertIndex;
              logCustomActionDrag('drop', {
                sourceIndex: fromIndex,
                targetIndex: stepIndex,
                hoverIndex: hoverDragOverIndex,
                computedInsertIndex: toIndex,
                markerIndex: state.markerIndex,
                markerPlacement: state.markerPlacement,
                actionOrderBefore: arr.map(item => asString(item?.actionId).trim()),
              });
              if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length) return;
              const [moved] = arr.splice(fromIndex, 1);
              if (!moved) return;
              arr.splice(toIndex, 0, moved);
            });
            clearCustomActionDragState();
          });

          dragHandle.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            touchDraggingActionIndex = stepIndex;
            touchDragPointerId = e.pointerId;
            stepRow.classList.add('dragging');
            logCustomActionDrag('dragstart', {
              sourceIndex: stepIndex,
              sourceActionId: actionId,
              pointerId: e.pointerId,
            });
            try { dragHandle.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
          });

          dragHandle.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'touch') return;
            if (touchDragPointerId !== e.pointerId || touchDraggingActionIndex == null) return;
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            const hitRow = hit && typeof hit.closest === 'function'
              ? hit.closest('.view-footer-custom-action-row')
              : null;
            if (!hitRow || hitRow.classList.contains('view-footer-action-row-header')) return;
            const rows = Array.from(actionWrap.querySelectorAll('.view-footer-custom-action-row:not(.view-footer-action-row-header)'));
            const hitIndex = rows.indexOf(hitRow);
            if (hitIndex < 0) return;
            refreshCustomActionDragIndicator(touchDraggingActionIndex, hitIndex);
            e.preventDefault();
          });

          dragHandle.addEventListener('pointerup', (e) => {
            if (e.pointerType !== 'touch') return;
            if (touchDragPointerId !== e.pointerId || touchDraggingActionIndex == null) return;
            const fromIndex = touchDraggingActionIndex;
            const state = resolveCustomActionDropState(fromIndex, hoverDragOverIndex);
            const toIndex = state.insertIndex;
            logCustomActionDrag('drop', {
              sourceIndex: fromIndex,
              hoverIndex: hoverDragOverIndex,
              computedInsertIndex: toIndex,
              markerIndex: state.markerIndex,
              markerPlacement: state.markerPlacement,
              pointerId: e.pointerId,
            });
            try { dragHandle.releasePointerCapture(e.pointerId); } catch (err) {}
            clearCustomActionDragState();
            if (fromIndex === toIndex) return;
            writeCustomActions((arr) => {
              if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex > arr.length) return;
              const [moved] = arr.splice(fromIndex, 1);
              if (!moved) return;
              arr.splice(toIndex, 0, moved);
            });
            e.preventDefault();
          });

          dragHandle.addEventListener('pointercancel', (e) => {
            if (e.pointerType !== 'touch') return;
            if (touchDragPointerId !== e.pointerId) return;
            try { dragHandle.releasePointerCapture(e.pointerId); } catch (err) {}
            clearCustomActionDragState();
          });

          removeStepBtn.addEventListener('click', () => {
            writeCustomActions((arr) => {
              if (stepIndex < 0 || stepIndex >= arr.length) return;
              arr.splice(stepIndex, 1);
            });
          });

          stepRow.append(dragHandle, fnText, removeStepBtn);
          actionWrap.appendChild(stepRow);
        }

        if (!customActions.length) {
          const emptyRow = el('div', { className: 'view-footer-action-row view-footer-custom-action-row' });
          emptyRow.append(
            el('div', { className: 'view-footer-action-name', text: '—' }),
            el('div', { className: 'view-footer-action-name', text: 'No actions yet.' }),
            el('div', { className: 'view-footer-action-name', text: '—' }),
          );
          actionWrap.appendChild(emptyRow);
        }

        fields.appendChild(actionWrap);
        // initialize autoplay values for custom buttons
        try {
          const ov = getControlOverride(cfg, key) || {};
          const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? ov.autoplay : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
          // detect any link actions and disable autoplay control if present
          const hasLink = Array.isArray(customBtn.actions) && customBtn.actions.some(s => { const id = String((s && s.actionId) || '').trim(); return /^link(\.|$)/i.test(id); });
          // clamp stored delay to valid range and step
          const delayMs = clampAutoplayMs(Number(apRaw.delayMs || AUTOPLAY_MIN_MS));
          autoplayChk.checked = !!apRaw.enabled && !hasLink;
          delayVal.textContent = `${(delayMs / 1000).toFixed(1)}s`;
          // disable +/- when not enabled
          if (!autoplayChk.checked) {
            delayMinus.disabled = true; delayPlus.disabled = true;
          }
          if (hasLink) {
            autoplayChk.disabled = true;
            try { autoplayLabel.title = 'Autoplay disabled: contains link actions which cannot be autoplayed.'; autoplayLabel.classList.add('disabled'); autoplayLabel.setAttribute('aria-disabled','true'); } catch (e) {}
          }
        } catch (e) {}
        // custom button: change handlers for autoplay and +/- with clamping
        autoplayChk.addEventListener('change', () => {
          if (autoplayChk.disabled) return;
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const ap = { ...apRaw };
            if (autoplayChk.checked) {
              ap.enabled = true;
              ap.delayMs = clampAutoplayMs(ap.delayMs || AUTOPLAY_MIN_MS);
              delayMinus.disabled = (ap.delayMs <= AUTOPLAY_MIN_MS);
              delayPlus.disabled = (ap.delayMs >= AUTOPLAY_MAX_MS);
            } else {
              ap.enabled = false;
              delayMinus.disabled = true; delayPlus.disabled = true;
            }
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            delayVal.textContent = `${(Number(ap.delayMs || 0) / 1000).toFixed(1)}s`;
            markDirty();
          } catch (e) {}
        });
        delayMinus.addEventListener('click', () => {
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const nextDelay = clampAutoplayMs(Math.max(AUTOPLAY_MIN_MS, Number(apRaw.delayMs || AUTOPLAY_MIN_MS) - AUTOPLAY_STEP_MS));
            const ap = { ...apRaw, delayMs: nextDelay };
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            delayVal.textContent = `${(nextDelay / 1000).toFixed(1)}s`;
            delayMinus.disabled = (nextDelay <= AUTOPLAY_MIN_MS);
            delayPlus.disabled = (nextDelay >= AUTOPLAY_MAX_MS);
            markDirty();
          } catch (e) {}
        });
        delayPlus.addEventListener('click', () => {
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const nextDelay = clampAutoplayMs(Math.min(AUTOPLAY_MAX_MS, Number(apRaw.delayMs || AUTOPLAY_MIN_MS) + AUTOPLAY_STEP_MS));
            const ap = { ...apRaw, delayMs: nextDelay };
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            delayVal.textContent = `${(nextDelay / 1000).toFixed(1)}s`;
            delayMinus.disabled = (nextDelay <= AUTOPLAY_MIN_MS);
            delayPlus.disabled = (nextDelay >= AUTOPLAY_MAX_MS);
            markDirty();
          } catch (e) {}
        });
      } else {
        const actionWrap = el('div', { className: 'view-footer-action-list' });
        const header = el('div', { className: 'view-footer-action-row view-footer-action-row-header' });
        header.append(
          el('div', { className: 'view-footer-action-name', text: 'Action' }),
          el('div', { className: 'view-footer-action-name', text: 'Icon' }),
          el('div', { className: 'view-footer-action-name', text: 'Name' }),
          el('div', { className: 'view-footer-action-name', text: 'Hotkey' }),
          el('div', { className: 'view-footer-action-name', text: 'Fn' }),
        );
        actionWrap.appendChild(header);

        const states = Array.isArray(base.states) ? base.states : [];
        if (!states.length) {
          const meta = buildControlActionDisplay(base);
          const stRow = el('div', { className: 'view-footer-action-row' });
          const stTitle = el('div', { className: 'view-footer-action-name', text: meta.title });
          const stIcon = createIconDropdown({
            value: asString(override.icon || ''),
            onChange: (iconValue) => {
              const next = { ...getControlOverride(cfg, key) };
              if (!iconValue) delete next.icon;
              else next.icon = iconValue;
              setControlOverride(cfg, key, next);
              markDirty();
              try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
            },
          });
          const stText = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: meta.text } });
          const stHotkeyBtn = el('button', { className: 'btn small view-footer-hotkey-btn', text: shortcutToCaption(resolveShortcut(base, override)) || 'Set hotkey' });
          stHotkeyBtn.type = 'button';
          const fnLabel = el('div', { className: 'view-footer-action-fn', text: meta.fnName || '-' });

          stText.value = asString(override.text || '');

          stText.addEventListener('input', () => {
            const next = { ...getControlOverride(cfg, key) };
            const v = asString(stText.value).trim();
            if (!v) delete next.text;
            else next.text = v;
            setControlOverride(cfg, key, next);
            markDirty();
            try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
          });

          try { if (cfg.hotkeysDisabled) stHotkeyBtn.style.visibility = 'hidden'; } catch (e) {}
          stHotkeyBtn.addEventListener('click', async () => {
            try { if (cfg.hotkeysDisabled) return; } catch (e) {}
            const taken = getAssignedShortcutMap(cfg, { skipKey: key, skipState: null });
            const currentShortcut = resolveShortcut(base, getControlOverride(cfg, key));
            const result = await openHotkeyCaptureDialog({
              currentShortcut,
              isTaken: (nextShortcut) => {
                const hit = taken.get(String(nextShortcut || '').toUpperCase());
                return hit ? `That key is already used by ${hit}.` : '';
              },
            });
            if (!result) return;
            const next = { ...getControlOverride(cfg, key) };
            next.shortcut = result.shortcut;
            next.caption = result.caption;
            setControlOverride(cfg, key, next);
            markDirty();
            renderEditor();
          });

          stRow.append(stTitle, stIcon, stText, stHotkeyBtn, fnLabel);
          actionWrap.appendChild(stRow);
        } else {
          for (const st of states) {
            const stOv = (override.states && override.states[st.name]) ? override.states[st.name] : {};
            const meta = buildStateActionDisplay(base, st);
            const stRow = el('div', { className: 'view-footer-action-row' });
            const stTitle = el('div', { className: 'view-footer-action-name', text: meta.title });
            const stIcon = createIconDropdown({
              value: asString(stOv.icon || ''),
              onChange: (iconValue) => {
                let next = { ...getControlOverride(cfg, key) };
                next = upsertStateOverride(next, st.name, (dst) => {
                  const i = asString(iconValue).trim();
                  const t = asString(stText.value).trim();
                  if (!i) delete dst.icon; else dst.icon = i;
                  if (!t) delete dst.text; else dst.text = t;
                });
                setControlOverride(cfg, key, next);
                markDirty();
                try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
              },
            });
            const stText = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: meta.text } });
            const stHotkeyBtn = el('button', { className: 'btn small view-footer-hotkey-btn', text: shortcutToCaption(resolveStateShortcut(st, stOv)) || 'Set hotkey' });
            stHotkeyBtn.type = 'button';
            const fnLabel = el('div', { className: 'view-footer-action-fn', text: meta.fnName || '-' });
            stText.value = asString(stOv.text || '');

            const writeState = () => {
              let next = { ...getControlOverride(cfg, key) };
              next = upsertStateOverride(next, st.name, (dst) => {
                const i = asString(stIcon.getValue ? stIcon.getValue() : '').trim();
                const t = asString(stText.value).trim();
                if (!i) delete dst.icon; else dst.icon = i;
                if (!t) delete dst.text; else dst.text = t;
              });
              setControlOverride(cfg, key, next);
              markDirty();
              try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
            };
            stText.addEventListener('input', writeState);

            try { if (cfg.hotkeysDisabled) stHotkeyBtn.style.visibility = 'hidden'; } catch (e) {}
            stHotkeyBtn.addEventListener('click', async () => {
              try { if (cfg.hotkeysDisabled) return; } catch (e) {}
              const taken = getAssignedShortcutMap(cfg, { skipKey: key, skipState: st.name });
              const currentShortcut = resolveStateShortcut(st, (getControlOverride(cfg, key).states || {})[st.name]);
              const result = await openHotkeyCaptureDialog({
                currentShortcut,
                isTaken: (nextShortcut) => {
                  const hit = taken.get(String(nextShortcut || '').toUpperCase());
                  return hit ? `That key is already used by ${hit}.` : '';
                },
              });
              if (!result) return;
              let next = { ...getControlOverride(cfg, key) };
              next = upsertStateOverride(next, st.name, (dst) => {
                dst.shortcut = result.shortcut;
                dst.caption = result.caption;
              });
              setControlOverride(cfg, key, next);
              markDirty();
              try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
              renderEditor();
            });

            stRow.append(stTitle, stIcon, stText, stHotkeyBtn, fnLabel);
            actionWrap.appendChild(stRow);
          }
        }

        fields.appendChild(actionWrap);
        // initialize autoplay values for base controls
        try {
          const ov = getControlOverride(cfg, key) || {};
          const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? ov.autoplay : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
          const actionId = asString(base.actionKey || base.key || '');
          const isLinkAction = /^link(\.|$)/i.test(actionId);
          const delayMs = clampAutoplayMs(Number(apRaw.delayMs || AUTOPLAY_MIN_MS));
          autoplayChk.checked = !!apRaw.enabled && !isLinkAction;
          delayVal.textContent = `${(delayMs / 1000).toFixed(1)}s`;
          if (!autoplayChk.checked) {
            delayMinus.disabled = true; delayPlus.disabled = true;
          }
          if (isLinkAction) {
            autoplayChk.disabled = true;
            try { autoplayLabel.title = 'Autoplay disabled: control action is a link and cannot be autoplayed.'; autoplayLabel.classList.add('disabled'); autoplayLabel.setAttribute('aria-disabled','true'); } catch (e) {}
          }
        } catch (e) {}
        autoplayChk.addEventListener('change', () => {
          if (autoplayChk.disabled) return;
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const ap = { ...apRaw };
            if (autoplayChk.checked) {
              ap.enabled = true;
              ap.delayMs = clampAutoplayMs(ap.delayMs || AUTOPLAY_MIN_MS);
              delayMinus.disabled = (ap.delayMs <= AUTOPLAY_MIN_MS);
              delayPlus.disabled = (ap.delayMs >= AUTOPLAY_MAX_MS);
            } else {
              ap.enabled = false;
              delayMinus.disabled = true; delayPlus.disabled = true;
            }
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            markDirty();
          } catch (e) {}
        });
        delayMinus.addEventListener('click', () => {
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const nextDelay = clampAutoplayMs(Math.max(AUTOPLAY_MIN_MS, Number(apRaw.delayMs || AUTOPLAY_MIN_MS) - AUTOPLAY_STEP_MS));
            const ap = { ...apRaw, delayMs: nextDelay };
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            delayVal.textContent = `${(nextDelay / 1000).toFixed(1)}s`;
            delayMinus.disabled = (nextDelay <= AUTOPLAY_MIN_MS);
            delayPlus.disabled = (nextDelay >= AUTOPLAY_MAX_MS);
            markDirty();
          } catch (e) {}
        });
        delayPlus.addEventListener('click', () => {
          try {
            const ov = getControlOverride(cfg, key) || {};
            const apRaw = (ov.autoplay && typeof ov.autoplay === 'object') ? deepClone(ov.autoplay) : { enabled: false, delayMs: AUTOPLAY_MIN_MS };
            const nextDelay = clampAutoplayMs(Math.min(AUTOPLAY_MAX_MS, Number(apRaw.delayMs || AUTOPLAY_MIN_MS) + AUTOPLAY_STEP_MS));
            const ap = { ...apRaw, delayMs: nextDelay };
            setControlOverride(cfg, key, { ...ov, autoplay: ap });
            delayVal.textContent = `${(nextDelay / 1000).toFixed(1)}s`;
            delayMinus.disabled = (nextDelay <= AUTOPLAY_MIN_MS);
            delayPlus.disabled = (nextDelay >= AUTOPLAY_MAX_MS);
            markDirty();
          } catch (e) {}
        });
      }

      visibility.addEventListener('change', () => {
        const next = { ...getControlOverride(cfg, key) };
        if (visibility.checked) delete next.hidden;
        else next.hidden = true;
        setControlOverride(cfg, key, next);
        markDirty();
        try { resetControlBtn.disabled = isCustom ? false : isControlDefault(cfg, key); } catch (e) {}
      });

      // collapse toggle behavior for this row
      collapseBtn.addEventListener('click', () => {
        row.classList.toggle('collapsed');
        try {
          if (row.classList.contains('collapsed')) expandedRows.delete(rowId);
          else expandedRows.add(rowId);
        } catch (e) {}
        updateCollapseBtnText();
        updateExpandCollapseBtnText();
      });

      // Initialize row collapsed state from expandedRows (collapsed by default)
      try {
        if (!expandedRows.has(rowId)) row.classList.add('collapsed');
        else row.classList.remove('collapsed');
      } catch (e) { row.classList.add('collapsed'); }
      updateCollapseBtnText();

      moveUp.addEventListener('click', () => {
        moveControl(cfg, key, -1);
        renderEditor();
      });

      moveDown.addEventListener('click', () => {
        moveControl(cfg, key, 1);
        renderEditor();
      });

      resetControlBtn.addEventListener('click', () => {
        resetControlToDefault(cfg, key);
        markDirty();
        renderEditor();
      });

      if (removeCustomBtn) {
        removeCustomBtn.addEventListener('click', () => {
          removeCustomButton(cfg, key);
          cfg.order = (cfg.order || []).filter(k => k !== key);
          resetControlToDefault(cfg, key);
          markDirty();
          renderEditor();
        });
      }

      row.append(rowTop, fields);
      controlsList.appendChild(row);
    }
    // after rendering all rows, update expand/collapse text
    updateExpandCollapseBtnText();
  }

  function updateExpandCollapseBtnText() {
    const rows = Array.from(controlsList.querySelectorAll('.view-footer-control-row'));
    if (!rows.length) {
      expandCollapseAllBtn.textContent = 'Expand All';
      return;
    }
    const anyCollapsed = rows.some(r => r.classList.contains('collapsed'));
    // If any are collapsed, action will expand all -> show 'Expand All'
    expandCollapseAllBtn.textContent = anyCollapsed ? 'Expand All' : 'Collapse All';
  }

  function renderAll() {
    ensureSelectedConfigIsAvailable();
    renderConfigList();
    renderEditor();
    try { updateDisableHotkeysText(); } catch (e) {}
    markDirty('renderAll');
  }

  newBtn.addEventListener('click', () => {
    createNewConfig();
    renderAll();
  });

  dupBtn.addEventListener('click', () => {
    duplicateSelectedConfig();
    renderAll();
  });

  disableHotkeysBtn.addEventListener('click', () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    cfg.hotkeysDisabled = !cfg.hotkeysDisabled;
    try { disableHotkeysBtn.textContent = cfg.hotkeysDisabled ? 'Enable Hotkeys' : 'Disable Hotkeys'; } catch (e) {}
    markDirty();
    renderEditor();
  });

  function updateDisableHotkeysText() {
    const cfg = selectedConfig();
    if (!cfg) return;
    try { disableHotkeysBtn.textContent = cfg.hotkeysDisabled ? 'Enable Hotkeys' : 'Disable Hotkeys'; } catch (e) {}
  }

  delBtn.addEventListener('click', async () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    const ok = await openDeleteConfigConfirmDialog({ configName: cfg.name || cfg.id });
    if (!ok) return;
    deleteSelectedConfig();
    emitSave();
    savedPrefs = deepClone(prefs);
    renderAll();
  });

  nameInput.addEventListener('input', () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    cfg.name = asString(nameInput.value).trim() || cfg.id;
    markDirty();
    renderConfigList();
    renderEditor();
  });

  leftTitle.addEventListener('click', () => {
    if (window.innerWidth > 900) return;
    isConfigListCollapsed = !isConfigListCollapsed;
    updateConfigListCollapseUi();
  });

  addEmptyBtn.addEventListener('click', () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    cfg.order = cfg.order.concat(['__empty']);
    markDirty();
    renderEditor();
  });

  addCustomBtn.addEventListener('click', async () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    const id = `custom-${Date.now().toString(36).slice(-6)}`;
    const nextButton = {
      id,
      icon: '',
      text: 'Custom',
      caption: '',
      shortcut: '',
      actions: [],
    };
    upsertCustomButton(cfg, nextButton);
    const token = customTokenFromId(id);
    if (!Array.isArray(cfg.order)) cfg.order = [];
    if (!cfg.order.includes(token)) cfg.order.push(token);
    markDirty();
    renderEditor();
  });

  jsonBtn.addEventListener('click', () => {
    openCurrentConfigJsonDialog();
  });

  dialogJsonBtn.addEventListener('click', () => {
    openStoredFooterPrefsJsonDialog();
  });

  expandCollapseAllBtn.addEventListener('click', () => {
    const rows = Array.from(controlsList.querySelectorAll('.view-footer-control-row'));
    if (!rows.length) return;
    const anyCollapsed = rows.some(r => r.classList.contains('collapsed'));
    if (anyCollapsed) {
      // expand all
      rows.forEach(r => {
        r.classList.remove('collapsed');
        try { if (r.dataset && r.dataset.rowId) expandedRows.add(r.dataset.rowId); } catch (e) {}
      });
    } else {
      // collapse all
      rows.forEach(r => {
        r.classList.add('collapsed');
        try { if (r.dataset && r.dataset.rowId) expandedRows.delete(r.dataset.rowId); } catch (e) {}
      });
    }
    // update per-row collapse button text to match state
    rows.forEach(r => {
      try {
        const btn = r.querySelector('.view-footer-collapse-btn');
        if (btn) btn.textContent = r.classList.contains('collapsed') ? '+' : '-';
      } catch (e) {}
    });
    updateExpandCollapseBtnText();
  });

  saveBtn.addEventListener('click', () => {
    if (!isDirty) return;
    emitSave();
    savedPrefs = deepClone(prefs);
    markDirty('save');
  });

  let closed = false;
  let prevFocus = null;

  function getFocusable(root) {
    const sel = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll(sel)).filter(node => node.offsetParent !== null);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      attemptClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = getFocusable(dialog);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onCloseOverlaysEvent() {
    attemptClose();
  }

  async function attemptClose() {
    if (closed) return;
    if (isDirty) {
      // Prevent confirmDialog from triggering our overlay-close handler
      try { document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent); } catch (e) {}
      let res = null;
      try {
        res = await confirmDialog({
          title: 'Unsaved changes',
          message: 'You have unsaved changes. Save, discard, or cancel?',
          detail: '',
          confirmText: 'Discard',
          cancelText: 'Cancel',
          saveText: 'Save',
          hasSave: true,
          danger: true,
        });
      } finally {
        try { document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent); } catch (e) {}
      }
      // res is one of: 'save' | 'confirm' | 'cancel' (when hasSave)
      if (!res || res === 'cancel') return;
      if (res === 'save') {
        try { emitSave(); } catch (e) {}
        savedPrefs = deepClone(prefs);
        markDirty('attemptClose:save');
        close();
        return;
      }
      // res === 'confirm' -> discard and close
    }
    close();
  }

  function close() {
    if (closed) return;
    closed = true;

    try { console.debug('[dialog] close viewFooterSettingsDialog'); } catch (e) {}

    try { dialog.classList.remove('open'); } catch (e) {}
    try { backdrop.classList.remove('show'); } catch (e) {}

    const cleanup = () => {
      try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
      try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      try { document.removeEventListener('keydown', onKeyDown); } catch (e) {}
      try { document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent); } catch (e) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
    };

    let done = false;
    function finish() { if (done) return; done = true; cleanup(); }
    try { dialog.addEventListener('transitionend', finish); } catch (e) {}
    setTimeout(finish, 220);
  }

  closeBtn.addEventListener('click', () => attemptClose());
  backdrop.addEventListener('click', () => attemptClose());

  const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
  prevFocus = document.activeElement;
  mount.append(backdrop, dialog);
  try { console.debug('[dialog] open viewFooterSettingsDialog', { appId, selectedConfigId }); } catch (e) {}

  dialog.style.position = 'fixed';
  dialog.style.left = '50%';
  dialog.style.top = '45%';
  dialog.style.transform = 'translate(-50%, -50%)';
  dialog.style.width = 'auto';

  renderAll();

  requestAnimationFrame(() => {
    try {
      backdrop.classList.add('show');
      dialog.classList.add('open');
    } catch (e) {}
    // Do NOT auto-focus the config name input to avoid bringing up mobile keyboards.
    try { dialog.focus(); } catch (e) {}
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);

  return { close };
}
