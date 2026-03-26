import { renderCollectionsManager } from './views/collectionsView/collectionsView.js';
import { renderManageCollections } from './views/manageCollectionsView/manageCollectionsView.js';
import { renderStudyManager } from './views/studyManagerView/studyManagerView.js';
import { parseHashRoute } from './utils/browser/helpers.js';
import { renderData } from './views/dataView/dataView.js';
import { renderKanjiStudyCard } from './views/kanjiStudyCardView/kanjiStudyCardView.js';
import { renderEntityExplorer } from './views/entityExplorerView/entityExplorerView.js';
import { createCollectionBrowserDropdown } from './components/features/collectionBrowser.js';
import { openRightClickMenu, registerRightClickContext } from './components/shared/rightClickMenu.js';
import { createShellTitleContextMenu } from './components/features/shellTitleContextMenu.js';
import { createShellFooter } from './components/features/shellFooter.js';
import { createDropdown } from './components/shared/dropdown.js';
import { timed } from './utils/browser/timing.js';
import collectionSettingsManager from './managers/collectionSettingsManager.js';
import {
  getFirebaseAuthSnapshot,
  signInWithGoogle,
  signOutFirebaseUser,
  subscribeFirebaseAuth,
} from './integrations/firebase/auth.js';

export function createAppShell({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'shell-root';

  // Initialize controllers with store
  collectionSettingsManager.init({ store });

  // Register shell as a settings consumer for persisted shell settings.
  try {
    store?.settings?.registerConsumer?.({
      consumerId: 'shell',
      settings: [
        'shell.showFooterCaptions',
        'shell.compactNav',
        'shell.timingEnabled',
        'shell.hideShellFooter',
        'shell.hideViewHeaderTools',
        'shell.hideViewFooterControls',
        'shell.logSettings',
      ],
      onChange: ({ settingId, next } = {}) => {
        try {
          const id = String(settingId || '').trim();
          if (!id) return;
          // Re-render header/layout when UI-related shell settings change.
          if (id.startsWith('shell.')) {
            try { renderHeader(); } catch (e) {}
            try { updateShellLayoutVars(); } catch (e) {}
          }
        } catch (e) {}
      }
    });
  } catch (e) {}

  const shellTitleContextMenu = createShellTitleContextMenu({
    store,
    settings: store?.settings,
    settingIds: [
      'shell.showFooterCaptions',
      'shell.compactNav',
      'shell.hideShellFooter',
      'shell.hideViewHeaderTools',
      'shell.hideViewFooterControls',
      'shell.logSettings',
    ],
    updateShellLayoutVars: () => {
      try { updateShellLayoutVars(); } catch (e) {}
    },
    context: 'brand-context-menu',
  });

  // Caption visibility is controlled explicitly via the brand toggle button.
  // Persist this preference in settings so it survives reloads.
  let captionsVisible = false;
  let authActionPending = false;
  let authActionError = '';
  try {
    const sm = store?.settings;
    if (sm && typeof sm.isReady === 'function' && sm.isReady() && typeof sm.get === 'function') {
      captionsVisible = !!sm.get('shell.showFooterCaptions', { consumerId: 'shell' });
      try { document.body.classList.toggle('hide-shell-footer', !!sm.get('shell.hideShellFooter', { consumerId: 'shell' })); } catch (e) {}
      try { document.body.classList.toggle('hide-view-footer-controls', !!sm.get('shell.hideViewFooterControls', { consumerId: 'shell' })); } catch (e) {}
      try { document.body.classList.toggle('hide-view-header-tools', !!sm.get('shell.hideViewHeaderTools', { consumerId: 'shell' })); } catch (e) {}
    }
  } catch (e) {}

  try {
    subscribeFirebaseAuth(() => {
      authActionPending = false;
      authActionError = '';
      try { renderHeader(); } catch (e) {}
    });
  } catch (e) {}

  async function handleAuthButtonClick() {
    if (authActionPending) return;
    authActionPending = true;
    authActionError = '';
    renderHeader();
    try {
      const authState = getFirebaseAuthSnapshot();
      if (authState?.isSignedIn) await signOutFirebaseUser();
      else await signInWithGoogle();
    } catch (e) {
      authActionError = String(e?.message || e || 'Authentication failed');
      authActionPending = false;
      renderHeader();
    }
  }

  function setCaptionsVisible(val, opts = {}) {
    captionsVisible = !!val;
    try {
      if (captionsVisible) document.body.classList.add('using-keyboard');
      else document.body.classList.remove('using-keyboard');
    } catch (e) {}

    // Persist to settings so preference survives reloads.
    try {
      if (store?.settings && typeof store.settings.set === 'function') {
        store.settings.set('shell.showFooterCaptions', captionsVisible, { consumerId: 'shell', immediate: !!opts.immediate, notifySelf: false, silent: !(opts.notify) });
      }
    } catch (e) {}
  }

  // Global key handling: keep document-level listeners centralized here.
  // Components should subscribe to `ui:closeOverlays` when they are open.
  function onGlobalKeyDown(e) {
    // If a modal dialog (aria-modal) is open, let it trap keys and skip
    // shell-level global key handling so modals can control focus/keyboard.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    // Escape closes overlays (existing behavior)
    if (e.key === 'Escape') {
      document.dispatchEvent(new CustomEvent('ui:closeOverlays'));
      return;
    }
    // Prioritize the collection browser when it's open — let it handle nav keys.
    const navKeys = ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'ArrowLeft', 'ArrowRight'];
    const container = document.getElementById('hdr-collection-select');
    if (container && container.classList.contains('open') && navKeys.includes(e.key)) {
      const menu = container.querySelector('.custom-dropdown-menu');
      if (!menu) return;

      const options = Array.from(menu.querySelectorAll('.custom-dropdown-option'));
      if (options.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      // current keyboard-focused index (persist on the container element)
      let idx = Number(container.dataset.kbIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) {
        const sel = options.findIndex(o => o.classList.contains('selected'));
        idx = sel >= 0 ? sel : 0;
      }

      function setFocused(i) {
        options.forEach(o => o.classList.remove('keyboard-focus'));
        const opt = options[Math.max(0, Math.min(options.length - 1, i))];
        if (opt) {
          opt.classList.add('keyboard-focus');
          opt.scrollIntoView({ block: 'nearest' });
          container.dataset.kbIndex = String(Array.prototype.indexOf.call(options, opt));
        }
      }

      if (e.key === 'ArrowDown') {
        idx = Math.min(idx + 1, options.length - 1);
        setFocused(idx);
        return;
      }

      if (e.key === 'ArrowUp') {
        idx = Math.max(idx - 1, 0);
        setFocused(idx);
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        const opt = options[idx];
        if (opt) opt.click();
        delete container.dataset.kbIndex;
        return;
      }

      if (e.key === 'ArrowRight') {
        const opt = options[idx];
        if (opt && opt.dataset.kind === 'folder') opt.click();
        return;
      }

      if (e.key === 'ArrowLeft') {
        const upOpt = menu.querySelector('.custom-dropdown-option[data-kind="up"]');
        if (upOpt) upOpt.click();
        return;
      }
    }

    // If no collection browser is open, delegate to registered app handlers.
    // Handlers are called in LIFO order (last-registered first). If a handler
    // returns true, it handled the event and we stop further processing.
    if (typeof appKeyHandlers !== 'undefined' && Array.isArray(appKeyHandlers) && appKeyHandlers.length) {
      for (let i = appKeyHandlers.length - 1; i >= 0; i--) {
        try {
          const h = appKeyHandlers[i];
          if (typeof h.handler === 'function') {
            const handled = h.handler(e);
            if (handled) {
              return;
            }
          }
        } catch (err) {
          // swallow
        }
      }
    }
  }

  document.addEventListener('keydown', onGlobalKeyDown);

  // App-level key handler registry. Apps register a handler so shell can
  // delegate keyboard events to the active app. Handlers should return
  // `true` if they handled the event and want to stop further processing.
  const appKeyHandlers = [];

  // App-level media handler registry. Apps can register callbacks for
  // play/pause/toggle (Bluetooth headset buttons, media keys, etc.).
  // Shell will dispatch to the most-recently-registered handler (LIFO),
  // mirroring keyboard handler behavior.
  const appMediaHandlers = [];

  function getActiveMediaHandler() {
    if (!Array.isArray(appMediaHandlers) || appMediaHandlers.length === 0) return null;
    return appMediaHandlers[appMediaHandlers.length - 1] || null;
  }

  function setShellMediaPlaybackState(state) {
    try {
      if (!('mediaSession' in navigator) || !navigator.mediaSession) return;
      const s = String(state || 'none');
      navigator.mediaSession.playbackState = (s === 'playing' || s === 'paused' || s === 'none') ? s : 'none';
    } catch (e) {}
  }

  function syncShellMediaSessionFromActive() {
    const active = getActiveMediaHandler();
    if (!active) {
      setShellMediaPlaybackState('none');
      return;
    }
    try {
      if (typeof active.getState === 'function') {
        const st = active.getState();
        if (st && typeof st === 'object' && st.playing !== undefined) {
          setShellMediaPlaybackState(st.playing ? 'playing' : 'paused');
        } else if (typeof st === 'boolean') {
          setShellMediaPlaybackState(st ? 'playing' : 'paused');
        }
      }
    } catch (e) {}
  }

  function dispatchMediaAction(action) {
    // Match the shell keydown behavior: if a modal is open, skip app dispatch.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false;

    const active = getActiveMediaHandler();
    if (!active) return false;

    try {
      let result;
      if (action === 'play') {
        if (typeof active.play === 'function') result = active.play();
        else if (typeof active.toggle === 'function') result = active.toggle();
      } else if (action === 'pause') {
        if (typeof active.pause === 'function') result = active.pause();
        else if (typeof active.toggle === 'function') result = active.toggle();
      } else {
        if (typeof active.toggle === 'function') result = active.toggle();
      }

      // If handler returns state, use it; otherwise query getState.
      if (typeof result === 'boolean') {
        setShellMediaPlaybackState(result ? 'playing' : 'paused');
      } else if (result && typeof result === 'object' && result.playing !== undefined) {
        setShellMediaPlaybackState(result.playing ? 'playing' : 'paused');
      } else {
        syncShellMediaSessionFromActive();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  document.addEventListener('app:registerKeyHandler', (ev) => {
    try {
      const { id, handler } = ev.detail || {};
      if (!id || typeof handler !== 'function') return;
      // Remove existing with same id then push to top
      for (let i = appKeyHandlers.length - 1; i >= 0; i--) {
        if (appKeyHandlers[i].id === id) appKeyHandlers.splice(i, 1);
      }
      appKeyHandlers.push({ id, handler });
    } catch (err) {}
  });

  document.addEventListener('app:unregisterKeyHandler', (ev) => {
    try {
      const id = ev.detail?.id;
      if (!id) return;
      for (let i = appKeyHandlers.length - 1; i >= 0; i--) {
        if (appKeyHandlers[i].id === id) appKeyHandlers.splice(i, 1);
      }
    } catch (err) {}
  });

  // Media handler register/unregister
  document.addEventListener('app:registerMediaHandler', (ev) => {
    try {
      const { id, play, pause, toggle, getState } = ev.detail || {};
      if (!id) return;
      // Remove existing with same id then push to top
      for (let i = appMediaHandlers.length - 1; i >= 0; i--) {
        if (appMediaHandlers[i].id === id) appMediaHandlers.splice(i, 1);
      }
      appMediaHandlers.push({ id, play, pause, toggle, getState });
      syncShellMediaSessionFromActive();
    } catch (err) {}
  });

  document.addEventListener('app:unregisterMediaHandler', (ev) => {
    try {
      const id = ev.detail?.id;
      if (!id) return;
      for (let i = appMediaHandlers.length - 1; i >= 0; i--) {
        if (appMediaHandlers[i].id === id) appMediaHandlers.splice(i, 1);
      }
      syncShellMediaSessionFromActive();
    } catch (err) {}
  });

  // Apps can notify the shell that their playback state changed (e.g. user
  // clicked play/pause in the UI) so the MediaSession playbackState stays in sync.
  document.addEventListener('app:mediaStateChanged', (ev) => {
    try {
      const id = ev.detail?.id;
      const active = getActiveMediaHandler();
      if (id && active && active.id !== id) return;
      syncShellMediaSessionFromActive();
    } catch (e) {}
  });

  // Wire MediaSession actions + media-key keydown fallback once at the shell.
  try {
    if ('mediaSession' in navigator && navigator.mediaSession) {
      const ms = navigator.mediaSession;
      try { ms.setActionHandler('play', () => dispatchMediaAction('play')); } catch (e) {}
      try { ms.setActionHandler('pause', () => dispatchMediaAction('pause')); } catch (e) {}
      try { ms.setActionHandler('stop', () => dispatchMediaAction('pause')); } catch (e) {}
      try { ms.setActionHandler('playpause', () => dispatchMediaAction('toggle')); } catch (e) {}
      // optional metadata (safe to ignore if unsupported)
      try {
        ms.metadata = new window.MediaMetadata({ title: 'Study Cards' });
      } catch (e) {}
      syncShellMediaSessionFromActive();
    }
  } catch (e) {}

  // Keydown fallback: some environments expose media keys as key events.
  try {
    window.addEventListener('keydown', (e) => {
      const key = String(e.key || '');
      const code = String(e.code || '');
      const isPlayPause = key === 'MediaPlayPause' || code === 'MediaPlayPause';
      const isPlay = key === 'MediaPlay' || code === 'MediaPlay';
      const isPause = key === 'MediaPause' || code === 'MediaPause';
      if (!isPlayPause && !isPlay && !isPause) return;
      const handled = dispatchMediaAction(isPlay ? 'play' : isPause ? 'pause' : 'toggle');
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  } catch (e) {}

  const header = document.createElement('div');
  header.className = 'header';
  header.id = 'shell-header';

  const headerInner = document.createElement('div');
  headerInner.className = 'header-inner';
  headerInner.id = 'shell-header-inner';

  const nav = document.createElement('div');
  nav.className = 'nav';
  nav.id = 'shell-nav';

  const main = document.createElement('main');
  main.className = 'main';
  main.id = 'shell-main';
  const cachedMainHost = document.createElement('div');
  cachedMainHost.id = 'shell-main-cached';
  const transientMainHost = document.createElement('div');
  transientMainHost.id = 'shell-main-transient';
  main.append(cachedMainHost, transientMainHost);

  header.append(headerInner);
  header.append(nav);
  el.append(header);
  el.append(main);

  const shellFooter = createShellFooter({ store, captionsVisible });
  const footer = shellFooter.el;
  el.append(footer);

  // Expose a simple footer API on store.shell so apps can send status/warnings
  try {
    if (store && store.shell && typeof store.shell === 'object') {
      store.shell.setFooterLeft = (status, warnings) => {
        try { if (typeof shellFooter.setLeftContent === 'function') shellFooter.setLeftContent({ status, warnings }); } catch (e) {}
      };
      store.shell.setFooterLeftStatus = (s) => { try { if (typeof shellFooter.setLeftStatus === 'function') shellFooter.setLeftStatus(s); } catch (e) {} };
      store.shell.setFooterLeftWarnings = (w) => { try { if (typeof shellFooter.setLeftWarnings === 'function') shellFooter.setLeftWarnings(w); } catch (e) {} };
    }
  } catch (e) {}

  // Keep CSS variables in sync with measured header/footer heights so
  // the main scroll area can be sized to end above floating controls.
  function updateShellLayoutVars() {
    try {
      const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
      const shellFooterH = footer ? Math.round(footer.getBoundingClientRect().height) : 0;
      const viewFooterEl = document.querySelector('.view-footer-controls');
      const viewFooterH = viewFooterEl ? Math.round(viewFooterEl.getBoundingClientRect().height) : Math.round(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--view-footer-height')) || 0);

      document.documentElement.style.setProperty('--shell-header-height', `${headerH}px`);
      document.documentElement.style.setProperty('--shell-footer-height', `${shellFooterH}px`);
      document.documentElement.style.setProperty('--view-footer-height', `${viewFooterH}px`);
    } catch (e) {
      // ignore measurement errors
    }
  }

  // Initial sync + react to resizes and DOM changes
  setTimeout(updateShellLayoutVars, 0);
  window.addEventListener('resize', updateShellLayoutVars);
  try {
    const mo = new MutationObserver(() => updateShellLayoutVars());
    mo.observe(document.body, { childList: true, subtree: true });

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => updateShellLayoutVars());
      try { ro.observe(header); } catch (e) {}
      const existing = document.querySelector('.view-footer-controls');
      if (existing) try { ro.observe(existing); } catch (e) {}
    }
  } catch (e) {}

  // Local cache of store-derived values to avoid synchronous store reads
  // during header render. This keeps renderHeader fast and only updates
  // when the store emits changes.
  const cached = {
    collections: Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections() : [],
    activeId: typeof store?.collections?.getActiveCollectionId === 'function' ? store.collections.getActiveCollectionId() : null,
    activeCollection: typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null,
  };

  try {
    shellFooter.renderFromStore({ activeCollection: cached.activeCollection, activeId: cached.activeId });
  } catch (e) {}

  // Study time tracking (app x collection)
  let activeStudySession = null;
  let activeRoutePathname = null;
  const cachedRoutePaths = new Set(['/kanji', '/data']);
  const cachedRouteMounts = new Map();

  function forEachLifecycleNode(root, fn) {
    if (!root || typeof fn !== 'function') return;
    const visit = (node) => {
      try { fn(node); } catch (e) {}
    };
    visit(root);
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let current = walker.nextNode();
      while (current) {
        visit(current);
        current = walker.nextNode();
      }
    } catch (e) {}
  }

  function activateCachedRouteMount(mount) {
    forEachLifecycleNode(mount, (node) => {
      if (typeof node?.__activate === 'function') node.__activate();
      if (typeof node?.__register === 'function') node.__register();
    });
  }

  function deactivateCachedRouteMount(mount) {
    forEachLifecycleNode(mount, (node) => {
      if (typeof node?.__deactivate === 'function') node.__deactivate();
      if (typeof node?.__unregister === 'function') node.__unregister();
    });
  }

  function hideAllCachedRouteMounts() {
    for (const mount of cachedRouteMounts.values()) {
      deactivateCachedRouteMount(mount);
      mount.hidden = true;
      mount.style.display = 'none';
    }
  }

  function getCachedRouteMount(path, renderFn) {
    if (cachedRouteMounts.has(path)) return cachedRouteMounts.get(path);
    const mount = document.createElement('div');
    mount.className = 'shell-cached-route';
    mount.dataset.routePath = path;
    mount.hidden = true;
    mount.style.display = 'none';
    const content = renderFn();
    if (content) mount.append(content);
    cachedMainHost.append(mount);
    cachedRouteMounts.set(path, mount);
    return mount;
  }

  function routePathToAppId(pathname) {
    const p = String(pathname || '').trim();
    if (!p) return null;
    if (p === '/kanji') return 'kanji';
    if (p === '/explorer') return 'explorer';
    if (p === '/data') return 'data';
    if (p === '/collections') return 'collections';
    if (p === '/study-manager') return 'study-manager';
    return null;
  }

  function endActiveStudySession() {
    if (!activeStudySession) return;
    try {
      const endWall = Date.now();
      const durationMs = Math.max(0, endWall - activeStudySession.startWallMs);
      // Ignore ultra-short time slices to reduce noise.
      if (durationMs >= 1000) {
        try {
          // Fetch any per-collection UI state (held filter / studyFilter)
          let held = '';
          let sf = '';
          const st = collectionSettingsManager.get(activeStudySession.collectionId) || {};
          held = String(st?.heldTableSearch || '').trim();
          sf = String(st?.studyFilter || '').trim();

          store.studyTime.recordAppCollectionStudySession({
            appId: activeStudySession.appId,
            collectionId: activeStudySession.collectionId,
            startIso: activeStudySession.startIso,
            endIso: new Date(endWall).toISOString(),
            durationMs,
            heldTableSearch: held || undefined,
            studyFilter: sf || undefined,
          });
        } catch (e) {}
      }
    } catch (e) {
      // ignore
    } finally {
      activeStudySession = null;
    }
  }

  function startActiveStudySessionFor(pathname) {
    try {
      const appId = routePathToAppId(pathname);
      const collectionId = (store?.collections && typeof store.collections.getActiveCollectionId === 'function')
        ? (store.collections.getActiveCollectionId() || null)
        : null;
      if (!appId || !collectionId) return;
      activeStudySession = {
        appId,
        collectionId,
        startWallMs: Date.now(),
        startIso: new Date().toISOString(),
      };
    } catch (e) {
      activeStudySession = null;
    }
  }

  function swapStudySessionFor(pathname) {
    endActiveStudySession();
    startActiveStudySessionFor(pathname);
  }

  try {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') endActiveStudySession();
    });
    window.addEventListener('pagehide', () => {
      endActiveStudySession();
    });
  } catch (e) {}

  function renderHeader() {
    headerInner.innerHTML = '';

    // If renderHeader runs while a menu is open, ensure overlays are closed.
    try { shellTitleContextMenu?.close?.(); } catch (e) {}

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.id = 'hdr-brand';

    const brandTitle = document.createElement('div');
    brandTitle.className = 'brand-title';
    brandTitle.id = 'hdr-brand-title';
    brandTitle.textContent = 'Study Cards';

    const brandSubtitle = document.createElement('div');
    brandSubtitle.className = 'brand-subtitle';
    brandSubtitle.id = 'hdr-brand-subtitle';
    brandSubtitle.textContent = 'Local-first study tools';

    const authState = getFirebaseAuthSnapshot();
    const brandAuth = document.createElement('div');
    brandAuth.className = 'brand-auth';
    brandAuth.id = 'hdr-brand-auth';

    const authStatus = document.createElement('span');
    authStatus.className = 'brand-auth-status';
    authStatus.id = 'hdr-auth-status';
    if (!authState?.isReady) {
      authStatus.textContent = 'Checking sign-in';
    } else if (authState?.isSignedIn) {
      const label = String(authState.displayName || authState.email || authState.uid || 'Signed in').trim();
      authStatus.textContent = `Signed in: ${label}`;
      if (authState.email) authStatus.title = authState.email;
    } else {
      authStatus.textContent = 'Not signed in';
    }

    const authButton = document.createElement('button');
    authButton.type = 'button';
    authButton.className = `btn small ${authState?.isSignedIn ? '' : 'primary'}`.trim();
    authButton.id = 'hdr-auth-button';
    authButton.disabled = !authState?.isReady || authActionPending;
    authButton.textContent = authActionPending
      ? 'Working...'
      : (authState?.isSignedIn ? 'Sign out' : 'Log in');
    authButton.addEventListener('click', () => {
      void handleAuthButtonClick();
    });
    if (authActionError) authButton.title = authActionError;

    brandAuth.append(authStatus, authButton);

    brand.append(brandTitle, brandSubtitle, brandAuth);

    // (Captions toggle moved to the brand context menu.)

    brand.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { shellTitleContextMenu?.openAt?.(e.clientX, e.clientY); } catch (e) {}
    });

    const right = document.createElement('div');
    right.className = 'header-right';
    right.id = 'hdr-right';

    const collectionBadge = document.createElement('div');
    collectionBadge.className = 'badge';
    collectionBadge.id = 'hdr-collection-badge';

    const collections = cached.collections;
    const activeId = cached.activeId;

    const collectionSelect = createCollectionBrowserDropdown({
      store,
      className: 'align-right',
      onSelect: async (value) => {
        await store.collections.setActiveCollectionId(value);
        const currentRoute = getCurrentRoute();
        renderRoute(currentRoute);
      }
    });
    collectionSelect.id = 'hdr-collection-select';

    const collectionLabel = document.createElement('span');
    collectionLabel.className = 'badge-muted';
    collectionLabel.id = 'hdr-collection-label';
    collectionLabel.textContent = 'Collection:';

    collectionBadge.append(collectionLabel, collectionSelect);

    right.append(collectionBadge);
    headerInner.append(brand, right);

    // On mobile, use SK if collection name is long, otherwise show full brand name
    if (window.innerWidth <= 768) {
      const activeCollection = collections.find(c => c.key === activeId);
      const collectionName = activeCollection?.metadata?.name || '';
      
      if (collectionName.length > 20) {
        headerInner.classList.add('compact-brand');
      } else {
        headerInner.classList.remove('compact-brand');
      }
    } else {
      headerInner.classList.remove('compact-brand');
    }

    nav.innerHTML = '';

    const links = [
      { href: '#/kanji', label: 'Kanji Study' },
      { href: '#/data', label: 'Data' },
      { href: '#/study-manager', label: 'Study Manager' },
      { href: '#/collections', label: 'Collections' },
      { href: '#/manage-collections', label: 'Manage Collections' },
      { href: '#/explorer', label: 'Explorer' },
    ];

    const currentPath = getCurrentRoute().pathname;

    // Compact nav: use a dropdown in the header instead of the nav links
    let compactNav = false;
    try { compactNav = !!(store?.settings?.get && store.settings.get('shell.compactNav', { consumerId: 'shell' })); } catch (e) { compactNav = false; }

    if (compactNav) {
      try {
        nav.style.display = 'none';
        const existing = document.getElementById('hdr-nav-dropdown');
        if (existing) existing.remove();
        const ddItems = links.map(l => ({ value: l.href, label: l.label }));
        const dd = createDropdown({ items: ddItems, value: `#${currentPath}`, onChange: (v) => { try { location.hash = String(v || '#/collections'); } catch (e) {} }, className: 'hdr-nav-dropdown align-right', closeOverlaysOnOpen: true });
        dd.id = 'hdr-nav-dropdown';
        try { const prev = right.querySelector('#hdr-nav-dropdown'); if (prev) prev.remove(); } catch (e) {}
        try { right.appendChild(dd); } catch (e) {}
      } catch (e) {
        nav.style.display = '';
      }
    } else {
      nav.style.display = '';
      const existing = document.getElementById('hdr-nav-dropdown');
      if (existing) try { existing.remove(); } catch (e) {}
      for (const l of links) {
        const a = document.createElement('a');
        a.id = `nav-link-${String(l.label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        a.href = l.href;
        a.textContent = l.label;
        const linkPath = l.href.replace(/^#/, '');
        if (linkPath === currentPath) a.classList.add('active');
        nav.append(a);
      }
    }
  }

  function getCurrentRoute() {
    return parseHashRoute(location.hash);
  }

  function renderRoute(route) {
    const path = String(route?.pathname || '/');
    return timed(`shell.renderRoute ${path}`, () => {
      renderHeader();
      hideAllCachedRouteMounts();
      transientMainHost.innerHTML = '';

      // Study-time bookkeeping: close previous view session and start the next.
      try {
        const nextPath = String(route?.pathname || '/');
        if (activeRoutePathname !== nextPath) {
          swapStudySessionFor(nextPath);
          activeRoutePathname = nextPath;
        }
      } catch (e) {}

      if (route.pathname === '/kanji') {
        try { console.info(cachedRouteMounts.has('/kanji') ? 'shell.renderRoute /kanji cache hit' : 'shell.renderRoute /kanji cache miss'); } catch (e) {}
        const mount = getCachedRouteMount('/kanji', () => timed('view.renderKanjiStudyCard', () => renderKanjiStudyCard({ store })));
        mount.hidden = false;
        mount.style.display = '';
        activateCachedRouteMount(mount);
        return;
      }
      if (route.pathname === '/explorer') {
        transientMainHost.append(timed('view.renderEntityExplorer', () => renderEntityExplorer({ store })));
        return;
      }

      if (route.pathname === '/data') {
        try { console.info(cachedRouteMounts.has('/data') ? 'shell.renderRoute /data cache hit' : 'shell.renderRoute /data cache miss'); } catch (e) {}
        const mount = getCachedRouteMount('/data', () => timed('view.renderData', () => renderData({ store })));
        mount.hidden = false;
        mount.style.display = '';
        activateCachedRouteMount(mount);
        return;
      }

      if (route.pathname === '/study-manager') {
        transientMainHost.append(timed('view.renderStudyManager', () => renderStudyManager({ store, onNavigate, route })));
        return;
      }

      if (route.pathname === '/collections') {
        transientMainHost.append(timed('view.renderCollectionsManager', () => renderCollectionsManager({ store, onNavigate, route })));
        return;
      }

      if (route.pathname === '/manage-collections') {
        transientMainHost.append(timed('view.renderManageCollections', () => renderManageCollections({ store, onNavigate, route })));
        return;
      }

      // Inline fallback for missing routes (previously used placeholderView)
      const nf = document.createElement('div');
      nf.className = 'placeholder-root';
      const nh = document.createElement('h2');
      nh.textContent = 'Not Found';
      const np = document.createElement('div');
      np.className = 'hint';
      np.textContent = `No route for ${route.pathname}`;
      nf.append(nh, np);
      transientMainHost.append(nf);
    });
  }

  if (store?.collections && typeof store.collections.subscribe === 'function') {
    store.collections.subscribe((event = {}) => {
      const type = String(event?.type || '').trim();
      if (type && type !== 'collections.index.loaded' && type !== 'collections.loaded' && type !== 'collections.active.changed') {
        return;
      }
      try {
        const prevActiveId = cached.activeId;
        cached.collections = Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections() : cached.collections;
        cached.activeId = typeof store?.collections?.getActiveCollectionId === 'function' ? store.collections.getActiveCollectionId() : cached.activeId;
        cached.activeCollection = typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : cached.activeCollection;

        if (prevActiveId !== cached.activeId && activeRoutePathname) {
          swapStudySessionFor(activeRoutePathname);
        }
      } catch (err) {}
      renderHeader();
      try {
        shellFooter.renderFromStore({ activeCollection: cached.activeCollection, activeId: cached.activeId });
      } catch (e) {}
    });
  }

  return { el, renderHeader, renderRoute, getCurrentRoute };
}
