import { nowMs } from '../utils/helpers.js';
import { getCollectionView } from '../utils/collectionManagement.js';

export function renderFlashcards({ store }) {
  const el = document.createElement('div');
  el.id = 'flashcards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'flashcards-card';

  let active = store.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>Flashcards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  // derive entries view (study window + shuffle) from shared util
  function refreshFromStore() {
    active = store.getActiveCollection();
    const collState = (store && typeof store.loadCollectionState === 'function') ? store.loadCollectionState(active?.key) : null;
    entries = getCollectionView(active?.entries, collState, { windowSize: 10 }).entries;
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
  
    const controls = document.createElement('div');
    controls.className = 'cardtools-row cardtools-bottom';
    controls.id = 'flashcards-controls';

    if (!entry) {
      body.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
    } else {
      renderCard(body, entry);
    }

    const prev = document.createElement('button');
    prev.className = 'button';
    prev.id = 'flashcards-prev';
    prev.name = 'prev';
    prev.textContent = 'Prev';

    const next = document.createElement('button');
    next.className = 'button';
    next.id = 'flashcards-next';
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
      const timeOnCard = Math.round(nowMs() - shownAt);
      
      if (index < total - 1) {
        index += 1;
        shownAt = nowMs();
        render();
      }
    });

    controls.append(prev, next);
    
    wrapper.append(cornerCaption, toolsRow, body, controls);
  }

  render();

  // React to store changes (e.g., virtual set finishing its background resolution)
  let unsub = null;
  try {
    if (store && typeof store.subscribe === 'function') {
      let lastKey = store.getActiveCollection?.()?.key || null;
      unsub = store.subscribe(() => {
        try {
          const key = store.getActiveCollection?.()?.key || null;
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

  // Add keyboard navigation
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
  // Register the handler with the shell so shell controls app-level keyboard handling.
  // The handler should return true when it handled the event to stop further processing.
  const registerFlashcardsHandler = () => {
    const wrapped = (e) => {
      try {
        keyHandler(e);
        // keyHandler calls e.preventDefault when it handles keys; return true if default prevented
        return e.defaultPrevented === true;
      } catch (err) {
        return false;
      }
    };
    document.dispatchEvent(new CustomEvent('app:registerKeyHandler', { detail: { id: 'flashcards', handler: wrapped } }));
  };

  const unregisterFlashcardsHandler = () => {
    document.dispatchEvent(new CustomEvent('app:unregisterKeyHandler', { detail: { id: 'flashcards' } }));
  };

  // Register now for app-level handling
  setTimeout(registerFlashcardsHandler, 0);
  
  // Cleanup on unmount (not perfect but helps)
  setTimeout(() => {
    const observer = new MutationObserver((mutations) => {
      if (!document.body.contains(wrapper)) {
        unregisterFlashcardsHandler();
        try { if (typeof unsub === 'function') unsub(); } catch (e) {}
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 100);

  el.append(wrapper);
  return el;
}
