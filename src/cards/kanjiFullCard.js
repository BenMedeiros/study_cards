// Factory for a full-detail kanji card showing labelled rows for all common fields.
export function createKanjiFullCard({ entry = null, config = {} } = {}) {
  console.log('[Card:Full] createKanjiFullCard()', { entry, config });
  const root = document.createElement('div');
  root.className = 'card kanji-full-card';

  const body = document.createElement('div');
  body.className = 'kanji-full-body';

  // Helper to create a labelled row
  function makeRow(labelText) {
    const row = document.createElement('div');
    row.className = 'kanji-full-row';
    const label = document.createElement('div');
    label.className = 'kanji-full-label';
    label.textContent = labelText || '';
    const value = document.createElement('div');
    value.className = 'kanji-full-value';
    row.append(label, value);
    return { row, label, value };
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
    console.log('[Card:Full] setEntry()', e);
    const entryObj = e || {};
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
  }

  function setFieldVisible(field, visible) {
    const v = !!visible;
    const k = String(field || '').toLowerCase();
    const r = rows[k];
    if (!r) return;
    // Only hide/show the value element so the label remains visible.
    r.value.style.visibility = v ? '' : 'hidden';
  }

  function setFieldsVisible(map) {
    console.log('[Card:Full] setFieldsVisible()', map);
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

  function getToggleFields(metadata) {
    console.log('[Card:Full] getToggleFields()', { metadataKeys: metadata ? Object.keys(metadata) : null });
    if (!metadata || typeof metadata !== 'object') {
      return (Array.isArray(kanjiFullCardToggleFields) ? kanjiFullCardToggleFields.slice() : []);
    }
    const fields = Array.isArray(metadata.fields) ? metadata.fields : (Array.isArray(metadata.schema) ? metadata.schema : []);
    if (!Array.isArray(fields) || !fields.length) return (Array.isArray(kanjiFullCardToggleFields) ? kanjiFullCardToggleFields.slice() : []);
    return fields.map(f => ({ value: String(f.key || f), left: f.label || String(f.key || f), right: 'Visible' }));
  }

  return { el: root, setEntry, setFieldVisible, setFieldsVisible, setVisible, getToggleFields, destroy };
}

// Export canonical toggleable fields for the full-detail card
export const kanjiFullCardToggleFields = [
  { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
  { value: 'kanji', left: 'Kanji', right: 'Visible' },
  { value: 'reading', left: 'Reading', right: 'Visible' },
  { value: 'meaning', left: 'Meaning', right: 'Visible' },
  { value: 'type', left: 'Type', right: 'Visible' },
  { value: 'lexical', left: 'Lexical Class', right: 'Visible' },
  { value: 'orthography', left: 'Orthography', right: 'Visible' },
  { value: 'tags', left: 'Tags', right: 'Visible' },
];
