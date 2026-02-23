// Factory for creating a Kanji main card element.
// The card uses the existing project CSS classes (from src/styles.css).
export function createKanjiMainCard({ entry = null, indexText = '', handlers = {} } = {}) {
  const root = document.createElement('div');
  root.className = 'card kanji-card';

  const wrapper = document.createElement('div');
  wrapper.className = 'kanji-card-wrapper';
  wrapper.tabIndex = 0;

  const corner = document.createElement('div');
  corner.className = 'card-corner-caption';
  corner.textContent = indexText || '';

  const body = document.createElement('div');
  // Keep this as a generic body container (avoid duplicating IDs)
  body.className = 'kanji-body';

  const topLeft = document.createElement('div');
  topLeft.className = 'kanji-top-left';

  const mainWrap = document.createElement('div');
  mainWrap.className = 'kanji-main-wrap';

  const main = document.createElement('div');
  main.className = 'kanji-main';
  main.style.fontSize = '5rem';

  const bottomLeft = document.createElement('div');
  bottomLeft.className = 'kanji-bottom-left';

  const bottomRight = document.createElement('div');
  bottomRight.className = 'kanji-bottom-right';

  mainWrap.appendChild(main);
  body.append(topLeft, mainWrap, bottomLeft, bottomRight);
  wrapper.append(corner, body);
  root.appendChild(wrapper);

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
    const entryObj = e || {};
    // Common field names used in this project: kanji/character/text, reading/kana, meaning/definition
    const kanji = resolvePath(entryObj, 'kanji') || resolvePath(entryObj, 'character') || resolvePath(entryObj, 'text') || '';
    const reading = resolvePath(entryObj, 'reading') || resolvePath(entryObj, 'kana') || '';
    const meaning = resolvePath(entryObj, 'meaning') || resolvePath(entryObj, 'definition') || resolvePath(entryObj, 'gloss') || '';
    const pos = resolvePath(entryObj, 'type') || resolvePath(entryObj, 'pos') || resolvePath(entryObj, 'partOfSpeech') || '';

    // Auto-scale font size based on kanji text length (mirror previous logic)
    const length = (kanji || '').length;
    let fontSize = 5; // rem
    if (length > 6) fontSize = 3.5;
    else if (length > 5) fontSize = 3.75;
    else if (length > 4) fontSize = 4;
    main.style.fontSize = `${fontSize}rem`;

    main.textContent = kanji;
    topLeft.textContent = pos;
    bottomLeft.textContent = reading;
    bottomRight.textContent = meaning;
  }

  function setIndexText(t) {
    corner.textContent = t || '';
  }

  // Control visibility via inline style (visibility:hidden) per-field.
  function setFieldVisible(field, visible) {
    const v = !!visible;
    switch (String(field || '').toLowerCase()) {
      case 'type':
        topLeft.style.visibility = v ? '' : 'hidden';
        break;
      case 'kanji':
        main.style.visibility = v ? '' : 'hidden';
        break;
      case 'reading':
        bottomLeft.style.visibility = v ? '' : 'hidden';
        break;
      case 'meaning':
        bottomRight.style.visibility = v ? '' : 'hidden';
        break;
      default:
        break;
    }
  }

  function setFieldsVisible(map) {
    if (!map || typeof map !== 'object') return;
    for (const k of Object.keys(map)) {
      setFieldVisible(k, !!map[k]);
    }
  }

  function destroy() {
    // Remove any listeners in future (none here currently) and detach nodes
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // wire optional handlers (e.g., click to speak)
  if (handlers.onClick) {
    root.addEventListener('click', (ev) => handlers.onClick(ev, { setEntry, setIndexText }));
  }

  // initialize
  setEntry(entry);
  setIndexText(indexText);

  return { el: root, setEntry, setIndexText, setFieldVisible, setFieldsVisible, destroy };
}
