import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  // Simple state
  let entries = [];
  let index = 0;
  let viewMode = 'kanji-only'; // current card view
  let defaultViewMode = 'kanji-only'; // controls what is shown when changing cards
  let shownAt = nowMs();
  let isShuffled = false;
  let autoSpeakKanji = false;
  let currentFontWeight = 'normal'; // cycles through: bold -> normal -> lighter
  let savedUI = null;
  let uiStateRestored = false; // ensure saved UI (index/order) is applied only once
  let originalEntries = [];
  let currentOrder = null; // array of indices mapping to originalEntries

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  // sessionStorage helpers for UI state
  function loadUIState() {
    try {
      const raw = sessionStorage.getItem('kanjiUIState');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveUIState() {
    try {
      const state = {
        isShuffled: !!isShuffled,
        defaultViewMode: defaultViewMode,
        fontWeight: currentFontWeight,
        autoSpeak: !!autoSpeakKanji,
        order: currentOrder || null,
        currentIndex: index,
      };
      sessionStorage.setItem('kanjiUIState', JSON.stringify(state));
    } catch (e) {
      // ignore
    }
  }

  // Root UI pieces
  const headerTools = document.createElement('div');
  headerTools.className = 'kanji-header-tools';

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = '🔀 Shuffle';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn small';
  toggleBtn.textContent = 'Show Full';

  // Bold toggle button (cycles font weight)
  const boldBtn = document.createElement('button');
  boldBtn.type = 'button';
  boldBtn.className = 'btn small';
  boldBtn.textContent = 'B';
  boldBtn.title = `Font weight: ${currentFontWeight}`;
  boldBtn.style.fontWeight = currentFontWeight;

  // New: Auto-speak Kanji toggle button
  const autoSpeakBtn = document.createElement('button');
  autoSpeakBtn.type = 'button';
  autoSpeakBtn.className = 'btn small';
  autoSpeakBtn.textContent = '🔊 Auto Speak Kanji';

  headerTools.append(shuffleBtn, toggleBtn, boldBtn, autoSpeakBtn);

  // Apply saved UI state (visuals only here) — will apply shuffle after entries load
  savedUI = loadUIState();
  if (savedUI) {
    if (savedUI.fontWeight) {
      currentFontWeight = savedUI.fontWeight;
      boldBtn.title = `Font weight: ${currentFontWeight}`;
    }
    if (typeof savedUI.autoSpeak === 'boolean') {
      autoSpeakKanji = !!savedUI.autoSpeak;
      autoSpeakBtn.setAttribute('aria-pressed', String(!!autoSpeakKanji));
      autoSpeakBtn.textContent = autoSpeakKanji ? '🔊 Auto Speak: ON' : '🔊 Auto Speak Kanji';
    }
    if (savedUI.defaultViewMode) {
      defaultViewMode = savedUI.defaultViewMode;
      toggleBtn.textContent = defaultViewMode === 'kanji-only' ? 'Show Full' : 'Show Kanji';
    }
    // Ensure the active viewMode matches the saved default so the initial render uses it
    viewMode = defaultViewMode;
  }

  // Visual helper for bold button background + weight
  function updateBoldBtnVisual() {
    boldBtn.style.fontWeight = currentFontWeight;
    boldBtn.title = `Font weight: ${currentFontWeight}`;
    // Simple, fixed rgba variants per request:
    // - lighter font -> slightly stronger background
    // - bold font -> slightly subtler background
    if (currentFontWeight === 'lighter') {
      boldBtn.style.backgroundColor = 'rgba(96, 165, 250, 0.15)';
    } else if (currentFontWeight === 'bold') {
      boldBtn.style.backgroundColor = 'rgba(96, 165, 250, 0.03)';
    } else {
      boldBtn.style.backgroundColor = '';
    }
    boldBtn.style.transition = 'background-color 140ms ease';
  }
  // ensure visuals match initial state
  updateBoldBtnVisual();

  // Footer controls
  const footerControls = document.createElement('div');
  footerControls.className = 'kanji-footer-controls';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'btn';
  prevBtn.innerHTML = '<span class="icon">←</span><span class="text">Prev</span>';

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'btn';
  revealBtn.innerHTML = '<span class="icon"></span><span class="text">Reveal</span>';

  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.className = 'btn';
  soundBtn.innerHTML = '<span class="icon">🔊</span><span class="text">Sound</span>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn';
  nextBtn.innerHTML = '<span class="icon">→</span><span class="text">Next</span>';

  footerControls.append(prevBtn, revealBtn, soundBtn, nextBtn);
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
    autoSpeakBtn.textContent = autoSpeakKanji ? '🔊 Auto Speak: ON' : '🔊 Auto Speak Kanji';
    // Speak current entry immediately when enabling
    if (autoSpeakKanji && entries[index]) speakEntry(entries[index]);
    saveUIState();
  });

  // Bold toggle behaviour: cycle ['bold','normal','lighter'] (default: normal)
  boldBtn.addEventListener('click', () => {
    const cycle = ['bold', 'normal', 'lighter'];
    const idx = cycle.indexOf(currentFontWeight);
    const next = cycle[(idx + 1) % cycle.length];
    currentFontWeight = next;
    updateBoldBtnVisual();
    render();
    saveUIState();
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'kanji-card-wrapper';
  wrapper.tabIndex = 0; // so it can receive keyboard focus

  // Outer card container to get .card styling (border, background, padding)
  const card = document.createElement('div');
  card.className = 'card kanji-card';

  // render a single card body
  function renderCard(body, entry) {
    body.innerHTML = '';

    // main kanji centered
    const kanjiWrap = document.createElement('div');
    kanjiWrap.className = 'kanji-main-wrap';
    const kanjiMain = document.createElement('div');
    kanjiMain.className = 'kanji-main';
    kanjiMain.textContent = getFieldValue(entry, ['kanji', 'character', 'text']) || '';
    // Apply current font weight preference
    kanjiMain.style.fontWeight = currentFontWeight;
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
    const active = store.getActiveCollection();
    originalEntries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    console.debug('[KanjiStudy] refreshEntriesFromStore: found originalEntries', { count: originalEntries.length });
    // If we have a saved order and it matches the number of entries, apply it
    if (savedUI && savedUI.order && Array.isArray(savedUI.order) && savedUI.order.length === originalEntries.length) {
      currentOrder = savedUI.order.slice();
      entries = currentOrder.map(i => originalEntries[i]);
      isShuffled = true;
      console.debug('[KanjiStudy] refreshEntriesFromStore: applied saved order', { orderLen: currentOrder.length });
    } else if (currentOrder && Array.isArray(currentOrder) && currentOrder.length === originalEntries.length) {
      // apply in-memory currentOrder (fallback)
      entries = currentOrder.map(i => originalEntries[i]);
      isShuffled = true;
      console.debug('[KanjiStudy] refreshEntriesFromStore: applied in-memory order', { orderLen: currentOrder.length });
    } else {
      entries = [...originalEntries];
      isShuffled = false;
      currentOrder = null;
    }
    // If a saved index exists, restore it (will be clamped to valid range)
    // Only apply saved index once on initial load to avoid overwriting runtime navigation
    if (!uiStateRestored && savedUI && typeof savedUI.currentIndex === 'number') {
      index = savedUI.currentIndex;
      uiStateRestored = true;
      console.debug('[KanjiStudy] refreshEntriesFromStore: restored saved index (initial)', { savedIndex: savedUI.currentIndex });
    }
    const prevIndex = index;
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
    if (index !== prevIndex) console.debug('[KanjiStudy] refreshEntriesFromStore: clamped index', { prevIndex, newIndex: index, entriesLength: entries.length });
  }

  // Navigation / control helpers to avoid duplicated logic
  function goToIndex(newIndex) {
    console.debug('[KanjiStudy] goToIndex requested', { newIndex, currentIndex: index, entriesLength: entries.length });
    if (newIndex < 0 || newIndex >= entries.length) {
      console.debug('[KanjiStudy] goToIndex aborted - out of bounds', { newIndex, entriesLength: entries.length });
      return;
    }
    const prev = index;
    index = newIndex;
    shownAt = nowMs();
    viewMode = defaultViewMode;
    console.debug('[KanjiStudy] goToIndex applied', { prev, index });
    render();
    if (autoSpeakKanji && entries[index]) speakEntry(entries[index]);
    // persist current index so it's restored when navigating back
    saveUIState();
  }

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }
  function revealFull() { viewMode = 'full'; render(); }
  function showKanjiOnly() { viewMode = 'kanji-only'; render(); }
  function speakCurrent() { if (entries[index]) speakEntry(entries[index]); }

  function shuffleEntries() {
    // Build a permutation of indices based on originalEntries
    const n = originalEntries.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    currentOrder = indices;
    entries = currentOrder.map(i => originalEntries[i]);
    index = 0;
    viewMode = defaultViewMode;
    isShuffled = true;
    render();
    saveUIState();
  }

  function toggleDefaultViewMode() {
    defaultViewMode = defaultViewMode === 'kanji-only' ? 'full' : 'kanji-only';
    toggleBtn.textContent = defaultViewMode === 'kanji-only' ? 'Show Full' : 'Show Kanji';
    viewMode = defaultViewMode;
    render();
    saveUIState();
  }

  function render() {
      if (!isShuffled) {
    refreshEntriesFromStore();
      }
    console.debug('[KanjiStudy] render', { index, entriesLength: entries.length, isShuffled, viewMode });

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
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // Footer caption (below the card)
  const footer = document.createElement('div');
  footer.className = 'kanji-footer-caption';
  footer.id = 'kanji-controls';
  footer.textContent = '← / →: navigate  •  ↑: full  •  ↓: kanji only';

  card.appendChild(wrapper);
  el.append(headerTools, card);
  el.append(footerControls);
  // Footer controls event listeners
  prevBtn.addEventListener('click', () => {
    console.debug('[KanjiStudy] Prev clicked', { index, entriesLength: entries.length });
    showPrev();
  });

  nextBtn.addEventListener('click', () => {
    console.debug('[KanjiStudy] Next clicked', { index, entriesLength: entries.length });
    showNext();
  });

  revealBtn.addEventListener('click', revealFull);

  soundBtn.addEventListener('click', () => {
    const entry = entries[index];
    // Use the same unified speak flow
    speakEntry(entry);
  });

  // Tools behaviour
  shuffleBtn.addEventListener('click', shuffleEntries);
  toggleBtn.addEventListener('click', toggleDefaultViewMode);

  // Keyboard navigation
  const keyHandler = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      revealFull();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      showKanjiOnly();
    }
  };

  wrapper.addEventListener('keydown', keyHandler);
  document.addEventListener('keydown', keyHandler);



  // Cleanup on unmount
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      document.removeEventListener('keydown', keyHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose element so the shell can mount it
  return el;
}