import { renderLanding } from './apps/landing.js';
import { renderFlashcards } from './apps/flashcards.js';
import { renderQaCards } from './apps/qaCards.js';
import { renderCollectionsManager } from './apps/collections.js';
import { renderData } from './apps/data.js';
import { renderPlaceholderTool } from './apps/placeholder.js';
import { renderKanjiStudyCard } from './apps/kanjiStudyCard.js';
import { createCollectionBrowserDropdown } from './components/collectionBrowser.js';
import { speak } from './utils/speech.js';
import { createDropdown } from './components/dropdown.js';

export function createAppShell({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'shell-root';

  function getVoiceState() {
    return (store && typeof store.getShellVoiceSettings === 'function') ? (store.getShellVoiceSettings() || {}) : {};
  }

  function setVoiceState(patch) {
    if (store && typeof store.setShellVoiceSettings === 'function') {
      store.setShellVoiceSettings(patch);
    }
  }

  // Global key handling: keep document-level listeners centralized here.
  // Components should subscribe to `ui:closeOverlays` when they are open.
  function onGlobalKeyDown(e) {
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

    const right = document.createElement('div');
    right.className = 'header-right';
    right.id = 'hdr-right';

    const collectionBadge = document.createElement('div');
    collectionBadge.className = 'badge';
    collectionBadge.id = 'hdr-collection-badge';

    const collections = store.getCollections();
    const activeId = store.getActiveCollectionId();

    const collectionSelect = createCollectionBrowserDropdown({
      store,
      className: 'align-right',
      onSelect: async (value) => {
        await store.setActiveCollectionId(value);
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
    const activeCollection = store.getCollections().find(c => c.key === store.getActiveCollectionId());
    const activeCategory = activeCollection?.metadata?.category || '';

    const links = [
      { href: '#/', label: 'Home' },
      { href: '#/flashcards', label: 'Flashcards' },
      { href: '#/qa-cards', label: 'QA Cards' },
      // only include Kanji when active collection category is japanese
      ...(activeCategory.toLowerCase() === 'japanese' ? [{ href: '#/kanji', label: 'Kanji Study' }] : []),
      { href: '#/data', label: 'Data' },
      { href: '#/collections', label: 'Collections' },
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
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    const path = raw.startsWith('/') ? raw : '/';
    const [pathname, search = ''] = path.split('?');
    return { pathname, query: new URLSearchParams(search) };
  }

  function renderRoute(route) {
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
      const active = store.getActiveCollection();
      const category = active?.metadata?.category || '';
      if (category.toLowerCase() !== 'japanese') {
        // redirect to home if the active collection isn't Japanese
        onNavigate('/');
        return;
      }

      main.append(renderKanjiStudyCard({ store }));
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
    renderHeader();
  });

  return { el, renderHeader, renderRoute, getCurrentRoute };
}