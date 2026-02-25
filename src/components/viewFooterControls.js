import { getGlobalSettingsManager } from '../managers/settingsManager.js';
import { openViewFooterSettingsDialog } from './dialogs/viewFooterSettingsDialog.js';

const FOOTER_CONFIGS_SETTING_ID = 'apps.viewFooter.configs';

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function isDescriptor(item) {
  return !!(item && typeof item === 'object' && !(item instanceof Element));
}

function asString(v) {
  return (v == null) ? '' : String(v);
}

function isCustomToken(key) {
  return typeof key === 'string' && key.startsWith('__custom:');
}

function customTokenFromId(id) {
  return `__custom:${asString(id).trim()}`;
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
    for (const act of (Array.isArray(item.actions) ? item.actions : [])) {
      if (!act || typeof act !== 'object') continue;
      const actionId = asString(act.actionId).trim();
      if (!actionId) continue;
      const delayMsNum = Number(act.delayMs);
      const delayMs = Number.isFinite(delayMsNum) ? Math.max(0, Math.round(delayMsNum)) : 0;
      actions.push({ actionId, delayMs });
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

function normalizeConfigEntry(raw, baseKeys = []) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const customButtons = normalizeCustomButtons(src.customButtons);
  const customTokens = new Set(customButtons.map(btn => customTokenFromId(btn.id)));
  const order = Array.isArray(src.order) ? src.order.map(v => String(v || '').trim()).filter(Boolean) : [];
  const seen = new Set();
  const normalizedOrder = [];
  for (const key of order) {
    const k = String(key || '').trim();
    // allow special placeholder token '__empty' in order
    const isPlaceholder = (k === '__empty');
    if (!k || (!isPlaceholder && seen.has(k)) || (!isPlaceholder && !baseKeys.includes(k) && !customTokens.has(k))) continue;
    if (!isPlaceholder) seen.add(k);
    // preserve placeholder token as-is; allow multiple placeholders
    normalizedOrder.push(k);
  }
  for (const token of customTokens) {
    if (!seen.has(token)) {
      seen.add(token);
      normalizedOrder.push(token);
    }
  }
  for (const key of baseKeys) {
    if (!seen.has(key)) normalizedOrder.push(key);
  }
  return {
    id: String(src.id || 'default'),
    name: String(src.name || 'Default'),
    order: normalizedOrder,
    controls: (src.controls && typeof src.controls === 'object') ? deepClone(src.controls) : {},
    customButtons,
    hotkeysDisabled: !!src.hotkeysDisabled,
  };
}

function normalizeAppFooterPrefs(raw, baseKeys = []) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const configs = Array.isArray(src.configs) ? src.configs : [];
  const byId = new Map();
  for (const c of configs) {
    const n = normalizeConfigEntry(c, baseKeys);
    const id = String(n.id || '').trim();
    if (!id) continue;
    n.id = id;
    byId.set(id, n);
  }
  if (!byId.has('default')) {
    byId.set('default', { id: 'default', name: 'Default', order: baseKeys.slice(), controls: {}, customButtons: [] });
  }
  const activeConfigId = byId.has(src.activeConfigId) ? src.activeConfigId : 'default';
  return {
    activeConfigId,
    configs: Array.from(byId.values()),
  };
}

function getConfigById(appPrefs, configId) {
  if (!appPrefs || !Array.isArray(appPrefs.configs)) return null;
  return appPrefs.configs.find(c => c.id === configId) || null;
}

function applyStateOverrides(state, overrideState, disableHotkeys = false) {
  if (!overrideState || typeof overrideState !== 'object') return state;
  const out = { ...state };
  if (typeof overrideState.icon === 'string') out.icon = overrideState.icon;
  if (typeof overrideState.text === 'string') out.text = overrideState.text;
  if (!disableHotkeys) {
    if (typeof overrideState.shortcut === 'string') out.shortcut = overrideState.shortcut;
    if (typeof overrideState.caption === 'string') out.caption = overrideState.caption;
    else if (typeof overrideState.shortcut === 'string') {
      const s = String(overrideState.shortcut || '');
      if (s === ' ') out.caption = 'Space';
      else if (s === 'ArrowLeft') out.caption = '←';
      else if (s === 'ArrowRight') out.caption = '→';
      else if (s === 'ArrowUp') out.caption = '↑';
      else if (s === 'ArrowDown') out.caption = '↓';
      else if (/^[a-z]$/i.test(s)) out.caption = s.toUpperCase();
      else out.caption = s;
    }
  } else {
    delete out.shortcut;
    delete out.caption;
  }
  return out;
}

