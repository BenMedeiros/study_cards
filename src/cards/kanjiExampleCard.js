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

  const fieldVisibility = {
    title: true,
    japanese: true,
    english: true,
    notes: true,
    sentences: true,
    chunks: true,
  };

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

  const titleLabel = document.createElement('div');
  titleLabel.className = 'kanji-related-label';
  titleLabel.style.marginTop = '0.5rem';
  titleLabel.textContent = 'Title';

  const titleText = document.createElement('div');
  titleText.className = 'kanji-related-text';
  titleText.style.fontSize = '1rem';
  titleText.style.fontWeight = '600';

  const primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  primaryBtn.className = 'kanji-related-text kanji-related-jp';
  primaryBtn.style.margin = '0.5rem 0 0';
  primaryBtn.style.padding = '0';
  primaryBtn.style.border = 'none';
  primaryBtn.style.background = 'transparent';
  primaryBtn.style.cursor = 'pointer';
  primaryBtn.style.textAlign = 'left';

  const sentencesPanel = document.createElement('div');
  sentencesPanel.style.marginTop = '0.75rem';
  sentencesPanel.style.display = 'none';
  sentencesPanel.style.borderLeft = '3px solid var(--line)';
  sentencesPanel.style.paddingLeft = '0.75rem';

  const sentencesHeader = document.createElement('div');
  sentencesHeader.className = 'kanji-related-label';
  sentencesHeader.textContent = 'Sentences';

  const sentencesList = document.createElement('div');
  sentencesList.style.display = 'flex';
  sentencesList.style.flexDirection = 'column';
  sentencesList.style.gap = '0.5rem';
  sentencesList.style.marginTop = '0.5rem';

  sentencesPanel.append(sentencesHeader, sentencesList);

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
    titleLabel,
    titleText,
    primaryBtn,
    sentencesPanel,
    chunksPanel,
    enLabel,
    enText,
    notesLabel,
    notesList
  );

  let currentIndex = 0;
  let showPrimaryDetails = false;
  let selectedSentenceIndex = -1;
  let showSentenceChunks = false;
  let selectedChunkIndex = -1;

  function firstDefinedString(obj, keys = []) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }

  function normalizeNotes(item) {
    if (Array.isArray(item?.notes)) return item.notes.map((n) => String(n)).filter(Boolean);
    if (typeof item?.note === 'string' && item.note.trim()) return [item.note.trim()];
    return [];
  }

  function normalizeChunks(chunks) {
    if (!Array.isArray(chunks)) return [];
    return chunks
      .filter((chunk) => chunk && typeof chunk === 'object')
      .map((chunk) => ({
        ja: String(chunk.ja || ''),
        gloss: String(chunk.gloss || chunk.en || ''),
        focus: String(chunk.focus || chunk.pattern || ''),
        refs: Array.isArray(chunk.refs) ? chunk.refs.map((v) => String(v)).filter(Boolean) : [],
      }));
  }

  function normalizeSentence(sentence) {
    if (!sentence || typeof sentence !== 'object') {
      return { ja: '', en: '', notes: [], pattern: '', chunks: [] };
    }
    return {
      ja: firstDefinedString(sentence, primaryKeys),
      en: firstDefinedString(sentence, secondaryKeys),
      notes: normalizeNotes(sentence),
      pattern: String(sentence.pattern || ''),
      chunks: normalizeChunks(sentence.chunks),
    };
  }

  function normalizeItem(rawItem) {
    if (typeof rawItem === 'string') {
      return {
        raw: rawItem,
        sourceName: '',
        title: '',
        jp: rawItem,
        en: '',
        notes: [],
        chunks: [],
        sentences: [],
        kind: 'text',
      };
    }
    const item = (rawItem && typeof rawItem === 'object') ? rawItem : {};
    const sentences = Array.isArray(item.sentences) ? item.sentences.map(normalizeSentence) : [];
    const chunks = normalizeChunks(item.chunks);
    const kind = sentences.length ? 'paragraph' : (chunks.length ? 'sentence' : 'text');
    return {
      raw: item,
      sourceName: String(item.__relatedCollectionName || ''),
      title: String(item.title || item.heading || item.name || ''),
      jp: firstDefinedString(item, primaryKeys),
      en: firstDefinedString(item, secondaryKeys),
      notes: normalizeNotes(item),
      chunks,
      sentences,
      kind,
    };
  }

  function extractRelatedItemsFromEntry(ent) {
    if (!ent || typeof ent !== 'object') return [];
    const out = [];
    if (ent.relatedCollections && typeof ent.relatedCollections === 'object') {
      for (const [name, items] of Object.entries(ent.relatedCollections)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (item && typeof item === 'object') out.push({ ...item, __relatedCollectionName: name });
          else out.push(item);
        }
      }
    }
    if (out.length) return out;
    const hasFields = firstDefinedString(ent, [...primaryKeys, ...secondaryKeys, 'sentence'])
      || Array.isArray(ent?.chunks)
      || Array.isArray(ent?.sentences);
    return hasFields ? [ent] : [];
  }

  function getCurrentItem() {
    const listItems = extractRelatedItemsFromEntry(entry).map(normalizeItem);
    return { listItems, item: listItems[currentIndex] || null };
  }

  function renderControls(listItems) {
    const count = listItems.length;
    counter.textContent = count ? `${currentIndex + 1} / ${count}` : '';
    prevBtn.style.display = count > 1 ? '' : 'none';
    nextBtn.style.display = count > 1 ? '' : 'none';
    counter.style.display = count ? '' : 'none';
  }

  function resetExpandedState() {
    showPrimaryDetails = false;
    selectedSentenceIndex = -1;
    showSentenceChunks = false;
    selectedChunkIndex = -1;
  }

  function setEntry(newEntry) {
    settingsLog('[Card:Related] setEntry()', newEntry);
    entry = newEntry || null;
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function renderChunkList(target, chunks = [], { emptyMessage = 'No chunks available for this text.' } = {}) {
    target.innerHTML = '';
    if (!Array.isArray(chunks) || !chunks.length) {
      const empty = document.createElement('div');
      empty.className = 'kanji-related-label';
      empty.textContent = emptyMessage;
      target.appendChild(empty);
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
          refs.textContent = `Refs: ${chunk.refs.join(', ')}`;
          row.appendChild(refs);
        }
      }

      chunkBtn.addEventListener('click', () => {
        selectedChunkIndex = i;
        render();
      });
      target.appendChild(row);
    });
  }

  function renderSentenceList(sentences = []) {
    sentencesList.innerHTML = '';
    if (!Array.isArray(sentences) || !sentences.length) {
      const empty = document.createElement('div');
      empty.className = 'kanji-related-label';
      empty.textContent = 'No sentences available for this text.';
      sentencesList.appendChild(empty);
      return;
    }

    sentences.forEach((sentence, i) => {
      const row = document.createElement('div');
      row.style.border = '1px solid var(--line)';
      row.style.borderRadius = '8px';
      row.style.padding = '0.5rem 0.65rem';
      row.style.background = (i === selectedSentenceIndex && showSentenceChunks) ? 'var(--panel)' : 'transparent';
      row.style.borderLeft = (i === selectedSentenceIndex && showSentenceChunks) ? '4px solid var(--accent)' : '4px solid transparent';

      const sentenceBtn = document.createElement('button');
      sentenceBtn.type = 'button';
      sentenceBtn.style.width = '100%';
      sentenceBtn.style.textAlign = 'left';
      sentenceBtn.style.border = 'none';
      sentenceBtn.style.background = 'transparent';
      sentenceBtn.style.padding = '0';
      sentenceBtn.style.cursor = 'pointer';
      sentenceBtn.title = fieldVisibility.chunks ? 'Show sentence chunks' : 'Show sentence details';

      const sentenceTop = document.createElement('div');
      sentenceTop.style.display = 'flex';
      sentenceTop.style.alignItems = 'center';
      sentenceTop.style.justifyContent = 'space-between';
      sentenceTop.style.gap = '0.5rem';

      const sentenceJa = document.createElement('div');
      sentenceJa.className = 'kanji-related-text';
      sentenceJa.style.fontSize = '1rem';
      sentenceJa.style.flex = '1';
      sentenceJa.textContent = sentence.ja;

      const sentenceSpeakBtn = document.createElement('button');
      sentenceSpeakBtn.type = 'button';
      sentenceSpeakBtn.className = 'icon-button';
      sentenceSpeakBtn.title = 'Listen to this sentence';
      sentenceSpeakBtn.textContent = '🔊';
      sentenceSpeakBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const text = String(sentence.ja || '').trim();
        if (!text) return;
        if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, sentenceIndex: i, entry });
        else speak(text, getLanguageCode('reading'));
      });

      sentenceTop.append(sentenceJa, sentenceSpeakBtn);
      sentenceBtn.appendChild(sentenceTop);

      if (fieldVisibility.english && sentence.en) {
        const sentenceEn = document.createElement('div');
        sentenceEn.className = 'kanji-related-label';
        sentenceEn.style.marginTop = '0.25rem';
        sentenceEn.style.color = 'var(--text)';
        sentenceEn.style.opacity = '0.85';
        sentenceEn.style.fontSize = '0.95rem';
        sentenceEn.textContent = sentence.en;
        sentenceBtn.appendChild(sentenceEn);
      }

      row.appendChild(sentenceBtn);

      if (i === selectedSentenceIndex && showSentenceChunks) {
        if (sentence.pattern) {
          const pattern = document.createElement('div');
          pattern.className = 'kanji-related-label';
          pattern.style.marginTop = '0.4rem';
          pattern.textContent = `Pattern: ${sentence.pattern}`;
          row.appendChild(pattern);
        }
        if (sentence.notes.length) {
          const note = document.createElement('div');
          note.className = 'kanji-related-label';
          note.style.marginTop = '0.25rem';
          note.textContent = sentence.notes.join(' | ');
          row.appendChild(note);
        }
        if (fieldVisibility.chunks) {
          const chunkMount = document.createElement('div');
          chunkMount.style.marginTop = '0.5rem';
          chunkMount.style.display = 'flex';
          chunkMount.style.flexDirection = 'column';
          chunkMount.style.gap = '0.5rem';
          renderChunkList(chunkMount, sentence.chunks, { emptyMessage: 'No chunks available for this sentence.' });
          row.appendChild(chunkMount);
        }
      }

      sentenceBtn.addEventListener('click', () => {
        if (selectedSentenceIndex === i) showSentenceChunks = !showSentenceChunks;
        else {
          selectedSentenceIndex = i;
          showSentenceChunks = true;
          selectedChunkIndex = -1;
        }
        render();
      });

      sentencesList.appendChild(row);
    });
  }

  function updateDisplay() {
    const { listItems, item } = getCurrentItem();
    renderControls(listItems);

    const current = item || {
      title: '',
      jp: '',
      en: '',
      notes: [],
      chunks: [],
      sentences: [],
      kind: 'text',
    };

    const hasContent = !!(current.title || current.jp || current.en || current.notes.length || current.chunks.length || current.sentences.length);
    if (!hasContent) {
      placeholder.style.display = '';
      titleLabel.style.display = 'none';
      titleText.style.display = 'none';
      primaryBtn.style.display = 'none';
      sentencesPanel.style.display = 'none';
      chunksPanel.style.display = 'none';
      enLabel.style.display = 'none';
      enText.style.display = 'none';
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
      return;
    }

    placeholder.style.display = 'none';

    const hasTitle = fieldVisibility.title && !!current.title;
    titleLabel.style.display = hasTitle ? '' : 'none';
    titleText.style.display = hasTitle ? '' : 'none';
    titleText.textContent = current.title;

    const canExpandSentences = current.sentences.length && fieldVisibility.sentences;
    const canExpandChunks = current.chunks.length && fieldVisibility.chunks;
    const canExpand = canExpandSentences || canExpandChunks;

    primaryBtn.style.display = (fieldVisibility.japanese && current.jp) ? '' : 'none';
    primaryBtn.textContent = current.jp;
    primaryBtn.style.cursor = canExpand ? 'pointer' : 'default';
    primaryBtn.title = canExpandSentences
      ? 'Show passage sentences'
      : (canExpandChunks ? 'Show text chunks' : 'No expandable details');
    primaryBtn.setAttribute('aria-expanded', showPrimaryDetails ? 'true' : 'false');

    sentencesPanel.style.display = showPrimaryDetails && canExpandSentences ? '' : 'none';
    chunksPanel.style.display = showPrimaryDetails && !canExpandSentences && canExpandChunks ? '' : 'none';

    if (showPrimaryDetails && canExpandSentences) renderSentenceList(current.sentences);
    if (showPrimaryDetails && !canExpandSentences && canExpandChunks) {
      chunksHeader.textContent = 'Chunks';
      renderChunkList(chunksList, current.chunks, { emptyMessage: 'No chunks available for this text.' });
    }

    enLabel.style.display = (fieldVisibility.english && current.en) ? '' : 'none';
    enText.style.display = (fieldVisibility.english && current.en) ? '' : 'none';
    enText.textContent = current.en;

    notesList.innerHTML = '';
    if (fieldVisibility.notes && current.notes.length) {
      notesLabel.style.display = '';
      notesList.style.display = '';
      for (const n of current.notes) {
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
    const items = extractRelatedItemsFromEntry(entry);
    if (!items.length) return;
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    resetExpandedState();
    render();
    handlers.onPrev && handlers.onPrev(currentIndex);
  });

  nextBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const items = extractRelatedItemsFromEntry(entry);
    if (!items.length) return;
    currentIndex = (currentIndex + 1) % items.length;
    resetExpandedState();
    render();
    handlers.onNext && handlers.onNext(currentIndex);
  });

  primaryBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const { item } = getCurrentItem();
    const canExpand = (item?.sentences?.length && fieldVisibility.sentences) || (item?.chunks?.length && fieldVisibility.chunks);
    if (!canExpand) return;
    showPrimaryDetails = !showPrimaryDetails;
    if (!showPrimaryDetails) {
      selectedSentenceIndex = -1;
      showSentenceChunks = false;
      selectedChunkIndex = -1;
    }
    render();
  });

  speakBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const { item } = getCurrentItem();
    const text = String(item?.jp || '').trim();
    if (!text) return;
    if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, entry });
    else speak(text, getLanguageCode('reading'));
  });

  function update(newEntry) {
    settingsLog('[Card:Related] update()', { hasEntry: !!newEntry });
    if (newEntry) entry = newEntry;
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function setFieldVisible(field, visible) {
    const f = String(field || '').trim().toLowerCase();
    if (!f) return;
    if (Object.prototype.hasOwnProperty.call(fieldVisibility, f)) fieldVisibility[f] = !!visible;
    render();
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  setEntry(entry);
  render();

  return { el: root, update, setEntry, setVisible, setFieldVisible, setFieldsVisible, destroy };
}

