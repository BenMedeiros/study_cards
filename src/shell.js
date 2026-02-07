import { renderLanding } from './apps/landingView.js';
import { renderFlashcards } from './apps/flashcardsView.js';
import { renderQaCards } from './apps/qaCardsView.js';
import { renderCollectionsManager } from './apps/collectionsView.js';
import { parseHashRoute } from './utils/helpers.js';
import { renderData } from './apps/dataView.js';
import { renderPlaceholderTool } from './apps/placeholderView.js';
import { renderKanjiStudyCard } from './apps/kanjiStudyCardView.js';
import { renderGrammarStudyCard } from './apps/grammarStudyCardView.js';
import { renderEntityExplorer } from './apps/entityExplorerView.js';
import { createCollectionBrowserDropdown } from './components/collectionBrowser.js';
import { speak } from './utils/speech.js';
import { createDropdown } from './components/dropdown.js';
import * as idb from './utils/idb.js';

export function createAppShell({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'shell-root';

  function getVoiceState() {
    return (store?.shell && typeof store.shell.getVoiceSettings === 'function') ? (store.shell.getVoiceSettings() || {}) : {};
  }

  function setVoiceState(patch) {
    if (store?.shell && typeof store.shell.setVoiceSettings === 'function') {
      store.shell.setVoiceSettings(patch);
    }
  }

  // Track whether the user is actively using a keyboard vs pointer input.
  // Persist to shell state so other parts of the app can read it.
  let usingKeyboard = false;
  let __keyboardTimeout = null;
  const KEYBOARD_TIMEOUT_MS = 600 * 1000; // 600 seconds

  function clearKeyboardTimeout() {
    if (__keyboardTimeout) {
      clearTimeout(__keyboardTimeout);
      __keyboardTimeout = null;
    }
  }

  function setUsingKeyboardState(val) {
    const next = !!val;
    if (next === usingKeyboard) {
      // refresh timeout when already true
      if (next) {
        clearKeyboardTimeout();
        __keyboardTimeout = setTimeout(() => setUsingKeyboardState(false), KEYBOARD_TIMEOUT_MS);
      }
      return;
    }

    usingKeyboard = next;
    try {
      if (usingKeyboard) document.body.classList.add('using-keyboard');
      else document.body.classList.remove('using-keyboard');
    } catch (e) {}

    if (store?.shell && typeof store.shell.setState === 'function') {
      try {
        const payload = { usingKeyboard };
        if (usingKeyboard) payload.usingKeyboardLastSeen = new Date().toISOString();
        // Persist without notifying subscribers to avoid re-rendering the
        // header/menu while key handlers are active. scheduleFlush still
        // debounces actual persistence to disk.
        try { store.shell.setState(payload, { silent: true }); } catch (e) {}
      } catch (e) {}
    }

    clearKeyboardTimeout();
    if (usingKeyboard) {
      __keyboardTimeout = setTimeout(() => setUsingKeyboardState(false), KEYBOARD_TIMEOUT_MS);
    }
  }

  // Initialize from persisted shell state (respect 600s timeout if provided)
  try {
    const persisted = (store?.shell && typeof store.shell.getState === 'function') ? (store.shell.getState() || {}) : {};
    let initial = !!persisted.usingKeyboard;
    if (initial && persisted.usingKeyboardLastSeen) {
      const then = Date.parse(String(persisted.usingKeyboardLastSeen || '')) || 0;
      if ((Date.now() - then) > KEYBOARD_TIMEOUT_MS) initial = false;
    }
    setUsingKeyboardState(initial);
  } catch (e) {}

  // Simple heuristic: any keydown -> keyboard usage. We do NOT flip back to
  // pointer usage immediately on mouse/pointer events; instead `usingKeyboard`
  // is cleared only after the inactivity timeout (KEYBOARD_TIMEOUT_MS).
  window.addEventListener('keydown', () => setUsingKeyboardState(true), { capture: true, passive: true });

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

  header.append(headerInner);
  header.append(nav);
  el.append(header);
  el.append(main);

  // Local cache of store-derived values to avoid synchronous store reads
  // during header render. This keeps renderHeader fast and only updates
  // when the store emits changes.
  const cached = {
    collections: Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections() : [],
    activeId: typeof store?.collections?.getActiveCollectionId === 'function' ? store.collections.getActiveCollectionId() : null,
    activeCollection: typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : null,
    voiceState: getVoiceState(),
  };

  // Study time tracking (app x collection)
  let activeStudySession = null;
  let activeRoutePathname = null;

  function routePathToAppId(pathname) {
    const p = String(pathname || '').trim();
    if (!p) return null;
    if (p === '/') return 'home';
    if (p === '/flashcards') return 'flashcards';
    if (p === '/qa-cards') return 'qa-cards';
    if (p === '/kanji') return 'kanji';
    if (p === '/explorer') return 'explorer';
    if (p === '/data') return 'data';
    if (p === '/collections') return 'collections';
    return null;
  }

  function endActiveStudySession() {
    if (!activeStudySession) return;
    try {
      const endWall = Date.now();
      const durationMs = Math.max(0, endWall - activeStudySession.startWallMs);
      // Ignore ultra-short time slices to reduce noise.
      if (durationMs >= 1000) {
        store.studyTime.recordAppCollectionStudySession({
          appId: activeStudySession.appId,
          collectionId: activeStudySession.collectionId,
          startIso: activeStudySession.startIso,
          endIso: new Date(endWall).toISOString(),
          durationMs,
        });
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

    brand.append(brandTitle, brandSubtitle);

    // Right-click on brand opens a small command menu for dev actions
    let brandMenuEl = null;

    function closeBrandMenu() {
      if (brandMenuEl) {
        try { brandMenuEl.remove(); } catch (e) {}
        brandMenuEl = null;
      }
      document.removeEventListener('click', onBodyClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
    }

    function onBodyClick(e) {
      // Click outside removes menu
      if (!brandMenuEl) return;
      if (!brandMenuEl.contains(e.target)) closeBrandMenu();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') closeBrandMenu();
    }

    // If renderHeader runs while the menu is open, force-close any orphan.
    try {
      document.querySelectorAll('.brand-context-menu').forEach((el) => el.remove());
    } catch (e) {}
    closeBrandMenu();

    function openBrandMenu(x, y) {
      document.dispatchEvent(new CustomEvent('ui:closeOverlays'));
      // Prevent multiple instances: always replace any existing menu.
      closeBrandMenu();

      const menu = document.createElement('div');
      menu.className = 'brand-context-menu';
      menu.style.position = 'fixed';
      menu.style.left = `${Math.round(x)}px`;
      menu.style.top = `${Math.round(y)}px`;
      menu.style.background = 'var(--panel)';
      menu.style.border = '1px solid var(--border)';
      menu.style.borderRadius = '0.5rem';
      menu.style.padding = '0.25rem';
      menu.style.zIndex = '1400';
      menu.style.minWidth = '12rem';

      const addItem = (label, onClick) => {
        const it = document.createElement('div');
        it.className = 'brand-context-item';
        it.textContent = label;
        it.style.padding = '0.5rem 0.75rem';
        it.style.cursor = 'pointer';
        it.style.color = 'var(--text)';
        it.addEventListener('click', (ev) => { ev.stopPropagation(); try { onClick(); } catch (e) {} closeBrandMenu(); });
        it.addEventListener('mouseenter', () => { it.style.background = 'rgba(96,165,250,0.06)'; });
        it.addEventListener('mouseleave', () => { it.style.background = 'transparent'; });
        menu.appendChild(it);
      };

      addItem('Log Persisted Data (IDB)', () => {
        try {
          console.group('Persisted Data (IndexedDB)');
          // Dump kv + collections and log as raw objects (no pretty JSON)
          idb.idbDumpAll().then((dump) => {
            const kvRecs = dump?.kv || [];
            const collRecs = dump?.collections || [];
            console.log('idb.kv (all records):');
            for (const r of Array.isArray(kvRecs) ? kvRecs : []) {
              const key = r?.key ?? '(no key)';
              const val = r?.value ?? r;
              console.log(key, val);
            }
            console.log('idb.collections (array):', collRecs);
            console.groupEnd();
          }).catch((err) => { console.error('IDB read error', err); console.groupEnd(); });
        } catch (err) { console.error('Log Persisted Data failed', err); }
      });

      // Append menu and wire dismissal
      document.body.appendChild(menu);
      brandMenuEl = menu;
      // Use capture so we close even if inner code stops propagation.
      setTimeout(() => {
        document.addEventListener('click', onBodyClick, true);
        document.addEventListener('keydown', onKeyDown, true);
      }, 0);
    }

    brand.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBrandMenu(e.clientX, e.clientY);
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

    // Settings (voice)
    const settings = document.createElement('div');
    settings.className = 'shell-settings';
    settings.id = 'hdr-settings';

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'icon-button';
    settingsBtn.textContent = '⚙️';
    settingsBtn.title = 'Settings';
    settingsBtn.setAttribute('aria-haspopup', 'dialog');
    settingsBtn.setAttribute('aria-expanded', 'false');

    const settingsMenu = document.createElement('div');
    settingsMenu.className = 'shell-settings-menu';
    settingsMenu.setAttribute('role', 'dialog');
    settingsMenu.setAttribute('aria-label', 'Settings');

    const title = document.createElement('div');
    title.className = 'shell-settings-title';
    title.textContent = 'Settings';

    function makeRow(labelText, controlEl) {
      const row = document.createElement('div');
      row.className = 'kv';
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = labelText;
      const v = document.createElement('div');
      v.append(controlEl);
      row.append(k, v);
      return row;
    }

    const voiceState = getVoiceState();
    const engVoice = (voiceState.engVoice && typeof voiceState.engVoice === 'object') ? voiceState.engVoice : {};
    const jpVoice = (voiceState.jpVoice && typeof voiceState.jpVoice === 'object') ? voiceState.jpVoice : {};

    function getVoices() {
      return window.speechSynthesis?.getVoices?.() || [];
    }

    function makeVoiceItems({ langPrefix }) {
      const voices = getVoices();
      const filtered = voices.filter(v => String(v.lang || '').toLowerCase().startsWith(langPrefix));
      const sorted = [...filtered].sort((a, b) => {
        const aDef = a.default ? 0 : 1;
        const bDef = b.default ? 0 : 1;
        if (aDef !== bDef) return aDef - bDef;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });

      return [
        { value: '', label: 'Auto (browser default)' },
        ...sorted.map(v => ({
          value: v.voiceURI,
          label: `${v.name} (${v.lang})${v.default ? ' • default' : ''}`,
        }))
      ];
    }

    function buildVoiceSection({ titleText, langPrefix, stateKey, initial, testSampleText, testLang }) {
      const section = document.createElement('div');
      section.className = 'shell-settings-section';

      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'shell-settings-section-header';

      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'shell-settings-section-title';
      sectionTitle.textContent = titleText;

      const current = (initial && typeof initial === 'object') ? initial : {};

      // Voice dropdown (custom)
      const voiceMount = document.createElement('div');

      function renderVoiceDropdown() {
        const items = makeVoiceItems({ langPrefix });
        const selectedValue = typeof current.voiceURI === 'string' ? current.voiceURI : '';
        const dd = createDropdown({
          items,
          value: selectedValue,
          className: 'align-right',
          closeOverlaysOnOpen: false,
          onChange: (voiceURI) => {
            const uri = voiceURI || null;
            const found = uri ? getVoices().find(v => v.voiceURI === uri) : null;
            current.voiceURI = uri;
            current.voiceName = found?.name || null;
            setVoiceState({ [stateKey]: { voiceURI: current.voiceURI, voiceName: current.voiceName } });
          }
        });

        voiceMount.innerHTML = '';
        voiceMount.append(dd);
      }

      renderVoiceDropdown();

      function makeSlider({ min, max, step, value, onValue }) {
        const wrap = document.createElement('div');
        wrap.className = 'slider-row';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'slider';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(value);

        const val = document.createElement('span');
        val.className = 'slider-value';
        val.textContent = String(value);

        slider.addEventListener('input', () => {
          const v = Number(slider.value);
          val.textContent = slider.value;
          if (typeof onValue === 'function') onValue(v);
        });

        wrap.append(slider, val);
        return { wrap, slider, val };
      }

      const rateDefault = Number.isFinite(Number(current.rate)) ? Number(current.rate) : 0.9;
      const pitchDefault = Number.isFinite(Number(current.pitch)) ? Number(current.pitch) : 1;
      const volumeDefault = Number.isFinite(Number(current.volume)) ? Number(current.volume) : 1;

      const rateSlider = makeSlider({
        min: 0.5,
        max: 1.5,
        step: 0.1,
        value: rateDefault,
        onValue: (v) => {
          current.rate = v;
          setVoiceState({ [stateKey]: { rate: current.rate } });
        }
      });

      const pitchSlider = makeSlider({
        min: 0.1,
        max: 1.5,
        step: 0.1,
        value: pitchDefault,
        onValue: (v) => {
          current.pitch = v;
          setVoiceState({ [stateKey]: { pitch: current.pitch } });
        }
      });

      const volumeSlider = makeSlider({
        min: 0.1,
        max: 1,
        step: 0.1,
        value: volumeDefault,
        onValue: (v) => {
          current.volume = v;
          setVoiceState({ [stateKey]: { volume: current.volume } });
        }
      });

      const rows = document.createElement('div');
      rows.append(
        makeRow('Voice', voiceMount),
        makeRow('Rate', rateSlider.wrap),
        makeRow('Pitch', pitchSlider.wrap),
        makeRow('Volume', volumeSlider.wrap),
      );

      const sectionActions = document.createElement('div');
      sectionActions.className = 'shell-settings-actions';

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'button';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', () => {
        speak(testSampleText, testLang);
      });

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'button';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', () => {
        current.voiceURI = null;
        current.voiceName = null;
        current.rate = 0.9;
        current.pitch = 1;
        current.volume = 1;
        setVoiceState({
          [stateKey]: { voiceURI: null, voiceName: null, rate: 0.9, pitch: 1, volume: 1 },
        });

        rateSlider.slider.value = '0.9';
        rateSlider.val.textContent = '0.9';
        pitchSlider.slider.value = '1';
        pitchSlider.val.textContent = '1';
        volumeSlider.slider.value = '1';
        volumeSlider.val.textContent = '1';
        renderVoiceDropdown();
      });

      sectionActions.append(testBtn, resetBtn);

      sectionHeader.append(sectionTitle, sectionActions);

      // When voices load asynchronously, re-render the dropdown list.
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
          renderVoiceDropdown();
        };
      }

      section.append(sectionHeader, rows);
      return {
        section,
        renderVoiceDropdown,
        current,
        rateInput: rateSlider.slider,
        pitchInput: pitchSlider.slider,
        volumeInput: volumeSlider.slider,
      };
    }

    const engSection = buildVoiceSection({
      titleText: 'English voice',
      langPrefix: 'en',
      stateKey: 'engVoice',
      initial: engVoice,
      testSampleText: 'Hello',
      testLang: 'en-US',
    });

    const jpSection = buildVoiceSection({
      titleText: 'Japanese voice',
      langPrefix: 'ja',
      stateKey: 'jpVoice',
      initial: jpVoice,
      testSampleText: 'こんにちは',
      testLang: 'ja-JP',
    });

    settingsMenu.append(title, engSection.section, jpSection.section);

    function isSettingsOpen() {
      return settings.classList.contains('open');
    }

    function onCloseOverlaysEvent() {
      if (isSettingsOpen()) closeSettings({ focusButton: true });
    }

    function openSettings() {
      settings.classList.add('open');
      settingsBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);
      // Ensure dropdown lists are refreshed when opening.
      engSection.renderVoiceDropdown();
      jpSection.renderVoiceDropdown();
    }

    function closeSettings({ focusButton = false } = {}) {
      settings.classList.remove('open');
      settingsBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent);
      if (focusButton) settingsBtn.focus();
    }

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close other overlays (e.g., dropdowns) before opening.
      document.dispatchEvent(new CustomEvent('ui:closeOverlays'));

      if (!isSettingsOpen()) openSettings();
      else closeSettings();
    });

    const closeOnClickOutside = (e) => {
      if (!settings.contains(e.target) && !settingsMenu.contains(e.target)) {
        closeSettings();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeOnClickOutside);
    }, 0);

    settings.append(settingsBtn, settingsMenu);

    right.append(collectionBadge, settings);
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
    // Show the Kanji Study link only when the active collection is Japanese
    const activeCollection = cached.activeCollection || collections.find(c => c.key === activeId);
    const activeCategory = activeCollection?.metadata?.category || '';

    const links = [
      { href: '#/', label: 'Home' },
      { href: '#/flashcards', label: 'Flashcards' },
      { href: '#/qa-cards', label: 'QA Cards' },
      // only include Kanji when active collection category is japanese
      ...(activeCategory.toLowerCase() === 'japanese' ? [{ href: '#/kanji', label: 'Kanji Study' }] : []),
      ...(String(activeCategory || '').toLowerCase().startsWith('japanese.grammar') ? [{ href: '#/grammar', label: 'Grammar Study' }] : []),
      { href: '#/data', label: 'Data' },
      { href: '#/collections', label: 'Collections' },
      { href: '#/explorer', label: 'Explorer' },
    ];

    const currentPath = getCurrentRoute().pathname;
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

  function getCurrentRoute() {
    return parseHashRoute(location.hash);
  }

  function renderRoute(route) {
    // Study-time bookkeeping: close previous view session and start the next.
    try {
      const nextPath = String(route?.pathname || '/');
      if (activeRoutePathname !== nextPath) {
        swapStudySessionFor(nextPath);
        activeRoutePathname = nextPath;
      }
    } catch (e) {}

    renderHeader();
    main.innerHTML = '';

    if (route.pathname === '/') {
      main.append(renderLanding({ store, onNavigate }));
      return;
    }

    if (route.pathname === '/flashcards') {
      main.append(renderFlashcards({ store }));
      return;
    }

    if (route.pathname === '/qa-cards') {
      main.append(renderQaCards({ store, onNavigate }));
      return;
    }
    // Crossword and Word Search routes removed

    if (route.pathname === '/kanji') {
      const active = store.collections.getActiveCollection();
      const category = active?.metadata?.category || '';
      if (category.toLowerCase() !== 'japanese') {
        // redirect to home if the active collection isn't Japanese
        onNavigate('/');
        return;
      }

      main.append(renderKanjiStudyCard({ store }));
      return;
    }


    if (route.pathname === '/grammar') {
      const active = store.collections.getActiveCollection();
      const category = String(active?.metadata?.category || '');
      if (!category.toLowerCase().startsWith('japanese.grammar')) {
        onNavigate('/');
        return;
      }
      main.append(renderGrammarStudyCard({ store }));
      return;
    }

    if (route.pathname === '/explorer') {
      main.append(renderEntityExplorer({ store }));
      return;
    }

    if (route.pathname === '/data') {
      main.append(renderData({ store }));
      return;
    }

    if (route.pathname === '/collections') {
      main.append(renderCollectionsManager({ store, onNavigate, route }));
      return;
    }

    main.append(renderPlaceholderTool({ title: 'Not Found', hint: `No route for ${route.pathname}` }));
  }

  store.subscribe(() => {
    // Refresh cached values then re-render header
    try {
      const prevActiveId = cached.activeId;
      cached.collections = Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections() : cached.collections;
      cached.activeId = typeof store?.collections?.getActiveCollectionId === 'function' ? store.collections.getActiveCollectionId() : cached.activeId;
      cached.activeCollection = typeof store?.collections?.getActiveCollection === 'function' ? store.collections.getActiveCollection() : cached.activeCollection;
      cached.voiceState = getVoiceState();

      // If the active collection changed while staying in the same view,
      // split the study session so time is attributed to the correct collection.
      if (prevActiveId !== cached.activeId && activeRoutePathname) {
        swapStudySessionFor(activeRoutePathname);
      }
    } catch (err) {}
    renderHeader();
  });

  return { el, renderHeader, renderRoute, getCurrentRoute };
}