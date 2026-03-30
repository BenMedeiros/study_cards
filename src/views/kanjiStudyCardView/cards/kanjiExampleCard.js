import { settingsLog } from '../../../managers/settingsManager.js';
import { speak } from '../../../utils/browser/speech.js';

const DEFAULT_FIELD_ITEMS = [
  { key: 'title', label: 'Title' },
  { key: 'japanese', label: 'Japanese' },
  { key: 'english', label: 'English' },
  { key: 'notes', label: 'Notes' },
  { key: 'sentences', label: 'Sentences' },
  { key: 'chunks', label: 'Chunks' },
];

function normalizeAvailableCollections(collections) {
  const items = Array.isArray(collections) ? collections : [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const key = String(raw?.key ?? raw?.name ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(raw?.label ?? raw?.title ?? key).trim() || key,
    });
  }
  return out;
}

function normalizeFieldItems(fields) {
  const items = Array.isArray(fields) && fields.length ? fields : DEFAULT_FIELD_ITEMS;
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const key = String(raw?.key ?? raw?.value ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(raw?.label ?? raw?.left ?? key).trim() || key,
    });
  }
  return out;
}

function getDefaultCollectionConfig(fields) {
  return {
    fields: fields.map((item) => item.key),
    detailsMode: 'click',
    collapsePrimaryWhenExpanded: false,
  };
}

function normalizeCardConfig(config, availableCollections = [], collectionFieldItems = {}) {
  const out = {
    collections: availableCollections.map((item) => item.key),
    relatedCollections: {},
  };
  const src = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {};
  const allowedCollections = new Set(availableCollections.map((item) => item.key));
  const selectedCollections = Array.isArray(src.collections)
    ? src.collections.map((item) => String(item || '').trim()).filter((item) => allowedCollections.has(item))
    : out.collections.slice();
  out.collections = selectedCollections.length ? selectedCollections : out.collections.slice();

  for (const key of out.collections) {
    const fields = normalizeFieldItems(collectionFieldItems?.[key]);
    const allowedFields = new Set(fields.map((item) => item.key));
    const raw = (src.relatedCollections && typeof src.relatedCollections === 'object' && !Array.isArray(src.relatedCollections))
      ? src.relatedCollections[key]
      : null;
    const next = getDefaultCollectionConfig(fields);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const selectedFields = Array.isArray(raw.fields)
        ? raw.fields.map((item) => String(item || '').trim()).filter((item) => allowedFields.has(item))
        : [];
      if (selectedFields.length) next.fields = selectedFields;
      next.detailsMode = String(raw.detailsMode || '').trim().toLowerCase() === 'always' ? 'always' : 'click';
      next.collapsePrimaryWhenExpanded = !!raw.collapsePrimaryWhenExpanded;
    }
    out.relatedCollections[key] = next;
  }
  return out;
}

function firstDefinedString(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function normalizeNotes(item) {
  if (Array.isArray(item?.notes)) return item.notes.map((value) => String(value)).filter(Boolean);
  if (typeof item?.note === 'string' && item.note.trim()) return [item.note.trim()];
  return [];
}

function normalizeChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks
    .filter((chunk) => chunk && typeof chunk === 'object')
    .map((chunk) => ({
      ja: String(chunk.ja || chunk.jp || chunk.text || ''),
      gloss: String(chunk.gloss || chunk.en || ''),
      focus: String(chunk.focus || chunk.pattern || ''),
      refs: Array.isArray(chunk.refs) ? chunk.refs.map((value) => String(value)).filter(Boolean) : [],
    }));
}

function normalizeSentence(sentence, primaryKeys, secondaryKeys) {
  if (!sentence || typeof sentence !== 'object') return { ja: '', en: '', notes: [], pattern: '', chunks: [] };
  return {
    ja: firstDefinedString(sentence, primaryKeys),
    en: firstDefinedString(sentence, secondaryKeys),
    notes: normalizeNotes(sentence),
    pattern: String(sentence.pattern || ''),
    chunks: normalizeChunks(sentence.chunks),
  };
}

