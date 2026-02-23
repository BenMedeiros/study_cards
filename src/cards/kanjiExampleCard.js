// Factory for creating a Kanji example card element with internal carousel controls.
// Uses existing CSS classes defined in src/styles.css.
export function createKanjiExampleCard({ entry = null, sentences = [], handlers = {} } = {}) {
  const root = document.createElement('div');
  root.className = 'card kanji-example-card';

  const header = document.createElement('div');
  header.className = 'kanji-example-header';

  const label = document.createElement('div');
  label.className = 'kanji-example-label';
  label.textContent = 'Sentence';

  const controls = document.createElement('div');
  controls.className = 'example-carousel-controls';
  controls.style.display = 'flex';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'icon-button';
  prevBtn.title = 'Previous sentence';
  prevBtn.textContent = '◀';

  const counter = document.createElement('div');
  counter.className = 'kanji-example-label';
  counter.style.margin = '0 8px';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'icon-button';
  nextBtn.title = 'Next sentence';
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
  jpText.className = 'kanji-example-text kanji-example-jp';

  const enLabel = document.createElement('div');
  enLabel.className = 'kanji-example-label';
  enLabel.style.marginTop = '1rem';
  enLabel.textContent = 'English';

  const enText = document.createElement('div');
  enText.className = 'kanji-example-text kanji-example-en';
  enText.style.fontSize = '1rem';

  const notesLabel = document.createElement('div');
  notesLabel.className = 'kanji-example-label';
  notesLabel.style.marginTop = '1rem';
  notesLabel.textContent = 'Notes';

  const notesList = document.createElement('ul');
  notesList.className = 'kanji-example-notes';

  root.append(header, jpText, enLabel, enText, notesLabel, notesList);

  let currentIndex = 0;
  let items = Array.isArray(sentences) ? sentences.slice() : [];

  function renderControls() {
    const count = items.length;
    counter.textContent = count ? `${currentIndex + 1} / ${count}` : '';
    prevBtn.style.display = count > 1 ? '' : 'none';
    nextBtn.style.display = count > 1 ? '' : 'none';
    counter.style.display = count ? '' : 'none';
  }

  function setSentences(list) {
    items = Array.isArray(list) ? list.slice() : [];
    currentIndex = 0;
    render();
  }

  function render() {
    renderControls();
    const s = items[currentIndex] || null;
    // sentence object can be string or { jp, en, notes }
    let jp = '', en = '', notes = [];
    if (s) {
      if (typeof s === 'string') jp = s;
      else {
        // Support multiple possible keys for Japanese text (ja, jp, japanese, text)
        jp = s.jp || s.ja || s.japanese || s.text || s.sentence || '';
        en = s.en || s.en_us || s.eng || s.english || '';
        notes = Array.isArray(s.notes) ? s.notes : (s.note ? [s.note] : []);
      }
    }
    // fallback to entry-level fields when available
    if (!jp) jp = (entry && (entry.sentence || entry.jp || entry.japanese)) || '';
    if (!en) en = (entry && (entry.english || entry.en || entry.translation)) || '';

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
    } else {
      // keep empty list (CSS will hide if desired)
    }
  }

  prevBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!items.length) return;
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    render();
    handlers.onPrev && handlers.onPrev(currentIndex);
  });

  nextBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!items.length) return;
    currentIndex = (currentIndex + 1) % items.length;
    render();
    handlers.onNext && handlers.onNext(currentIndex);
  });

  speakBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const cur = items[currentIndex] || {};
    let text = '';
    if (typeof cur === 'string') text = cur;
    else {
      text = cur.jp || cur.ja || cur.japanese || cur.text || cur.sentence || '';
    }
    // fallback to entry-level sentence if individual item lacks JP text
    if (!text) text = (entry && (entry.sentence || entry.jp || entry.japanese || entry.text)) || '';
    if (handlers.onSpeak) handlers.onSpeak(text, { index: currentIndex, entry });
  });

  function update(newEntry, newSentences) {
    if (newEntry) entry = newEntry;
    if (Array.isArray(newSentences)) items = newSentences.slice();
    currentIndex = 0;
    render();
  }

  function destroy() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function setVisible(visible) {
    root.style.display = visible ? '' : 'none';
  }

  // Control english visibility via inline style (visibility:hidden)
  function setEnglishVisible(visible) {
    const v = !!visible;
    enLabel.style.visibility = v ? '' : 'hidden';
    enText.style.visibility = v ? '' : 'hidden';
  }

  // initialize
  setSentences(sentences);
  render();

  return { el: root, update, setSentences, setVisible, setEnglishVisible, destroy };
}
