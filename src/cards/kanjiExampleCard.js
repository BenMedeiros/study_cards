// Factory for creating a Kanji related-item card element with internal carousel controls.
// Uses existing CSS classes defined in src/styles.css.
import { settingsLog } from '../managers/settingsManager.js';

export function createKanjiRelatedCard({ entry = null, handlers = {}, config = {} } = {}) {
  settingsLog('[Card:Related] createKanjiRelatedCard()', { entry });
  const root = document.createElement('div');
  root.className = 'card kanji-related-card';

  const itemLabel = String(config?.itemLabel || 'Related');
  const secondaryLabel = String(config?.secondaryLabel || 'English');
  const primaryKeys = Array.isArray(config?.primaryKeys) && config.primaryKeys.length
    ? config.primaryKeys.slice()
    : ['jp', 'ja', 'japanese', 'text', 'sentence'];
  const secondaryKeys = Array.isArray(config?.secondaryKeys) && config.secondaryKeys.length
    ? config.secondaryKeys.slice()
    : ['en', 'en_us', 'eng', 'english', 'translation'];

  const header = document.createElement('div');
  header.className = 'kanji-related-header';

  const label = document.createElement('div');
  label.className = 'kanji-related-label';
  label.textContent = itemLabel;

  const controls = document.createElement('div');
  controls.className = 'related-carousel-controls';
  controls.style.display = 'flex';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'icon-button';
  prevBtn.title = `Previous ${itemLabel.toLowerCase()}`;
  prevBtn.textContent = '◀';

  const counter = document.createElement('div');
  counter.className = 'kanji-related-label';
  counter.style.margin = '0 8px';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'icon-button';
  nextBtn.title = `Next ${itemLabel.toLowerCase()}`;
  nextBtn.textContent = '▶';

  const speakWrapper = document.createElement('div');
  const speakBtn = document.createElement('button');
  speakBtn.className = 'icon-button';
  speakBtn.title = 'Listen';
  speakBtn.textContent = '🔊';
  speakWrapper.appendChild(speakBtn);

  controls.append(prevBtn, counter, nextBtn);
  header.append(label, controls, speakWrapper);

  const jpText = document.createElement('div');
  jpText.className = 'kanji-related-text kanji-related-jp';

  const placeholder = document.createElement('div');
  placeholder.className = 'hint kanji-related-empty';
  placeholder.style.marginTop = '0.5rem';
  placeholder.textContent = 'No related items.';

  const enLabel = document.createElement('div');
  enLabel.className = 'kanji-related-label';
  enLabel.style.marginTop = '1rem';
  enLabel.textContent = secondaryLabel;

  const enText = document.createElement('div');
  enText.className = 'kanji-related-text kanji-related-en';
  enText.style.fontSize = '1rem';

  const notesLabel = document.createElement('div');
  notesLabel.className = 'kanji-related-label';
  notesLabel.style.marginTop = '1rem';
  notesLabel.textContent = 'Notes';

  const notesList = document.createElement('ul');
  notesList.className = 'kanji-related-notes';

  root.append(header, placeholder, jpText, enLabel, enText, notesLabel, notesList);

  let currentIndex = 0;
  // Only accept `entry` as the source of truth for related items.
  function extractSentencesFromEntry(ent) {
    if (!ent || typeof ent !== 'object') return [];
    // Prefer collection-specific related data if present, then legacy containers
    settingsLog('[Card:Related] extractSentencesFromEntry(): keys', Object.keys(ent || {}));
    if (Array.isArray(ent.relatedCollections?.sentences)) {
      settingsLog('[Card:Related] using relatedCollections.sentences', ent.relatedCollections.sentences.length);
      return ent.relatedCollections.sentences.slice();
    }
    return [];
  }

  let listItems = extractSentencesFromEntry(entry);

  function firstDefinedString(obj, keys = []) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }

  function renderControls() {
    const count = listItems.length;
    counter.textContent = count ? `${currentIndex + 1} / ${count}` : '';
    prevBtn.style.display = count > 1 ? '' : 'none';
    nextBtn.style.display = count > 1 ? '' : 'none';
    counter.style.display = count ? '' : 'none';
  }

  // Standard API: accept `entry` and derive sentences from entry.relatedCollections.sentences
  function setEntry(newEntry) {
    settingsLog('[Card:Related] setEntry()', newEntry);
    entry = newEntry || null;
    listItems = extractSentencesFromEntry(entry);
    settingsLog('[Card:Related] setEntry => listItems.length', Array.isArray(listItems) ? listItems.length : 0, listItems && listItems[0]);
    currentIndex = 0;
    render();
  }

  // Internal DOM update helper (no debug) so callers can avoid emitting a separate
  // `render` debug line when they're already logging an action like `setEntry`.
  function updateDisplay() {
    renderControls();
    const s = listItems[currentIndex] || null;
    // sentence object can be string or { jp, en, notes }
    let jp = '', en = '', notes = [];
    if (s) {
      if (typeof s === 'string') jp = s;
      else {
        jp = firstDefinedString(s, primaryKeys);
        en = firstDefinedString(s, secondaryKeys);
        notes = Array.isArray(s.notes) ? s.notes : (s.note ? [s.note] : []);
      }
    }
    // fallback to entry-level fields when available
    if (!jp) jp = firstDefinedString(entry, ['sentence', 'jp', 'ja', 'japanese', 'text']);
    if (!en) en = firstDefinedString(entry, ['english', 'en', 'translation']);
    const hasContent = !!(jp || en || (Array.isArray(notes) && notes.length));

    if (!hasContent && (!Array.isArray(listItems) || listItems.length === 0)) {
      // No related data and no fallback content: show only header + placeholder for consistency.
      settingsLog('[Card:Related] updateDisplay(): no content; listItems.length=', Array.isArray(listItems) ? listItems.length : 0);
      placeholder.style.display = '';
      jpText.style.display = 'none';
      enLabel.style.display = 'none';
      enText.style.display = 'none';
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
    } else {
      // Show the content areas and populate them. Hide placeholder.
      placeholder.style.display = 'none';
      jpText.style.display = '';
      enLabel.style.display = '';
      enText.style.display = '';
      notesLabel.style.display = '';
      notesList.style.display = '';

      jpText.textContent = jp;
      enText.textContent = en;

      // rebuild notes
      notesList.innerHTML = '';
      if (Array.isArray(notes) && notes.length) {
        for (const n of notes) {
          const li = document.createElement('li');
          li.textContent = String(n);
          notesList.appendChild(li);
        }
      }
    }
  }

  function render() {
    settingsLog('[Card:Related] render()', { currentIndex, listItemsLength: Array.isArray(listItems) ? listItems.length : 0, entrySample: entry ? (entry.sentence || entry.jp || entry.japanese || entry.text) : null });
    updateDisplay();
  }

  prevBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!listItems.length) return;
    currentIndex = (currentIndex - 1 + listItems.length) % listItems.length;
    render();
    handlers.onPrev && handlers.onPrev(currentIndex);
  });

  nextBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!listItems.length) return;
    currentIndex = (currentIndex + 1) % listItems.length;
    render();
    handlers.onNext && handlers.onNext(currentIndex);
  });

  speakBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const cur = listItems[currentIndex] || {};
    let text = '';
    if (typeof cur === 'string') text = cur;
    else {
      text = firstDefinedString(cur, primaryKeys);
    }
    // fallback to entry-level sentence if individual item lacks JP text
    if (!text) text = (entry && (entry.sentence || entry.jp || entry.japanese || entry.text)) || '';
    if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, entry });
  });

  function update(newEntry) {
    settingsLog('[Card:Related] update()', { newEntrySample: newEntry ? (newEntry.sentence || newEntry.jp || newEntry.japanese || newEntry.text) : null });
    if (newEntry) entry = newEntry;
    listItems = extractSentencesFromEntry(entry);
    currentIndex = 0;
    render();
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  // Generic field visibility API
  function setFieldVisible(field, visible) {
    const v = !!visible;
    const f = String(field || '').trim();
    if (!f) return;
    if (f === 'english') enText.style.visibility = v ? '' : 'hidden';
    else if (f === 'japanese') jpText.style.visibility = v ? '' : 'hidden';
    else if (f === 'notes') notesList.style.visibility = v ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  // initialize from `entry`
  setEntry(entry);
  render();

  return { el: root, update, setEntry, setVisible, setFieldVisible, setFieldsVisible, destroy };
}
