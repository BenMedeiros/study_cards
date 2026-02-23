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
  // prefer mounting menus inside the app shell when available so menus
  // are scoped to the app container rather than the global document.
  const _menuHost = (typeof document !== 'undefined' && document.getElementById) ? (document.getElementById('shell-root') || document.body) : document.body;

  let menu = document.querySelector('.context-menu');
  let created = false;
  // track the currently-visible submenu element (if any)
  let _currentOpenSubmenu = null;
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
    // Ensure the reused menu element is hosted inside the preferred container
    try {
      if (menu.parentNode !== _menuHost) {
        _menuHost.append(menu);
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
    // append into the preferred host (shell root when present)
    try { _menuHost.append(menu); } catch (e) { try { document.body.append(menu); } catch (e) {} }
    created = true;
  }

  function buildItem(it) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    btn.textContent = it.label || '';
    if (it.disabled) btn.disabled = true;
    // If item has a submenu, show an affordance and handle hover to open it
    if (Array.isArray(it.submenu) && it.submenu.length) {
      btn.classList.add('has-submenu');
      const arrow = document.createElement('span');
      arrow.className = 'context-menu-item-arrow';
      arrow.textContent = '▸';
      btn.append(arrow);

      let submenuEl = null;
      let closeTimeout = null;

      function createSubmenu() {
        if (submenuEl) return submenuEl;
        submenuEl = document.createElement('div');
        submenuEl.className = 'context-menu context-menu-submenu';
        submenuEl.style.position = 'fixed';
        submenuEl.style.zIndex = '9999';
        for (const child of it.submenu) {
          const childBtn = buildItem(child);
          submenuEl.append(childBtn);
        }
        // append to same host as parent menu
        try { menu.append(submenuEl); } catch (e) { document.body.append(submenuEl); }
        // keep submenu open when hovered
        submenuEl.addEventListener('mouseenter', () => { clearTimeout(closeTimeout); });
        submenuEl.addEventListener('mouseleave', () => { scheduleCloseSubmenu(); });
        return submenuEl;
      }

      function openSubmenu() {
        clearTimeout(closeTimeout);
        const s = createSubmenu();
        try {
          // Hide any existing submenu elements immediately to avoid overlap/flicker.
          try {
            const existing = menu.querySelectorAll('.context-menu-submenu');
            for (const ex of existing) {
              if (ex === s) continue;
              try { ex.style.display = 'none'; } catch (e) { try { ex.remove(); } catch (e) {} }
            }
          } catch (e) {}

          const r = btn.getBoundingClientRect();
          const left = Math.min(window.innerWidth - 8, Math.round(r.right + 6));
          const top = Math.max(4, Math.round(r.top));
          s.style.left = `${left}px`;
          s.style.top = `${top}px`;
          s.style.display = '';
          _currentOpenSubmenu = s;
        } catch (e) {}
      }

      function scheduleCloseSubmenu(delay = 180) {
        clearTimeout(closeTimeout);
        closeTimeout = setTimeout(() => {
          try { if (submenuEl) submenuEl.style.display = 'none'; } catch (e) {}
        }, delay);
      }

      btn.addEventListener('mouseenter', () => { openSubmenu(); });
      btn.addEventListener('mouseleave', () => { scheduleCloseSubmenu(); });
      // also support a click handler if provided
      const origOnClick = it.onClick;
      if (typeof origOnClick === 'function') {
        btn.addEventListener('click', (e) => {
          try { origOnClick(e); } catch (e) {}
          close();
        });
      }
    } else {
      btn.addEventListener('click', (e) => {
        try { if (typeof it.onClick === 'function') it.onClick(e); } catch (e) {}
        close();
      });
    }
    return btn;
  }

  for (const it of items) menu.append(buildItem(it));
  // already appended into the preferred host when created

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
    try {
      // hide any submenus that may be open
      const subs = Array.from(menu.querySelectorAll('.context-menu-submenu'));
      for (const s of subs) {
        try { s.style.display = 'none'; } catch (e) {}
      }
      _currentOpenSubmenu = null;
    } catch (e) {}
  }

  return { close, menu };
}
