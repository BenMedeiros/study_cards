import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';
import { createAutoplayControls } from '../components/autoplay.js';
import { createSpeakerButton } from '../components/speaker.js';
import { getCollectionView } from '../utils/collectionManagement.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';

import { createCollectionActions } from '../utils/collectionActions.js';

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
      const active = store.getActiveCollection ? store.getActiveCollection() : null;
      const key = active && active.key ? active.key : null;
      if (!key) return;
      if (typeof store.saveCollectionState === 'function') {
        store.saveCollectionState(key, {
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

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = '🔀 Shuffle';

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

  headerTools.append(shuffleBtn, toggleBtn, autoSpeakBtn);

  // No legacy UI load: visual defaults used; autoplay/defaults remain runtime-only

  // Footer controls
  const footerControls = document.createElement('div');
  footerControls.className = 'view-footer-controls';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'btn';
  prevBtn.innerHTML = '<span class="icon">←</span><span class="text">Prev</span><span class="caption">←</span>';

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'btn';
  revealBtn.innerHTML = '<span class="icon"></span><span class="text">Reveal</span><span class="caption">↑</span>';

  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.className = 'btn';
  soundBtn.innerHTML = '<span class="icon">🔊</span><span class="text">Sound</span><span class="caption">Space</span>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn';
  nextBtn.innerHTML = '<span class="icon">→</span><span class="text">Next</span><span class="caption">→</span>';

  const learnedBtn = document.createElement('button');
  learnedBtn.type = 'button';
  learnedBtn.className = 'btn';
  learnedBtn.innerHTML = '<span class="icon">✅</span><span class="text">Learned</span><span class="caption">V</span>';
  learnedBtn.setAttribute('aria-pressed', 'false');

  const practiceBtn = document.createElement('button');
  practiceBtn.type = 'button';
  practiceBtn.className = 'btn';
  practiceBtn.innerHTML = '<span class="icon">🎯</span><span class="text">Practice</span><span class="caption">X</span>';
  practiceBtn.setAttribute('aria-pressed', 'false');

  footerControls.append(prevBtn, revealBtn, soundBtn, learnedBtn, practiceBtn, nextBtn);
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
  const autoplayControlsEl = createAutoplayControls({
    sequence: Array.isArray(autoplayConfig) ? autoplayConfig : (autoplayConfig ? autoplayConfig : []),
    isPlaying: !!isAutoPlaying,
    onTogglePlay: (play) => {
      isAutoPlaying = !!play;
      saveUIState();
      if (isAutoPlaying) startAutoplay();
    },
    onSequenceChange: (seq) => {
      autoplayConfig = Array.isArray(seq) ? seq.slice() : [];
      saveUIState();
    }
  });
  // place autoplay controls at start of headerTools, grouped visually
  headerTools.insertBefore(autoplayControlsEl, shuffleBtn);

  const wrapper = document.createElement('div');
  wrapper.className = 'kanji-card-wrapper';
  wrapper.tabIndex = 0; // so it can receive keyboard focus

  // Outer card container to get .card styling (border, background, padding)
  const card = document.createElement('div');
  card.className = 'card kanji-card';

  // Example card (created once, shown/hidden as needed)
  const exampleCard = document.createElement('div');
  exampleCard.className = 'card kanji-example-card';

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
    const active = store.getActiveCollection();
    originalEntries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    // Use shared collection management to build the view (study window + shuffle)
    const key = active?.key;
    let collState = (store && typeof store.loadCollectionState === 'function') ? (store.loadCollectionState(key) || {}) : {};

    let skipLearned = false;
    let focusOnly = false;
    if (typeof collState?.studyFilter === 'string') {
      const raw = String(collState.studyFilter || '').trim();
      const parts = raw.split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
      const set = new Set(parts);
      skipLearned = set.has('skipLearned') || set.has('skip_learned') || set.has('skip-learned');
      focusOnly = set.has('focusOnly') || set.has('focus_only') || set.has('focus') || set.has('morePractice') || set.has('more_practice');
    } else {
      // legacy
      skipLearned = !!collState?.skipLearned;
      focusOnly = !!collState?.focusOnly;
    }

    

    const view = getCollectionView(originalEntries, collState, { windowSize: 10 });
    let nextEntries = Array.isArray(view.entries) ? view.entries.slice() : [];
    let nextIndices = Array.isArray(view.indices) ? view.indices.slice() : [];

    // Apply filters to the rendered view even when not using studyIndices.
    if (skipLearned || focusOnly) {
      const filteredEntries = [];
      const filteredIndices = [];
      for (let i = 0; i < nextEntries.length; i++) {
        const entry = nextEntries[i];
        const v = getPrimaryKanjiValue(entry);
        if (!v) {
          filteredEntries.push(entry);
          filteredIndices.push(nextIndices[i]);
          continue;
        }
        if (skipLearned && typeof store.isKanjiLearned === 'function') {
          if (store.isKanjiLearned(v)) continue;
        }
        if (focusOnly && typeof store.isKanjiFocus === 'function') {
          if (!store.isKanjiFocus(v)) continue;
        }
        filteredEntries.push(entry);
        filteredIndices.push(nextIndices[i]);
      }
      nextEntries = filteredEntries;
      nextIndices = filteredIndices;
    }

    entries = nextEntries;
    viewIndices = nextIndices;
    isShuffled = !!view.isShuffled;
    orderHashInt = view.order_hash_int || null;
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
    const v = getPrimaryKanjiValue(entry);
    const isLearned = !!(store && typeof store.isKanjiLearned === 'function' && v) ? store.isKanjiLearned(v) : false;
    const isFocus = !!(store && typeof store.isKanjiFocus === 'function' && v) ? store.isKanjiFocus(v) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  

  function updateRevealButton() {
    // Keep the caption span so shortcut hint remains visible when keyboard is active
    if (viewMode === 'full') {
      revealBtn.innerHTML = '<span class="icon"></span><span class="text">Hide</span><span class="caption">↑</span>';
    } else {
      revealBtn.innerHTML = '<span class="icon"></span><span class="text">Reveal</span><span class="caption">↑</span>';
    }
  }

  function shuffleEntries() {
    const n = originalEntries.length;
    if (n === 0) return;

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
    const active = store.getActiveCollection ? store.getActiveCollection() : null;
    const key = active && active.key ? active.key : null;
    if (key) {
      try {
        const actions = createCollectionActions(store);
        actions.shuffleCollection(key);
      } catch (e) {
        // ignore
      }
    }

    // rebuild view from saved collection state
    refreshEntriesFromStore();
    index = 0;
    viewMode = defaultViewMode;
    isShuffled = true;
    render();
  }

  // small sleep helper
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // PRNG and permutation moved to shared util `src/utils/collectionManagement.js`

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
          saveUIState();
          _autoplayAbort = true;
          break;
        }
      }
      // after running full sequence, yield briefly to avoid tight loop
      await sleep(200);
    }
    // update any UI state (play button) via saved state
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
    // render

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

    // Show/hide example card based on entry.example
    if (entry && entry.example) {
      exampleCard.innerHTML = '';
      
      // Extract example fields (handle undefined/null)
      const jaText = entry.example.ja || '';
      const enText = entry.example.en || '';
      const notes = Array.isArray(entry.example.notes) ? entry.example.notes : [];
      
      // Only show card if Japanese text exists
      if (!jaText) {
        exampleCard.style.display = 'none';
        return;
      }
      
      // Label row with speaker button
      const exampleHeader = document.createElement('div');
      exampleHeader.className = 'kanji-example-header';
      
      const exampleLabel = document.createElement('div');
      exampleLabel.className = 'muted kanji-example-label';
      exampleLabel.textContent = 'Example Sentence';
      
      const speakerBtn = createSpeakerButton({ 
        text: jaText,
        fieldKey: 'reading'
      });
      
      exampleHeader.append(exampleLabel, speakerBtn);
      
      // Japanese text (always visible)
      const exampleText = document.createElement('div');
      exampleText.className = 'kanji-example-text';
      exampleText.textContent = jaText;
      
      exampleCard.append(exampleHeader, exampleText);
      
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
        
        exampleCard.append(enLabel, enDiv);
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
        
        exampleCard.append(notesLabel, notesList);
      }
      
      exampleCard.style.display = 'block';
    } else {
      exampleCard.style.display = 'none';
    }
    
    // Update reveal button text based on current viewMode
    updateRevealButton();

    // Update learned/focus button state
    updateMarkButtons();
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // React to store changes (e.g., virtual set finishing its background resolution)
  let unsub = null;
  try {
    if (store && typeof store.subscribe === 'function') {
      let lastKey = store.getActiveCollection?.()?.key || null;
      unsub = store.subscribe(() => {
        try {
          const active = store.getActiveCollection?.();
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

  // Footer caption (below the card)
  const footer = document.createElement('div');
  footer.className = 'view-footer-caption';
  footer.id = 'kanji-controls';
  footer.textContent = '← / →: navigate  •  ↑: full  •  ↓: kanji only';

  card.appendChild(wrapper);
  el.append(headerTools, card, exampleCard);
  el.append(footerControls);
  // Footer controls event listeners
  prevBtn.addEventListener('click', showPrev);

  nextBtn.addEventListener('click', showNext);

  revealBtn.addEventListener('click', toggleReveal);

  soundBtn.addEventListener('click', () => {
    const entry = entries[index];
    // Use the same unified speak flow
    speakEntry(entry);
  });

  learnedBtn.addEventListener('click', () => {
    const entry = entries[index];
    const v = getPrimaryKanjiValue(entry);
    if (!v) return;
    // Capture the original index before toggling learned.
    // toggleKanjiLearned() notifies subscribers synchronously, which can refresh entries/viewIndices
    // and otherwise cause us to remove the *next* item from the study subset.
    const originalIdxBefore = Number.isFinite(Number(viewIndices[index])) ? Number(viewIndices[index]) : null;
    if (store && typeof store.toggleKanjiLearned === 'function') {
      const nowLearned = store.toggleKanjiLearned(v);
      updateMarkButtons();
      // If we just marked learned while studying a removable subset, remove it.
      if (nowLearned) {
        try {
          const active = store.getActiveCollection?.();
          const key = active?.key;
          const collState = (store && typeof store.loadCollectionState === 'function') ? (store.loadCollectionState(key) || {}) : {};
          let skipLearnedMode = false;
          if (typeof collState?.studyFilter === 'string') {
            const raw = String(collState.studyFilter || '').trim();
            const parts = raw.split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
            const set = new Set(parts);
            skipLearnedMode = set.has('skipLearned') || set.has('skip_learned') || set.has('skip-learned');
          } else {
            // legacy
            skipLearnedMode = !!collState?.skipLearned;
          }
          if (skipLearnedMode) {
            refreshEntriesFromStore();
            index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
            render();
            saveUIState();
          }
        } catch (e) {
          // ignore
        }
      }
    }
  });

  practiceBtn.addEventListener('click', () => {
    const entry = entries[index];
    const v = getPrimaryKanjiValue(entry);
    if (!v) return;
    if (store && typeof store.toggleKanjiFocus === 'function') {
      store.toggleKanjiFocus(v);
      updateMarkButtons();
    }
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
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      // spacebar -> sound
      soundBtn.click();
    } else if (e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      // x -> practice
      practiceBtn.click();
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      // v -> learned
      learnedBtn.click();
    }
  };

  wrapper.addEventListener('keydown', keyHandler);
  // Register the handler with the shell so shell controls app-level keyboard handling.
  const registerKanjiHandler = () => {
    const wrapped = (e) => {
      try {
        keyHandler(e);
        return e.defaultPrevented === true;
      } catch (err) {
        return false;
      }
    };
    document.dispatchEvent(new CustomEvent('app:registerKeyHandler', { detail: { id: 'kanjiStudy', handler: wrapped } }));
  };

  const unregisterKanjiHandler = () => {
    document.dispatchEvent(new CustomEvent('app:unregisterKeyHandler', { detail: { id: 'kanjiStudy' } }));
  };

  setTimeout(registerKanjiHandler, 0);



  // Cleanup on unmount
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      unregisterKanjiHandler();
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose element so the shell can mount it
  return el;
}