function buildActionRegistry(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!isDescriptor(item) || !item.key) continue;
    const controlKey = asString(item.key).trim();
    if (!controlKey) continue;

    if (Array.isArray(item.states) && item.states.length) {
      for (const state of item.states) {
        if (!state || !state.name || typeof state.action !== 'function') continue;
        const stateName = asString(state.name).trim();
        if (!stateName) continue;
        const actionId = asString(state.actionKey || `${controlKey}:${stateName}`).trim();
        if (!actionId || map.has(actionId)) continue;
        map.set(actionId, {
          id: actionId,
          controlKey,
          state: stateName,
          icon: asString(state.icon),
          text: asString(state.text) || stateName,
          caption: asString(state.caption),
          shortcut: asString(state.shortcut),
          fnName: asString(state.fnName),
          invoke: state.action,
        });
      }
      continue;
    }

    if (typeof item.action === 'function') {
      const actionId = asString(item.actionKey || controlKey).trim();
      if (!actionId || map.has(actionId)) continue;
      map.set(actionId, {
        id: actionId,
        controlKey,
        icon: asString(item.icon),
        text: asString(item.text) || controlKey,
        caption: asString(item.caption),
        shortcut: asString(item.shortcut),
        fnName: asString(item.fnName),
        invoke: item.action,
      });
    }
  }
  return map;
}

function createCustomButtonDescriptor(button, actionRegistry, disableHotkeys = false) {
  if (!button || typeof button !== 'object') return null;
  const id = asString(button.id).trim();
  if (!id) return null;
  const actions = Array.isArray(button.actions) ? button.actions.slice() : [];

  async function runAll(e) {
    for (const step of actions) {
      if (!step || typeof step !== 'object') continue;
      const actionId = asString(step.actionId).trim();
      if (!actionId) continue;
      const delayMsNum = Number(step.delayMs);
      const delayMs = Number.isFinite(delayMsNum) ? Math.max(0, Math.round(delayMsNum)) : 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const entry = actionRegistry.get(actionId);
      if (!entry || typeof entry.invoke !== 'function') continue;
      try {
        const maybePromise = entry.invoke(e);
        if (maybePromise && typeof maybePromise.then === 'function') {
          await maybePromise;
        }
      } catch (err) {
        // ignore individual action failures in a multi-action button
      }
    }
  }

  const descriptor = {
    key: customTokenFromId(id),
    icon: asString(button.icon),
    text: asString(button.text) || 'Custom',
    caption: asString(button.caption),
    shortcut: asString(button.shortcut),
    action: (e) => { runAll(e); },
  };

  if (disableHotkeys) {
    delete descriptor.shortcut;
    delete descriptor.caption;
  }

  return descriptor;
}

