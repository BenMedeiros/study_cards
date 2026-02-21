import { el, safeId } from './ui.js';

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function asString(v) {
  return (v == null) ? '' : String(v);
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
      states: Array.isArray(raw.states)
        ? raw.states
          .filter(s => s && s.name)
          .map(s => ({
            name: String(s.name),
            text: asString(s.text),
            icon: asString(s.icon),
            caption: asString(s.caption),
            shortcut: asString(s.shortcut),
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
  };
}

function normalizeAppPrefs(raw, baseControls) {
  const baseKeys = baseControls.map(c => c.key);
  const src = (raw && typeof raw === 'object') ? raw : {};
  const rawConfigs = Array.isArray(src.configs) ? src.configs : [];
  const byId = new Map();

  for (const c of rawConfigs) {
    const n = ensureDefaultConfig(c);
    const id = String(n.id || '').trim();
    if (!id) continue;
    n.id = id;
    n.order = normalizeOrder(n.order, baseKeys);
    byId.set(n.id, n);
  }

  if (!byId.has('default')) {
    byId.set('default', { id: 'default', name: 'Default', order: baseKeys.slice(), controls: {} });
  }

  const configs = Array.from(byId.values());
  const activeConfigId = byId.has(src.activeConfigId) ? src.activeConfigId : 'default';
  return { activeConfigId, configs };
}

function normalizeOrder(order, baseKeys) {
  const seen = new Set();
  const out = [];
  const source = Array.isArray(order) ? order : [];
  for (const key of source) {
    const k = String(key || '').trim();
    // allow placeholder token '__empty' to be included in the order
    const isPlaceholder = (k === '__empty');
    if (!k || (!isPlaceholder && seen.has(k)) || (!isPlaceholder && !baseKeys.includes(k))) continue;
    if (!isPlaceholder) seen.add(k);
    out.push(k);
  }
  for (const k of baseKeys) {
    if (!seen.has(k)) out.push(k);
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
    const clearBtn = el('button', { className: 'btn small', text: 'Clear' });
    clearBtn.type = 'button';
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    const useBtn = el('button', { className: 'btn small', text: 'Use Key' });
    useBtn.type = 'button';
    useBtn.disabled = true;

    actions.append(clearBtn, cancelBtn, useBtn);
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

    clearBtn.addEventListener('click', () => close({ clear: true }));
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
  appPrefs = null,
  onChange = null,
} = {}) {
  const controls = normalizeBaseControls(baseControls);
  const baseKeys = controls.map(c => c.key);
  let prefs = normalizeAppPrefs(appPrefs, controls);
  let savedPrefs = deepClone(prefs);
  let selectedConfigId = prefs.activeConfigId;
  let isDirty = false;

  function emitSave(nextPrefs = prefs) {
    try {
      if (typeof onChange === 'function') onChange(deepClone(nextPrefs));
    } catch (e) {
      // ignore
    }
  }

  function selectedConfig() {
    return getConfigById(prefs, selectedConfigId) || getConfigById(prefs, 'default');
  }

  function ensureSelectedOrder(config) {
    if (!config) return;
    config.order = normalizeOrder(config.order, baseKeys);
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

  function markDirty() {
    isDirty = JSON.stringify(prefs) !== JSON.stringify(savedPrefs);
    if (saveBtn) saveBtn.disabled = !isDirty;
  }

  function createNewConfig() {
    const stamp = Date.now().toString(36).slice(-5);
    const id = `cfg-${safeId(`${appId}-${stamp}`) || stamp}`;
    const next = {
      id,
      name: `Config ${prefs.configs.length + 1}`,
      order: baseKeys.slice(),
      controls: {},
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
    prefs.configs.push(next);
    prefs.activeConfigId = id;
    selectedConfigId = id;
    markDirty();
  }

  function deleteSelectedConfig() {
    const current = selectedConfig();
    if (!current || current.id === 'default') return;
    prefs.configs = prefs.configs.filter(c => c.id !== current.id);
    prefs.activeConfigId = 'default';
    selectedConfigId = 'default';
    markDirty();
  }

  function resetFooterToDefault(config) {
    if (!config) return;
    config.controls = {};
    config.order = baseKeys.slice();
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

  function getAssignedShortcutMap(config, { skipKey = null, skipState = null } = {}) {
    const map = new Map();
    if (!config) return map;

    for (const key of config.order || []) {
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

  const closeBtn = el('button', { className: 'view-footer-settings-close btn small', text: '✕' });
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close footer settings');

  const title = el('div', { className: 'view-footer-settings-title', text: 'Footer Settings' });
  const subtitle = el('div', { className: 'hint', text: `App: ${appId}` });

  const left = el('div', { className: 'view-footer-settings-left' });
  const right = el('div', { className: 'view-footer-settings-right' });

  const leftTitle = el('div', { className: 'hint', text: 'Saved Configurations' });
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
  const resetBtn = el('button', { className: 'btn small', text: 'Reset Footer to Default' });
  resetBtn.type = 'button';
  const addEmptyBtn = el('button', { className: 'btn small', text: 'Add Empty' });
  addEmptyBtn.type = 'button';
  const saveBtn = el('button', { className: 'btn small', text: 'Save Changes' });
  saveBtn.type = 'button';
  saveBtn.disabled = true;

  const expandCollapseAllBtn = el('button', { className: 'btn small', text: 'Collapse All' });
  expandCollapseAllBtn.type = 'button';

  rightTop.append(nameLabel, nameInput, expandCollapseAllBtn, addEmptyBtn, resetBtn, saveBtn);

  const controlsTitle = el('div', { className: 'hint', text: 'Controls' });
  const controlsList = el('div', { className: 'view-footer-controls-editor-list' });
  right.append(rightTop, controlsTitle, controlsList);

  const shell = el('div', { className: 'view-footer-settings-shell', children: [left, right] });
  dialog.append(closeBtn, title, subtitle, shell);

  function renderConfigList() {
    configList.innerHTML = '';
    for (const cfg of prefs.configs) {
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
  }

  function renderEditor() {
    const cfg = selectedConfig();
    if (!cfg) {
      nameInput.value = '';
      controlsList.innerHTML = '';
      return;
    }

    ensureSelectedOrder(cfg);
    nameInput.value = cfg.name || cfg.id;
    delBtn.disabled = cfg.id === 'default';

    controlsList.innerHTML = '';
    for (let i = 0; i < cfg.order.length; i++) {
      const key = cfg.order[i];
      const base = getBaseControl(key);
      if (!base && key !== '__empty') continue;
      const override = getControlOverride(cfg, key);
      const row = el('div', { className: 'view-footer-control-row' });
      const rowTop = el('div', { className: 'view-footer-control-row-top' });

      // per-row collapse toggle
      const collapseBtn = el('button', { className: 'btn small view-footer-collapse-btn', text: '▴' });
      collapseBtn.type = 'button';
      collapseBtn.title = 'Toggle details';

      const visibility = el('input', { attrs: { type: 'checkbox' } });
      visibility.checked = !override.hidden;
      const visibilityLabel = el('label', { className: 'view-footer-visible-label', text: 'Show' });
      visibilityLabel.prepend(visibility);

      const keyBadge = el('div', { className: 'view-footer-control-key', text: key });
      const moveUp = el('button', { className: 'btn small', text: '↑' });
      moveUp.type = 'button';
      const moveDown = el('button', { className: 'btn small', text: '↓' });
      moveDown.type = 'button';
      const resetControlBtn = el('button', { className: 'btn small', text: 'Reset' });
      resetControlBtn.type = 'button';

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
        rowTop.append(collapseBtn, emptyLabel, moveUp, moveDown, removeBtn);
        // no fields for placeholders
        row.append(rowTop);
        controlsList.appendChild(row);
        // ensure collapse button state
        collapseBtn.addEventListener('click', () => {
          row.classList.toggle('collapsed');
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

      const fields = el('div', { className: 'view-footer-control-fields' });

      if (!base.states.length) {
        const iconInput = el('input', { className: 'view-footer-control-icon', attrs: { type: 'text', maxlength: '8', placeholder: base.icon || '' } });
        const textInput = el('input', { className: 'view-footer-control-text', attrs: { type: 'text', maxlength: '40', placeholder: base.text || '' } });
        const hotkeyBtn = el('button', { className: 'btn small view-footer-hotkey-btn', text: shortcutToCaption(resolveShortcut(base, override)) || 'Set hotkey' });
        hotkeyBtn.type = 'button';

        iconInput.value = asString(override.icon || '');
        textInput.value = asString(override.text || '');

        iconInput.addEventListener('input', () => {
          const next = { ...getControlOverride(cfg, key) };
          const v = asString(iconInput.value).trim();
          if (!v) delete next.icon;
          else next.icon = v;
          setControlOverride(cfg, key, next);
          markDirty();
        });

        textInput.addEventListener('input', () => {
          const next = { ...getControlOverride(cfg, key) };
          const v = asString(textInput.value).trim();
          if (!v) delete next.text;
          else next.text = v;
          setControlOverride(cfg, key, next);
          markDirty();
        });

        hotkeyBtn.addEventListener('click', async () => {
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
          if (result.clear) {
            delete next.shortcut;
            delete next.caption;
          } else {
            next.shortcut = result.shortcut;
            next.caption = result.caption;
          }
          setControlOverride(cfg, key, next);
          markDirty();
          renderEditor();
        });

        fields.append(
          el('div', { className: 'hint', text: 'Icon' }), iconInput,
          el('div', { className: 'hint', text: 'Name' }), textInput,
          el('div', { className: 'hint', text: 'Hotkey' }), hotkeyBtn,
        );
      } else {
        const stateWrap = el('div', { className: 'view-footer-state-list' });
        for (const st of base.states) {
          const stOv = (override.states && override.states[st.name]) ? override.states[st.name] : {};
          const stRow = el('div', { className: 'view-footer-state-row' });
          const stTitle = el('div', { className: 'view-footer-state-name', text: st.name });
          const stIcon = el('input', { attrs: { type: 'text', maxlength: '8', placeholder: st.icon || '' } });
          const stText = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: st.text || '' } });
          const stHotkeyBtn = el('button', { className: 'btn small view-footer-hotkey-btn', text: shortcutToCaption(resolveStateShortcut(st, stOv)) || 'Set hotkey' });
          stHotkeyBtn.type = 'button';
          stIcon.value = asString(stOv.icon || '');
          stText.value = asString(stOv.text || '');

          const writeState = () => {
            let next = { ...getControlOverride(cfg, key) };
            next = upsertStateOverride(next, st.name, (dst) => {
              const i = asString(stIcon.value).trim();
              const t = asString(stText.value).trim();
              if (!i) delete dst.icon; else dst.icon = i;
              if (!t) delete dst.text; else dst.text = t;
            });
            setControlOverride(cfg, key, next);
            markDirty();
          };

          stIcon.addEventListener('input', writeState);
          stText.addEventListener('input', writeState);

          stHotkeyBtn.addEventListener('click', async () => {
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
              if (result.clear) {
                delete dst.shortcut;
                delete dst.caption;
              } else {
                dst.shortcut = result.shortcut;
                dst.caption = result.caption;
              }
            });
            setControlOverride(cfg, key, next);
            markDirty();
            renderEditor();
          });

          stRow.append(stTitle, stIcon, stText, stHotkeyBtn);
          stateWrap.appendChild(stRow);
        }
        fields.appendChild(stateWrap);
      }

      visibility.addEventListener('change', () => {
        const next = { ...getControlOverride(cfg, key) };
        if (visibility.checked) delete next.hidden;
        else next.hidden = true;
        setControlOverride(cfg, key, next);
        markDirty();
      });

      // collapse toggle behavior for this row
      collapseBtn.addEventListener('click', () => {
        row.classList.toggle('collapsed');
        updateExpandCollapseBtnText();
      });

      // Initialize row collapsed state (expanded by default)
      row.classList.remove('collapsed');

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
    renderConfigList();
    renderEditor();
    markDirty();
  }

  newBtn.addEventListener('click', () => {
    createNewConfig();
    renderAll();
  });

  dupBtn.addEventListener('click', () => {
    duplicateSelectedConfig();
    renderAll();
  });

  delBtn.addEventListener('click', async () => {
    const cfg = selectedConfig();
    if (!cfg || cfg.id === 'default') return;
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
  });

  resetBtn.addEventListener('click', () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    resetFooterToDefault(cfg);
    renderEditor();
  });

  addEmptyBtn.addEventListener('click', () => {
    const cfg = selectedConfig();
    if (!cfg) return;
    cfg.order = cfg.order.concat(['__empty']);
    markDirty();
    renderEditor();
  });

  expandCollapseAllBtn.addEventListener('click', () => {
    const rows = Array.from(controlsList.querySelectorAll('.view-footer-control-row'));
    if (!rows.length) return;
    const anyCollapsed = rows.some(r => r.classList.contains('collapsed'));
    if (anyCollapsed) {
      // expand all
      rows.forEach(r => r.classList.remove('collapsed'));
    } else {
      // collapse all
      rows.forEach(r => r.classList.add('collapsed'));
    }
    updateExpandCollapseBtnText();
  });

  saveBtn.addEventListener('click', () => {
    if (!isDirty) return;
    emitSave();
    savedPrefs = deepClone(prefs);
    markDirty();
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
      close();
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
    close();
  }

  function close() {
    if (closed) return;
    closed = true;

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

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
  prevFocus = document.activeElement;
  mount.append(backdrop, dialog);

  dialog.style.position = 'fixed';
  dialog.style.left = '50%';
  dialog.style.top = '45%';
  dialog.style.transform = 'translate(-50%, -50%)';

  renderAll();

  requestAnimationFrame(() => {
    try {
      backdrop.classList.add('show');
      dialog.classList.add('open');
    } catch (e) {}
    try { nameInput.focus(); } catch (e) { try { dialog.focus(); } catch (e2) {} }
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);

  return { close };
}