function normalizeItem(rawItem, primaryKeys, secondaryKeys) {
  if (typeof rawItem === 'string') {
    return {
      sourceName: '',
      title: '',
      jp: rawItem,
      en: '',
      notes: [],
      chunks: [],
      sentences: [],
    };
  }
  const item = (rawItem && typeof rawItem === 'object') ? rawItem : {};
  return {
    sourceName: String(item.__relatedCollectionName || ''),
    title: String(item.title || item.heading || item.name || ''),
    jp: firstDefinedString(item, primaryKeys),
    en: firstDefinedString(item, secondaryKeys),
    notes: normalizeNotes(item),
    chunks: normalizeChunks(item.chunks),
    sentences: Array.isArray(item.sentences) ? item.sentences.map((sentence) => normalizeSentence(sentence, primaryKeys, secondaryKeys)) : [],
  };
}

export function createKanjiRelatedCard({ entry = null, indexText = '', handlers = {}, config = {} } = {}) {
  settingsLog('[Card:Related] createKanjiRelatedCard()', { entry, indexText, config });
  const root = document.createElement('div');
  root.className = 'card kanji-study-card kanji-related-card';

  const topRight = document.createElement('div');
  topRight.className = 'kanji-study-card-top-right';

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = String(indexText || config?.cornerCaption || '').trim();

  const actions = document.createElement('div');
  actions.className = 'kanji-study-card-actions';

  const header = document.createElement('div');
  header.className = 'kanji-related-header';

  const label = document.createElement('div');
  label.className = 'kanji-related-label';
  label.textContent = '';

  const controls = document.createElement('div');
  controls.className = 'related-carousel-controls';
  controls.style.display = 'flex';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'icon-button';
  prevBtn.title = 'Previous related item';
  prevBtn.textContent = '◀';

  const counter = document.createElement('div');
  counter.className = 'kanji-related-label';
  counter.style.margin = '0 8px';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'icon-button';
  nextBtn.title = 'Next related item';
  nextBtn.textContent = '▶';

  const speakBtn = document.createElement('button');
  speakBtn.type = 'button';
  speakBtn.className = 'icon-button';
  speakBtn.title = 'Listen';
  speakBtn.textContent = '🔊';

  const placeholder = document.createElement('div');
  placeholder.className = 'hint kanji-related-empty';
  placeholder.style.marginTop = '0.5rem';
  placeholder.textContent = 'No related items.';

  const sourceLabel = document.createElement('div');
  sourceLabel.className = 'kanji-related-label';
  sourceLabel.style.marginTop = '0.5rem';

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

  const collapseDetailsBtn = document.createElement('button');
  collapseDetailsBtn.type = 'button';
  collapseDetailsBtn.className = 'btn small';
  collapseDetailsBtn.textContent = 'Collapse Details';
  collapseDetailsBtn.style.marginTop = '0.5rem';

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
  enLabel.textContent = String(config?.secondaryLabel || 'English');

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

  controls.append(prevBtn, counter, nextBtn);
  header.append(label, controls, speakBtn);
  topRight.append(corner, actions);
  root.append(
    topRight,
    header,
    placeholder,
    sourceLabel,
    titleLabel,
    titleText,
    primaryBtn,
    collapseDetailsBtn,
    sentencesPanel,
    chunksPanel,
    enLabel,
    enText,
    notesLabel,
    notesList
  );

  const primaryKeys = Array.isArray(config?.primaryKeys) && config.primaryKeys.length
    ? config.primaryKeys.slice()
    : ['jp', 'ja', 'japanese', 'text', 'sentence'];
  const secondaryKeys = Array.isArray(config?.secondaryKeys) && config.secondaryKeys.length
    ? config.secondaryKeys.slice()
    : ['en', 'en_us', 'eng', 'english', 'translation'];

  let currentEntry = entry;
  let availableCollections = normalizeAvailableCollections(config?.availableCollections);
  let collectionFieldItems = {};
  for (const item of availableCollections) collectionFieldItems[item.key] = normalizeFieldItems(config?.collectionFieldItems?.[item.key]);
  let cardConfig = normalizeCardConfig(config?.cardConfig, availableCollections, collectionFieldItems);
  let currentIndex = 0;
  let expandedItemKey = '';
  let selectedSentenceIndex = 0;
  let selectedChunkIndex = 0;
  let externalFieldVisibility = {};

  const openConfig = (handlers && typeof handlers.onOpenConfig === 'function')
    ? handlers.onOpenConfig
    : (config && typeof config.onOpenConfig === 'function' ? config.onOpenConfig : null);
  if (typeof openConfig === 'function') {
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'icon-button kanji-study-card-config-btn';
    configBtn.title = 'Configure card';
    configBtn.setAttribute('aria-label', 'Configure card');
    configBtn.textContent = '⚙';
    configBtn.addEventListener('click', () => {
      try {
        openConfig({
          cardId: String(config?.cardId || 'related').trim() || 'related',
          entry: currentEntry,
          cardConfig: {
            ...cardConfig,
            collections: Array.isArray(cardConfig.collections) ? cardConfig.collections.slice() : [],
            relatedCollections: Object.fromEntries(
              Object.entries(cardConfig.relatedCollections || {}).map(([key, value]) => [
                key,
                { ...value, fields: Array.isArray(value?.fields) ? value.fields.slice() : [] },
              ])
            ),
          },
          availableCollections: availableCollections.slice(),
          collectionFieldItems: Object.fromEntries(Object.entries(collectionFieldItems).map(([key, value]) => [key, value.slice()])),
        });
      } catch (e) {}
    });
    actions.appendChild(configBtn);
  }

  function setDisplayText(el, value) {
    if (!el) return;
    const text = String(value ?? '');
    el.textContent = text;
    el.style.whiteSpace = /\r|\n/.test(text) ? 'pre-wrap' : '';
    el.style.wordBreak = /\r|\n/.test(text) ? 'break-word' : '';
  }

  function getCollectionConfig(name) {
    const fields = collectionFieldItems[name] || normalizeFieldItems();
    const fallback = getDefaultCollectionConfig(fields);
    const configured = cardConfig.relatedCollections?.[name];
    if (!configured) return fallback;
    return {
      fields: Array.isArray(configured.fields) && configured.fields.length ? configured.fields.slice() : fallback.fields.slice(),
      detailsMode: configured.detailsMode === 'always' ? 'always' : 'click',
      collapsePrimaryWhenExpanded: !!configured.collapsePrimaryWhenExpanded,
    };
  }

  function isFieldVisible(name, fieldKey) {
    const scoped = externalFieldVisibility[name];
    if (!scoped || typeof scoped !== 'object') return true;
    if (!Object.prototype.hasOwnProperty.call(scoped, fieldKey)) return true;
    return !!scoped[fieldKey];
  }

  function getVisibleFieldsForCollection(name) {
    return getCollectionConfig(name).fields.filter((fieldKey) => isFieldVisible(name, fieldKey));
  }

  function getMergedItems() {
    if (!currentEntry || typeof currentEntry !== 'object') return [];
    const out = [];
    for (const collectionName of cardConfig.collections) {
      const records = Array.isArray(currentEntry?.relatedCollections?.[collectionName]) ? currentEntry.relatedCollections[collectionName] : [];
      for (const record of records) {
        const normalized = normalizeItem(record, primaryKeys, secondaryKeys);
        normalized.sourceName = collectionName;
        out.push(normalized);
      }
    }
    return out;
  }

  function resetExpandedState() {
    expandedItemKey = '';
    selectedSentenceIndex = 0;
    selectedChunkIndex = 0;
  }

  function renderChunkList(target, chunks = [], item) {
    target.innerHTML = '';
    if (!Array.isArray(chunks) || !chunks.length) {
      const empty = document.createElement('div');
      empty.className = 'kanji-related-label';
      empty.textContent = 'No chunks available for this text.';
      target.appendChild(empty);
      return;
    }
    if (selectedChunkIndex < 0 || selectedChunkIndex >= chunks.length) selectedChunkIndex = 0;
    chunks.forEach((chunk, chunkIndex) => {
      const row = document.createElement('div');
      row.style.border = '1px solid var(--line)';
      row.style.borderRadius = '8px';
      row.style.padding = '0.5rem 0.65rem';
      row.style.background = chunkIndex === selectedChunkIndex ? 'var(--panel)' : 'transparent';
      row.style.borderLeft = chunkIndex === selectedChunkIndex ? '4px solid var(--accent)' : '4px solid transparent';

      const button = document.createElement('button');
      button.type = 'button';
      button.style.width = '100%';
      button.style.textAlign = 'left';
      button.style.border = 'none';
      button.style.background = 'transparent';
      button.style.padding = '0';
      button.style.cursor = 'pointer';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '0.5rem';

      const ja = document.createElement('div');
      ja.className = 'kanji-related-text';
      ja.style.fontSize = '1rem';
      ja.style.flex = '1';
      setDisplayText(ja, chunk.ja);

      const chunkSpeakBtn = document.createElement('button');
      chunkSpeakBtn.type = 'button';
      chunkSpeakBtn.className = 'icon-button';
      chunkSpeakBtn.title = 'Listen to this chunk';
      chunkSpeakBtn.textContent = '🔊';
      chunkSpeakBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = String(chunk.ja || '').trim();
        if (!text) return;
        if (handlers.onSpeak) handlers.onSpeak(text, { entry: currentEntry, relatedCollectionName: item.sourceName, index: currentIndex, chunkIndex });
        else speak(text, { fieldKey: 'reading' });
      });

      const gloss = document.createElement('div');
      gloss.className = 'kanji-related-label';
      gloss.style.marginTop = '0.25rem';
      gloss.style.color = 'var(--text)';
      gloss.style.opacity = '0.85';
      gloss.style.fontSize = '0.95rem';
      setDisplayText(gloss, chunk.gloss);

      top.append(ja, chunkSpeakBtn);
      button.append(top, gloss);
      row.appendChild(button);

      if (chunkIndex === selectedChunkIndex) {
        if (chunk.focus) {
          const focus = document.createElement('div');
          focus.className = 'kanji-related-label';
          focus.style.marginTop = '0.4rem';
          setDisplayText(focus, `Focus: ${chunk.focus}`);
          row.appendChild(focus);
        }
        if (Array.isArray(chunk.refs) && chunk.refs.length) {
          const refs = document.createElement('div');
          refs.className = 'kanji-related-label';
          refs.style.marginTop = '0.25rem';
          setDisplayText(refs, `Refs: ${chunk.refs.join(', ')}`);
          row.appendChild(refs);
        }
      }

      button.addEventListener('click', () => {
        selectedChunkIndex = chunkIndex;
        render();
      });
      target.appendChild(row);
    });
  }

  function renderSentenceList(sentences = [], item, collectionConfig, visibleFields) {
    sentencesList.innerHTML = '';
    if (!Array.isArray(sentences) || !sentences.length) {
      const empty = document.createElement('div');
      empty.className = 'kanji-related-label';
      empty.textContent = 'No sentences available for this text.';
      sentencesList.appendChild(empty);
      return;
    }
    if (selectedSentenceIndex < 0 || selectedSentenceIndex >= sentences.length) selectedSentenceIndex = 0;
    sentences.forEach((sentence, sentenceIndex) => {
      const row = document.createElement('div');
      row.style.border = '1px solid var(--line)';
      row.style.borderRadius = '8px';
      row.style.padding = '0.5rem 0.65rem';
      const sentenceExpanded = collectionConfig.detailsMode === 'always' || sentenceIndex === selectedSentenceIndex;
      row.style.background = sentenceExpanded ? 'var(--panel)' : 'transparent';
      row.style.borderLeft = sentenceExpanded ? '4px solid var(--accent)' : '4px solid transparent';

      const button = document.createElement('button');
      button.type = 'button';
      button.style.width = '100%';
      button.style.textAlign = 'left';
      button.style.border = 'none';
      button.style.background = 'transparent';
      button.style.padding = '0';
      button.style.cursor = collectionConfig.detailsMode === 'click' ? 'pointer' : 'default';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '0.5rem';

      const sentenceJa = document.createElement('div');
      sentenceJa.className = 'kanji-related-text';
      sentenceJa.style.fontSize = '1rem';
      sentenceJa.style.flex = '1';
      setDisplayText(sentenceJa, sentence.ja);

      const sentenceSpeakBtn = document.createElement('button');
      sentenceSpeakBtn.type = 'button';
      sentenceSpeakBtn.className = 'icon-button';
      sentenceSpeakBtn.title = 'Listen to this sentence';
      sentenceSpeakBtn.textContent = '🔊';
      sentenceSpeakBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = String(sentence.ja || '').trim();
        if (!text) return;
        if (handlers.onSpeak) handlers.onSpeak(text, { entry: currentEntry, relatedCollectionName: item.sourceName, index: currentIndex, sentenceIndex });
        else speak(text, { fieldKey: 'reading' });
      });

      top.append(sentenceJa, sentenceSpeakBtn);
      button.appendChild(top);

      if (visibleFields.includes('english') && sentence.en) {
        const sentenceEn = document.createElement('div');
        sentenceEn.className = 'kanji-related-label';
        sentenceEn.style.marginTop = '0.25rem';
        sentenceEn.style.color = 'var(--text)';
        sentenceEn.style.opacity = '0.85';
        sentenceEn.style.fontSize = '0.95rem';
        setDisplayText(sentenceEn, sentence.en);
        button.appendChild(sentenceEn);
      }

      row.appendChild(button);

      if (sentenceExpanded) {
        if (sentence.pattern) {
          const pattern = document.createElement('div');
          pattern.className = 'kanji-related-label';
          pattern.style.marginTop = '0.4rem';
          setDisplayText(pattern, `Pattern: ${sentence.pattern}`);
          row.appendChild(pattern);
        }
        if (sentence.notes.length) {
          const note = document.createElement('div');
          note.className = 'kanji-related-label';
          note.style.marginTop = '0.25rem';
          setDisplayText(note, sentence.notes.join(' | '));
          row.appendChild(note);
        }
        if (visibleFields.includes('chunks')) {
          const chunkMount = document.createElement('div');
          chunkMount.style.marginTop = '0.5rem';
          chunkMount.style.display = 'flex';
          chunkMount.style.flexDirection = 'column';
          chunkMount.style.gap = '0.5rem';
          renderChunkList(chunkMount, sentence.chunks, item);
          row.appendChild(chunkMount);
        }
      }

      if (collectionConfig.detailsMode === 'click') {
        button.addEventListener('click', () => {
          selectedSentenceIndex = sentenceIndex;
          selectedChunkIndex = 0;
          render();
        });
      }

      sentencesList.appendChild(row);
    });
  }

  function updateDisplay() {
    const items = getMergedItems();
    if (currentIndex < 0 || currentIndex >= items.length) currentIndex = 0;
    const item = items[currentIndex] || null;
    counter.textContent = items.length ? `${currentIndex + 1} / ${items.length}` : '';
    prevBtn.style.display = items.length > 1 ? '' : 'none';
    nextBtn.style.display = items.length > 1 ? '' : 'none';
    counter.style.display = items.length ? '' : 'none';

    if (!item) {
      placeholder.style.display = '';
      sourceLabel.style.display = 'none';
      titleLabel.style.display = 'none';
      titleText.style.display = 'none';
      primaryBtn.style.display = 'none';
      collapseDetailsBtn.style.display = 'none';
      sentencesPanel.style.display = 'none';
      chunksPanel.style.display = 'none';
      enLabel.style.display = 'none';
      enText.style.display = 'none';
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
      return;
    }

    const collectionName = String(item.sourceName || '').trim();
    const collectionMeta = availableCollections.find((entryItem) => entryItem.key === collectionName);
    const collectionLabel = collectionMeta?.label || collectionName;
    const collectionConfig = getCollectionConfig(collectionName);
    const visibleFields = getVisibleFieldsForCollection(collectionName);
    const canExpandSentences = item.sentences.length && visibleFields.includes('sentences');
    const canExpandChunks = item.chunks.length && visibleFields.includes('chunks');
    const canExpand = canExpandSentences || canExpandChunks;
    const expanded = collectionConfig.detailsMode === 'always' || expandedItemKey === `${collectionName}:${currentIndex}`;
    const hidePrimary = collectionConfig.collapsePrimaryWhenExpanded && expanded && canExpand;

    placeholder.style.display = 'none';

    label.textContent = collectionLabel || String(config?.itemLabel || 'Related');
    sourceLabel.style.display = 'none';
    sourceLabel.textContent = '';

    titleLabel.style.display = visibleFields.includes('title') && item.title ? '' : 'none';
    titleText.style.display = visibleFields.includes('title') && item.title ? '' : 'none';
    setDisplayText(titleText, item.title);

    primaryBtn.style.display = visibleFields.includes('japanese') && item.jp && !hidePrimary ? '' : 'none';
    setDisplayText(primaryBtn, item.jp);
    primaryBtn.style.cursor = canExpand && collectionConfig.detailsMode === 'click' ? 'pointer' : 'default';
    primaryBtn.title = canExpand && collectionConfig.detailsMode === 'click' ? 'Show nested content' : 'Japanese text';
    primaryBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    collapseDetailsBtn.style.display = hidePrimary && collectionConfig.detailsMode === 'click' ? '' : 'none';
    sentencesPanel.style.display = expanded && canExpandSentences ? '' : 'none';
    chunksPanel.style.display = expanded && !canExpandSentences && canExpandChunks ? '' : 'none';

    if (expanded && canExpandSentences) renderSentenceList(item.sentences, item, collectionConfig, visibleFields);
    if (expanded && !canExpandSentences && canExpandChunks) {
      chunksHeader.textContent = 'Chunks';
      renderChunkList(chunksList, item.chunks, item);
    }

    enLabel.style.display = visibleFields.includes('english') && item.en ? '' : 'none';
    enText.style.display = visibleFields.includes('english') && item.en ? '' : 'none';
    setDisplayText(enText, item.en);

    notesList.innerHTML = '';
    if (visibleFields.includes('notes') && item.notes.length) {
      notesLabel.style.display = '';
      notesList.style.display = '';
      for (const note of item.notes) {
        const li = document.createElement('li');
        setDisplayText(li, note);
        notesList.appendChild(li);
      }
    } else {
      notesLabel.style.display = 'none';
      notesList.style.display = 'none';
    }
  }

  function render() {
    settingsLog('[Card:Related] render()', { currentIndex, hasEntry: !!currentEntry });
    updateDisplay();
  }

  prevBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const items = getMergedItems();
    if (!items.length) return;
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    resetExpandedState();
    render();
    if (handlers.onPrev) handlers.onPrev(currentIndex);
  });

  nextBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const items = getMergedItems();
    if (!items.length) return;
    currentIndex = (currentIndex + 1) % items.length;
    resetExpandedState();
    render();
    if (handlers.onNext) handlers.onNext(currentIndex);
  });

  primaryBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const item = getMergedItems()[currentIndex] || null;
    if (!item) return;
    const collectionName = String(item.sourceName || '').trim();
    const visibleFields = getVisibleFieldsForCollection(collectionName);
    const canExpand = (item.sentences.length && visibleFields.includes('sentences')) || (item.chunks.length && visibleFields.includes('chunks'));
    const collectionConfig = getCollectionConfig(collectionName);
    if (!canExpand || collectionConfig.detailsMode !== 'click') return;
    const itemKey = `${collectionName}:${currentIndex}`;
    expandedItemKey = expandedItemKey === itemKey ? '' : itemKey;
    if (!expandedItemKey) {
      selectedSentenceIndex = 0;
      selectedChunkIndex = 0;
    }
    render();
  });

  collapseDetailsBtn.addEventListener('click', () => {
    expandedItemKey = '';
    render();
  });

  speakBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const item = getMergedItems()[currentIndex] || null;
    const text = String(item?.jp || '').trim();
    if (!text) return;
    if (handlers.onSpeak) handlers.onSpeak(text, { entry: currentEntry, index: currentIndex, relatedCollectionName: item?.sourceName || '' });
    else speak(text, { fieldKey: 'reading' });
  });

  function setEntry(nextEntry) {
    settingsLog('[Card:Related] setEntry()', nextEntry);
    currentEntry = nextEntry || null;
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function update(nextEntry) {
    settingsLog('[Card:Related] update()', { hasEntry: !!nextEntry });
    if (nextEntry) currentEntry = nextEntry;
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function setIndexText(text) {
    corner.textContent = String(text || '').trim();
  }

  function setConfig(nextConfig) {
    cardConfig = normalizeCardConfig(nextConfig, availableCollections, collectionFieldItems);
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function setAvailableCollections(nextCollections, nextFieldItems = null) {
    availableCollections = normalizeAvailableCollections(nextCollections);
    collectionFieldItems = {};
    for (const item of availableCollections) collectionFieldItems[item.key] = normalizeFieldItems(nextFieldItems?.[item.key]);
    cardConfig = normalizeCardConfig(cardConfig, availableCollections, collectionFieldItems);
    currentIndex = 0;
    resetExpandedState();
    render();
  }

  function setCollectionFieldsVisible(collectionName, map) {
    const key = String(collectionName || '').trim();
    if (!key || !map || typeof map !== 'object') return;
    externalFieldVisibility[key] = { ...(externalFieldVisibility[key] || {}), ...map };
    render();
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const collectionName of cardConfig.collections) {
      setCollectionFieldsVisible(collectionName, map);
    }
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  setEntry(currentEntry);
  setIndexText(indexText || config?.cornerCaption || '');

  return {
    el: root,
    update,
    setEntry,
    setVisible,
    setIndexText,
    setConfig,
    setAvailableCollections,
    setCollectionFieldsVisible,
    setFieldsVisible,
    destroy,
  };
}
