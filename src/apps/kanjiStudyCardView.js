import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';
import { createAutoplayControls } from '../components/autoplay.js';
import { createSpeakerButton } from '../components/ui.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  // Study timing: credit time spent on a card (max 10s per card view).
  const MAX_CREDIT_PER_CARD_MS = 10_000;
  const MIN_VIEW_TO_COUNT_MS = 200;
  const timing = {
    kanji: null,
    startedAtMs: null,
    creditedThisViewMs: 0,
    seenMarkedThisView: false,
  };

  function canRunTimer() {
    try {
      if (document.visibilityState !== 'visible') return false;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function getCurrentKanjiKey() {
    const entry = entries && entries.length ? entries[index] : null;
    return String(store.collections.getEntryStudyKey(entry) || '').trim();
  }

  function flushTimingCredit({ immediate = false } = {}) {
    const k = timing.kanji;
    if (!k) return;
    if (timing.startedAtMs == null) return;
    const now = nowMs();
    const elapsed = Math.max(0, Math.round(now - timing.startedAtMs));

    // Only count a view (seen/timesSeen) after a minimum dwell.
    const totalViewedThisViewMs = timing.creditedThisViewMs + elapsed;
    if (!timing.seenMarkedThisView && totalViewedThisViewMs >= MIN_VIEW_TO_COUNT_MS) {
      timing.seenMarkedThisView = true;
      try {
        if (store?.kanjiProgress && typeof store.kanjiProgress.recordKanjiSeenInKanjiStudyCard === 'function') {
          store.kanjiProgress.recordKanjiSeenInKanjiStudyCard(k, { silent: true, immediate });
        }
      } catch (e) {
        // ignore
      }
    }

    // Don't award any study-time credit unless they've been on the card long enough.
    if (totalViewedThisViewMs < MIN_VIEW_TO_COUNT_MS) {
      timing.startedAtMs = null;
      return;
    }

    const remaining = Math.max(0, MAX_CREDIT_PER_CARD_MS - timing.creditedThisViewMs);
    const add = Math.round(Math.min(elapsed, remaining));
    timing.startedAtMs = null;
    if (add <= 0) return;
    timing.creditedThisViewMs += add;
    try {
      if (store?.kanjiProgress && typeof store.kanjiProgress.addTimeMsStudiedInKanjiStudyCard === 'function') {
        store.kanjiProgress.addTimeMsStudiedInKanjiStudyCard(k, add, { silent: true, immediate });
      }
    } catch (e) {
      // ignore
    }
  }

  function maybeResumeTiming() {
    if (!timing.kanji) return;
    if (timing.startedAtMs != null) return;
    if (timing.creditedThisViewMs >= MAX_CREDIT_PER_CARD_MS) return;
    if (!canRunTimer()) return;
    timing.startedAtMs = nowMs();
  }

  function beginTimingForKanji(kanji) {
    const k = String(kanji || '').trim();
    if (!k) {
      // Nothing to track
      timing.kanji = null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      return;
    }

    // Close out any previous card timing before switching.
    flushTimingCredit();

    timing.kanji = k;
    timing.startedAtMs = null;
    timing.creditedThisViewMs = 0;

    // Defer "seen" increment until MIN_VIEW_TO_COUNT_MS has elapsed.
    timing.seenMarkedThisView = false;

    maybeResumeTiming();
  }

  function syncTimingToCurrentCard() {
    const current = getCurrentKanjiKey();
    if (!current) {
      // stop
      flushTimingCredit();
      timing.kanji = null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      return;
    }
    if (timing.kanji !== current) {
      beginTimingForKanji(current);
      return;
    }
    // same card: ensure paused/resumed state matches visibility/focus
    if (!canRunTimer()) {
      flushTimingCredit();
    } else {
      maybeResumeTiming();
    }
  }

  // Simple state
  let entries = [];
  let index = 0;
  let viewMode = 'kanji-only'; // current card view
  let defaultViewMode = 'kanji-only'; // controls what is shown when changing cards
  let shownAt = nowMs();
  let isShuffled = false;
  let autoSpeakKanji = false;
  let isAutoPlaying = false;
  let autoplayConfig = null; // will be defaulted from savedUI or component defaults
  let uiStateRestored = false; // ensure saved UI (index/order) is applied only once
  let originalEntries = [];
  let currentOrder = null; // array of indices mapping to originalEntries
  let orderHashInt = null; // deterministic seed for shuffle (preferred persisted form)
  let viewIndices = []; // indices into originalEntries for the current rendered entries array

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
        store.collections.saveCollectionState(key, {
          isShuffled: !!isShuffled,
          defaultViewMode: defaultViewMode,
          order_hash_int: (typeof orderHashInt === 'number') ? orderHashInt : null,
          currentIndex: index,
        });
      }
    } catch (e) {
      // ignore
    }
  }

  // Root UI pieces
  const headerTools = createViewHeaderTools();

  function wrapHeaderTool(controlEl, captionText) {
    const group = document.createElement('div');
    group.className = 'data-expansion-group';
    const caption = document.createElement('div');
    caption.className = 'data-expansion-caption';
    caption.textContent = String(captionText || '').trim();
    group.append(controlEl, caption);
    return group;
  }

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = 'Shuffle';
  shuffleBtn.setAttribute('aria-pressed', String(!!isShuffled));

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn small';
  // Details toggle: Off when showing kanji-only; On when showing full details
  toggleBtn.textContent = defaultViewMode === 'kanji-only' ? 'Details: Off' : 'Details: On';
  toggleBtn.title = 'Toggle details';
  toggleBtn.setAttribute('aria-pressed', String(defaultViewMode !== 'kanji-only'));

  // New: Auto-speak Kanji toggle button
  const autoSpeakBtn = document.createElement('button');
  autoSpeakBtn.type = 'button';
  autoSpeakBtn.className = 'btn small';
  autoSpeakBtn.textContent = '🔊 Auto-speak: Off';
  autoSpeakBtn.title = 'Toggle auto-speak';

  const shuffleGroup = wrapHeaderTool(shuffleBtn, 'col.shuffle');
  const detailsGroup = wrapHeaderTool(toggleBtn, 'app.card-details');
  const autoSpeakGroup = wrapHeaderTool(autoSpeakBtn, 'app.auto-speak');

  headerTools.append(shuffleGroup, detailsGroup, autoSpeakGroup);

  // No legacy UI load: visual defaults used; autoplay/defaults remain runtime-only

  // Footer controls: describe actions and let footer build UI + register shortcuts
  let prevBtn, revealBtn, soundBtn, nextBtn, learnedBtn, practiceBtn;

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', action: () => showPrev() },
    { key: 'reveal', states: [
        { name: 'kanji-only', icon: '', text: 'Reveal', caption: '↑', shortcut: 'ArrowUp', action: () => toggleReveal() },
        { name: 'full', icon: '', text: 'Hide', caption: '↓', shortcut: 'ArrowDown', action: () => showKanjiOnly() }
      ], initialState: 'kanji-only' },
    { key: 'sound', icon: '🔊', text: 'Sound', caption: 'Space', shortcut: ' ', action: () => speakCurrent() },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiLearned === 'function') {
        store.kanjiProgress.toggleKanjiLearned(v);
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
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiFocus === 'function') {
        store.kanjiProgress.toggleKanjiFocus(v);
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
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', action: () => showNext() },
  ];

  const footerControls = createViewFooterControls(footerDesc, { appId: 'kanjiStudy' });
  // map returned button elements for local use
  prevBtn = footerControls.buttons.prev;
  revealBtn = footerControls.buttons.reveal;
  soundBtn = footerControls.buttons.sound;
  nextBtn = footerControls.buttons.next;
  learnedBtn = footerControls.buttons.learned;
  practiceBtn = footerControls.buttons.practice;
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
  // Auto-speak button behavior
  autoSpeakBtn.setAttribute('aria-pressed', 'false');
  autoSpeakBtn.addEventListener('click', () => {
    autoSpeakKanji = !autoSpeakKanji;
    autoSpeakBtn.setAttribute('aria-pressed', String(!!autoSpeakKanji));
    autoSpeakBtn.textContent = autoSpeakKanji ? '🔊 Auto-speak: On' : '🔊 Auto-speak: Off';
    // Speak current entry immediately when enabling
    if (autoSpeakKanji && entries[index]) speakEntry(entries[index]);
    saveUIState();
  });

  // Autoplay controls: create grouped play/gear control and hook into play loop
  // Load app-specific autoplay config (saved under uiState.apps.kanjiStudy.autoplaySequence)
  try {
    if (store?.apps && typeof store.apps.getState === 'function') {
      const appState = store.apps.getState('kanjiStudy') || {};
      if (Array.isArray(appState.autoplaySequence)) autoplayConfig = appState.autoplaySequence.slice();
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
      if (store?.apps && typeof store.apps.setState === 'function') {
        store.apps.setState('kanjiStudy', { autoplaySequence: autoplayConfig });
      }
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
        if (store?.apps && typeof store.apps.setState === 'function') {
          store.apps.setState('kanjiStudy', { autoplaySequence: autoplayConfig });
        }
      } catch (e) {}
      saveUIState();
    }
  });
  // place autoplay controls at start of headerTools, grouped visually
  headerTools.insertBefore(autoplayControlsEl, shuffleGroup);

  const wrapper = document.createElement('div');
  wrapper.className = 'kanji-card-wrapper';
  wrapper.tabIndex = 0; // so it can receive keyboard focus

  // Outer card container to get .card styling (border, background, padding)
  const card = document.createElement('div');
  card.className = 'card kanji-card';

  // Sentence card (created once, shown/hidden as needed)
  const sentenceCard = document.createElement('div');
  sentenceCard.className = 'card kanji-example-card';
  // carousel state for sentences on the current entry
  let currentSentenceIndex = 0;
  let lastSentenceEntry = null;

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

    // top-left type (styled and toggled like bottom-right meaning)
    const topLeft = document.createElement('div');
    topLeft.className = 'kanji-top-left muted';
    topLeft.textContent = getFieldValue(entry, ['type']) || '';

    // bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'kanji-bottom-left muted';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'kanji-bottom-right muted';
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
    // If a saved index exists in collection state, restore it once on initial load
    if (!uiStateRestored && collState && typeof collState.currentIndex === 'number') {
      index = collState.currentIndex;
      uiStateRestored = true;
    }
    const prevIndex = index;
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
    if (index !== prevIndex) {/* index clamped */}
  }

  // Navigation / control helpers to avoid duplicated logic
  function goToIndex(newIndex) {
    if (newIndex < 0 || newIndex >= entries.length) return;
    // finalize time for previous card before switching
    flushTimingCredit({ immediate: false });
    const prev = index;
    index = newIndex;
    shownAt = nowMs();
    viewMode = defaultViewMode;
    // index updated
    render();
    if (autoSpeakKanji && entries[index]) speakEntry(entries[index]);
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
    const entry = entries[index];
    const v = store.collections.getEntryStudyKey(entry);
    const isLearned = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiLearned === 'function' && v) ? store.kanjiProgress.isKanjiLearned(v) : false;
    const isFocus = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiFocus === 'function' && v) ? store.kanjiProgress.isKanjiFocus(v) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  

  function updateRevealButton() {
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

    flushTimingCredit({ immediate: false });

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
    try { shuffleBtn.setAttribute('aria-pressed', 'true'); } catch (e) {}
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
    toggleBtn.textContent = defaultViewMode === 'kanji-only' ? 'Details: Off' : 'Details: On';
    toggleBtn.setAttribute('aria-pressed', String(defaultViewMode !== 'kanji-only'));
    viewMode = defaultViewMode;
    render();
    saveUIState();
  }

  function render() {
      if (!isShuffled) {
    refreshEntriesFromStore();
      }
    try { shuffleBtn.setAttribute('aria-pressed', String(!!isShuffled)); } catch (e) {}
    // render

    // If the underlying entry changed due to refresh, keep timing aligned.
    // (e.g., store updates, filter changes, virtual set resolution)
    syncTimingToCurrentCard();

    wrapper.innerHTML = '';

    const entry = entries[index];
    const total = entries.length;

    const cornerCaption = document.createElement('div');
    cornerCaption.className = 'card-corner-caption';
    cornerCaption.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    const body = document.createElement('div');
    body.id = 'kanji-body';

    if (viewMode === 'kanji-only') wrapper.classList.add('kanji-only');
    else wrapper.classList.remove('kanji-only');

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else {
      renderCard(body, entry);
    }

    wrapper.append(cornerCaption, body);

    // Show/hide sentence card based on entry.sentences (array)
    if (entry && Array.isArray(entry.sentences) && entry.sentences.length) {
      // reset carousel index when switching to a new entry
      if (lastSentenceEntry !== entry) {
        currentSentenceIndex = 0;
        lastSentenceEntry = entry;
      }
      sentenceCard.innerHTML = '';
      const sentences = entry.sentences || [];
      const idx = ((Number(currentSentenceIndex) || 0) % sentences.length + sentences.length) % sentences.length;
      const ex = sentences[idx] || {};
      const jaText = ex.ja || '';
      const enText = ex.en || '';
      const notes = Array.isArray(ex.notes) ? ex.notes : [];
      
      // Only show card if Japanese text exists
      if (!jaText) {
        sentenceCard.style.display = 'none';
        return;
      }
      
      // Label row with speaker button
      const exampleHeader = document.createElement('div');
      exampleHeader.className = 'kanji-example-header';

      const exampleLabel = document.createElement('div');
      exampleLabel.className = 'muted kanji-example-label';
      exampleLabel.textContent = 'Sentence';

      // create speaker button bound to current sentence text
      const speakerBtn = createSpeakerButton({ 
        text: jaText,
        fieldKey: 'reading'
      });

      // Carousel controls (prev / index / next) when multiple sentences
      const controls = document.createElement('div');
      controls.className = 'example-carousel-controls';
      controls.style.display = 'flex';
      if (sentences.length > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'icon-button';
        prevBtn.title = 'Previous sentence';
        prevBtn.textContent = '◀';
        prevBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          currentSentenceIndex = (idx - 1 + sentences.length) % sentences.length;
          render();
        });

        const nextBtn = document.createElement('button');
        nextBtn.className = 'icon-button';
        nextBtn.title = 'Next sentence';
        nextBtn.textContent = '▶';
        nextBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          currentSentenceIndex = (idx + 1) % sentences.length;
          render();
        });

        const counter = document.createElement('div');
        counter.className = 'muted kanji-example-label';
        counter.style.margin = '0 8px';
        counter.textContent = `${idx + 1} / ${sentences.length}`;

        controls.append(prevBtn, counter, nextBtn);
      }

      exampleHeader.append(exampleLabel, controls, speakerBtn);
      
      // Japanese text (always visible)
      const exampleText = document.createElement('div');
      exampleText.className = 'kanji-example-text';
      exampleText.textContent = jaText;
      
      sentenceCard.append(exampleHeader, exampleText);
      
      // English translation (shown only when revealed)
      if (enText && viewMode === 'full') {
        const enLabel = document.createElement('div');
        enLabel.className = 'muted kanji-example-label';
        enLabel.style.marginTop = '1rem';
        enLabel.textContent = 'English';
        
        const enDiv = document.createElement('div');
        enDiv.className = 'kanji-example-text';
        enDiv.style.fontSize = '1rem';
        enDiv.textContent = enText;
        
        sentenceCard.append(enLabel, enDiv);
      }
      
      // Notes (shown only when revealed)
      if (notes.length > 0 && viewMode === 'full') {
        const notesLabel = document.createElement('div');
        notesLabel.className = 'muted kanji-example-label';
        notesLabel.style.marginTop = '1rem';
        notesLabel.textContent = 'Notes';
        
        const notesList = document.createElement('ul');
        notesList.className = 'kanji-example-notes';
        notes.forEach(note => {
          const li = document.createElement('li');
          li.textContent = note;
          notesList.appendChild(li);
        });
        
        sentenceCard.append(notesLabel, notesList);
      }
      sentenceCard.style.display = 'block';
    } else {
      sentenceCard.style.display = 'none';
    }
    
    // Update reveal button text based on current viewMode
    updateRevealButton();

    // Update learned/focus button state
    updateMarkButtons();
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // Pause/resume timing on visibility/focus changes
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushTimingCredit({ immediate: true });
    } else {
      maybeResumeTiming();
    }
  };
  const onBlur = () => {
    flushTimingCredit({ immediate: true });
  };
  const onFocus = () => {
    maybeResumeTiming();
  };

  try {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
  } catch (e) {
    // ignore
  }

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

  card.appendChild(wrapper);
  el.append(headerTools, card, sentenceCard);
  el.append(footerControls.el);

  // Tools behaviour
  shuffleBtn.addEventListener('click', shuffleEntries);
  toggleBtn.addEventListener('click', toggleDefaultViewMode);

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
      try {
        flushTimingCredit({ immediate: true });
      } catch (e) {}
      try {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onFocus);
      } catch (e) {}
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      try {
        document.dispatchEvent(new CustomEvent('app:unregisterMediaHandler', { detail: { id: MEDIA_HANDLER_ID } }));
      } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose element so the shell can mount it
  return el;
}
