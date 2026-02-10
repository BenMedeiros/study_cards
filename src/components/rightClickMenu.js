// Lightweight standardized right-click menu used across the app.
// Uses the shared `.context-menu` style.

// Keep a small registry of allowed context-menu subtypes so callers
// must opt-in to adding subtype classes (helps keep CSS maintenance
// explicit and prevents accidental class proliferation).
const _allowedRcmContexts = new Set(['brand', 'table']);
const _allowedRcmClassNames = new Set(['brand-context-menu', 'table-context-menu']);

export function registerRightClickContext(name) {
  try {
    if (!name || typeof name !== 'string') return false;
    const n = String(name).trim();
    // if caller passed a full class name like "brand-context-menu"
    if (/-context-menu$/i.test(n)) {
      _allowedRcmClassNames.add(n);
      const short = n.replace(/-context-menu$/i, '');
      if (short) _allowedRcmContexts.add(short);
      return true;
    }
    // otherwise accept a short context name and derive the class name
    if (!/^[a-z0-9_-]+$/i.test(n)) return false;
    _allowedRcmContexts.add(n);
    _allowedRcmClassNames.add(`${n}-context-menu`);
    return true;
  } catch (e) { return false; }
}

export function getAllowedRightClickClassNames() {
  return Array.from(_allowedRcmClassNames);
}

export function getAllowedRightClickContexts() {
  return Array.from(_allowedRcmContexts);
}

export function openRightClickMenu({ x = 0, y = 0, items = [], context = '' } = {}) {
  // signal other overlays to close before opening
  try { document.dispatchEvent(new CustomEvent('ui:closeOverlays')); } catch (e) {}
  // hide any stray menus that don't listen to the close event
    try {
      const hideSelector = ['.context-menu'].concat(getAllowedRightClickClassNames().map((c) => `.${c}`)).join(', ');
      document.querySelectorAll(hideSelector).forEach((el) => { try { el.style.display = 'none'; } catch (e) {} });
    } catch (e) {}

  // reuse an existing context menu element when possible to keep the DOM tidy
  let menu = document.querySelector('.context-menu');
  let created = false;
  if (menu) {
    // reuse
    try { menu.innerHTML = ''; } catch (e) {}
    try { menu.style.display = ''; } catch (e) {}
    try { menu.style.left = `${Math.round(x)}px`; menu.style.top = `${Math.round(y)}px`; } catch (e) {}
    // update context-specific class when reusing the element
    try {
      const prev = menu.dataset._rcmOwner || '';
      if (prev && prev !== context) {
        try { menu.classList.remove(prev); } catch (e) {}
      }
      if (context) {
        const className = /-context-menu$/i.test(context) ? context : `${context}-context-menu`;
        if (_allowedRcmClassNames.has(className) || _allowedRcmContexts.has(context)) {
          try { menu.classList.add(className); } catch (e) {}
          menu.dataset._rcmOwner = className;
        } else {
          try { delete menu.dataset._rcmOwner; } catch (e) {}
        }
      } else {
        try { delete menu.dataset._rcmOwner; } catch (e) {}
      }
    } catch (e) {}
  } else {
    menu = document.createElement('div');
    menu.className = 'context-menu';
    if (context) {
      const className = /-context-menu$/i.test(context) ? context : `${context}-context-menu`;
      if (_allowedRcmClassNames.has(className) || _allowedRcmContexts.has(context)) {
        try { menu.classList.add(className); } catch (e) {}
        try { menu.dataset._rcmOwner = className; } catch (e) {}
      }
    }
    // left/top are applied inline so the menu can be placed near the pointer
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
    created = true;
  }

  function buildItem(it) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    btn.textContent = it.label || '';
    if (it.disabled) btn.disabled = true;
    btn.addEventListener('click', (e) => {
      try { if (typeof it.onClick === 'function') it.onClick(e); } catch (e) {}
      close();
    });
    return btn;
  }

  for (const it of items) menu.append(buildItem(it));

  if (created) document.body.append(menu);

    // position fix if off-screen (keep using inline left/top updates)
  try {
    const r = menu.getBoundingClientRect();
    let nx = x, ny = y;
    if (r.right > window.innerWidth) nx = Math.max(4, x - (r.right - window.innerWidth) - 8);
    if (r.bottom > window.innerHeight) ny = Math.max(4, y - (r.bottom - window.innerHeight) - 8);
    if (nx !== x || ny !== y) {
      menu.style.left = `${Math.round(nx)}px`;
      menu.style.top = `${Math.round(ny)}px`;
    }
  } catch (e) {}

  function onDocClick(ev) {
    if (!menu.contains(ev.target)) close();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') close();
  }

  // Listen for shell/app requests to close overlays so menus are mutually-exclusive
  function onUiCloseOverlays() { close(); }

  // attach listeners only once per menu element
  if (!menu.dataset._rcmListeners) {
    setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('ui:closeOverlays', onUiCloseOverlays);
    }, 0);
    try { menu.dataset._rcmListeners = '1'; } catch (e) {}
  }

  function close() {
    try { menu.style.display = 'none'; } catch (e) {}
  }

  return { close, menu };
}
