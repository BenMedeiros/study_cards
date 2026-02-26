// Factory for a full-detail kanji card showing labelled rows for all common fields.
import { speak, getLanguageCode } from '../utils/speech.js';
import { settingsLog } from '../managers/settingsManager.js';

export function createKanjiFullCard({ entry = null, config = {}, handlers = {} } = {}) {
  settingsLog('[Card:Full] createKanjiFullCard()', { entry, config, handlers });
  const root = document.createElement('div');
  root.className = 'card kanji-full-card';

  const body = document.createElement('div');
  body.className = 'kanji-full-body';

  // keep current entry reference available to handlers
  let currentEntry = entry;

  // Helper to create a labelled row
  function makeRow(labelText) {
    const row = document.createElement('div');
    row.className = 'kanji-full-row';
    const label = document.createElement('div');
    label.className = 'kanji-full-label';
    label.textContent = labelText || '';
    const value = document.createElement('div');
    value.className = 'kanji-full-value';
    // inline play button for consistency/spacing across rows
    const playBtn = document.createElement('button');
    playBtn.className = 'icon-button kanji-full-play';
    playBtn.title = 'Listen';
    playBtn.textContent = '🔊';
    // default hidden; enable for specific fields during initialization
    playBtn.style.visibility = 'hidden';
    row.append(label, value, playBtn);
    return { row, label, value, playBtn };
  }

  // Rows for fields commonly shown in the full view
  const rows = {
    kanji: makeRow('Kanji'),
    reading: makeRow('Reading'),
    meaning: makeRow('Meaning'),
    type: makeRow('Type'),
    lexical: makeRow('Lexical Class'),
    orthography: makeRow('Orthography'),
    tags: makeRow('Tags'),
  };

  // Append rows in desired order
  body.append(
    rows.kanji.row,
    rows.reading.row,
    rows.meaning.row,
    rows.type.row,
    rows.lexical.row,
    rows.orthography.row,
    rows.tags.row
  );

  root.appendChild(body);

  // attach play handlers to each row's play button
  for (const k of Object.keys(rows)) {
    const r = rows[k];
    if (!r) continue;
    const btn = r.playBtn || r.row.querySelector('.kanji-full-play');
    if (!btn) continue;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      // derive text to speak; prefer entry fields, fallback to displayed value
      let text = '';
      if (k === 'kanji') {
        text = resolvePath(currentEntry, 'kanji') || resolvePath(currentEntry, 'character') || resolvePath(currentEntry, 'text') || r.value.textContent || '';
      } else if (k === 'reading') {
        text = resolvePath(currentEntry, 'reading') || resolvePath(currentEntry, 'kana') || r.value.textContent || '';
      } else {
        text = r.value.textContent || resolvePath(currentEntry, k) || '';
      }
      const speakHandler = (handlers && handlers.onSpeak) ? handlers.onSpeak : (config && config.handlers && config.handlers.onSpeak ? config.handlers.onSpeak : null);
      if (typeof speakHandler === 'function') {
        try { speakHandler(String(text || ''), { field: k, entry: currentEntry }); } catch (err) { console.error('[Card:Full] speak handler error', err); }
      } else {
        try {
          // Use shared speak utility to respect persisted voice settings and language mapping
          const lang = getLanguageCode(k);
          speak(String(text || ''), lang);
        } catch (err) {
          console.error('[Card:Full] speech error', err);
        }
      }
    });
  }

  function resolvePath(obj, path) {
    if (!obj || !path) return '';
    const parts = String(path).split(/\.|\//).filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    return (cur == null) ? '' : String(cur);
  }

  function setEntry(e) {
    settingsLog('[Card:Full] setEntry()', e);
    const entryObj = e || {};
    // update current entry reference for handlers
    currentEntry = entryObj;
    const kanji = resolvePath(entryObj, 'kanji') || resolvePath(entryObj, 'character') || resolvePath(entryObj, 'text') || '';
    const reading = resolvePath(entryObj, 'reading') || resolvePath(entryObj, 'kana') || '';
    const meaning = resolvePath(entryObj, 'meaning') || resolvePath(entryObj, 'definition') || resolvePath(entryObj, 'gloss') || '';
    const pos = resolvePath(entryObj, 'type') || resolvePath(entryObj, 'pos') || '';
    const lexical = resolvePath(entryObj, 'lexicalClass') || resolvePath(entryObj, 'lexical') || '';
    const orth = resolvePath(entryObj, 'orthography') || '';
    const tags = Array.isArray(entryObj?.tags) ? entryObj.tags.join(', ') : (entryObj?.tags || '');

    rows.kanji.value.textContent = kanji;
    rows.reading.value.textContent = reading;
    rows.meaning.value.textContent = meaning;
    rows.type.value.textContent = pos;
    rows.lexical.value.textContent = lexical;
    rows.orthography.value.textContent = orth;
    rows.tags.value.textContent = tags;
    // configure play button visibility: only show for kanji and reading by default
    for (const k of Object.keys(rows)) {
      const r = rows[k];
      if (!r) continue;
      const allowedSound = (k === 'kanji' || k === 'reading');
      const valueVis = r.value.style.visibility !== 'hidden';
      if (r.playBtn) r.playBtn.style.visibility = (valueVis && allowedSound) ? '' : 'hidden';
    }
  }

  function setFieldVisible(field, visible) {
    const v = !!visible;
    const k = String(field || '').toLowerCase();
    const r = rows[k];
    if (!r) return;
    // Only hide/show the value element so the label remains visible.
    r.value.style.visibility = v ? '' : 'hidden';
    // also toggle inline play button visibility for fields that support sound
    const allowedSound = (k === 'kanji' || k === 'reading');
    if (r.playBtn) r.playBtn.style.visibility = (v && allowedSound) ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    settingsLog('[Card:Full] setFieldsVisible()', map);
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) setFieldVisible(k, !!map[k]);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // initialize
  setEntry(entry);

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, destroy };
}
