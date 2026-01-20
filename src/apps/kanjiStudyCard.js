import { nowMs } from '../utils/helpers.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card kanji-card';
  wrapper.id = 'kanji-card';

  const active = store.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>Kanji Study</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  let entries = active.entries || [];
  let index = 0;
  let shownAt = nowMs();

  function getFieldValue(entry, keys) {
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  function renderCard(body, entry) {
    body.innerHTML = '';

    // Top-right caption area with small "Type" label and an input for typing practice
    const topRight = document.createElement('div');
    topRight.className = 'kanji-top-right caption';

    const captionLabel = document.createElement('span');
    captionLabel.className = 'caption-label';
    captionLabel.textContent = 'Type';

    const captionInput = document.createElement('input');
    captionInput.className = 'caption-input';
    captionInput.type = 'text';
    captionInput.placeholder = '';
    captionInput.setAttribute('aria-label', 'Type to practice reading or meaning');

    topRight.append(captionLabel, captionInput);

    // Centered kanji element
    const kanjiWrap = document.createElement('div');
    kanjiWrap.className = 'kanji-center';

    const kanjiText = document.createElement('div');
    kanjiText.className = 'kanji-main';

    // Heuristics for main fields (kanji first, fallback to first field value)
    const kanjiValue = getFieldValue(entry, ['kanji', 'word', 'term']) || '';
    kanjiText.textContent = kanjiValue;

    kanjiWrap.append(kanjiText);

    // Bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'kanji-bottom-left muted';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // Bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'kanji-bottom-right muted';
    bottomRight.textContent = getFieldValue(entry, ['meaning', 'definition', 'gloss']) || '';

    body.append(topRight, kanjiWrap, bottomLeft, bottomRight);

    // Focus input for quick typing
    setTimeout(() => captionInput.focus(), 0);

    // Optional: reveal helper on Enter (no evaluation logic by default)
    captionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // simple visual feedback: briefly flash border
        captionInput.classList.add('submitted');
        setTimeout(() => captionInput.classList.remove('submitted'), 400);
      }
    });
  }

  function render() {
    const entry = entries[index];
    const total = entries.length;

    wrapper.innerHTML = '';

    const cornerCaption = document.createElement('div');
    cornerCaption.className = 'card-corner-caption';
    cornerCaption.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    const body = document.createElement('div');
    body.id = 'kanji-body';

    const controls = document.createElement('div');
    controls.className = 'cardtools-row cardtools-bottom';
    controls.id = 'kanji-controls';

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else {
      renderCard(body, entry);
    }

    const prev = document.createElement('button');
    prev.className = 'button';
    prev.id = 'kanji-prev';
    prev.name = 'prev';
    prev.textContent = 'Prev';

    const next = document.createElement('button');
    next.className = 'button';
    next.id = 'kanji-next';
    next.name = 'next';
    next.textContent = 'Next';

    prev.addEventListener('click', async () => {
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        render();
      }
    });

    next.addEventListener('click', async () => {
      if (index < total - 1) {
        index += 1;
        shownAt = nowMs();
        render();
      }
    });

    controls.append(prev, next);

    wrapper.append(cornerCaption, body, controls);
  }

  render();

  // Keyboard navigation
  const keyHandler = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        render();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < entries.length - 1) {
        index += 1;
        shownAt = nowMs();
        render();
      }
    }
  };

  wrapper.addEventListener('keydown', keyHandler);
  document.addEventListener('keydown', keyHandler);

  // Cleanup on unmount
  setTimeout(() => {
    const observer = new MutationObserver((mutations) => {
      if (!document.body.contains(wrapper)) {
        document.removeEventListener('keydown', keyHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 100);

  el.append(wrapper);
  return el;
}