function applyFooterConfig(items = [], appPrefs = null, actionRegistry = new Map()) {
  const activeConfig = getConfigById(appPrefs, appPrefs?.activeConfigId) || getConfigById(appPrefs, 'default');
  if (!activeConfig) return items.slice();

  const disableHotkeys = !!activeConfig.hotkeysDisabled;

  const controlsByKey = new Map();
  const others = [];
  const customButtonsByToken = new Map();

  for (const customBtn of (Array.isArray(activeConfig.customButtons) ? activeConfig.customButtons : [])) {
    const token = customTokenFromId(customBtn.id);
    const override = (activeConfig.controls && activeConfig.controls[token] && typeof activeConfig.controls[token] === 'object')
      ? activeConfig.controls[token]
      : {};
    if (override.hidden) continue;
    const descriptor = createCustomButtonDescriptor(customBtn, actionRegistry, disableHotkeys);
    if (descriptor) customButtonsByToken.set(token, descriptor);
  }

  for (const item of items) {
    if (!isDescriptor(item) || !item.key) {
      others.push(item);
      continue;
    }
    const key = String(item.key || '').trim();
    if (!key) {
      others.push(item);
      continue;
    }

    const override = (activeConfig.controls && activeConfig.controls[key] && typeof activeConfig.controls[key] === 'object')
      ? activeConfig.controls[key]
      : {};
    if (override.hidden) continue;

    const next = { ...item };
    if (disableHotkeys) {
      delete next.shortcut;
      delete next.caption;
    }
    if (Array.isArray(next.states) && next.states.length) {
      const stateOverrides = (override.states && typeof override.states === 'object') ? override.states : {};
      next.states = next.states.map(st => {
        if (!st || !st.name) return st;
        return applyStateOverrides({ ...st }, stateOverrides[st.name], disableHotkeys);
      });
    } else {
      if (typeof override.icon === 'string') next.icon = override.icon;
      if (typeof override.text === 'string') next.text = override.text;
      if (!disableHotkeys) {
        if (typeof override.shortcut === 'string') next.shortcut = override.shortcut;
        if (typeof override.caption === 'string') next.caption = override.caption;
        else if (typeof override.shortcut === 'string') {
          const s = String(override.shortcut || '');
          if (s === ' ') next.caption = 'Space';
          else if (s === 'ArrowLeft') next.caption = '←';
          else if (s === 'ArrowRight') next.caption = '→';
          else if (s === 'ArrowUp') next.caption = '↑';
          else if (s === 'ArrowDown') next.caption = '↓';
          else if (/^[a-z]$/i.test(s)) next.caption = s.toUpperCase();
          else next.caption = s;
        }
      } else {
        delete next.shortcut;
        delete next.caption;
      }
    }
    controlsByKey.set(key, next);
  }

  const out = [];
  const seen = new Set();
  const order = Array.isArray(activeConfig.order) ? activeConfig.order : [];
  for (const key of order) {
    const k = String(key || '').trim();
    if (!k) continue;
    if (k === '__empty') {
      // insert a placeholder slot
      out.push({ placeholder: true });
      continue;
    }
    if (isCustomToken(k)) {
      const custom = customButtonsByToken.get(k);
      if (!custom || seen.has(k)) continue;
      seen.add(k);
      out.push(custom);
      continue;
    }
    if (!controlsByKey.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(controlsByKey.get(k));
  }

  for (const [token, custom] of customButtonsByToken.entries()) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(custom);
  }

  for (const item of items) {
    if (!isDescriptor(item) || !item.key) continue;
    const key = String(item.key || '').trim();
    if (!key || seen.has(key) || !controlsByKey.has(key)) continue;
    seen.add(key);
    out.push(controlsByKey.get(key));
  }

  for (const other of others) out.push(other);
  return out;
}

