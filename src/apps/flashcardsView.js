import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';

import { createViewFooterControls } from '../components/viewFooterControls.js';

export function renderFlashcards({ store }) {
  const el = document.createElement('div');
  el.id = 'flashcards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'flashcards-card';

  let active = store.collections.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>Flashcards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  function getPrimaryValue(entry) {
    return String(store.collections.getEntryStudyKey(entry) || '').trim();
  }

  function speakEntry(entry) {
    if (!entry) return;
    const primary = getFieldValue(entry, ['reading', 'kana', 'word', 'text']);
    const fallback = getFieldValue(entry, ['kanji', 'character', 'text']);
    const speakText = primary || fallback || '';
    if (!speakText) return;
    const fieldKey = primary ? 'reading' : 'kanji';
    const lang = getLanguageCode(fieldKey, active?.metadata?.category);
    speak(speakText, lang);
  }

  // derive entries view (study window + shuffle) from shared util
  function refreshFromStore() {
    const res = store.collections.getActiveCollectionView({ windowSize: 10 });
    active = res?.collection || null;
    entries = Array.isArray(res?.view?.entries) ? res.view.entries.slice() : [];
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  let entries = [];
  let index = 0;
  let shownAt = nowMs();

  refreshFromStore();

  function renderCard(body, entry) {
    const fields = Array.isArray(active?.metadata?.fields) ? active.metadata.fields : [];

    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'kv';
      const key = document.createElement('div');
      key.className = 'k';
      key.textContent = field.label ?? field.key;

      const val = document.createElement('div');
      val.className = 'v';
      val.textContent = entry[field.key] ?? '';

      row.append(key, val);
      body.append(row);
    }
  }

  // Footer controls (shared component) — mirrors kanjiStudyCard actions except reveal/hide
  let learnedBtn, practiceBtn;

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }
  function speakCurrent() { if (entries[index]) speakEntry(entries[index]); }

  function goToIndex(newIndex) {
    if (newIndex < 0 || newIndex >= entries.length) return;
    index = newIndex;
    shownAt = nowMs();
    render();
  }

  function updateMarkButtons() {
    if (!learnedBtn || !practiceBtn) return;
    const entry = entries[index];
    const v = getPrimaryValue(entry);
    const isLearned = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiLearned === 'function' && v) ? store.kanjiProgress.isKanjiLearned(v) : false;
    const isFocus = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiFocus === 'function' && v) ? store.kanjiProgress.isKanjiFocus(v) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', action: () => showPrev() },
    { key: 'sound', icon: '🔊', text: 'Sound', caption: 'Space', shortcut: ' ', action: () => speakCurrent() },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = getPrimaryValue(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiLearned === 'function') {
        store.kanjiProgress.toggleKanjiLearned(v);
        updateMarkButtons();
        // If current card became filtered out (skipLearned/focusOnly), refresh view & clamp
        refreshFromStore();
        index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
        render();
      }
    } },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = getPrimaryValue(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiFocus === 'function') {
        store.kanjiProgress.toggleKanjiFocus(v);
        updateMarkButtons();
        // If current card became filtered out (skipLearned/focusOnly), refresh view & clamp
        refreshFromStore();
        index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
        render();
      }
    } },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', action: () => showNext() },
  ];

  const footerControls = createViewFooterControls(footerDesc, { appId: 'flashcards' });
  learnedBtn = footerControls.buttons.learned;
  practiceBtn = footerControls.buttons.practice;

  function render() {
    // active may have changed via store updates
    if (!active) {
      wrapper.innerHTML = '<h2>Flashcards</h2><p class="hint">No active collection.</p>';
      return;
    }
    const entry = entries[index];
    const total = entries.length;

    wrapper.innerHTML = '';

    const cornerCaption = document.createElement('div');
    cornerCaption.className = 'card-corner-caption';
    cornerCaption.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    const toolsRow = document.createElement('div');
    toolsRow.className = 'cardtools-row';
    toolsRow.id = 'flashcards-tools';

    const body = document.createElement('div');
    body.id = 'flashcards-body';
  
    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else {
      renderCard(body, entry);
    }

    wrapper.append(cornerCaption, toolsRow, body);

    // Update learned/focus button state
    updateMarkButtons();
  }

  render();

  // React to store changes (e.g., virtual set finishing its background resolution)
  let unsub = null;
  try {
    if (store && typeof store.subscribe === 'function') {
      let lastKey = store?.collections?.getActiveCollection?.()?.key || null;
      unsub = store.subscribe(() => {
        try {
          const key = store?.collections?.getActiveCollection?.()?.key || null;
          if (key !== lastKey) {
            lastKey = key;
            index = 0;
          }
          refreshFromStore();
          render();
        } catch (e) {
          // ignore
        }
      });
    }
  } catch (e) {
    unsub = null;
  }

  // Cleanup on unmount
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  el.append(wrapper);
  el.append(footerControls.el);
  return el;
}
