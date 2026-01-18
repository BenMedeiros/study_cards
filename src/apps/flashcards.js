import { nowMs } from '../utils/helpers.js';

export function renderFlashcards({ store }) {
  const el = document.createElement('div');
  el.id = 'flashcards-root';

  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  wrapper.id = 'flashcards-card';

  const active = store.getActiveCollection();
  if (!active) {
    wrapper.innerHTML = '<h2>Flashcards</h2><p class="hint">No active collection.</p>';
    el.append(wrapper);
    return el;
  }

  let entries = active.entries;
  let index = 0;
  let shownAt = nowMs();

  function renderCard(body, entry) {
    const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];

    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'kv';
      const key = document.createElement('div');
      key.className = 'k';
      key.textContent = field.label ?? field.key;

      const val = document.createElement('div');
      val.textContent = entry[field.key] ?? '';

      row.append(key, val);
      body.append(row);
    }
  }

  function render() {
    const entry = entries[index];
    const total = entries.length;

    wrapper.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'row';
    headerRow.id = 'flashcards-header';

    const title = document.createElement('h2');
    title.id = 'flashcards-title';
    title.style.margin = '0';
    title.textContent = `Flashcards — ${active.metadata.name}`;

    const pos = document.createElement('div');
    pos.className = 'badge';
    pos.id = 'flashcards-position';
    pos.textContent = total ? `${index + 1} / ${total}` : 'Empty';

    headerRow.append(title, pos);

    const body = document.createElement('div');
    body.id = 'flashcards-body';
    body.style.marginTop = '10px';
    
    const controls = document.createElement('div');
    controls.className = 'row';
    controls.id = 'flashcards-controls';
    controls.style.marginTop = '12px';

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
      await store.logEvent({
        type: 'flashcards.prev',
        collectionId: active.metadata.id,
        entryId: entry?.id ?? null,
        msOnCard: Math.round(nowMs() - shownAt),
      });
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        render();
      }
    });

    next.addEventListener('click', async () => {
      const timeOnCard = Math.round(nowMs() - shownAt);
      await store.logEvent({
        type: 'flashcards.next',
        collectionId: active.metadata.id,
        entryId: entry?.id ?? null,
        msOnCard: timeOnCard,
      });
      
      if (index < total - 1) {
        index += 1;
        shownAt = nowMs();
        render();
      }
    });

    controls.append(prev, next);
    
    const keyHint = document.createElement('div');
    keyHint.className = 'hint';
    keyHint.style.fontSize = '11px';
    keyHint.style.marginTop = '6px';
    keyHint.style.textAlign = 'center';
    keyHint.textContent = 'Use ← → arrow keys to navigate';
    
    wrapper.append(headerRow, body, controls, keyHint);
  }

  render();

  // Add keyboard navigation
  const keyHandler = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        index -= 1;
        shownAt = nowMs();
        render();
        store.logEvent({
          type: 'flashcards.prev',
          collectionId: active.metadata.id,
          entryId: entries[index]?.id ?? null,
          msOnCard: 0,
        });
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < entries.length - 1) {
        index += 1;
        shownAt = nowMs();
        render();
        store.logEvent({
          type: 'flashcards.next',
          collectionId: active.metadata.id,
          entryId: entries[index]?.id ?? null,
          msOnCard: 0,
        });
      }
    }
  };

  wrapper.addEventListener('keydown', keyHandler);
  // Also listen at document level for better UX
  document.addEventListener('keydown', keyHandler);
  
  // Cleanup on unmount (not perfect but helps)
  setTimeout(() => {
    const observer = new MutationObserver((mutations) => {
      if (!document.body.contains(wrapper)) {
        document.removeEventListener('keydown', keyHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 100);

  store.logEvent({ type: 'flashcards.opened', collectionId: active.metadata.id }).catch(() => {});

  el.append(wrapper);
  return el;
}