// Creates a footer control bar and appends provided button elements.
// Buttons/controls are created by the caller and passed in so
// the caller retains control over event handlers and shortcut hints.
function createViewFooterControls(items = [], opts = {}) {
  // items can be either Elements (legacy) or descriptor objects:
  // { key, icon, text, caption, ariaPressed, action }
  const footerControls = document.createElement('div');
  footerControls.className = 'view-footer-controls';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'view-footer-controls-row';
  footerControls.appendChild(controlsRow);

  const buttons = {};
  let shortcuts = {};
  const settingsManager = opts.settingsManager || getGlobalSettingsManager?.() || null;
  const appId = (opts && typeof opts.appId === 'string') ? opts.appId : `viewFooterControls${Math.random().toString(36).slice(2, 8)}`;

  const baseControlItems = items.filter(it => isDescriptor(it) && it.key).map(it => ({ ...it }));
  const actionRegistry = buildActionRegistry(items);
  const availableActions = Array.from(actionRegistry.values()).map(a => ({
    id: a.id,
    controlKey: a.controlKey,
    state: a.state || '',
    icon: a.icon,
    text: a.text,
    caption: a.caption,
    shortcut: a.shortcut,
    fnName: a.fnName,
  }));
  const baseKeys = baseControlItems.map(it => String(it.key || '').trim()).filter(Boolean);
  let allFooterPrefs = {};
  let appPrefs = normalizeAppFooterPrefs(null, baseKeys);

  // helper to create a simple button element from descriptor
  function makeButton(desc) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = desc.icon || '';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = desc.text || '';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = desc.caption || '';
    if (desc.ariaPressed !== undefined) b.setAttribute('aria-pressed', String(!!desc.ariaPressed));
    b.append(icon, text, caption);
    if (typeof desc.action === 'function') {
      b.addEventListener('click', (e) => desc.action(e));
    }
    // Helper API for apps to update parts of the button without rebuilding innerHTML
    b.setIcon = (v) => { icon.textContent = v || ''; };
    b.setText = (v) => { text.textContent = v || ''; };
    b.setCaption = (v) => { caption.textContent = v || ''; };
    b.setAriaPressed = (val) => { b.setAttribute('aria-pressed', String(!!val)); };
    b.getCaption = () => caption.textContent || '';
    return b;
  }

  // helper to create a stateful button (multiple visual/behavior states)
  function makeStateButton(desc) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    const icon = document.createElement('span');
    icon.className = 'icon';
    const text = document.createElement('span');
    text.className = 'text';
    const caption = document.createElement('span');
    caption.className = 'caption';
    b.append(icon, text, caption);

    const states = Array.isArray(desc.states) ? desc.states.slice() : [];
    const stateMap = {};
    for (const s of states) {
      if (!s || !s.name) continue;
      stateMap[s.name] = s;
    }
    let current = desc.initialState || (states[0] && states[0].name) || null;

    function applyState(name) {
      const s = stateMap[name];
      if (!s) return;
      icon.textContent = s.icon || '';
      text.textContent = s.text || '';
      caption.textContent = s.caption || '';
      if (s.ariaPressed !== undefined) b.setAttribute('aria-pressed', String(!!s.ariaPressed));
      current = name;
    }

    b.setState = (name) => { applyState(name); };
    b.getState = () => current;

    // click executes current state's action if present
    b.addEventListener('click', (e) => {
      const s = stateMap[current];
      if (s && typeof s.action === 'function') s.action(e);
    });

    // expose a handler to be called by shortcut wrapper
    b.handleShortcut = (key, e) => {
      const s = stateMap[current];
      if (s && s.shortcut && (s.shortcut === key || String(s.shortcut).toUpperCase() === String(key).toUpperCase())) {
        if (typeof s.action === 'function') s.action(e);
      }
    };

    // initialize visual
    if (current) applyState(current);
    return b;
  }

  function clearButtonsMap() {
    for (const k of Object.keys(buttons)) delete buttons[k];
  }

  function buildButtons(renderItems = []) {
    controlsRow.innerHTML = '';
    clearButtonsMap();

    const statefulKeySets = [];
    const nextShortcuts = Object.assign({}, opts.shortcuts || {});
    let visibleCount = 0;

    for (const it of renderItems) {
      if (it instanceof Element) {
        controlsRow.appendChild(it);
        visibleCount++;
        continue;
      }
      if (!it || typeof it !== 'object') continue;
      // placeholder slots
      if (it.placeholder) {
        const ph = document.createElement('button');
        ph.type = 'button';
        ph.className = 'btn view-footer-placeholder';
        ph.disabled = true;
        ph.setAttribute('aria-hidden', 'true');
        controlsRow.appendChild(ph);
        continue;
      }
      let el;
      if (Array.isArray(it.states) && it.states.length) {
        el = makeStateButton(it);
        const keys = new Set();
        for (const s of it.states) if (s && s.shortcut) keys.add(s.shortcut);
        statefulKeySets.push({ el, keys });
      } else {
        el = makeButton(it);
      }
      controlsRow.appendChild(el);
      visibleCount++;
      if (it.key) buttons[it.key] = el;

      if (it.shortcut && !(Array.isArray(it.states) && it.states.length)) {
        nextShortcuts[it.shortcut] = nextShortcuts[it.shortcut] || (it.key ? buttons[it.key] : null) || it.action;
      }
    }

    for (const ks of statefulKeySets) {
      for (const key of ks.keys) {
        if (!nextShortcuts[key]) {
          nextShortcuts[key] = (e) => {
            try { ks.el.handleShortcut(key, e); } catch (err) {}
          };
        }
      }
    }

    shortcuts = nextShortcuts;
    // annotate how many rows should be used on mobile (CSS reads this)
    try { footerControls.setAttribute('data-mobile-rows', (visibleCount <= 3 ? 'one' : 'two')); } catch (e) {}
  }

  function readPrefs() {
    if (!settingsManager || typeof settingsManager.get !== 'function' || typeof settingsManager.set !== 'function' || typeof settingsManager.registerConsumer !== 'function') {
      appPrefs = normalizeAppFooterPrefs(null, baseKeys);
      return;
    }
    try {
      allFooterPrefs = settingsManager.get(FOOTER_CONFIGS_SETTING_ID, { consumerId: `footer.${appId}` }) || {};
      appPrefs = normalizeAppFooterPrefs(allFooterPrefs[appId], baseKeys);
    } catch (e) {
      allFooterPrefs = {};
      appPrefs = normalizeAppFooterPrefs(null, baseKeys);
    }
  }

  function persistPrefs(nextAppPrefs) {
    if (!settingsManager || typeof settingsManager.set !== 'function') return;
    try {
      const current = settingsManager.get(FOOTER_CONFIGS_SETTING_ID, { consumerId: `footer.${appId}` }) || {};
      const merged = { ...(current || {}), [appId]: deepClone(nextAppPrefs) };
      settingsManager.set(FOOTER_CONFIGS_SETTING_ID, merged, { consumerId: `footer.${appId}` });
    } catch (e) {
      // ignore persistence failures
    }
  }

  function rebuildFromConfig() {
    const renderItems = applyFooterConfig(items, appPrefs, actionRegistry);
    buildButtons(renderItems);
  }

  readPrefs();
  rebuildFromConfig();

  function handler(e) {
    if (!shortcuts) return false;
    const key = e.key;
    let target = shortcuts[key] || shortcuts[String(key).toUpperCase()];
    if (!target) return false;
    try {
      if (typeof target === 'function') target(e);
      else if (target instanceof Element) target.click();
      return true;
    } catch (err) {
      return false;
    }
  }

  function register() {
    try { document.dispatchEvent(new CustomEvent('app:registerKeyHandler', { detail: { id: appId, handler } })); } catch (e) {}
  }
  function unregister() {
    try { document.dispatchEvent(new CustomEvent('app:unregisterKeyHandler', { detail: { id: appId } })); } catch (e) {}
  }

  let settingsDialogHandle = null;
  let unregSettings = null;

  if (opts.enableSettings !== false && baseControlItems.length) {
    // settings button should sit in its own block row above the controls
    const settingsRow = document.createElement('div');
    settingsRow.className = 'view-footer-settings-row';
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'view-footer-settings-btn btn small';
    settingsBtn.textContent = '⚙';
    settingsBtn.title = 'Footer settings';
    settingsBtn.setAttribute('aria-label', 'Footer settings');
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { settingsDialogHandle?.close?.(); } catch (err) {}
      settingsDialogHandle = openViewFooterSettingsDialog({
        appId,
        baseControls: baseControlItems,
        availableActions,
        appPrefs,
        onChange: (nextPrefs) => {
          appPrefs = normalizeAppFooterPrefs(nextPrefs, baseKeys);
          persistPrefs(appPrefs);
          rebuildFromConfig();
        }
      });
    });
    settingsRow.appendChild(settingsBtn);
    // insert settings row before the controls row so it appears above
    footerControls.insertBefore(settingsRow, controlsRow);
  }

  if (settingsManager && typeof settingsManager.registerConsumer === 'function') {
    try {
      unregSettings = settingsManager.registerConsumer({
        consumerId: `footer.${appId}`,
        settings: [FOOTER_CONFIGS_SETTING_ID],
        onChange: ({ settingId, next }) => {
          if (settingId !== FOOTER_CONFIGS_SETTING_ID) return;
          try {
            const all = (next && typeof next === 'object') ? next : {};
            appPrefs = normalizeAppFooterPrefs(all[appId], baseKeys);
            rebuildFromConfig();
          } catch (e) {
            // ignore
          }
        },
      });
    } catch (e) {
      unregSettings = null;
    }
  }

  const mo = new MutationObserver(() => {
    if (!document.body.contains(footerControls)) {
      unregister();
      try { settingsDialogHandle?.close?.(); } catch (e) {}
      try { if (typeof unregSettings === 'function') unregSettings(); } catch (e) {}
      try { mo.disconnect(); } catch (e) {}
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setTimeout(register, 0);

  footerControls.__unregister = unregister;

  return {
    el: footerControls,
    buttons,
    getButton: (key) => buttons[key] || null,
    rebuild: () => rebuildFromConfig(),
  };
}

// Expose globally for existing apps that call this without imports
window.createViewFooterControls = createViewFooterControls;

export { createViewFooterControls };
