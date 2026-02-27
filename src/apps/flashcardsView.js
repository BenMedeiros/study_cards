import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';

import { createViewFooterControls } from '../components/viewFooterControls.js';
import collectionSettingsController from '../controllers/collectionSettingsController.js';
import flashcardsController from '../controllers/flashcardsController.js';

export function renderFlashcards({ store }) {
  const el = document.createElement('div');
  el.id = 'flashcards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'flashcards-card';

  let active = store.collections.getActiveCollection();
    let flashController = null;
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
    // setup controller bound to active collection
    if (flashController && flashController.collKey !== (active && active.key)) {
      try { flashController.dispose(); } catch (e) {}
      flashController = null;
    }
    if (!flashController && active && active.key) flashController = flashcardsController.create(active.key);
    const collState = (res?.collState && typeof res.collState === 'object') ? res.collState : {};
    entries = Array.isArray(res?.view?.entries) ? res.view.entries.slice() : [];
    // restore per-app index once (no legacy fallback)
    if (!uiStateRestored) {
      const savedIndex = (collState && collState.flashcardsView && typeof collState.flashcardsView.currentIndex === 'number')
        ? collState.flashcardsView.currentIndex
        : undefined;
      if (typeof savedIndex === 'number' && Number.isFinite(savedIndex)) index = Math.max(0, Math.min(entries.length - 1, Math.round(savedIndex)));
      uiStateRestored = true;
    }
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
  }

  let entries = [];
  let index = 0;
  let uiStateRestored = false;
  let shownAt = nowMs();
  const progressTracker = store?.kanjiProgress?.createCardProgressTracker?.({
    appId: 'flashcardsView',
    getCollectionKey: () => String(active?.key || '').trim(),
    getEntryKey: () => {
      const entry = entries && entries.length ? entries[index] : null;
      const primary = getPrimaryValue(entry);
      const pattern = String(entry?.pattern || '').trim();
      return primary || pattern || '';
    },
  });

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
  function getFooterButton(key) {
    if (!footerControls) return null;
    if (typeof footerControls.getButton === 'function') return footerControls.getButton(key);
    return (footerControls.buttons && footerControls.buttons[key]) || null;
  }

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }
  function speakCurrent() { if (entries[index]) speakEntry(entries[index]); }

  function goToIndex(newIndex) {
    if (newIndex < 0 || newIndex >= entries.length) return;
    progressTracker?.flush?.();
    index = newIndex;
    shownAt = nowMs();
    (flashController || flashcardsController.create(active?.key)).setCurrentIndex(index);
    render();
  }

  function updateMarkButtons() {
    const learnedBtn = getFooterButton('learned');
    const practiceBtn = getFooterButton('practice');
    if (!learnedBtn || !practiceBtn) return;
    const entry = entries[index];
    const v = getPrimaryValue(entry);
    const collectionKey = String(active?.key || '').trim();
    const isLearned = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiLearned === 'function' && v) ? store.kanjiProgress.isKanjiLearned(v, { collectionKey }) : false;
    const isFocus = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiFocus === 'function' && v) ? store.kanjiProgress.isKanjiFocus(v, { collectionKey }) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', actionKey: 'prev', fnName: 'showPrev', action: () => showPrev() },
    { key: 'sound', icon: '🔊', text: 'Sound', caption: 'Space', shortcut: ' ', actionKey: 'sound', fnName: 'speakCurrent', action: () => speakCurrent() },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', actionKey: 'learned', fnName: 'toggleKanjiLearned', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = getPrimaryValue(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiLearned === 'function') {
        store.kanjiProgress.toggleKanjiLearned(v, { collectionKey: String(active?.key || '').trim() });
        updateMarkButtons();
        // If current card became filtered out (skipLearned/focusOnly), refresh view & clamp
        refreshFromStore();
        index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
        render();
      }
    } },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', actionKey: 'practice', fnName: 'toggleKanjiFocus', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = getPrimaryValue(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiFocus === 'function') {
        store.kanjiProgress.toggleKanjiFocus(v, { collectionKey: String(active?.key || '').trim() });
        updateMarkButtons();
        // If current card became filtered out (skipLearned/focusOnly), refresh view & clamp
        refreshFromStore();
        index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
        render();
      }
    } },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', actionKey: 'next', fnName: 'showNext', action: () => showNext() },
  ];

  const footerControls = createViewFooterControls(footerDesc, { appId: 'flashcards' });

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
    try { progressTracker?.syncToCurrent?.(); } catch (e) {}
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
            try { progressTracker?.flush?.({ immediate: true }); } catch (e) {}
            lastKey = key;
            // New active collection: allow restoration from saved per-app state
            uiStateRestored = false;
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
      try { progressTracker?.teardown?.(); } catch (e) {}
      try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  el.append(wrapper);
  el.append(footerControls.el);
  return el;
}
