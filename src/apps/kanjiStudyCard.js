import { nowMs } from '../utils/helpers.js';
import { createSpeakerButton } from '../components/speaker.js';

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

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
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

  // New: Auto-speak Kanji toggle button
  const autoSpeakBtn = document.createElement('button');
  autoSpeakBtn.type = 'button';
  autoSpeakBtn.className = 'btn small';
  autoSpeakBtn.textContent = '🔊 Auto Speak Kanji';

  headerTools.append(shuffleBtn, toggleBtn, autoSpeakBtn);

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
  // Helper to speak kanji
  // Use speech directly for auto-speak
  function speakKanji(entry) {
    const kanjiText = getFieldValue(entry, ['kanji', 'character', 'text']) || '';
    if (kanjiText) {
      // Use the same language logic as speaker button
      // Default to ja-JP for kanji
      let lang = 'ja-JP';
      // If entry has a fieldKey or collectionCategory, you could use getLanguageCode
      // But for kanji, ja-JP is correct
      import('../utils/speech.js').then(({ speak }) => {
        speak(kanjiText, lang);
      });
    }
  }
  // Auto-speak button behavior
  autoSpeakBtn.addEventListener('click', () => {
    autoSpeakKanji = !autoSpeakKanji;
    autoSpeakBtn.textContent = autoSpeakKanji ? '🔊 Speaking Kanji: ON' : '🔊 Auto Speak Kanji';
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
    kanjiWrap.append(kanjiMain);

    // bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'kanji-bottom-left muted';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'kanji-bottom-right muted';
    bottomRight.textContent = getFieldValue(entry, ['meaning', 'definition', 'gloss']) || '';

    body.append(kanjiWrap, bottomLeft, bottomRight);
  }

  function refreshEntriesFromStore() {
    const active = store.getActiveCollection();
    entries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  function render() {
      if (!isShuffled) {
    refreshEntriesFromStore();
      }

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

  // Initial population
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
    if (index > 0) {
      index -= 1;
      shownAt = nowMs();
      viewMode = defaultViewMode;
      render();
      if (autoSpeakKanji && entries[index]) speakKanji(entries[index]);
    }
  });

  nextBtn.addEventListener('click', () => {
    if (index < entries.length - 1) {
      index += 1;
      shownAt = nowMs();
      viewMode = defaultViewMode;
      render();
      if (autoSpeakKanji && entries[index]) speakKanji(entries[index]);
    }
  });

  revealBtn.addEventListener('click', () => {
    viewMode = 'full';
    render();
  });

  soundBtn.addEventListener('click', () => {
    const entry = entries[index];
    const speakText = getFieldValue(entry, ['reading', 'kana', 'word', 'text']) || getFieldValue(entry, ['kanji']);
    import('../utils/speech.js').then(({ speak }) => {
      speak(speakText, 'ja-JP');
    });
  });

  // Tools behaviour
  shuffleBtn.addEventListener('click', () => {
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    index = 0;
    viewMode = defaultViewMode;
    isShuffled = true;
    render();
  });

  toggleBtn.addEventListener('click', () => {
    defaultViewMode = defaultViewMode === 'kanji-only' ? 'full' : 'kanji-only';
    toggleBtn.textContent = defaultViewMode === 'kanji-only' ? 'Show Full' : 'Show Kanji';
    // When toggling, also update current card to match default
    viewMode = defaultViewMode;
    render();
  });

  // Keyboard navigation
  const keyHandler = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        viewMode = defaultViewMode;
        render();
        if (autoSpeakKanji && entries[index]) speakKanji(entries[index]);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < entries.length - 1) {
        index += 1;
        shownAt = nowMs();
        viewMode = defaultViewMode;
        render();
        if (autoSpeakKanji && entries[index]) speakKanji(entries[index]);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      viewMode = 'full';
      render();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      viewMode = 'kanji-only';
      render();
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