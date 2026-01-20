import { nowMs } from '../utils/helpers.js';
import { createSpeakerButton } from '../components/speaker.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  // Simple state
  let entries = [];
  let index = 0;
  let viewMode = 'kanji-only';
  let shownAt = nowMs();
    let isShuffled = false;

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  // Root UI pieces
  const tools = document.createElement('div');
  tools.className = 'kanji-tools';

  const shuffleBtn = document.createElement('button');
  shuffleBtn.type = 'button';
  shuffleBtn.className = 'btn small';
  shuffleBtn.textContent = '🔀 Shuffle';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn small';
  toggleBtn.textContent = 'Show Full';

  tools.append(shuffleBtn, toggleBtn);

  const wrapper = document.createElement('div');
  wrapper.className = 'kanji-card-wrapper';
  wrapper.tabIndex = 0; // so it can receive keyboard focus

  // Outer card container to get .card styling (border, background, padding)
  const card = document.createElement('div');
  card.className = 'card kanji-card';

  // render a single card body
  function renderCard(body, entry) {
    body.innerHTML = '';

    // top-left: speaker
    const topLeft = document.createElement('div');
    topLeft.className = 'kanji-top-left';
    const speakText = getFieldValue(entry, ['reading', 'kana', 'word', 'text']) || getFieldValue(entry, ['kanji']);
    const speaker = createSpeakerButton(speakText);
    topLeft.append(speaker);

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

    body.append(topLeft, kanjiWrap, bottomLeft, bottomRight);
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
  footer.textContent = '← / →: navigate  •  ↑: kanji only  •  ↓: full';

  card.appendChild(wrapper);
  el.append(tools, card, footer);

  // Tools behaviour
  shuffleBtn.addEventListener('click', () => {
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    index = 0;
    viewMode = 'kanji-only';
      isShuffled = true;
    render();
  });

  toggleBtn.addEventListener('click', () => {
    viewMode = viewMode === 'kanji-only' ? 'full' : 'kanji-only';
    toggleBtn.textContent = viewMode === 'kanji-only' ? 'Show Full' : 'Show Kanji';
    render();
  });

  // Keyboard navigation
  const keyHandler = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        viewMode = 'kanji-only';
        render();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < entries.length - 1) {
        index += 1;
        shownAt = nowMs();
        viewMode = 'kanji-only';
        render();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      viewMode = 'kanji-only';
      render();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      viewMode = 'full';
      render();
    }
  };

  wrapper.addEventListener('keydown', keyHandler);
  document.addEventListener('keydown', keyHandler);

  // Touch / swipe handling for mobile
  let touchStartX = 0;
  let touchStartY = 0;
  const threshold = 30; // px

  wrapper.addEventListener('touchstart', (ev) => {
    const t = ev.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  wrapper.addEventListener('touchend', (ev) => {
    const t = ev.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      if (dx < 0) {
        if (index < entries.length - 1) { index += 1; shownAt = nowMs(); viewMode = 'kanji-only'; render(); }
      } else {
        if (index > 0) { index -= 1; shownAt = nowMs(); viewMode = 'kanji-only'; render(); }
      }
    } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > threshold) {
      if (dy < 0) { // swipe up
        viewMode = 'kanji-only'; render();
      } else { // swipe down
        viewMode = 'full'; render();
      }
    }
  }, { passive: true });

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