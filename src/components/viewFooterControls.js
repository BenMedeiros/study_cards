// Creates a footer control bar and appends provided button elements.
// Buttons/controls are created by the caller and passed in so
// the caller retains control over event handlers and shortcut hints.
function createViewFooterControls(items = [], opts = {}) {
  // items can be either Elements (legacy) or descriptor objects:
  // { key, icon, text, caption, ariaPressed, action }
  const footerControls = document.createElement('div');
  footerControls.className = 'view-footer-controls';

  const buttons = {};

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

  // Build DOM
  // Collect possible shortcut keys for stateful buttons
  const statefulKeySets = [];

  for (const it of items) {
    if (it instanceof Element) {
      footerControls.appendChild(it);
    } else if (it && typeof it === 'object') {
      let el;
      if (Array.isArray(it.states) && it.states.length) {
        el = makeStateButton(it);
        // collect state's shortcuts
        const keys = new Set();
        for (const s of it.states) if (s && s.shortcut) keys.add(s.shortcut);
        statefulKeySets.push({ el, keys });
      } else {
        el = makeButton(it);
      }
      footerControls.appendChild(el);
      if (it.key) buttons[it.key] = el;
    }
  }

  // Build shortcuts map either from opts.shortcuts or from item.shortcut
  const shortcuts = Object.assign({}, opts.shortcuts || {});
  for (const it of items) {
    if (it && typeof it === 'object' && it.shortcut && !(Array.isArray(it.states) && it.states.length)) {
      shortcuts[it.shortcut] = shortcuts[it.shortcut] || (it.key ? buttons[it.key] : null) || it.action;
    }
  }

  // For stateful buttons, register wrapper functions for each potential key
  for (const ks of statefulKeySets) {
    for (const key of ks.keys) {
      // Only set if not already set by opts.shortcuts or non-state item
      if (!shortcuts[key]) {
        shortcuts[key] = (e) => {
          try { ks.el.handleShortcut(key, e); } catch (err) {}
        };
      }
    }
  }

  const appId = (opts && typeof opts.appId === 'string') ? opts.appId : `viewFooterControls${Math.random().toString(36).slice(2,8)}`;

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

  const mo = new MutationObserver(() => {
    if (!document.body.contains(footerControls)) {
      unregister();
      try { mo.disconnect(); } catch (e) {}
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setTimeout(register, 0);

  footerControls.__unregister = unregister;

  return { el: footerControls, buttons };
}

// Expose globally for existing apps that call this without imports
window.createViewFooterControls = createViewFooterControls;

export { createViewFooterControls };
