import { speak } from '../../utils/browser/speech.js';

const APP_ID = 'japaneseStudy';
const JAPANESE_WORDS_COLLECTION = 'japanese/japanese_words.json';

const DEFAULT_MODES = [
  { id: 'kanji', label: 'Kanji first', description: 'Show kanji, hide English and hiragana.' },
  { id: 'english', label: 'English first', description: 'Show only English.' },
  { id: 'hiragana', label: 'Hiragana first', description: 'Show only hiragana.' },
  { id: 'voice', label: 'Voice only', description: 'Hide text and dictate.' },
];

const DEFAULT_SETS = [
  { id: 'all', name: 'All words', rules: { query: '', type: '', tag: '', limit: 0 }, system: true },
];

function clone(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
}

function normalizeSet(raw, fallbackIndex = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rules = source.rules && typeof source.rules === 'object' ? source.rules : {};
  const id = String(source.id || '').trim() || `set-${Date.now()}-${fallbackIndex}`;
  const name = String(source.name || '').trim() || `Set ${fallbackIndex + 1}`;
  return {
    id,
    name,
    system: !!source.system || id === 'all',
    rules: {
      query: String(rules.query || '').trim(),
      type: String(rules.type || '').trim(),
      tag: String(rules.tag || '').trim(),
      limit: Math.max(0, Math.floor(Number(rules.limit) || 0)),
    },
  };
}

function normalizeState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sets = Array.isArray(source.sets) ? source.sets.map(normalizeSet) : clone(DEFAULT_SETS, DEFAULT_SETS);
  const normalizedSets = sets.length ? sets : clone(DEFAULT_SETS, DEFAULT_SETS);
  const activeSetId = normalizedSets.some((set) => set.id === source.activeSetId) ? source.activeSetId : normalizedSets[0].id;
  const mode = DEFAULT_MODES.some((item) => item.id === source.mode) ? source.mode : 'kanji';
  return {
    sets: normalizedSets,
    activeSetId,
    mode,
    currentIndex: Math.max(0, Math.floor(Number(source.currentIndex) || 0)),
  };
}

function persistState(store, state, opts = {}) {
  try {
    store?.apps?.setState?.(APP_ID, clone(state, state), { immediate: !!opts.immediate });
  } catch (e) {}
}

function textIncludes(value, needle) {
  if (!needle) return true;
  return String(value || '').toLowerCase().includes(needle.toLowerCase());
}

function matchesSet(entry, set) {
  const rules = set?.rules || {};
  const query = String(rules.query || '').trim();
  const type = String(rules.type || '').trim();
  const tag = String(rules.tag || '').trim();

  if (query) {
    const haystack = [entry?.kanji, entry?.reading, entry?.meaning, entry?.type, ...(Array.isArray(entry?.tags) ? entry.tags : [])].join(' ');
    if (!textIncludes(haystack, query)) return false;
  }

  if (type && String(entry?.type || '') !== type) return false;

  if (tag) {
    const tags = Array.isArray(entry?.tags) ? entry.tags.map((item) => String(item || '')) : [];
    if (!tags.includes(tag)) return false;
  }

  return true;
}

function applySet(entries, set) {
  const filtered = (Array.isArray(entries) ? entries : []).filter((entry) => matchesSet(entry, set));
  const limit = Math.max(0, Math.floor(Number(set?.rules?.limit) || 0));
  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

function getDisplayText(entry, key) {
  const value = entry?.[key];
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '').trim();
}

function getJapaneseText(entry) {
  return getDisplayText(entry, 'kanji') || getDisplayText(entry, 'reading');
}

