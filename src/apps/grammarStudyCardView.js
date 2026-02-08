import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';
import { createAutoplayControls } from '../components/autoplay.js';
import { createSpeakerButton } from '../components/ui.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';

export function renderGrammarStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'grammar-study-root';

  const MAX_CREDIT_PER_CARD_MS = 10_000;
  const MIN_VIEW_TO_COUNT_MS = 200;

  const timing = {
    key: null,
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

  function getPrimaryKey(entry) {
    const p = entry && typeof entry === 'object' ? entry.pattern : '';
    return String(p || '').trim();
  }

  function getCurrentKey() {
    const entry = entries && entries.length ? entries[index] : null;
    return getPrimaryKey(entry);
  }

  function flushTimingCredit({ immediate = false } = {}) {
    const k = timing.key;
    if (!k) return;
    if (timing.startedAtMs == null) return;

    const now = nowMs();
    const elapsed = Math.max(0, Math.round(now - timing.startedAtMs));

    const totalViewedThisViewMs = timing.creditedThisViewMs + elapsed;
    if (!timing.seenMarkedThisView && totalViewedThisViewMs >= MIN_VIEW_TO_COUNT_MS) {
      timing.seenMarkedThisView = true;
      try {
        store?.grammarProgress?.recordGrammarSeenInGrammarStudyCard?.(k, { silent: true, immediate });
      } catch (e) {}
    }

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
      store?.grammarProgress?.addTimeMsStudiedInGrammarStudyCard?.(k, add, { silent: true, immediate });
    } catch (e) {}
  }

  function maybeResumeTiming() {
    if (!timing.key) return;
    if (timing.startedAtMs != null) return;
    if (timing.creditedThisViewMs >= MAX_CREDIT_PER_CARD_MS) return;
    if (!canRunTimer()) return;
    timing.startedAtMs = nowMs();
  }

  function beginTimingForKey(key) {
    const k = String(key || '').trim();
    if (!k) {
      flushTimingCredit();
      timing.key = null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      return;
    }

    flushTimingCredit();
    timing.key = k;
    timing.startedAtMs = null;
    timing.creditedThisViewMs = 0;
    timing.seenMarkedThisView = false;
    maybeResumeTiming();
  }

  function syncTimingToCurrentCard() {
    const current = getCurrentKey();
    if (!current) {
      flushTimingCredit();
      timing.key = null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      return;
    }
    if (timing.key !== current) beginTimingForKey(current);
    else maybeResumeTiming();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      maybeResumeTiming();
    } else {
      flushTimingCredit({ immediate: true });
    }
  });

  window.addEventListener('blur', () => flushTimingCredit({ immediate: true }));
  window.addEventListener('focus', () => maybeResumeTiming());

  let entries = [];
  let indices = [];
  let isShuffled = false;
  let orderHashInt = null;

  // per-collection UI state
  let index = 0;

  // display mode: 'pattern-only' or 'full'
  let viewMode = 'pattern-only';

  function refreshFromStore({ resetIndex = false } = {}) {
    const res = store.collections.getActiveCollectionView();
    const collState = res?.collState || {};
    const prevKey = (!resetIndex && entries && entries.length && entries[index]) ? getPrimaryKey(entries[index]) : null;

    const view = res?.view || {};
    entries = Array.isArray(view?.entries) ? view.entries.slice() : [];
    indices = Array.isArray(view?.indices) ? view.indices.slice() : [];
    isShuffled = !!view?.isShuffled;
    orderHashInt = (typeof view?.order_hash_int === 'number') ? view.order_hash_int : null;

    const savedMode = (typeof collState.defaultViewMode === 'string') ? collState.defaultViewMode : null;
    viewMode = (savedMode === 'pattern-only' || savedMode === 'full') ? savedMode : viewMode;

    if (resetIndex) {
      index = 0;
    } else if (prevKey) {
      const found = entries.findIndex(en => getPrimaryKey(en) === prevKey);
      if (found >= 0) index = found;
    } else {
      // initial load: prefer saved index
      if (typeof collState.currentIndex === 'number' && Number.isFinite(collState.currentIndex)) {
        index = Math.max(0, Math.min(entries.length - 1, Math.round(collState.currentIndex)));
      }
    }

    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  // initial load
  refreshFromStore({ resetIndex: false });

  let autoSpeak = false;

  // Autoplay state (persisted to app state)
  const appState = (store?.apps && typeof store.apps.getState === 'function') ? (store.apps.getState('grammarStudy') || {}) : {};
  let isAutoPlaying = !!appState.isAutoPlaying;
  let autoplayConfig = Array.isArray(appState.autoplaySequence) ? appState.autoplaySequence.slice() : [];
  let autoplayStepIndex = 0;
  let autoplayTimer = null;
  let autoplayControlsEl = null;

  function clearAutoplayTimer() {
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
  }

  function persistAutoplayState() {
    try {
      store?.apps?.setState?.('grammarStudy', { isAutoPlaying: !!isAutoPlaying, autoplaySequence: autoplayConfig });
    } catch (e) {}
  }

  function scheduleAutoplayNextStep(delayMs) {
    clearAutoplayTimer();
    const d = (typeof delayMs === 'number' && Number.isFinite(delayMs)) ? Math.max(0, Math.round(delayMs)) : 0;
    autoplayTimer = setTimeout(() => {
      autoplayTimer = null;
      runAutoplayStep();
    }, d);
  }

  function setAutoplayPlaying(next, { source = 'ui' } = {}) {
    const n = !!next;
    if (n === isAutoPlaying) return;
    isAutoPlaying = n;
    if (!isAutoPlaying) {
      clearAutoplayTimer();
      try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(false); } catch (e) {}
    } else {
      autoplayStepIndex = 0;
      try { autoplayControlsEl && autoplayControlsEl.__setPlaying && autoplayControlsEl.__setPlaying(true); } catch (e) {}
      scheduleAutoplayNextStep(0);
    }
    persistAutoplayState();
    render();
  }

  function runAutoplayStep() {
    if (!isAutoPlaying) return;
    const seq = Array.isArray(autoplayConfig) && autoplayConfig.length ? autoplayConfig : [
      { action: 'next' },
      { action: 'wait', ms: 800 },
      { action: 'sound' },
      { action: 'wait', ms: 600 },
      { action: 'reveal' },
      { action: 'wait', ms: 1000 },
    ];

    const step = seq[autoplayStepIndex % seq.length] || null;
    autoplayStepIndex = (autoplayStepIndex + 1) % seq.length;

    if (!step || typeof step !== 'object') {
      scheduleAutoplayNextStep(400);
      return;
    }

    const action = String(step.action || '').trim();
    if (action === 'wait') {
      scheduleAutoplayNextStep(step.ms ?? 800);
      return;
    }

    try {
      if (action === 'next') showNext();
      else if (action === 'prev') showPrev();
      else if (action === 'sound') speakCurrent();
      else if (action === 'reveal') toggleReveal();
    } catch (e) {}

    scheduleAutoplayNextStep(600);
  }

  function saveUIState() {
    try {
      const active = store?.collections?.getActiveCollection?.();
      const key = active?.key || null;
      if (!key) return;
      store.collections.saveCollectionState?.(key, {
        isShuffled: !!isShuffled,
        defaultViewMode: viewMode,
        order_hash_int: (typeof orderHashInt === 'number') ? orderHashInt : null,
        currentIndex: index,
      });
    } catch (e) {}
  }

  function currentEntry() {
    return entries && entries.length ? entries[index] : null;
  }

  function isCurrentLearned() {
    const k = getCurrentKey();
    if (!k) return false;
    try { return !!store?.grammarProgress?.isGrammarLearned?.(k); } catch { return false; }
  }

  function isCurrentFocus() {
    const k = getCurrentKey();
    if (!k) return false;
    try { return !!store?.grammarProgress?.isGrammarFocus?.(k); } catch { return false; }
  }

  function setIndex(next) {
    const n = entries.length;
    if (!n) {
      index = 0;
      saveUIState();
      render();
      return;
    }
    const clamped = ((next % n) + n) % n;
    if (clamped === index) return;
    flushTimingCredit();
    index = clamped;
    saveUIState();
    render();
  }

  function showPrev() { setIndex(index - 1); }
  function showNext() { setIndex(index + 1); }

  function showPatternOnly() {
    viewMode = 'pattern-only';
    saveUIState();
    render();
  }

  function showFull() {
    viewMode = 'full';
    saveUIState();
    render();
  }

  function toggleReveal() {
    if (viewMode === 'pattern-only') showFull();
    else showPatternOnly();
  }

  function toggleShuffle() {
    const active = store?.collections?.getActiveCollection?.();
    const collKey = active?.key || null;
    if (!collKey) return;
    if (!isShuffled) {
      const seed = store.collections.shuffleCollection(collKey);
      orderHashInt = typeof seed === 'number' ? seed : null;
      isShuffled = true;
    } else {
      store.collections.clearCollectionShuffle(collKey);
      orderHashInt = null;
      isShuffled = false;
    }
    // Reload view (deterministic) and re-apply studyFilter.
    refreshFromStore({ resetIndex: true });
    saveUIState();
    render();
  }

  function speakCurrent({ force = false } = {}) {
    const entry = currentEntry();
    if (!entry) return;
    const jp = String(entry.example_jp || '').trim() || String(entry.pattern || '').trim();
    if (!jp) return;
    try {
      // Grammar study is Japanese; use the Japanese voice mapping.
      speak(jp, { lang: getLanguageCode('reading'), force });
    } catch (e) {}
  }

  // Root UI
  const headerTools = createViewHeaderTools();

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = '🔀 Shuffle';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn small';
  toggleBtn.textContent = viewMode === 'pattern-only' ? 'Details: Off' : 'Details: On';
  toggleBtn.title = 'Toggle details';
  toggleBtn.setAttribute('aria-pressed', String(viewMode !== 'pattern-only'));

  const autoSpeakBtn = document.createElement('button');
  autoSpeakBtn.type = 'button';
  autoSpeakBtn.className = 'btn small';
  autoSpeakBtn.textContent = '🔊 Auto-speak: Off';
  autoSpeakBtn.title = 'Toggle auto-speak';
  autoSpeakBtn.setAttribute('aria-pressed', 'false');

  headerTools.append(shuffleBtn, toggleBtn, autoSpeakBtn);

  // Autoplay controls live in the header tools bar (consistent with Kanji Study).
  autoplayControlsEl = createAutoplayControls({
    sequence: Array.isArray(autoplayConfig) ? autoplayConfig : [],
    isPlaying: !!isAutoPlaying,
    onTogglePlay: (play) => setAutoplayPlaying(!!play, { source: 'ui' }),
    onSequenceChange: (seq) => {
      autoplayConfig = Array.isArray(seq) ? seq.slice() : [];
      persistAutoplayState();
    }
  });
  // place autoplay controls at start of headerTools, grouped visually
  headerTools.insertBefore(autoplayControlsEl, shuffleBtn);

  let prevBtn, revealBtn, soundBtn, nextBtn, learnedBtn, practiceBtn;

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', action: () => showPrev() },
    { key: 'reveal', states: [
      { name: 'pattern-only', icon: '', text: 'Reveal', caption: '↑', shortcut: 'ArrowUp', action: () => toggleReveal() },
      { name: 'full', icon: '', text: 'Hide', caption: '↓', shortcut: 'ArrowDown', action: () => toggleReveal() },
    ], initialState: 'pattern-only' },
    { key: 'sound', icon: '🔊', text: 'Speak', caption: 'S', shortcut: 's', action: () => speakCurrent({ force: true }) },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', action: () => showNext() },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'L', shortcut: 'l', action: () => {
      const k = getCurrentKey();
      if (!k) return;
      store?.grammarProgress?.toggleGrammarLearned?.(k);
      // If this change causes the current card to be filtered out, refresh and clamp.
      refreshFromStore({ resetIndex: false });
      renderFooterState();
      render();
    } },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'P', shortcut: 'p', action: () => {
      const k = getCurrentKey();
      if (!k) return;
      store?.grammarProgress?.toggleGrammarFocus?.(k);
      refreshFromStore({ resetIndex: false });
      renderFooterState();
      render();
    } },
  ];

  const footer = createViewFooterControls(footerDesc, { appId: 'grammarStudy' });

  function renderFooterState() {
    if (!footer) return;
    const k = getCurrentKey();
    const learned = !!(k && store?.grammarProgress?.isGrammarLearned?.(k));
    const focus = !!(k && store?.grammarProgress?.isGrammarFocus?.(k));

    const btns = footer.buttons || {};
    learnedBtn = btns.learned || learnedBtn;
    practiceBtn = btns.practice || practiceBtn;
    prevBtn = btns.prev || prevBtn;
    revealBtn = btns.reveal || revealBtn;
    soundBtn = btns.sound || soundBtn;
    nextBtn = btns.next || nextBtn;

    if (learnedBtn?.setAriaPressed) learnedBtn.setAriaPressed(learned);
    if (practiceBtn?.setAriaPressed) practiceBtn.setAriaPressed(focus);

    // Match Kanji Study footer button visuals.
    try {
      learnedBtn?.classList?.toggle('state-learned', learned);
      practiceBtn?.classList?.toggle('state-focus', focus);
    } catch (e) {}

    // update reveal state
    if (revealBtn?.setState) revealBtn.setState(viewMode === 'pattern-only' ? 'pattern-only' : 'full');
  }

  function render() {
    el.innerHTML = '';
    // Keep view in sync with collection state changes (shuffle/filter/index persisted elsewhere).
    refreshFromStore({ resetIndex: false });
    toggleBtn.textContent = viewMode === 'pattern-only' ? 'Details: Off' : 'Details: On';
    toggleBtn.setAttribute('aria-pressed', String(viewMode !== 'pattern-only'));
    shuffleBtn.textContent = isShuffled ? '🔀 Shuffle: On' : '🔀 Shuffle';

    const entry = currentEntry();

    const card = document.createElement('div');
    card.className = 'card grammar-card';

    const cornerCaption = document.createElement('div');
    cornerCaption.className = 'card-corner-caption';
    cornerCaption.textContent = entries.length ? `${index + 1} / ${entries.length}` : '0 / 0';

    const top = document.createElement('div');
    top.className = 'grammar-card-top';

    const title = document.createElement('div');
    title.className = 'grammar-card-title';
    title.textContent = entry ? String(entry.pattern || '').trim() : '(No entries)';

    top.append(title);

    const body = document.createElement('div');
    body.className = 'grammar-card-body';

    if (!entry) {
      body.append(document.createTextNode('No grammar entries in this collection.'));
    } else if (viewMode === 'pattern-only') {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Press ↑ to reveal meaning + example.';
      body.append(hint);
    } else {
      const meaning = document.createElement('div');
      meaning.className = 'grammar-card-meaning';
      meaning.textContent = String(entry.meaning || '').trim();

      const exJp = document.createElement('div');
      exJp.className = 'grammar-card-example-jp';
      exJp.textContent = String(entry.example_jp || '').trim();

      const exEn = document.createElement('div');
      exEn.className = 'grammar-card-example-en';
      exEn.textContent = String(entry.example_en || '').trim();

      const notes = Array.isArray(entry.notes_grammar) ? entry.notes_grammar.filter(Boolean) : [];
      const notesBox = document.createElement('div');
      notesBox.className = 'grammar-card-notes';
      if (notes.length) {
        const h = document.createElement('div');
        h.className = 'grammar-card-notes-title';
        h.textContent = 'Notes';
        notesBox.append(h);
        const ul = document.createElement('ul');
        for (const n of notes) {
          const li = document.createElement('li');
          li.textContent = String(n);
          ul.append(li);
        }
        notesBox.append(ul);
      }

      const speakerRow = document.createElement('div');
      speakerRow.className = 'grammar-card-speaker-row';
      const speakerBtn = createSpeakerButton({
        text: String(entry.example_jp || '').trim() || String(entry.pattern || '').trim(),
        fieldKey: 'reading',
      });
      speakerRow.append(speakerBtn);

      body.append(meaning, exJp, exEn, notesBox, speakerRow);
    }

    card.append(cornerCaption, top, body);

    // Header tools already contains the autoplay controls.
    el.append(headerTools, card, footer.el);

    renderFooterState();
    syncTimingToCurrentCard();

    if (autoSpeak && entry) {
      try { speakCurrent(); } catch (e) {}
    }
  }

  shuffleBtn.addEventListener('click', () => toggleShuffle());
  toggleBtn.addEventListener('click', () => toggleReveal());
  autoSpeakBtn.addEventListener('click', () => {
    autoSpeak = !autoSpeak;
    autoSpeakBtn.textContent = autoSpeak ? '🔊 Auto-speak: On' : '🔊 Auto-speak: Off';
    autoSpeakBtn.setAttribute('aria-pressed', String(!!autoSpeak));
  });

  // Ensure timers flush on teardown if supported by router/shell.
  el.addEventListener('app:teardown', () => flushTimingCredit({ immediate: true }));

  render();
  return el;
}
