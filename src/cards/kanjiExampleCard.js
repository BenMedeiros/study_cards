// Factory for creating a Kanji related-item card element with internal carousel controls.
// Uses existing CSS classes defined in src/styles.css.
import { settingsLog } from '../managers/settingsManager.js';
import { speak, getLanguageCode } from '../utils/speech.js';

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

  const placeholder = document.createElement('div');
  placeholder.className = 'hint kanji-related-empty';
  placeholder.style.marginTop = '0.5rem';
  placeholder.textContent = 'No related items.';

  const sentenceBtn = document.createElement('button');
  sentenceBtn.type = 'button';
  sentenceBtn.className = 'kanji-related-text kanji-related-jp';
  sentenceBtn.style.margin = '0.5rem 0 0';
  sentenceBtn.style.padding = '0';
  sentenceBtn.style.border = 'none';
  sentenceBtn.style.background = 'transparent';
  sentenceBtn.style.cursor = 'pointer';
  sentenceBtn.style.textAlign = 'left';
  sentenceBtn.title = 'Show sentence chunks';

  const chunksPanel = document.createElement('div');
  chunksPanel.style.marginTop = '0.75rem';
  chunksPanel.style.display = 'none';
  chunksPanel.style.borderLeft = '3px solid var(--line)';
  chunksPanel.style.paddingLeft = '0.75rem';

  const chunksHeader = document.createElement('div');
  chunksHeader.className = 'kanji-related-label';
  chunksHeader.textContent = 'Chunks';

  const chunksList = document.createElement('div');
  chunksList.style.display = 'flex';
  chunksList.style.flexDirection = 'column';
  chunksList.style.gap = '0.5rem';
  chunksList.style.marginTop = '0.5rem';

  chunksPanel.append(chunksHeader, chunksList);

  const enLabel = document.createElement('div');
  enLabel.className = 'kanji-related-label';
  enLabel.style.marginTop = '1rem';
  enLabel.textContent = secondaryLabel;

  const enText = document.createElement('div');
  enText.className = 'kanji-related-text kanji-related-en';
  enText.style.fontSize = '1rem';
  enText.style.color = 'var(--text)';
  enText.style.opacity = '0.9';

  const notesLabel = document.createElement('div');
  notesLabel.className = 'kanji-related-label';
  notesLabel.style.marginTop = '1rem';
  notesLabel.textContent = 'Notes';

  const notesList = document.createElement('ul');
  notesList.className = 'kanji-related-notes';

  root.append(
    header,
    placeholder,
    sentenceBtn,
    chunksPanel,
    enLabel,
    enText,
    notesLabel,
    notesList
  );

  let currentIndex = 0;
  let showChunks = false;
  let selectedChunkIndex = -1;

  function firstDefinedString(obj, keys = []) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }

  function extractSentencesFromEntry(ent) {
    if (!ent || typeof ent !== 'object') return [];
    if (Array.isArray(ent.relatedCollections?.sentences)) return ent.relatedCollections.sentences.slice();
    const hasSentenceFields = firstDefinedString(ent, [...primaryKeys, ...secondaryKeys, 'sentence']) || Array.isArray(ent?.chunks);
    if (hasSentenceFields) return [ent];
    return [];
  }

  function getCurrentItem() {
    const listItems = extractSentencesFromEntry(entry);
    return { listItems, item: listItems[currentIndex] || null };
  }

  function renderControls(listItems) {
    const count = listItems.length;
    counter.textContent = count ? `${currentIndex + 1} / ${count}` : '';
    prevBtn.style.display = count > 1 ? '' : 'none';
    nextBtn.style.display = count > 1 ? '' : 'none';
    counter.style.display = count ? '' : 'none';
  }

  function setEntry(newEntry) {
    settingsLog('[Card:Related] setEntry()', newEntry);
    entry = newEntry || null;
    currentIndex = 0;
    showChunks = false;
    selectedChunkIndex = -1;
    render();
  }

  function renderChunkList(chunks = []) {
    chunksList.innerHTML = '';
    if (!Array.isArray(chunks) || !chunks.length) {
      const empty = document.createElement('div');
      empty.className = 'kanji-related-label';
      empty.textContent = 'No chunks available for this sentence.';
      chunksList.appendChild(empty);
      return;
    }

    if (selectedChunkIndex < 0 || selectedChunkIndex >= chunks.length) {
      selectedChunkIndex = 0;
    }

    chunks.forEach((chunk, i) => {
      const row = document.createElement('div');
      row.style.border = '1px solid var(--line)';
      row.style.borderRadius = '8px';
      row.style.padding = '0.5rem 0.65rem';
      row.style.background = i === selectedChunkIndex ? 'var(--panel)' : 'transparent';
      row.style.borderLeft = i === selectedChunkIndex ? '4px solid var(--accent)' : '4px solid transparent';

      const chunkBtn = document.createElement('button');
      chunkBtn.type = 'button';
      chunkBtn.style.width = '100%';
      chunkBtn.style.textAlign = 'left';
      chunkBtn.style.border = 'none';
      chunkBtn.style.background = 'transparent';
      chunkBtn.style.padding = '0';
      chunkBtn.style.cursor = 'pointer';
      chunkBtn.title = 'Show chunk details';

      const chunkTop = document.createElement('div');
      chunkTop.style.display = 'flex';
      chunkTop.style.alignItems = 'center';
      chunkTop.style.justifyContent = 'space-between';
      chunkTop.style.gap = '0.5rem';

      const ja = document.createElement('div');
      ja.className = 'kanji-related-text';
      ja.style.fontSize = '1rem';
      ja.style.flex = '1';
      ja.textContent = String(chunk?.ja || '');

      const chunkSpeakBtn = document.createElement('button');
      chunkSpeakBtn.type = 'button';
      chunkSpeakBtn.className = 'icon-button';
      chunkSpeakBtn.title = 'Listen to this chunk';
      chunkSpeakBtn.textContent = '🔊';

      chunkSpeakBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const text = String(chunk?.ja || '').trim();
        if (!text) return;
        if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, chunkIndex: i, entry });
        else speak(text, getLanguageCode('reading'));
      });

      const gloss = document.createElement('div');
      gloss.className = 'kanji-related-label';
      gloss.style.marginTop = '0.25rem';
      gloss.style.color = 'var(--text)';
      gloss.style.opacity = '0.85';
      gloss.style.fontSize = '0.95rem';
      gloss.textContent = String(chunk?.gloss || '');

      chunkTop.append(ja, chunkSpeakBtn);
      chunkBtn.append(chunkTop, gloss);
      row.appendChild(chunkBtn);

      if (i === selectedChunkIndex) {
        if (chunk?.focus) {
          const focus = document.createElement('div');
          focus.className = 'kanji-related-label';
          focus.style.marginTop = '0.4rem';
          focus.textContent = `Focus: ${chunk.focus}`;
          row.appendChild(focus);
        }
        if (Array.isArray(chunk?.refs) && chunk.refs.length) {
          const refs = document.createElement('div');
          refs.className = 'kanji-related-label';
          refs.style.marginTop = '0.25rem';
          refs.textContent = `Refs: ${chunk.refs.map((v) => String(v)).join(', ')}`;
          row.appendChild(refs);
        }
      }

      chunkBtn.addEventListener('click', () => {
        selectedChunkIndex = i;
        render();
      });
      chunksList.appendChild(row);
    });
  }

  function updateDisplay() {
    const { listItems, item } = getCurrentItem();
    renderControls(listItems);

    let jp = '';
    let en = '';
    let notes = [];
    let chunks = [];
    if (item && typeof item === 'object') {
      jp = firstDefinedString(item, primaryKeys);
      en = firstDefinedString(item, secondaryKeys);
      notes = Array.isArray(item.notes) ? item.notes : (item.note ? [item.note] : []);
      chunks = Array.isArray(item.chunks) ? item.chunks : [];
    } else if (typeof item === 'string') {
      jp = item;
    }

    const hasContent = !!(jp || en || notes.length || chunks.length);
    if (!hasContent) {
      placeholder.style.display = '';
      sentenceBtn.style.display = 'none';
      chunksPanel.style.display = 'none';
      enLabel.style.display = 'none';
      enText.style.display = 'none';
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
      return;
    }

    placeholder.style.display = 'none';
    sentenceBtn.style.display = jp ? '' : 'none';
    sentenceBtn.textContent = jp;
    sentenceBtn.setAttribute('aria-expanded', showChunks ? 'true' : 'false');
    chunksPanel.style.display = showChunks && chunks.length ? '' : 'none';
    if (showChunks && chunks.length) renderChunkList(chunks);

    enLabel.style.display = en ? '' : 'none';
    enText.style.display = en ? '' : 'none';
    enText.textContent = en;

    notesList.innerHTML = '';
    if (notes.length) {
      notesLabel.style.display = '';
      notesList.style.display = '';
      for (const n of notes) {
        const li = document.createElement('li');
        li.textContent = String(n);
        notesList.appendChild(li);
      }
    } else {
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
    }
  }

  function render() {
    settingsLog('[Card:Related] render()', { currentIndex, hasEntry: !!entry });
    updateDisplay();
  }

  prevBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const items = extractSentencesFromEntry(entry);
    if (!items.length) return;
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    showChunks = false;
    selectedChunkIndex = -1;
    render();
    handlers.onPrev && handlers.onPrev(currentIndex);
  });

  nextBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const items = extractSentencesFromEntry(entry);
    if (!items.length) return;
    currentIndex = (currentIndex + 1) % items.length;
    showChunks = false;
    selectedChunkIndex = -1;
    render();
    handlers.onNext && handlers.onNext(currentIndex);
  });

  sentenceBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const { item } = getCurrentItem();
    const chunks = Array.isArray(item?.chunks) ? item.chunks : [];
    if (!chunks.length) return;
    showChunks = !showChunks;
    if (showChunks && selectedChunkIndex < 0) selectedChunkIndex = 0;
    render();
  });

  speakBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const { item } = getCurrentItem();
    let text = '';
    if (typeof item === 'string') text = item;
    else text = firstDefinedString(item, primaryKeys);
    if (!text) text = (entry && (entry.sentence || entry.jp || entry.japanese || entry.text || entry.ja)) || '';
    if (!text) return;
    if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, entry });
    else speak(text, getLanguageCode('reading'));
  });

  function update(newEntry) {
    settingsLog('[Card:Related] update()', { hasEntry: !!newEntry });
    if (newEntry) entry = newEntry;
    currentIndex = 0;
    showChunks = false;
    selectedChunkIndex = -1;
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
    const f = String(field || '').trim().toLowerCase();
    if (!f) return;
    if (f === 'english') enText.style.visibility = v ? '' : 'hidden';
    else if (f === 'japanese') sentenceBtn.style.visibility = v ? '' : 'hidden';
    else if (f === 'notes') notesList.style.visibility = v ? '' : 'hidden';
    else if (f === 'chunks') chunksPanel.style.visibility = v ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  setEntry(entry);
  render();

  return { el: root, update, setEntry, setVisible, setFieldVisible, setFieldsVisible, destroy };
}
