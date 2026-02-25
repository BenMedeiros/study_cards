import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';
import { createAutoplayControls } from '../components/autoplay.js';
import { createSpeakerButton } from '../components/ui.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';
import { CARD_REGISTRY } from '../cards/index.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  // Register as a settings consumer for persisted app settings.
  try {
    store?.settings?.registerConsumer?.({
      consumerId: 'kanjiStudyCardView',
      settings: [
        'apps.kanjiStudy.defaultViewMode',
        'apps.kanjiStudy.autoplaySequence',
      ],
    });
  } catch (e) {}
  try {
    const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      try {
        const api = cardApis[c.key];
        if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
      } catch (e) {}
    }
  } catch (e) {}

  function getCurrentKanjiKey() {
    const entry = entries && entries.length ? entries[index] : null;
    return String(store.collections.getEntryStudyKey(entry) || '').trim();
  }

  function getCurrentCollectionKey() {
    const active = store?.collections?.getActiveCollection?.();
    return String(active?.key || '').trim();
  }

  const progressTracker = store?.kanjiProgress?.createCardProgressTracker?.({
    appId: 'kanjiStudyCardView',
    getCollectionKey: () => getCurrentCollectionKey(),
    getEntryKey: () => getCurrentKanjiKey(),
  });

  // Simple state
  let entries = [];
  let index = 0;
  let viewMode = 'kanji-only'; // current card view
  let defaultViewMode = 'kanji-only'; // controls what is shown when changing cards
  let shownAt = nowMs();
  let isShuffled = false;
  
  let isAutoPlaying = false;
  let autoplayConfig = null; // will be defaulted from savedUI or component defaults
  let uiStateRestored = false; // ensure saved UI (index/order) is applied only once
  let originalEntries = [];
  let currentOrder = null; // array of indices mapping to originalEntries
  let orderHashInt = null; // deterministic seed for shuffle (preferred persisted form)
  let viewIndices = []; // indices into originalEntries for the current rendered entries array
  let relatedHydratedCollectionKey = null;
  let relatedHydrationPromise = null;

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  function getPrimaryKanjiValue(entry) {
    return getFieldValue(entry, ['kanji', 'character', 'text']) || '';
  }

  // Persist minimal UI state into per-collection state (no legacy fallbacks)
  function saveUIState() {
    try {
      const active = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
      const key = active && active.key ? active.key : null;
      if (!key) return;
      if (typeof store?.collections?.saveCollectionState === 'function') {
        // persist collection fundamentals at top-level
        store.collections.saveCollectionState(key, {
          isShuffled: !!isShuffled,
          order_hash_int: (typeof orderHashInt === 'number') ? orderHashInt : null,
        });
        // persist app-scoped index and dropdown selections under `kanjiStudyCardView`
        try {
          const sliceOrAll = (sel, items) => {
            try {
              if (sel === 'all') return 'all';
              const arr = Array.isArray(sel) ? sel.slice() : [];
              const allVals = Array.isArray(items) ? items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
              const set = new Set(arr);
              const isAll = allVals.length > 0 && allVals.length === arr.length && allVals.every(v => set.has(v));
              return isAll ? 'all' : arr;
            } catch (e) { return Array.isArray(sel) ? sel.slice() : []; }
          };

          // Persist per-card field selections as an object keyed by card key.
          const cardFieldsOut = {};
          try {
            for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
              try {
                const items = Array.isArray(c.toggleFields) ? c.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
                const sel = cardFieldSelections[c.key];
                if (sel === 'all') cardFieldsOut[c.key] = 'all';
                else if (Array.isArray(sel)) cardFieldsOut[c.key] = sel.slice();
                else cardFieldsOut[c.key] = items.slice();
              } catch (e) {}
            }
          } catch (e) {}

          store.collections.saveCollectionState(key, {
            kanjiStudyCardView: {
              currentIndex: index,
              cardFields: cardFieldsOut,
              displayCards: sliceOrAll(displayCardSelection, displayCardItems),
            }
          });
        } catch (e) {
          // fallback: save index in app-scoped bucket as before
          try { store.collections.saveCollectionState(key, { currentIndex: index }, { app: 'kanjiStudyCardView' }); } catch (e2) {}
        }
            // persist app-global default view mode under apps.kanjiStudy
            try {
              if (store?.settings && typeof store.settings.set === 'function') {
                store.settings.set('apps.kanjiStudy.defaultViewMode', defaultViewMode, { consumerId: 'kanjiStudyCardView' });
              }
            } catch (e) {}
      }
    } catch (e) {
      // ignore
    }
  }

  // Root UI pieces
  const headerTools = createViewHeaderTools();
  // Instantiate available cards from the registry so views can be generic.
  const cardApis = {};
  try {
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      try {
        // Pass a common shape; factories may ignore unknown props.
        // Provide handlers for the related card so we don't need to recreate it later.
        if (c.key === 'related') {
          cardApis[c.key] = c.factory({ entry: null, indexText: '', handlers: {
            onSpeak: (text) => {
              if (!text) return;
              const lang = getLanguageCode('reading');
              try { speak(text, lang); } catch (e) {}
            },
            onNext: (ci) => {},
            onPrev: (ci) => {},
          }});
        } else {
          cardApis[c.key] = c.factory({ entry: null, indexText: '' });
        }
      } catch (e) {
        cardApis[c.key] = null;
      }
    }
  } catch (e) {}

  const fullCardApi = cardApis['full'] || null;
  // Track whether we mounted header/footer into the shell main container
  let __mountedHeaderInShell = false;
  let __mountedFooterInShell = false;

  // header groups are created via `headerTools.addElement`

  // shuffle control will be added later once handler is defined

  // --- Header dropdowns to control card field visibility ---
  // Use registry-driven per-card field selections and dropdowns.
  let cardFieldSelections = {}; // { [cardKey]: Array<string> | 'all' }
  let displayCardSelection = ['main', 'related'];
  try {
    const res = store?.collections?.getActiveCollectionView ? store.collections.getActiveCollectionView({ windowSize: 0 }) : null;
    const collState = res?.collState || {};
    const appState = collState?.kanjiStudyCardView || {};
    // Load legacy or new per-card saved state.
    // Initialize cardFieldSelections with registry defaults (all non-action fields)
    try {
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
        const items = Array.isArray(c.toggleFields) ? c.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
        cardFieldSelections[c.key] = items.slice();
      }
    } catch (e) {}

    if (appState && appState.cardFields) {
      // If saved as an object mapping, copy entries
      if (typeof appState.cardFields === 'object' && !Array.isArray(appState.cardFields)) {
        for (const k of Object.keys(appState.cardFields || {})) {
          try { cardFieldSelections[k] = appState.cardFields[k]; } catch (e) {}
        }
      } else if (Array.isArray(appState.cardFields)) {
        // legacy: array -> treat as main card selection
        cardFieldSelections['main'] = appState.cardFields.slice();
      } else if (typeof appState.cardFields === 'string' && appState.cardFields === 'all') {
        for (const k of Object.keys(cardFieldSelections)) cardFieldSelections[k] = 'all';
      }
    }
    // support legacy relatedFields/fullFields keys
    if (Array.isArray(appState.relatedFields)) cardFieldSelections['related'] = appState.relatedFields.slice();
    else if (typeof appState.relatedFields === 'string' && appState.relatedFields === 'all') cardFieldSelections['related'] = 'all';
    if (Array.isArray(appState.fullFields)) cardFieldSelections['full'] = appState.fullFields.slice();
    else if (typeof appState.fullFields === 'string' && appState.fullFields === 'all') cardFieldSelections['full'] = 'all';
    if (Array.isArray(appState.displayCards)) displayCardSelection = appState.displayCards.slice();
    else if (typeof appState.displayCards === 'string' && appState.displayCards === 'all') displayCardSelection = 'all';
  } catch (e) {}

  // Create per-card toggle dropdowns based on CARD_REGISTRY entries.
  const cardFieldControls = {};
  try {
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      try {
        const items = Array.isArray(c.toggleFields) ? c.toggleFields.slice() : [];
        const key = `${c.key}Fields`;
        const values = (function() {
          const sel = cardFieldSelections[c.key];
          if (sel === 'all') return items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
          if (Array.isArray(sel)) return sel.slice();
          // default: all non-action values
          return items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
        })();

        const rec = headerTools.addElement({
          type: 'dropdown', key, items, multi: true,
          values, commitOnClose: true,
          onChange: (vals) => {
            const chosen = (typeof vals === 'string' && vals === 'all')
              ? items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''))
              : (Array.isArray(vals) ? vals.slice() : []);
            // apply to card API: prefer setFieldsVisible(map), fallback to individual setters
            const api = cardApis[c.key];
            const set = new Set(chosen);
            try {
              if (api && typeof api.setFieldsVisible === 'function') {
                const map = {};
                for (const it of items) if (String(it?.kind || '') !== 'action') map[String(it.value || '')] = set.has(String(it.value || ''));
                try { api.setFieldsVisible(map); } catch (e) {}
              } else {
                for (const it of items) {
                  const v = String(it?.value || '');
                  const cap = v.charAt(0).toUpperCase() + v.slice(1);
                  const fnName = `set${cap}Visible`;
                  try {
                    if (api && typeof api[fnName] === 'function') api[fnName](set.has(v));
                    else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(v, set.has(v));
                  } catch (e) {}
                }
              }
            } catch (e) {}
            try { cardFieldSelections[c.key] = chosen; } catch (e) {}
            try { saveUIState(); } catch (e) {}
          },
          className: 'data-expansion-dropdown',
          caption: `${c.label}.visibility`
        });
        cardFieldControls[c.key] = rec && rec.control ? rec.control : null;
      } catch (e) {}
    }
  } catch (e) {}

  // No legacy UI load: visual defaults used; autoplay/defaults remain runtime-only

  // Footer controls: describe actions and let footer build UI + register shortcuts
  function getFooterButton(key) {
    if (!footerControls) return null;
    if (typeof footerControls.getButton === 'function') return footerControls.getButton(key);
    return (footerControls.buttons && footerControls.buttons[key]) || null;
  }

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', actionKey: 'prev', fnName: 'showPrev', action: () => showPrev() },
    // Note: removed stateful 'reveal' control (reveal/hide) as it caused issues.
    { key: 'sound', icon: '🔊', text: 'Sound', caption: 'Space', shortcut: ' ', actionKey: 'sound', fnName: 'speakCurrent', action: () => speakCurrent() },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', actionKey: 'learned', fnName: 'toggleKanjiLearned', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiLearned === 'function') {
        store.kanjiProgress.toggleKanjiLearned(v, { collectionKey: getCurrentCollectionKey() });
        updateMarkButtons();
        try {
          const view = store.collections.getActiveCollectionView({ windowSize: 10 })?.view;
          if (view?.skipLearned) {
            refreshEntriesFromStore();
            index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
            render();
            saveUIState();
          }
        } catch (e) {}
      }
    } },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', actionKey: 'practice', fnName: 'toggleKanjiFocus', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiFocus === 'function') {
        store.kanjiProgress.toggleKanjiFocus(v, { collectionKey: getCurrentCollectionKey() });
        updateMarkButtons();
        try {
          const view = store.collections.getActiveCollectionView({ windowSize: 10 })?.view;
          if (view?.focusOnly) {
            refreshEntriesFromStore();
            index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
            render();
            saveUIState();
          }
        } catch (e) {}
      }
    } },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', actionKey: 'next', fnName: 'showNext', action: () => showNext() },
  ];

  const footerControls = createViewFooterControls(footerDesc, { appId: 'kanjiStudy' });
  // Unified speak helper: prefer reading/word/kana, fall back to kanji/character/text
  function speakEntry(entry) {
    if (!entry) return;
    const primary = getFieldValue(entry, ['reading', 'kana', 'word', 'text']);
    const fallback = getFieldValue(entry, ['kanji', 'character', 'text']);
    const speakText = primary || fallback || '';
    if (!speakText) return;
    const fieldKey = primary ? 'reading' : 'kanji';
    const lang = getLanguageCode(fieldKey);
    speak(speakText, lang);
  }
  // Auto-speak setting removed from UI.

  // Autoplay controls: create grouped play/gear control and hook into play loop
  // Load app-specific autoplay config (saved under apps.kanjiStudy.*)
  try {
    if (store?.settings && typeof store.settings.get === 'function') {
      const seq = store.settings.get('apps.kanjiStudy.autoplaySequence', { consumerId: 'kanjiStudyCardView' });
      if (Array.isArray(seq)) autoplayConfig = seq.slice();

      const dvm = store.settings.get('apps.kanjiStudy.defaultViewMode', { consumerId: 'kanjiStudyCardView' });
      if (typeof dvm === 'string') {
        defaultViewMode = dvm;
      }

      // Ensure viewMode reflects restored default
      try { viewMode = defaultViewMode; } catch (e) {}
    }
  } catch (e) {}

  // Ensure a sensible default sequence exists and persist it app-scoped if missing
  const DEFAULT_AUTOPLAY_SEQUENCE = [
    { action: 'next' },
    { action: 'wait', ms: 1000 },
    { action: 'sound' },
    { action: 'wait', ms: 1000 }
  ];

  if (!Array.isArray(autoplayConfig) || autoplayConfig.length === 0) {
    autoplayConfig = DEFAULT_AUTOPLAY_SEQUENCE.slice();
    try {
      store?.settings?.set?.('apps.kanjiStudy.autoplaySequence', autoplayConfig, { consumerId: 'kanjiStudyCardView' });
    } catch (e) {}
  }

  // Autoplay play/pause state must be toggleable from both UI and external
  // media keys (Bluetooth play/pause). Keep UI + MediaSession in sync.
  let autoplayControlsEl = null;
  // Unique per mount: avoids a stale instance unregistering the active one.
  const MEDIA_HANDLER_ID = `kanjiStudy-${Math.random().toString(36).slice(2, 10)}`;

  function notifyShellMediaState() {
    try {
      document.dispatchEvent(new CustomEvent('app:mediaStateChanged', { detail: { id: MEDIA_HANDLER_ID } }));
    } catch (e) {}
  }

  function setAutoplayPlaying(next, { source = 'internal' } = {}) {
    const want = !!next;
    if (want) {
      // Mirror the autoplay UI's behavior: if no sequence exists, do not start.
      if (!Array.isArray(autoplayConfig) || autoplayConfig.length === 0) return;
    }
    if (want === isAutoPlaying) {
      // still keep MediaSession/UI consistent
      try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(want); } catch (e) {}
      notifyShellMediaState();
      return;
    }

    isAutoPlaying = want;
    if (!isAutoPlaying) {
      _autoplayAbort = true;
    }

    try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(isAutoPlaying); } catch (e) {}
    notifyShellMediaState();
    saveUIState();
    if (isAutoPlaying) startAutoplay();
  }

  autoplayControlsEl = createAutoplayControls({
    sequence: Array.isArray(autoplayConfig) ? autoplayConfig : [],
    isPlaying: !!isAutoPlaying,
    onTogglePlay: (play) => {
      // UI already toggled its own icon; we centralize state changes here so
      // MediaSession + external controls stay consistent.
      setAutoplayPlaying(!!play, { source: 'ui' });
    },
    onSequenceChange: (seq) => {
      autoplayConfig = Array.isArray(seq) ? seq.slice() : [];
      try {
        store?.settings?.set?.('apps.kanjiStudy.autoplaySequence', autoplayConfig, { consumerId: 'kanjiStudyCardView' });
      } catch (e) {}
      saveUIState();
    }
  });
  // place autoplay controls at start of headerTools, grouped visually
  // place autoplay controls at start of headerTools
  headerTools.prepend(autoplayControlsEl);

  // Create main/related/full card APIs. Prefer registry instances where available;
  // recreate related card with handlers so it can call back into this view.
  const mainCardApi = cardApis['main'] || (function() {
    try {
      const regMain = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'main') : null);
      if (regMain && typeof regMain.factory === 'function') return regMain.factory({ entry: null, indexText: '' });
    } catch (e) {}
    return null;
  })();
  const relatedFactory = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'related') : null);
  let relatedCardApi = (cardApis && cardApis['related']) ? cardApis['related'] : null;

  // full card dropdown is handled via the registry-driven loop above

  // Dropdown to choose which cards are displayed
  // Build display card items from the card registry so new cards appear automatically.
  const displayCardItems = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : []).map(c => ({ value: c.key, left: c.label }));

  const _displayCardsRec = headerTools.addElement({
    type: 'dropdown', key: 'displayCards', items: displayCardItems, multi: true,
    values: Array.isArray(displayCardSelection)
      ? displayCardSelection.slice()
      : (displayCardSelection === 'all' ? displayCardItems.map(it => String(it?.value || '')) : ['main', 'related']),
    commitOnClose: true,
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all')
        ? displayCardItems.map(it => String(it?.value || ''))
        : (Array.isArray(vals) ? vals.slice() : []);
      const set = new Set(chosen);
      try {
        for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
          try {
            const api = cardApis[c.key];
            if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
          } catch (e) {}
        }
      } catch (e) {}
      try { displayCardSelection = chosen; } catch (e) {}
      try { saveUIState(); } catch (e) {}
    },
    className: 'data-expansion-dropdown',
    caption: 'visible.cards'
  });


  // expose the same variable names used elsewhere so render() logic needs minimal changes
  const card = mainCardApi.el; // root .card kanji-card
  const wrapper = card.querySelector('.kanji-card-wrapper');
  // collect registry-ordered elements for appending into the view root
  const registryCardEls = [];
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    try {
      const api = cardApis[c.key];
      if (api && api.el) registryCardEls.push(api.el);
    } catch (e) {}
  }

  // Apply initial visibility/mute defaults to cards to match dropdown defaults
  try {
    if (displayCardSelection === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      try {
        const items = Array.isArray(c.toggleFields) ? c.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
        const sel = cardFieldSelections[c.key];
        const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : items.slice());
        const api = cardApis[c.key];
        const set = new Set(values);
        if (api && typeof api.setFieldsVisible === 'function') {
          const map = {};
          for (const v of items) map[v] = set.has(v);
          try { api.setFieldsVisible(map); } catch (e) {}
        } else {
          for (const v of items) {
            const cap = String(v).charAt(0).toUpperCase() + String(v).slice(1);
            const fnName = `set${cap}Visible`;
            try {
              if (api && typeof api[fnName] === 'function') api[fnName](set.has(v));
              else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(v, set.has(v));
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  try {
    // ensure related card toggles are applied even if no registry items matched earlier
    const regRelated = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'related') : null);
    if (regRelated) {
      try {
        const api = cardApis['related'];
        const sel = cardFieldSelections['related'];
        const items = Array.isArray(regRelated.toggleFields) ? regRelated.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
        const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : items.slice());
        const set = new Set(values);
        try { if (api && typeof api.setEnglishVisible === 'function') api.setEnglishVisible(set.has('english')); } catch (e) {}
        try { if (api && typeof api.setJapaneseVisible === 'function') api.setJapaneseVisible(set.has('japanese')); } catch (e) {}
        try { if (api && typeof api.setNotesVisible === 'function') api.setNotesVisible(set.has('notes')); } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}

  // render a single card body
  function renderCard(body, entry) {
    body.innerHTML = '';

    // main kanji centered
    const kanjiWrap = document.createElement('div');
    kanjiWrap.className = 'kanji-main-wrap';
    const kanjiMain = document.createElement('div');
    kanjiMain.className = 'kanji-main';
    const text = getFieldValue(entry, ['kanji', 'character', 'text']) || '';
    kanjiMain.textContent = text;
    // Auto-scale font size based on text length (3 tiers)
    const length = text.length;
    let fontSize = 5; // base size in rem
    if (length > 6) fontSize = 3.5;
    else if(length > 5) fontSize = 3.75;
    else if (length > 4) fontSize = 4;
    kanjiMain.style.fontSize = `${fontSize}rem`;
    kanjiWrap.append(kanjiMain);

    // top-left type
    const topLeft = document.createElement('div');
    topLeft.className = 'kanji-top-left';
    topLeft.textContent = getFieldValue(entry, ['type']) || '';

    // bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'kanji-bottom-left';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'kanji-bottom-right';
    bottomRight.textContent = getFieldValue(entry, ['meaning', 'definition', 'gloss']) || '';

    body.append(topLeft, kanjiWrap, bottomLeft, bottomRight);
  }

  function refreshEntriesFromStore() {
    const res = store.collections.getActiveCollectionView({ windowSize: 10 });
    const active = res?.collection || null;
    const collState = res?.collState || {};
    const view = res?.view || {};

    originalEntries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    entries = Array.isArray(view?.entries) ? view.entries : [];
    viewIndices = Array.isArray(view?.indices) ? view.indices : [];
    isShuffled = !!view?.isShuffled;
    orderHashInt = (typeof view?.order_hash_int === 'number') ? view.order_hash_int : null;
    currentOrder = null;
    // If a saved index exists in collection state, restore it once on initial load.
    // Only use the app-scoped `kanjiStudyCardView.currentIndex` (no legacy fallbacks).
    if (!uiStateRestored && collState) {
      const savedIndex = (collState && collState.kanjiStudyCardView && typeof collState.kanjiStudyCardView.currentIndex === 'number')
        ? collState.kanjiStudyCardView.currentIndex
        : undefined;
      if (typeof savedIndex === 'number') {
        index = savedIndex;
      }
      try {
        const appState = collState.kanjiStudyCardView || {};
        // Apply saved per-card field selections (supports new object format and legacy values)
        try {
          if (appState.cardFields && typeof appState.cardFields === 'object' && !Array.isArray(appState.cardFields)) {
            for (const k of Object.keys(appState.cardFields || {})) {
              try {
                const sel = appState.cardFields[k];
                const reg = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(x => x.key === k) : null);
                const items = (reg && Array.isArray(reg.toggleFields)) ? reg.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
                const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : []);
                const api = cardApis[k];
                const set = new Set(values);
                if (api && typeof api.setFieldsVisible === 'function') {
                  const map = {};
                  for (const val of items) map[val] = set.has(val);
                  try { api.setFieldsVisible(map); } catch (e) {}
                } else {
                  for (const val of items) {
                    const cap = String(val).charAt(0).toUpperCase() + String(val).slice(1);
                    const fnName = `set${cap}Visible`;
                    try {
                      if (api && typeof api[fnName] === 'function') api[fnName](set.has(val));
                      else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(val, set.has(val));
                    } catch (e) {}
                  }
                }
                try { cardFieldSelections[k] = sel === 'all' ? 'all' : (Array.isArray(sel) ? sel.slice() : values.slice()); } catch (e) {}
              } catch (e) {}
            }
          } else if (Array.isArray(appState.cardFields)) {
            // legacy: treat as main card selection
            try { cardFieldSelections['main'] = appState.cardFields.slice(); } catch (e) {}
            try { if (mainCardApi && typeof mainCardApi.setFieldsVisible === 'function') {
              const regMain = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(x => x.key === 'main') : null);
              const items = (regMain && Array.isArray(regMain.toggleFields)) ? regMain.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
              const map = {};
              for (const val of items) map[val] = Array.isArray(appState.cardFields) ? appState.cardFields.includes(val) : false;
              try { mainCardApi.setFieldsVisible(map); } catch (e) {}
            } } catch (e) {}
          } else if (typeof appState.cardFields === 'string' && appState.cardFields === 'all') {
            for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) try { cardFieldSelections[c.key] = 'all'; } catch (e) {}
          }
          // legacy singular keys
          if (Array.isArray(appState.relatedFields)) try { cardFieldSelections['related'] = appState.relatedFields.slice(); } catch (e) {}
          if (typeof appState.relatedFields === 'string' && appState.relatedFields === 'all') try { cardFieldSelections['related'] = 'all'; } catch (e) {}
          if (Array.isArray(appState.fullFields)) try { cardFieldSelections['full'] = appState.fullFields.slice(); } catch (e) {}
          if (typeof appState.fullFields === 'string' && appState.fullFields === 'all') try { cardFieldSelections['full'] = 'all'; } catch (e) {}
        } catch (e) {}
        if (Array.isArray(appState.displayCards)) {
          displayCardSelection = appState.displayCards.slice();
          const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
          try {
            for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
              try {
                const api = cardApis[c.key];
                if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
      uiStateRestored = true;
    }
    const prevIndex = index;
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
    if (index !== prevIndex) {/* index clamped */}

    // Ensure full-detail card reflects the currently selected entry after entries refresh
    try {
      const curEntry = entries && entries.length ? entries[index] : null;
      if (fullCardApi && typeof fullCardApi.setEntry === 'function') fullCardApi.setEntry(curEntry);
    } catch (e) {}

    try {
      const activeKey = String(active?.key || '').trim();
      if (!activeKey) {
        relatedHydratedCollectionKey = null;
        relatedHydrationPromise = null;
        return;
      }
      if (relatedHydratedCollectionKey !== activeKey && !relatedHydrationPromise && typeof store?.collections?.getCollectionEntriesWithRelated === 'function') {
        relatedHydrationPromise = Promise.resolve()
          .then(() => store.collections.getCollectionEntriesWithRelated(activeKey, { sample: 0 }))
          .then(() => {
            const currentActive = store?.collections?.getActiveCollection?.();
            if (String(currentActive?.key || '').trim() !== activeKey) return;
            relatedHydratedCollectionKey = activeKey;
            refreshEntriesFromStore();
            render();
          })
          .catch(() => {})
          .finally(() => {
            relatedHydrationPromise = null;
          });
      }
    } catch (e) {}
  }

  // Navigation / control helpers to avoid duplicated logic
  function goToIndex(newIndex) {
    if (newIndex < 0 || newIndex >= entries.length) return;
    // finalize time for previous card before switching
    try { progressTracker?.flush?.({ immediate: false }); } catch (e) {}
    const prev = index;
    index = newIndex;
    shownAt = nowMs();
    viewMode = defaultViewMode;
    // index updated
    render();
    // auto-speak removed from UI; preserve speak on navigation via explicit calls elsewhere
    // persist current index so it's restored when navigating back
    saveUIState();
  }

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }
  function revealFull() { viewMode = 'full'; render(); }
  function showKanjiOnly() { viewMode = 'kanji-only'; render(); }
  function toggleReveal() {
    if (viewMode === 'full') {
      showKanjiOnly();
    } else {
      revealFull();
    }
  }
  function speakCurrent() { if (entries[index]) speakEntry(entries[index]); }

  function updateMarkButtons() {
    const learnedBtn = getFooterButton('learned');
    const practiceBtn = getFooterButton('practice');
    if (!learnedBtn || !practiceBtn) return;
    const entry = entries[index];
    const v = store.collections.getEntryStudyKey(entry);
    const collectionKey = getCurrentCollectionKey();
    const isLearned = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiLearned === 'function' && v) ? store.kanjiProgress.isKanjiLearned(v, { collectionKey }) : false;
    const isFocus = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiFocus === 'function' && v) ? store.kanjiProgress.isKanjiFocus(v, { collectionKey }) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  

  function updateRevealButton() {
    // Reveal/hide state removed — no-op to avoid errors from older calls.
    return;
  }

  function shuffleEntries() {
    const n = originalEntries.length;
    if (n === 0) return;

    try { progressTracker?.flush?.({ immediate: false }); } catch (e) {}

    // generate a 32-bit seed (prefer crypto RNG)
    let seed;
    try {
      const a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      seed = a[0] >>> 0;
    } catch (e) {
      seed = Math.floor(Math.random() * 0x100000000) >>> 0;
    }

    orderHashInt = seed;
    // persist per-collection state via centralized action
    const active = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
    const key = active && active.key ? active.key : null;
    if (key) {
      try {
        store.collections.shuffleCollection(key);
      } catch (e) {
        // ignore
      }
    }

    // rebuild view from saved collection state
    refreshEntriesFromStore();
    index = 0;
    viewMode = defaultViewMode;
    isShuffled = true;
    try { const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', 'true'); } catch (e) {}
    render();
  }

  // small sleep helper
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // PRNG and permutation now in collectionsManager

  // Autoplay loop: performs configured sequence for each card
  let _autoplayAbort = false;
  async function startAutoplay() {
    _autoplayAbort = false;
    // ensure we don't spawn multiple loops
    if (!isAutoPlaying) return;
    // default sequence if none configured
    const defaultSequence = [
      { action: 'next' },
      { action: 'wait', ms: 2000 },
      { action: 'sound' },
      { action: 'wait', ms: 1000 }
    ];

    while (isAutoPlaying && !_autoplayAbort) {
      const seq = Array.isArray(autoplayConfig) && autoplayConfig.length ? autoplayConfig.slice() : defaultSequence.slice();

      for (const step of seq) {
        if (!isAutoPlaying || _autoplayAbort) break;
        if (step.action === 'next') {
          // advance and wrap to start when reaching end
          if (index >= entries.length - 1) {
            goToIndex(0);
          } else {
            showNext();
          }
        } else if (step.action === 'prev') {
          showPrev();
        } else if (step.action === 'sound') {
          speakCurrent();
        } else if (step.action === 'wait') {
          await sleep(Number(step.ms) || 0);
        }

        // small pacing gap between actions
        await sleep(80);
        if (!document.body.contains(el)) {
          isAutoPlaying = false;
          notifyShellMediaState();
          try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(false); } catch (e) {}
          saveUIState();
          _autoplayAbort = true;
          break;
        }
      }
      // after running full sequence, yield briefly to avoid tight loop
      await sleep(200);
    }
    // update any UI state (play button) via saved state
    notifyShellMediaState();
    try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(!!isAutoPlaying); } catch (e) {}
    saveUIState();
  }

  function toggleDefaultViewMode() {
    defaultViewMode = defaultViewMode === 'kanji-only' ? 'full' : 'kanji-only';
    viewMode = defaultViewMode;
    render();
    saveUIState();
  }

  function render() {
      if (!isShuffled) {
    refreshEntriesFromStore();
      }
    try { const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', String(!!isShuffled)); } catch (e) {}
    // render

    // If the underlying entry changed due to refresh, keep timing aligned.
    // (e.g., store updates, filter changes, virtual set resolution)
    try { progressTracker?.syncToCurrent?.(); } catch (e) {}

    const entry = entries[index];
    const total = entries.length;

    // update view mode class on the wrapper (maintains previous behavior)
    if (viewMode === 'kanji-only') wrapper.classList.add('kanji-only');
    else wrapper.classList.remove('kanji-only');

    // update main card content and corner caption
    const caption = total ? `${index + 1} / ${total}` : 'Empty';
    try { mainCardApi.setIndexText(caption); } catch (e) {}

    if (!entry) {
      // show empty hint inside the card body
      const bodyEl = mainCardApi.el.querySelector('.kanji-body');
      if (bodyEl) bodyEl.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
      try { mainCardApi.setEntry(null); } catch (e) {}
      try { fullCardApi && typeof fullCardApi.setEntry === 'function' && fullCardApi.setEntry(null); } catch (e) {}
    } else {
      try { mainCardApi.setEntry(entry); } catch (e) {}
      try { fullCardApi && typeof fullCardApi.setEntry === 'function' && fullCardApi.setEntry(entry); } catch (e) {}
    }

    // Update related sentence card via its API. the card expects `entry` only.
    try {
      const displaySet = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
      // Pass the current entry to the related card so it can derive its sentences.
      try { if (relatedCardApi && typeof relatedCardApi.setEntry === 'function') relatedCardApi.setEntry(entry); } catch (e) {}
      // Toggle visibility for every registered card according to user selection.
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
        try {
          const api = cardApis[c.key];
          if (api && api.el) api.el.style.display = displaySet.has(c.key) ? '' : 'none';
        } catch (e) {}
      }
    } catch (e) {}
    
    // Update reveal button text based on current viewMode
    updateRevealButton();

    // Update learned/focus button state
    updateMarkButtons();
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // Pause/resume timing on visibility/focus changes

  // Removed local visibility handlers


  // React to store changes (e.g., virtual set finishing its background resolution)
  let unsub = null;
  try {
    if (store && typeof store.subscribe === 'function') {
      let lastKey = store?.collections?.getActiveCollection?.()?.key || null;
      unsub = store.subscribe(() => {
        try {
          const active = store?.collections?.getActiveCollection?.();
          const key = active?.key || null;
          // Refresh when active collection changes or when entries may have been updated.
          if (key !== lastKey) {
            lastKey = key;
            uiStateRestored = false;
          }
          refreshEntriesFromStore();
          render();
        } catch (e) {
          // ignore
        }
      });
    }
  } catch (e) {
    unsub = null;
  }

  // start autoplay automatically if saved state requested and a sequence exists
  if (isAutoPlaying && Array.isArray(autoplayConfig) && autoplayConfig.length) startAutoplay();

  // Register media controls with the shell so Bluetooth/media play-pause can
  // toggle autoplay just like clicking the play button.
  try {
    document.dispatchEvent(new CustomEvent('app:registerMediaHandler', {
      detail: {
        id: MEDIA_HANDLER_ID,
        play: () => {
          if (!document.body.contains(el)) return { playing: false };
          setAutoplayPlaying(true, { source: 'shell-media' });
          return { playing: !!isAutoPlaying };
        },
        pause: () => {
          if (!document.body.contains(el)) return { playing: false };
          setAutoplayPlaying(false, { source: 'shell-media' });
          return { playing: !!isAutoPlaying };
        },
        toggle: () => {
          if (!document.body.contains(el)) return { playing: false };
          setAutoplayPlaying(!isAutoPlaying, { source: 'shell-media' });
          return { playing: !!isAutoPlaying };
        },
        getState: () => ({ playing: !!isAutoPlaying }),
      }
    }));
  } catch (e) {}

  // Footer caption (below the card)
  const footer = document.createElement('div');
  footer.className = 'view-footer-caption';
  footer.id = 'kanji-controls';
  footer.textContent = '← / →: navigate  •  ↑: full  •  ↓: kanji only';

  // mainCardApi.el already contains its internal wrapper

  // Append every registered card element (in registry order) into the view root
  for (const childEl of registryCardEls) {
    try { el.appendChild(childEl); } catch (e) {}
  }

  // Build a DocumentFragment containing header -> view root -> footer so
  // when the shell appends the fragment its children become siblings in
  // the correct order under `#shell-main`.
  const frag = document.createDocumentFragment();
  frag.appendChild(headerTools);
  frag.appendChild(el);
  frag.appendChild(footerControls.el);
  // mark mounted flags; the fragment will be appended by the shell into
  // `#shell-main` synchronously when this function returns.
  __mountedHeaderInShell = true;
  __mountedFooterInShell = true;

  // Tools behaviour
  // wire shuffle control after handler exists
  try {
    headerTools.addElement({ type: 'button', key: 'shuffle', label: 'Shuffle', caption: 'col.shuffle', onClick: shuffleEntries });
  } catch (e) {}
  // Ensure header order: play (autoplayControlsEl), shuffle, visible.cards (displayCards), then others
  try {
    const parent = headerTools;
    const autoplayNode = autoplayControlsEl;
    const shuffleCtrl = (typeof headerTools.getControl === 'function') ? headerTools.getControl('shuffle') : null;
    const displayCtrl = (typeof headerTools.getControl === 'function') ? headerTools.getControl('displayCards') : null;
    const shuffleGroup = shuffleCtrl && shuffleCtrl.parentNode ? shuffleCtrl.parentNode : null;
    const displayGroup = displayCtrl && displayCtrl.parentNode ? displayCtrl.parentNode : null;
    if (parent && autoplayNode && shuffleGroup && parent.contains(autoplayNode) && parent.contains(shuffleGroup)) {
      parent.insertBefore(shuffleGroup, autoplayNode.nextSibling);
    }
    if (parent && autoplayNode && displayGroup) {
      const after = (shuffleGroup && parent.contains(shuffleGroup)) ? shuffleGroup.nextSibling : autoplayNode.nextSibling;
      parent.insertBefore(displayGroup, after);
    }
  } catch (e) {}
  // Details toggle removed from header tools

  // Keyboard handling for footer shortcuts is handled by the footer component
  // (it registers an app-level key handler using id 'kanjiStudy').



  // Cleanup on unmount
  let __wasMounted = false;
  const observer = new MutationObserver(() => {
    // Avoid false-positive unmount before the shell has appended this view.
    if (!__wasMounted) {
      if (document.body.contains(el)) __wasMounted = true;
      else return;
    }

    if (!document.body.contains(el)) {
      // finalize any remaining credit when navigating away/unmounting
      try { progressTracker?.teardown?.(); } catch (e) {}
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      try {
        document.dispatchEvent(new CustomEvent('app:unregisterMediaHandler', { detail: { id: MEDIA_HANDLER_ID } }));
      } catch (e) {}
      // cleanup header/footer moved into shell
      try {
        if (__mountedHeaderInShell && headerTools && headerTools.parentNode) headerTools.parentNode.removeChild(headerTools);
      } catch (e) {}
      try {
        if (__mountedFooterInShell && footerControls && footerControls.el && footerControls.el.parentNode) footerControls.el.parentNode.removeChild(footerControls.el);
      } catch (e) {}
      try {
        // explicitly unregister footer key handler if provided
        if (footerControls && typeof footerControls.__unregister === 'function') footerControls.__unregister();
      } catch (e) {}
      try { if (mainCardApi && typeof mainCardApi.destroy === 'function') mainCardApi.destroy(); } catch (e) {}
      try { if (relatedCardApi && typeof relatedCardApi.destroy === 'function') relatedCardApi.destroy(); } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose fragment so the shell can mount header -> view -> footer in order
  return frag;
}
