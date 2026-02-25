import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';
import { createAutoplayControls } from '../components/autoplay.js';
import { createSpeakerButton } from '../components/ui.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';
import { createKanjiMainCard, createKanjiRelatedCard, createKanjiFullCard } from '../cards/index.js';
import { createDropdown } from '../components/dropdown.js';

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
    const map = {};
    ['kanji', 'reading', 'meaning', 'type', 'lexical', 'orthography', 'tags'].forEach(k => map[k] = Array.isArray(fullFieldSelection) ? fullFieldSelection.includes(k) : false);
    if (fullCardApi && typeof fullCardApi.setFieldsVisible === 'function') fullCardApi.setFieldsVisible(map);
  } catch (e) {}
  try {
    const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
    if (mainCardApi && mainCardApi.el) mainCardApi.el.style.display = set.has('main') ? '' : 'none';
    if (relatedCardApi && relatedCardApi.el) relatedCardApi.el.style.display = set.has('related') ? '' : 'none';
    if (fullCardApi && fullCardApi.el) fullCardApi.el.style.display = set.has('full') ? '' : 'none';
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
          store.collections.saveCollectionState(key, {
            kanjiStudyCardView: {
              currentIndex: index,
              cardFields: Array.isArray(kanjiFieldSelection) ? kanjiFieldSelection.slice() : [],
              relatedFields: Array.isArray(relatedFieldSelection) ? relatedFieldSelection.slice() : [],
              fullFields: Array.isArray(fullFieldSelection) ? fullFieldSelection.slice() : [],
              displayCards: Array.isArray(displayCardSelection) ? displayCardSelection.slice() : [],
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
  // full-detail card instance (created early so header controls can reference it)
  const fullCardApi = createKanjiFullCard({ entry: null });
  // Track whether we mounted header/footer into the shell main container
  let __mountedHeaderInShell = false;
  let __mountedFooterInShell = false;

  // header groups are created via `headerTools.addElement`

  // shuffle control will be added later once handler is defined

  // --- Header dropdowns to control card field visibility ---
  // Load per-collection saved dropdown state (if any)
  let kanjiFieldSelection = ['kanji', 'reading', 'meaning', 'type'];
  let relatedFieldSelection = ['showRelated', 'english'];
  let fullFieldSelection = ['kanji', 'reading', 'meaning', 'type', 'lexical', 'orthography', 'tags'];
  let displayCardSelection = ['main', 'related'];
  try {
    const res = store?.collections?.getActiveCollectionView ? store.collections.getActiveCollectionView({ windowSize: 0 }) : null;
    const collState = res?.collState || {};
    const appState = collState?.kanjiStudyCardView || {};
    if (Array.isArray(appState.cardFields)) kanjiFieldSelection = appState.cardFields.slice();
    if (Array.isArray(appState.relatedFields)) relatedFieldSelection = appState.relatedFields.slice();
    if (Array.isArray(appState.fullFields)) fullFieldSelection = appState.fullFields.slice();
    if (Array.isArray(appState.displayCards)) displayCardSelection = appState.displayCards.slice();
  } catch (e) {}

  // Kanji main card: show/hide fields
  const kanjiFieldItems = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    { value: 'kanji', left: 'Kanji', right: 'Visible' },
    { value: 'reading', left: 'Reading', right: 'Visible' },
    { value: 'meaning', left: 'Meaning', right: 'Visible' },
    { value: 'type', left: 'Type', right: 'Visible' },
  ];

    const _kanjiFieldRec = headerTools.addElement({
      type: 'dropdown', key: 'kanjiFields', items: kanjiFieldItems, multi: true,
      values: Array.isArray(kanjiFieldSelection) ? kanjiFieldSelection.slice() : ['kanji', 'reading', 'meaning', 'type'],
      commitOnClose: true,
      onChange: (vals) => {
        const set = new Set(Array.isArray(vals) ? vals : []);
        ['kanji', 'reading', 'meaning', 'type'].forEach(f => { try { mainCardApi.setFieldVisible(f, set.has(f)); } catch (e) {} });
        try { kanjiFieldSelection = Array.isArray(vals) ? vals.slice() : []; } catch (e) {}
        try { saveUIState(); } catch (e) {}
      },
      className: 'data-expansion-dropdown',
      caption: 'card.fields'
    });
    const kanjiFieldDd = (_kanjiFieldRec && _kanjiFieldRec.control) ? _kanjiFieldRec.control : headerTools.getControl('kanjiFields');

  // Related card dropdown: show/hide entire related card, and mute/unmute English
  const relatedFieldItems = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    { value: 'showRelated', left: 'Related', right: 'Display' },
    { value: 'english', left: 'English', right: 'Visible' },
  ];

    const _relatedFieldRec = headerTools.addElement({
      type: 'dropdown', key: 'relatedFields', items: relatedFieldItems, multi: true,
      values: Array.isArray(relatedFieldSelection) ? relatedFieldSelection.slice() : ['showRelated', 'english'],
      commitOnClose: true,
      onChange: (vals) => {
        const set = new Set(Array.isArray(vals) ? vals : []);
        try { relatedCardApi.setVisible(set.has('showRelated')); } catch (e) {}
        try { relatedCardApi.setEnglishVisible(set.has('english')); } catch (e) {}
        try { relatedFieldSelection = Array.isArray(vals) ? vals.slice() : []; } catch (e) {}
        try { saveUIState(); } catch (e) {}
      },
      className: 'data-expansion-dropdown',
      caption: 'card.related'
    });
    const relatedFieldDd = (_relatedFieldRec && _relatedFieldRec.control) ? _relatedFieldRec.control : headerTools.getControl('relatedFields');

  

  // No legacy UI load: visual defaults used; autoplay/defaults remain runtime-only

  // Footer controls: describe actions and let footer build UI + register shortcuts
  function getFooterButton(key) {
    if (!footerControls) return null;
    if (typeof footerControls.getButton === 'function') return footerControls.getButton(key);
    return (footerControls.buttons && footerControls.buttons[key]) || null;
  }

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', actionKey: 'prev', fnName: 'showPrev', action: () => showPrev() },
    { key: 'reveal', states: [
        { name: 'kanji-only', icon: '', text: 'Reveal', caption: '↑', shortcut: 'ArrowUp', actionKey: 'reveal', fnName: 'toggleReveal', action: () => toggleReveal() },
        { name: 'full', icon: '', text: 'Hide', caption: '↓', shortcut: 'ArrowDown', actionKey: 'hide', fnName: 'showKanjiOnly', action: () => showKanjiOnly() }
      ], initialState: 'kanji-only' },
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
    { action: 'wait', ms: 1000 },
    { action: 'reveal' },
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

  // Create main card and related card via factories (decoupled components)
  const mainCardApi = createKanjiMainCard({ entry: null, indexText: '' });
  const relatedCardApi = createKanjiRelatedCard({ entry: null, sentences: [], handlers: {
    onSpeak: (text) => {
      if (!text) return;
      const lang = getLanguageCode('reading');
      try { speak(text, lang); } catch (e) {}
    },
    onNext: (ci) => { /* optional hook from related card */ },
    onPrev: (ci) => { /* optional hook from related card */ }
  }});

  // Per-card field dropdown for the full-detail card
  const fullFieldItems = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    { value: 'kanji', left: 'Kanji', right: 'Visible' },
    { value: 'reading', left: 'Reading', right: 'Visible' },
    { value: 'meaning', left: 'Meaning', right: 'Visible' },
    { value: 'type', left: 'Type', right: 'Visible' },
    { value: 'lexical', left: 'Lexical Class', right: 'Visible' },
    { value: 'orthography', left: 'Orthography', right: 'Visible' },
    { value: 'tags', left: 'Tags', right: 'Visible' },
  ];

    const _fullFieldRec = headerTools.addElement({
    type: 'dropdown', key: 'fullFields', items: fullFieldItems, multi: true,
    values: Array.isArray(fullFieldSelection) ? fullFieldSelection.slice() : ['kanji', 'reading', 'meaning', 'type', 'lexical', 'orthography', 'tags'],
    commitOnClose: true,
    onChange: (vals) => {
      const set = new Set(Array.isArray(vals) ? vals : []);
      const map = {};
      ['kanji', 'reading', 'meaning', 'type', 'lexical', 'orthography', 'tags'].forEach(k => map[k] = set.has(k));
      if (fullCardApi && typeof fullCardApi.setFieldsVisible === 'function') fullCardApi.setFieldsVisible(map);
      try { fullFieldSelection = Array.isArray(vals) ? vals.slice() : []; } catch (e) {}
      try { saveUIState(); } catch (e) {}
    },
    className: 'data-expansion-dropdown',
    caption: 'card.full'
  });
  const fullFieldDd = (_fullFieldRec && _fullFieldRec.control) ? _fullFieldRec.control : headerTools.getControl('fullFields');

  // Dropdown to choose which cards are displayed
  const displayCardItems = [
    { value: 'main', left: 'Main Card' },
    { value: 'related', left: 'Related Card' },
    { value: 'full', left: 'Full Details' }
  ];

  const _displayCardsRec = headerTools.addElement({
    type: 'dropdown', key: 'displayCards', items: displayCardItems, multi: true,
    values: Array.isArray(displayCardSelection) ? displayCardSelection.slice() : ['main', 'related'],
    commitOnClose: true,
    onChange: (vals) => {
      const set = new Set(Array.isArray(vals) ? vals : []);
      if (mainCardApi && mainCardApi.el) mainCardApi.el.style.display = set.has('main') ? '' : 'none';
      if (relatedCardApi && relatedCardApi.el) relatedCardApi.el.style.display = set.has('related') ? '' : 'none';
      if (fullCardApi && fullCardApi.el) fullCardApi.el.style.display = set.has('full') ? '' : 'none';

      if (_kanjiFieldRec && _kanjiFieldRec.group) _kanjiFieldRec.group.style.display = set.has('main') ? '' : 'none';
      if (_relatedFieldRec && _relatedFieldRec.group) _relatedFieldRec.group.style.display = set.has('related') ? '' : 'none';
      if (_fullFieldRec && _fullFieldRec.group) _fullFieldRec.group.style.display = set.has('full') ? '' : 'none';
      try { displayCardSelection = Array.isArray(vals) ? vals.slice() : []; } catch (e) {}
      try { saveUIState(); } catch (e) {}
    },
    className: 'data-expansion-dropdown',
    caption: 'which.cards'
  });


  // expose the same variable names used elsewhere so render() logic needs minimal changes
  const card = mainCardApi.el; // root .card kanji-card
  const wrapper = card.querySelector('.kanji-card-wrapper');
  const sentenceCard = relatedCardApi.el;

  // Apply initial visibility/mute defaults to cards to match dropdown defaults
  try {
    const map = { kanji: false, reading: false, meaning: false, type: false };
    for (const k of Object.keys(map)) map[k] = Array.isArray(kanjiFieldSelection) ? kanjiFieldSelection.includes(k) : false;
    // map currently will set true for included (visible)
    mainCardApi.setFieldsVisible(map);
  } catch (e) {}
  try {
    const initRelated = new Set(Array.isArray(relatedFieldSelection) ? relatedFieldSelection : []);
    relatedCardApi.setVisible(initRelated.has('showRelated'));
    relatedCardApi.setEnglishVisible(initRelated.has('english'));
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
        if (Array.isArray(appState.cardFields)) {
          kanjiFieldSelection = appState.cardFields.slice();
          const map = { kanji: false, reading: false, meaning: false, type: false };
          for (const k of Object.keys(map)) map[k] = kanjiFieldSelection.includes(k);
          try { mainCardApi.setFieldsVisible(map); } catch (e) {}
        }
        if (Array.isArray(appState.relatedFields)) {
          relatedFieldSelection = appState.relatedFields.slice();
          const initRelated = new Set(Array.isArray(relatedFieldSelection) ? relatedFieldSelection : []);
          try { relatedCardApi.setVisible(initRelated.has('showRelated')); } catch (e) {}
          try { relatedCardApi.setEnglishVisible(initRelated.has('english')); } catch (e) {}
        }
        if (Array.isArray(appState.fullFields)) {
          fullFieldSelection = appState.fullFields.slice();
          const map = {};
          ['kanji', 'reading', 'meaning', 'type', 'lexical', 'orthography', 'tags'].forEach(k => map[k] = fullFieldSelection.includes(k));
          try { fullCardApi.setFieldsVisible(map); } catch (e) {}
        }
        if (Array.isArray(appState.displayCards)) {
          displayCardSelection = appState.displayCards.slice();
          const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
          try { if (mainCardApi && mainCardApi.el) mainCardApi.el.style.display = set.has('main') ? '' : 'none'; } catch (e) {}
          try { if (relatedCardApi && relatedCardApi.el) relatedCardApi.el.style.display = set.has('related') ? '' : 'none'; } catch (e) {}
          try { if (fullCardApi && fullCardApi.el) fullCardApi.el.style.display = set.has('full') ? '' : 'none'; } catch (e) {}
          try { if (_kanjiFieldRec && _kanjiFieldRec.group) _kanjiFieldRec.group.style.display = set.has('main') ? '' : 'none'; } catch (e) {}
          try { if (_relatedFieldRec && _relatedFieldRec.group) _relatedFieldRec.group.style.display = set.has('related') ? '' : 'none'; } catch (e) {}
          try { if (_fullFieldRec && _fullFieldRec.group) _fullFieldRec.group.style.display = set.has('full') ? '' : 'none'; } catch (e) {}
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
    const revealBtn = getFooterButton('reveal');
    if (!revealBtn) return;
    // Keep the caption span so shortcut hint remains visible when keyboard is active
    if (revealBtn && typeof revealBtn.setState === 'function') {
      if (viewMode === 'full') revealBtn.setState('full');
      else revealBtn.setState('kanji-only');
    } else {
      if (viewMode === 'full') {
        if (typeof revealBtn.setText === 'function') revealBtn.setText('Hide');
        if (typeof revealBtn.setCaption === 'function') revealBtn.setCaption('↓');
      } else {
        if (typeof revealBtn.setText === 'function') revealBtn.setText('Reveal');
        if (typeof revealBtn.setCaption === 'function') revealBtn.setCaption('↑');
      }
    }
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
      { action: 'wait', ms: 1000 },
      { action: 'reveal' }
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
        } else if (step.action === 'reveal') {
          revealFull();
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

    // Update related sentence card via its API. show/hide depending on available related sentences
    const relatedSentences = Array.isArray(entry?.__related?.sentences) ? entry.__related.sentences : [];
    try {
      const displaySet = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
      const wantShow = Array.isArray(relatedFieldSelection) ? relatedFieldSelection.includes('showRelated') : true;
      if (entry && relatedSentences.length) {
        relatedCardApi.setSentences(relatedSentences);
        const jpText = relatedCardApi.el.querySelector('.kanji-related-jp')?.textContent || '';
        // Only show related card if user selected it in which.cards AND relatedFieldSelection allows it
        relatedCardApi.el.style.display = (displaySet.has('related') && jpText && wantShow) ? '' : 'none';
      } else {
        relatedCardApi.setSentences([]);
        relatedCardApi.el.style.display = 'none';
      }
      // Ensure main/full card visibility also respects the which.cards selection
      try { if (mainCardApi && mainCardApi.el) mainCardApi.el.style.display = displaySet.has('main') ? '' : 'none'; } catch (e) {}
      try { if (fullCardApi && fullCardApi.el) fullCardApi.el.style.display = displaySet.has('full') ? '' : 'none'; } catch (e) {}
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

  // Always append the card and sentence card into the view root
  el.append(card, sentenceCard, fullCardApi.el);

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