function getUniqueValues(entries, key) {
  const values = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (key === 'tags') {
      for (const tag of Array.isArray(entry?.tags) ? entry.tags : []) {
        const value = String(tag || '').trim();
        if (value) values.add(value);
      }
    } else {
      const value = String(entry?.[key] || '').trim();
      if (value) values.add(value);
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function button(label, className = '') {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `japanese-study-button ${className}`.trim();
  el.textContent = label;
  return el;
}

function fieldLabel(text, input) {
  const label = document.createElement('label');
  label.className = 'japanese-study-field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, input);
  return label;
}

function makeSelect(items, value) {
  const select = document.createElement('select');
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  select.value = value;
  return select;
}

function renderLine(parent, label, value, className, { hidden = false } = {}) {
  const row = document.createElement('div');
  row.className = `japanese-study-card-line ${className}`.trim();
  row.hidden = hidden;
  const labelEl = document.createElement('div');
  labelEl.className = 'japanese-study-card-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('div');
  valueEl.className = 'japanese-study-card-value';
  valueEl.textContent = value || '—';
  row.append(labelEl, valueEl);
  parent.append(row);
  return row;
}

export function renderJapaneseStudyPage({ store }) {
  const root = document.createElement('section');
  root.className = 'japanese-study-page';

  let state = normalizeState(store?.apps?.getState?.(APP_ID) || {});
  let collection = null;
  let entries = [];
  let deck = [];
  let revealed = false;
  let isActive = true;

  const top = document.createElement('header');
  top.className = 'japanese-study-top';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'japanese-study-title-wrap';
  const title = document.createElement('h1');
  title.textContent = 'Japanese Study';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Simple mobile-first word cards with saved study sets.';
  titleWrap.append(title, subtitle);

  const modeSelect = makeSelect(DEFAULT_MODES.map((mode) => ({ value: mode.id, label: mode.label })), state.mode);
  modeSelect.className = 'japanese-study-mode-select';
  top.append(titleWrap, fieldLabel('Mode', modeSelect));

  const setBar = document.createElement('section');
  setBar.className = 'japanese-study-set-bar';

  const setSelect = makeSelect([], state.activeSetId);
  setSelect.className = 'japanese-study-set-select';
  const setSummary = document.createElement('div');
  setSummary.className = 'japanese-study-set-summary';

  const details = document.createElement('details');
  details.className = 'japanese-study-set-details';
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Create / edit set';
  const form = document.createElement('form');
  form.className = 'japanese-study-set-form';
  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Set name';
  const queryInput = document.createElement('input');
  queryInput.placeholder = 'kanji, hiragana, English, tag…';
  const typeSelect = makeSelect([{ value: '', label: 'Any type' }], '');
  const tagSelect = makeSelect([{ value: '', label: 'Any tag' }], '');
  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.min = '0';
  limitInput.inputMode = 'numeric';
  limitInput.placeholder = '0 = all';
  const saveSet = button('Save set', 'primary');
  const deleteSet = button('Delete set', 'danger');
  form.append(
    fieldLabel('Name', nameInput),
    fieldLabel('Search', queryInput),
    fieldLabel('Type', typeSelect),
    fieldLabel('Tag', tagSelect),
    fieldLabel('Limit', limitInput),
    saveSet,
    deleteSet,
  );
  details.append(detailsSummary, form);

  setBar.append(fieldLabel('Set', setSelect), setSummary, details);

  const card = document.createElement('article');
  card.className = 'japanese-study-card';
  const progress = document.createElement('div');
  progress.className = 'japanese-study-progress';
  const prompt = document.createElement('div');
  prompt.className = 'japanese-study-prompt';
  const promptLabel = document.createElement('div');
  promptLabel.className = 'japanese-study-prompt-label';
  const promptValue = document.createElement('div');
  promptValue.className = 'japanese-study-prompt-value';
  prompt.append(promptLabel, promptValue);
  const answer = document.createElement('div');
  answer.className = 'japanese-study-answer';
  card.append(progress, prompt, answer);

  const footer = document.createElement('footer');
  footer.className = 'japanese-study-footer';
  const prevBtn = button('Previous');
  const jpSoundBtn = button('🔊 Japanese');
  const revealBtn = button('Reveal', 'primary');
  const enSoundBtn = button('🔊 English');
  const nextBtn = button('Next');
  footer.append(prevBtn, jpSoundBtn, revealBtn, enSoundBtn, nextBtn);

  const empty = document.createElement('div');
  empty.className = 'japanese-study-empty';
  empty.textContent = 'Loading Japanese words…';

  root.append(top, setBar, card, empty, footer);

  function activeSet() {
    return state.sets.find((set) => set.id === state.activeSetId) || state.sets[0] || normalizeSet(DEFAULT_SETS[0]);
  }

  function save() {
    persistState(store, state);
  }

  function updateSetSelect() {
    setSelect.innerHTML = '';
    for (const set of state.sets) {
      const option = document.createElement('option');
      option.value = set.id;
      option.textContent = set.name;
      setSelect.append(option);
    }
    setSelect.value = state.activeSetId;
  }

  function updateRuleChoices() {
    const selectedType = typeSelect.value;
    const selectedTag = tagSelect.value;
    typeSelect.innerHTML = '';
    tagSelect.innerHTML = '';
    for (const item of [{ value: '', label: 'Any type' }, ...getUniqueValues(entries, 'type').map((value) => ({ value, label: value }))]) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      typeSelect.append(option);
    }
    for (const item of [{ value: '', label: 'Any tag' }, ...getUniqueValues(entries, 'tags').map((value) => ({ value, label: value }))]) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      tagSelect.append(option);
    }
    typeSelect.value = Array.from(typeSelect.options).some((o) => o.value === selectedType) ? selectedType : '';
    tagSelect.value = Array.from(tagSelect.options).some((o) => o.value === selectedTag) ? selectedTag : '';
  }

  function populateFormFromActiveSet() {
    const set = activeSet();
    nameInput.value = set.system ? '' : set.name;
    queryInput.value = set.rules.query || '';
    typeSelect.value = set.rules.type || '';
    tagSelect.value = set.rules.tag || '';
    limitInput.value = set.rules.limit ? String(set.rules.limit) : '';
    deleteSet.disabled = !!set.system;
  }

  function rebuildDeck({ keepIndex = false } = {}) {
    deck = applySet(entries, activeSet());
    if (!keepIndex) state.currentIndex = 0;
    if (state.currentIndex >= deck.length) state.currentIndex = Math.max(0, deck.length - 1);
    revealed = false;
  }

  function currentEntry() {
    return deck[state.currentIndex] || null;
  }

  function speakJapanese() {
    const entry = currentEntry();
    const text = getJapaneseText(entry);
    if (text) speak(text, { lang: 'ja-JP', fieldKey: 'kanji', collectionKey: JAPANESE_WORDS_COLLECTION });
  }

  function speakEnglish() {
    const text = getDisplayText(currentEntry(), 'meaning');
    if (text) speak(text, { lang: 'en-US', fieldKey: 'meaning', collectionKey: JAPANESE_WORDS_COLLECTION });
  }

  function renderCard() {
    const entry = currentEntry();
    const total = deck.length;
    const set = activeSet();
    empty.hidden = total > 0;
    card.hidden = total === 0;
    footer.hidden = total === 0;
    setSummary.textContent = `${total} of ${entries.length} words in “${set.name}”`;
    progress.textContent = total ? `${state.currentIndex + 1} / ${total}` : '0 / 0';
    prevBtn.disabled = total <= 1;
    nextBtn.disabled = total <= 1;

    if (!entry) {
      empty.textContent = entries.length ? 'No words match this set. Edit the set rules or choose All words.' : 'Loading Japanese words…';
      return;
    }

    const kanji = getDisplayText(entry, 'kanji');
    const reading = getDisplayText(entry, 'reading');
    const meaning = getDisplayText(entry, 'meaning');
    const mode = state.mode;
    const modeMeta = DEFAULT_MODES.find((item) => item.id === mode) || DEFAULT_MODES[0];
    card.dataset.mode = mode;
    promptLabel.textContent = revealed ? 'Revealed' : modeMeta.label;

    if (revealed) {
      promptValue.textContent = kanji || reading || meaning || '—';
    } else if (mode === 'english') {
      promptValue.textContent = meaning || '—';
    } else if (mode === 'hiragana') {
      promptValue.textContent = reading || '—';
    } else if (mode === 'voice') {
      promptValue.textContent = 'Listen';
    } else {
      promptValue.textContent = kanji || reading || '—';
    }

    answer.innerHTML = '';
    renderLine(answer, 'Kanji', kanji, 'kanji', { hidden: !revealed && mode !== 'kanji' });
    renderLine(answer, 'Hiragana', reading, 'reading', { hidden: !revealed && mode !== 'hiragana' });
    renderLine(answer, 'English', meaning, 'meaning', { hidden: !revealed && mode !== 'english' });
    renderLine(answer, 'Type', getDisplayText(entry, 'type'), 'type', { hidden: !revealed });
    renderLine(answer, 'Tags', Array.isArray(entry?.tags) ? entry.tags.join(', ') : '', 'tags', { hidden: !revealed || !Array.isArray(entry?.tags) || !entry.tags.length });

    revealBtn.textContent = revealed ? 'Hide' : 'Reveal';
  }

  function renderAll({ keepIndex = true } = {}) {
    updateSetSelect();
    updateRuleChoices();
    populateFormFromActiveSet();
    rebuildDeck({ keepIndex });
    renderCard();
  }

  function move(delta) {
    if (!deck.length) return;
    state.currentIndex = (state.currentIndex + delta + deck.length) % deck.length;
    revealed = false;
    save();
    renderCard();
    if (state.mode === 'voice') speakJapanese();
  }

  function reveal() {
    if (!currentEntry()) return;
    revealed = !revealed;
    renderCard();
    if (revealed) speakJapanese();
  }

  modeSelect.addEventListener('change', () => {
    state.mode = modeSelect.value;
    revealed = false;
    save();
    renderCard();
    if (state.mode === 'voice') speakJapanese();
  });

  setSelect.addEventListener('change', () => {
    state.activeSetId = setSelect.value;
    state.currentIndex = 0;
    save();
    renderAll({ keepIndex: false });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = activeSet();
    const name = String(nameInput.value || '').trim() || String(current.system ? 'Custom set' : current.name || 'Custom set');
    const nextSet = normalizeSet({
      id: current.system ? `set-${Date.now()}` : current.id,
      name,
      rules: {
        query: queryInput.value,
        type: typeSelect.value,
        tag: tagSelect.value,
        limit: limitInput.value,
      },
    });
    if (current.system) {
      state.sets = [...state.sets, nextSet];
    } else {
      state.sets = state.sets.map((set) => set.id === current.id ? nextSet : set);
    }
    state.activeSetId = nextSet.id;
    state.currentIndex = 0;
    save();
    renderAll({ keepIndex: false });
  });

  deleteSet.addEventListener('click', () => {
    const current = activeSet();
    if (!current || current.system) return;
    state.sets = state.sets.filter((set) => set.id !== current.id);
    state.activeSetId = 'all';
    state.currentIndex = 0;
    save();
    renderAll({ keepIndex: false });
  });

  prevBtn.addEventListener('click', () => move(-1));
  nextBtn.addEventListener('click', () => move(1));
  revealBtn.addEventListener('click', reveal);
  jpSoundBtn.addEventListener('click', speakJapanese);
  enSoundBtn.addEventListener('click', speakEnglish);

  const keyHandler = (event) => {
    const target = event.target;
    const tagName = String(target?.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tagName) || target?.isContentEditable) return false;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); return true; }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); return true; }
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); reveal(); return true; }
    if (event.key && event.key.toLowerCase() === 's') { event.preventDefault(); speakJapanese(); return true; }
    return false;
  };

  function register() {
    document.dispatchEvent(new CustomEvent('app:registerKeyHandler', { detail: { id: APP_ID, handler: keyHandler } }));
    document.dispatchEvent(new CustomEvent('app:registerMediaHandler', { detail: { id: APP_ID, toggle: speakJapanese, play: speakJapanese, getState: () => ({ playing: false }) } }));
  }

  function unregister() {
    document.dispatchEvent(new CustomEvent('app:unregisterKeyHandler', { detail: { id: APP_ID } }));
    document.dispatchEvent(new CustomEvent('app:unregisterMediaHandler', { detail: { id: APP_ID } }));
  }

  root.__activate = () => { isActive = true; register(); };
  root.__deactivate = () => { isActive = false; unregister(); };
  root.__register = register;
  root.__unregister = unregister;

  async function initialize() {
    try {
      collection = await store?.collections?.loadCollection?.(JAPANESE_WORDS_COLLECTION);
      if (store?.collections?.getActiveCollectionId?.() !== JAPANESE_WORDS_COLLECTION) {
        await store?.collections?.setActiveCollectionId?.(JAPANESE_WORDS_COLLECTION);
        collection = store?.collections?.getActiveCollection?.() || collection;
      }
      entries = Array.isArray(collection?.entries) ? collection.entries.slice() : [];
      renderAll({ keepIndex: true });
      if (state.mode === 'voice' && isActive) speakJapanese();
    } catch (error) {
      empty.hidden = false;
      empty.textContent = `Could not load Japanese words: ${error?.message || error}`;
      card.hidden = true;
      footer.hidden = true;
    }
  }

  updateSetSelect();
  renderCard();
  register();
  void initialize();

  return root;
}
