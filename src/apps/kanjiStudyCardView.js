import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';
import { CARD_REGISTRY } from '../cards/index.js';
import { addStudyFilter } from '../components/studyControls.js';
import { addShuffleControls } from '../components/collectionControls.js';
import { settingsLog } from '../managers/settingsManager.js';

import collectionSettingsController from '../controllers/collectionSettingsController.js';
import kanjiStudyController from '../controllers/kanjiStudyController.js';

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';

  // Register as a settings consumer for persisted app settings.
  store?.settings?.registerConsumer?.({
    consumerId: 'kanjiStudyCardView',
    settings: [
      'apps.kanjiStudy.defaultViewMode',
    ],
  });

  function getCurrentKanjiKey() {
    const entry = entries && entries.length ? entries[index] : null;
    return String(store.collections.getEntryStudyKey(entry) || '').trim();
  }

  function getCurrentCollectionKey() {
    const active = store?.collections?.getActiveCollection?.();
    return String(active?.key || '').trim();
  }

  const progressTracker = store?.kanjiProgress?.createCardProgressTracker?.({
    appId: 'kanjiStudyCardView',
    getCollectionKey: () => getCurrentCollectionKey(),
    getEntryKey: () => getCurrentKanjiKey(),
  });

  // Simple state
  let entries = [];
  let index = 0;
  let viewMode = 'kanji-only'; // current card view
  let defaultViewMode = 'kanji-only'; // controls what is shown when changing cards
  let shownAt = nowMs();
  let isShuffled = false;
  
  let uiStateRestored = false; // ensure saved UI (index/order) is applied only once
  let originalEntries = [];
  let currentOrder = null; // array of indices mapping to originalEntries
  let orderHashInt = null; // deterministic seed for shuffle (preferred persisted form)
  let viewIndices = []; // indices into originalEntries for the current rendered entries array
  let relatedHydratedCollectionKey = null;
  let relatedHydrationPromise = null;
  let kanjiController = null;

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  function getPrimaryKanjiValue(entry) {
    return getFieldValue(entry, ['kanji', 'character', 'text']) || '';
  }

  // Persist minimal UI state into per-collection state (no legacy fallbacks)
  function saveUIState() {
    const active = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
    const key = active && active.key ? active.key : null;
    if (!key) return;
    // persist collection fundamentals at top-level
    collectionSettingsController.set(key, {
      isShuffled: !!isShuffled,
      order_hash_int: (typeof orderHashInt === 'number') ? orderHashInt : null,
    });
      // persist app-scoped index and dropdown selections under `kanjiStudyCardView`
      const sliceOrAll = (sel, items) => {
        if (sel === 'all') return 'all';
        const arr = Array.isArray(sel) ? sel.slice() : [];
        const allVals = Array.isArray(items) ? items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
        const set = new Set(arr);
        const isAll = allVals.length > 0 && allVals.length === arr.length && allVals.every(v => set.has(v));
        return isAll ? 'all' : arr;
      };

      // Persist entry-level and related-collection visibility selections
      const relatedOut = {};
      for (const k of Object.keys(relatedFieldSelections || {})) relatedOut[k] = Array.isArray(relatedFieldSelections[k]) ? relatedFieldSelections[k].slice() : relatedFieldSelections[k];

      (kanjiController || kanjiStudyController.create(key)).set({
        currentIndex: index,
        entryFields: (entryFieldSelection === 'all') ? 'all' : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []),
        relatedFields: relatedOut,
        displayCards: sliceOrAll(displayCardSelection, displayCardItems),
      });

      // persist app-global default view mode under apps.kanjiStudy
      if (store?.settings && typeof store.settings.set === 'function') {
        store.settings.set('apps.kanjiStudy.defaultViewMode', defaultViewMode, { consumerId: 'kanjiStudyCardView' });
      }
  }

  // Root UI pieces
  const headerTools = createViewHeaderTools();
  // Instantiate available cards from the registry so views can be generic.
  const cardApis = {};
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    // Pass a common shape; factories may ignore unknown props.
    // Provide handlers for the related card so we don't need to recreate it later.
    if (c.key === 'related') {
      cardApis[c.key] = c.factory({ entry: null, indexText: '', handlers: {
        onSpeak: (text) => {
          if (!text) return;
          const lang = getLanguageCode('reading');
          speak(text, lang);
        },
        onNext: (ci) => {},
        onPrev: (ci) => {},
      }});
    } else {
      cardApis[c.key] = c.factory({ entry: null, indexText: '' });
    }
  }

  const fullCardApi = cardApis['full'] || null;
  // Track whether we mounted header/footer into the shell main container
  let __mountedHeaderInShell = false;
  let __mountedFooterInShell = false;

  // header groups are created via `headerTools.addElement`

  // shuffle control will be added later once handler is defined

  // --- Header dropdowns to control field visibility (entry-level + related collections) ---
  // New authoritative model: visibility is controlled at the entry level (and per-related-collection).
  // Build items from collection metadata only (no legacy fallbacks).
  const res = store?.collections?.getActiveCollectionView ? store.collections.getActiveCollectionView({ windowSize: 0 }) : null;
  const coll = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
  if (coll && coll.key) {
    if (kanjiController && kanjiController.collKey !== coll.key) { kanjiController.dispose(); kanjiController = null; }
    if (!kanjiController) kanjiController = kanjiStudyController.create(coll.key);
  }
  const appState = (coll && coll.key) ? (kanjiController ? kanjiController.get() : {}) : {};
  let displayCardSelection = (appState && appState.displayCards !== undefined)
    ? (Array.isArray(appState.displayCards) ? appState.displayCards.slice() : appState.displayCards)
    : undefined;

  // state for visibility selections
  let entryFieldSelection = Array.isArray(appState?.entryFields) ? appState.entryFields.slice() : 'all';
  const relatedFieldSelections = (appState && typeof appState.relatedFields === 'object') ? { ...appState.relatedFields } : {};

  // helper to apply an entry-level visibility map to all card APIs
  function applyEntryFieldVisibility(map) {
    for (const k of Object.keys(cardApis || {})) {
      const api = cardApis[k];
      if (!api) continue;
      if (typeof api.setFieldsVisible === 'function') api.setFieldsVisible(map);
      else if (typeof api.setFieldVisible === 'function') {
        for (const fk of Object.keys(map)) api.setFieldVisible(fk, !!map[fk]);
      }
    }
  }

  // derive entry field items from collection metadata (authoritative)
  const activeColl = store?.collections?.getActiveCollection?.() || null;
  const metadata = activeColl?.metadata || {};
  const entryFieldItems = Array.isArray(metadata?.fields) ? metadata.fields.map(f => ({ value: String(f.key || f), left: f.label || String(f.key || f) })) : [];

  // create entry-level dropdown
  const entryFieldsRec = headerTools.addElement({
    type: 'dropdown', key: 'entryFields', items: entryFieldItems, multi: true,
    values: (entryFieldSelection === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []),
    commitOnClose: true,
    includeAllNone: true,
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(vals) ? vals.slice() : []);
      const set = new Set(chosen);
      const map = {};
      for (const it of entryFieldItems) map[String(it.value || '')] = set.has(String(it.value || ''));
      // Preserve the literal 'all' when the dropdown reports it, so persistence stores 'all' (not an expanded array).
      entryFieldSelection = (typeof vals === 'string' && vals === 'all') ? 'all' : chosen;
      applyEntryFieldVisibility(map);
      saveUIState();
    },
    className: 'data-expansion-dropdown',
    caption: 'entry.fields.visibility'
  });

  // For each related-collection declared in the collection metadata, add a dropdown.
  const relatedDefs = Array.isArray(metadata?.relatedCollections) ? metadata.relatedCollections.slice() : [];
  const relatedDropdownControls = {};
  const RELATED_DEFAULT_ITEMS = [
    { value: 'english', left: 'English' },
    { value: 'japanese', left: 'Japanese' },
    { value: 'notes', left: 'Notes' },
  ];

  for (const rel of relatedDefs) {
    const name = String(rel?.name || '').trim();
    if (!name) continue;
    const items = Array.isArray(rel.fields) ? rel.fields.map(f => ({ value: String(f.key || f), left: f.label || String(f.key || f) })) : RELATED_DEFAULT_ITEMS.slice();
    const sel = relatedFieldSelections[name] || 'all';
    const rec = headerTools.addElement({
      type: 'dropdown', key: `related.${name}.fields`, items, multi: true,
      values: (sel === 'all') ? items.map(it => String(it.value || '')) : (Array.isArray(sel) ? sel.slice() : []),
      commitOnClose: true,
      includeAllNone: true,
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all') ? items.map(it => String(it?.value || '')) : (Array.isArray(vals) ? vals.slice() : []);
        // Preserve 'all' when applicable so we persist the compact marker instead of the expanded list
        relatedFieldSelections[name] = (typeof vals === 'string' && vals === 'all') ? 'all' : chosen;
        // apply to related card API if available
        const api = cardApis['related'];
        if (api && typeof api.setFieldsVisible === 'function') {
          const set = new Set(chosen);
          const map = {};
          for (const it of items) map[String(it.value || '')] = set.has(String(it.value || ''));
          api.setFieldsVisible(map);
        }
        saveUIState();
      },
      className: 'data-expansion-dropdown',
      caption: `${name}.fields.visibility`
    });
    relatedDropdownControls[name] = rec && rec.control ? rec.control : null;
  }

  // No legacy UI load: visual defaults used.

  // Footer controls: describe actions and let footer build UI + register shortcuts
  function getFooterButton(key) {
    if (!footerControls) return null;
    if (typeof footerControls.getButton === 'function') return footerControls.getButton(key);
    return (footerControls.buttons && footerControls.buttons[key]) || null;
  }

  const footerDesc = [
    { key: 'prev', icon: '←', text: 'Prev', caption: '←', shortcut: 'ArrowLeft', actionKey: 'prev', fnName: 'showPrev', action: () => showPrev() },
    // Note: removed stateful 'reveal' control (reveal/hide) as it caused issues.
    // Default sound buttons: kanji and reading. Additional sound.<field> actions
    // are provided via extraActions so they can be added in custom buttons.
    { key: 'sound.kanji', icon: '🔊', text: 'Sound', shortcut: '', actionKey: 'sound.kanji', fnName: 'speakField', action: () => speakField('kanji') },
    { key: 'sound.reading', icon: '🔊', text: 'Sound', shortcut: ' ', actionKey: 'sound.reading', fnName: 'speakField', action: () => speakField('reading') },
    { key: 'learned', icon: '✅', text: 'Learned', caption: 'V', shortcut: 'v', actionKey: 'learned', fnName: 'toggleKanjiLearned', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiLearned === 'function') {
        store.kanjiProgress.toggleKanjiLearned(v, { collectionKey: getCurrentCollectionKey() });
        updateMarkButtons();
        const view = store.collections.getActiveCollectionView({ windowSize: 10 })?.view;
        if (view?.skipLearned) {
          refreshEntriesFromStore();
          index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
          render();
          saveUIState();
        }
      }
    } },
    { key: 'practice', icon: '🎯', text: 'Practice', caption: 'X', shortcut: 'x', actionKey: 'practice', fnName: 'toggleKanjiFocus', ariaPressed: false, action: () => {
      const entry = entries[index];
      const v = store.collections.getEntryStudyKey(entry);
      if (!v) return;
      if (store?.kanjiProgress && typeof store.kanjiProgress.toggleKanjiFocus === 'function') {
        store.kanjiProgress.toggleKanjiFocus(v, { collectionKey: getCurrentCollectionKey() });
        updateMarkButtons();
        const view = store.collections.getActiveCollectionView({ windowSize: 10 })?.view;
        if (view?.focusOnly) {
          refreshEntriesFromStore();
          index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
          render();
          saveUIState();
        }
      }
    } },
    { key: 'next', icon: '→', text: 'Next', caption: '→', shortcut: 'ArrowRight', actionKey: 'next', fnName: 'showNext', action: () => showNext() },
  ];

  let footerControls = null;
  // Auto-speak setting removed from UI.

  // Speak a specific field from the current entry (used for sound.X actions)
  function speakField(field) {
    const entry = entries && entries.length ? entries[index] : null;
    if (!entry || !field) return;
    const text = getFieldValue(entry, [field]);
    if (!text) return;
    const lang = getLanguageCode(field);
    speak(text, lang);
  }

  // Build extra dynamic sound actions so custom buttons can reference sound.<field>
  // Only include fields present on kanji entries; exclude relatedCollections
  const soundFields = ['kanji', 'lexicalClass', 'meaning', 'orthography', 'reading', 'type'];
  const extraActions = soundFields.map((f) => ({
    id: `sound.${f}`,
    controlKey: `sound.${f}`,
    text: `Sound (${f})`,
    fnName: 'speakField',
    invoke: (e) => { speakField(f); },
  }));

  // Add explicit kanji state setters so custom buttons can call them directly.
  // These wrap store.kanjiProgress APIs and operate on the current entry.
  extraActions.push({
    id: 'setStateLearned', controlKey: 'setStateLearned', text: 'Set Learned', fnName: 'setStateLearned', invoke: () => {
      const entry = entries && entries.length ? entries[index] : null;
      const key = entry ? store.collections.getEntryStudyKey(entry) : null;
      if (!key) return;
      try { store.kanjiProgress.setStateLearned(key, { collectionKey: getCurrentCollectionKey() }); } catch (e) {}
    }
  });
  extraActions.push({
    id: 'setStateNull', controlKey: 'setStateNull', text: 'Clear State', fnName: 'setStateNull', invoke: () => {
      const entry = entries && entries.length ? entries[index] : null;
      const key = entry ? store.collections.getEntryStudyKey(entry) : null;
      if (!key) return;
      try { store.kanjiProgress.setStateNull(key, { collectionKey: getCurrentCollectionKey() }); } catch (e) {}
    }
  });
  extraActions.push({
    id: 'setStateFocus', controlKey: 'setStateFocus', text: 'Set Focus', fnName: 'setStateFocus', invoke: () => {
      const entry = entries && entries.length ? entries[index] : null;
      const key = entry ? store.collections.getEntryStudyKey(entry) : null;
      if (!key) return;
      try { store.kanjiProgress.setStateFocus(key, { collectionKey: getCurrentCollectionKey() }); } catch (e) {}
    }
  });

  // Link actions: open searches for the primary kanji in a new tab.
  function openSearchInNewTab(url) {
    try { window.open(url, '_blank'); } catch (e) { }
  }
  function getSearchTerm() {
    const entry = entries && entries.length ? entries[index] : null;
    if (!entry) return '';
    return (getPrimaryKanjiValue(entry) || '').trim();
  }

  extraActions.push({
    id: 'link.google', controlKey: 'link.google', text: 'Link (Google)', fnName: 'linkGoogle', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://www.google.com/search?q=' + encodeURIComponent(t));
    }
  });
  extraActions.push({
    id: 'link.google.images', controlKey: 'link.google.images', text: 'Link (Google Images)', fnName: 'linkGoogleImages', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(t));
    }
  });
  extraActions.push({
    id: 'link.jisho', controlKey: 'link.jisho', text: 'Link (Jisho)', fnName: 'linkJisho', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://jisho.org/search/' + encodeURIComponent(t));
    }
  });
  extraActions.push({
    id: 'link.wiktionary', controlKey: 'link.wiktionary', text: 'Link (Wiktionary)', fnName: 'linkWiktionary', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://en.wiktionary.org/wiki/' + encodeURIComponent(t));
    }
  });
  extraActions.push({
    id: 'link.translate', controlKey: 'link.translate', text: 'Link (Google Translate)', fnName: 'linkTranslate', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://translate.google.com/?sl=auto&tl=en&text=' + encodeURIComponent(t) + '&op=translate');
    }
  });
  extraActions.push({
    id: 'link.chatgpt', controlKey: 'link.chatgpt', text: 'Link (ChatGPT)', fnName: 'linkChatGPT', namespace: 'entry.kanji', invoke: () => {
      const t = getSearchTerm(); if (!t) return; openSearchInNewTab('https://chat.openai.com/?q=' + encodeURIComponent(t));
    }
  });

  // Now create footer controls, passing extraActions so they appear in availableActions
  footerControls = createViewFooterControls(footerDesc, { appId: 'kanjiStudy', extraActions });

  // Load default view mode from settings
  if (store?.settings && typeof store.settings.get === 'function') {
    const dvm = store.settings.get('apps.kanjiStudy.defaultViewMode', { consumerId: 'kanjiStudyCardView' });
    if (typeof dvm === 'string') defaultViewMode = dvm;
    viewMode = defaultViewMode;
  }

  // Create main/related/full card APIs. Prefer registry instances where available;
  // recreate related card with handlers so it can call back into this view.
  const mainCardApi = cardApis['main'] || (function() {
    const regMain = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'main') : null);
    if (regMain && typeof regMain.factory === 'function') return regMain.factory({ entry: null, indexText: '' });
    return null;
  })();
  const relatedFactory = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'related') : null);
  let relatedCardApi = (cardApis && cardApis['related']) ? cardApis['related'] : null;

  // full card dropdown is handled via the registry-driven loop above

  // Dropdown to choose which cards are displayed
  // Build display card items from the card registry so new cards appear automatically.
  const displayCardItems = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : []).map(c => ({ value: c.key, left: c.label }));

  const _displayCardsRec = headerTools.addElement({
    type: 'dropdown', key: 'displayCards', items: displayCardItems, multi: true,
    values: Array.isArray(displayCardSelection)
      ? displayCardSelection.slice()
      : (displayCardSelection === 'all' ? displayCardItems.map(it => String(it?.value || '')) : ['main', 'related']),
    commitOnClose: true,
    includeAllNone: true,
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all')
        ? displayCardItems.map(it => String(it?.value || ''))
        : (Array.isArray(vals) ? vals.slice() : []);
      const set = new Set(chosen);
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
        const api = cardApis[c.key];
        if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
        // Also hide/show the corresponding per-card field dropdown group
        try {
          // Hide/show related dropdown groups when the related card is toggled
          if (c.key === 'related') {
            for (const rn of Object.keys(relatedDropdownControls || {})) {
              const rc = relatedDropdownControls[rn];
              if (rc && rc.parentNode) rc.parentNode.style.display = set.has(c.key) ? '' : 'none';
            }
          }
        } catch (e) {}
      }
      // Preserve the literal 'all' marker for compact persistence when the dropdown reports it.
      displayCardSelection = (typeof vals === 'string' && vals === 'all') ? 'all' : chosen;
      saveUIState();
    },
    className: 'data-expansion-dropdown',
    caption: 'visible.cards'
  });

  addStudyFilter(headerTools, { getCurrentCollectionKey, onChange: () => { refreshEntriesFromStore(); render(); } });


  // expose the same variable names used elsewhere so render() logic needs minimal changes
  const card = mainCardApi.el; // root .card kanji-card
  const wrapper = card.querySelector('.kanji-card-wrapper');
  // collect registry-ordered elements for appending into the view root
  const registryCardEls = [];
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    const api = cardApis[c.key];
    if (api && api.el) registryCardEls.push(api.el);
  }

  // Apply initial visibility defaults based on entry-level and related selections
  if (displayCardSelection === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));

  // Apply initial per-card visibility immediately so cards reflect persisted selection
  try {
    const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection.map(String) : []);
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      try {
        const api = cardApis[c.key];
        if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
        // Also hide/show related dropdown groups when the related card is toggled
        if (c.key === 'related') {
          for (const rn of Object.keys(relatedDropdownControls || {})) {
            const rc = relatedDropdownControls[rn];
            if (rc && rc.parentNode) rc.parentNode.style.display = set.has(c.key) ? '' : 'none';
          }
        }
      } catch (e) {
        /* ignore per-card errors */
      }
    }
  } catch (e) {}

  // Apply entry-level visibility
  const entrySelected = (entryFieldSelection === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []);
  const entrySet = new Set(entrySelected);
  const entryMap = {};
  for (const it of entryFieldItems) entryMap[String(it.value || '')] = entrySet.has(String(it.value || ''));
  applyEntryFieldVisibility(entryMap);

  // Apply related-collection visibility selections
  for (const rel of relatedDefs) {
    const name = String(rel?.name || '').trim();
    if (!name) continue;
    const items = Array.isArray(rel.fields) ? rel.fields.map(f => String(f.key || f)) : RELATED_DEFAULT_ITEMS.map(it => it.value);
    const sel = relatedFieldSelections[name] || 'all';
    const chosen = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : []);
    const api = cardApis['related'];
    if (api && typeof api.setFieldsVisible === 'function') {
      const set = new Set(chosen);
      const map = {};
      for (const v of items) map[v] = set.has(v);
      api.setFieldsVisible(map);
    }
  }

  // render a single card body
  function renderCard(body, entry) {
    body.innerHTML = '';

    // main kanji centered
    const kanjiWrap = document.createElement('div');
    kanjiWrap.className = 'kanji-main-wrap';
    const kanjiMain = document.createElement('div');
    kanjiMain.className = 'kanji-main';
    const text = getFieldValue(entry, ['kanji', 'character', 'text']) || '';
    kanjiMain.textContent = text;
    // Auto-scale font size based on text length (3 tiers)
    const length = text.length;
    let fontSize = 5; // base size in rem
    if (length > 6) fontSize = 3.5;
    else if(length > 5) fontSize = 3.75;
    else if (length > 4) fontSize = 4;
    kanjiMain.style.fontSize = `${fontSize}rem`;
    kanjiWrap.append(kanjiMain);

    // top-left type
    const topLeft = document.createElement('div');
    topLeft.className = 'kanji-top-left';
    topLeft.textContent = getFieldValue(entry, ['type']) || '';

    // bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'kanji-bottom-left';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'kanji-bottom-right';
    bottomRight.textContent = getFieldValue(entry, ['meaning', 'definition', 'gloss']) || '';

    body.append(topLeft, kanjiWrap, bottomLeft, bottomRight);
  }

  function refreshEntriesFromStore() {
    const res = store.collections.getActiveCollectionView({ windowSize: 10 });
    const active = res?.collection || null;
    const collState = (active && active.key) ? (collectionSettingsController.get(active.key) || {}) : (res?.collState || {});
    const view = res?.view || {};

    originalEntries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    entries = Array.isArray(view?.entries) ? view.entries : [];
    viewIndices = Array.isArray(view?.indices) ? view.indices : [];
    isShuffled = !!view?.isShuffled;
    orderHashInt = (typeof view?.order_hash_int === 'number') ? view.order_hash_int : null;
    currentOrder = null;
    // If a saved index exists in collection state, restore it once on initial load.
    // Only use the app-scoped `kanjiStudyCardView.currentIndex` (no legacy fallbacks).
    if (!uiStateRestored && collState) {
      const savedIndex = (collState.kanjiStudyCardView && typeof collState.kanjiStudyCardView.currentIndex === 'number')
        ? collState.kanjiStudyCardView.currentIndex
        : undefined;
      if (typeof savedIndex === 'number') index = savedIndex;

      const savedApp = collState.kanjiStudyCardView || {};
      if (savedApp.entryFields !== undefined) entryFieldSelection = savedApp.entryFields === 'all' ? 'all' : (Array.isArray(savedApp.entryFields) ? savedApp.entryFields.slice() : savedApp.entryFields);
      if (savedApp.relatedFields && typeof savedApp.relatedFields === 'object') {
        for (const k of Object.keys(savedApp.relatedFields)) relatedFieldSelections[k] = Array.isArray(savedApp.relatedFields[k]) ? savedApp.relatedFields[k].slice() : savedApp.relatedFields[k];
      }
      if (Array.isArray(savedApp.displayCards)) displayCardSelection = savedApp.displayCards.slice();
      else if (savedApp.displayCards === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));

      uiStateRestored = true;
    }
    const prevIndex = index;
    index = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
    if (index !== prevIndex) {/* index clamped */}

    // Ensure full-detail card reflects the currently selected entry after entries refresh
    try {
      const curEntry = entries && entries.length ? entries[index] : null;
      if (fullCardApi && typeof fullCardApi.setEntry === 'function') fullCardApi.setEntry(curEntry);
    } catch (e) {}

    try {
      const activeKey = String(active?.key || '').trim();
      if (!activeKey) {
        relatedHydratedCollectionKey = null;
        relatedHydrationPromise = null;
        return;
      }
      if (relatedHydratedCollectionKey !== activeKey && !relatedHydrationPromise && typeof store?.collections?.getCollectionEntriesWithRelated === 'function') {
        relatedHydrationPromise = Promise.resolve()
          .then(() => store.collections.getCollectionEntriesWithRelated(activeKey, { sample: 0 }))
          .then(() => {
            const currentActive = store?.collections?.getActiveCollection?.();
            if (String(currentActive?.key || '').trim() !== activeKey) return;
            relatedHydratedCollectionKey = activeKey;
            refreshEntriesFromStore();
            render();
          })
          .catch(() => {})
          .finally(() => {
            relatedHydrationPromise = null;
          });
      }
    } catch (e) {}
  }

  // Navigation / control helpers to avoid duplicated logic
  function goToIndex(newIndex) {
    if (newIndex < 0 || newIndex >= entries.length) return;
    // finalize time for previous card before switching
    progressTracker?.flush?.({ immediate: false });
    const prev = index;
    index = newIndex;
    shownAt = nowMs();
    viewMode = defaultViewMode;
    // index updated
    render();
    // auto-speak removed from UI; preserve speak on navigation via explicit calls elsewhere
    // persist current index so it's restored when navigating back
    saveUIState();
  }

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }
  function revealFull() { viewMode = 'full'; render(); }
  function showKanjiOnly() { viewMode = 'kanji-only'; render(); }
  function toggleReveal() {
    if (viewMode === 'full') {
      showKanjiOnly();
    } else {
      revealFull();
    }
  }
  

  function updateMarkButtons() {
    const learnedBtn = getFooterButton('learned');
    const practiceBtn = getFooterButton('practice');
    if (!learnedBtn || !practiceBtn) return;
    const entry = entries[index];
    const v = store.collections.getEntryStudyKey(entry);
    const collectionKey = getCurrentCollectionKey();
    const isLearned = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiLearned === 'function' && v) ? store.kanjiProgress.isKanjiLearned(v, { collectionKey }) : false;
    const isFocus = !!(store?.kanjiProgress && typeof store.kanjiProgress.isKanjiFocus === 'function' && v) ? store.kanjiProgress.isKanjiFocus(v, { collectionKey }) : false;

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
  }

  

  function updateRevealButton() {
    // Reveal/hide state removed — no-op to avoid errors from older calls.
    return;
  }

  function shuffleEntries() {
    const n = originalEntries.length;
    if (n === 0) return;

    try { progressTracker?.flush?.({ immediate: false }); } catch (e) {}

    // generate a 32-bit seed (prefer crypto RNG)
    let seed;
    const a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    seed = a[0] >>> 0;

    orderHashInt = seed;
    // persist per-collection state via centralized action
    const active = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
    const key = active && active.key ? active.key : null;
    if (key) {
      store.collections.shuffleCollection(key);
    }

    // rebuild view from saved collection state
    refreshEntriesFromStore();
    index = 0;
    viewMode = defaultViewMode;
    isShuffled = true;
    const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', 'true');
    render();
  }

  // small sleep helper
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // PRNG and permutation now in collectionsManager



  function toggleDefaultViewMode() {
    defaultViewMode = defaultViewMode === 'kanji-only' ? 'full' : 'kanji-only';
    viewMode = defaultViewMode;
    render();
    saveUIState();
  }

  function render() {
      if (!isShuffled) {
    refreshEntriesFromStore();
      }
    const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', String(!!isShuffled));
    // render

    // If the underlying entry changed due to refresh, keep timing aligned.
    // (e.g., store updates, filter changes, virtual set resolution)
    progressTracker?.syncToCurrent?.();

    const entry = entries[index];
    const total = entries.length;

    // update view mode class on the wrapper (maintains previous behavior)
    if (viewMode === 'kanji-only') wrapper.classList.add('kanji-only');
    else wrapper.classList.remove('kanji-only');

    // update main card content and corner caption
    const caption = total ? `${index + 1} / ${total}` : 'Empty';
    mainCardApi.setIndexText(caption);

    if (!entry) {
      // show empty hint inside the card body
      const bodyEl = mainCardApi.el.querySelector('.kanji-body');
      if (bodyEl) bodyEl.innerHTML = '<p class="hint">This collection has no entries yet.</p>';
      mainCardApi.setEntry(null);
      fullCardApi && typeof fullCardApi.setEntry === 'function' && fullCardApi.setEntry(null);
    } else {
      mainCardApi.setEntry(entry);
      fullCardApi && typeof fullCardApi.setEntry === 'function' && fullCardApi.setEntry(entry);
    }

    // Update related sentence card via its API. the card expects `entry` only.
    const displaySet = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
    // Pass the current entry to the related card so it can derive its sentences.
    if (relatedCardApi && typeof relatedCardApi.setEntry === 'function') relatedCardApi.setEntry(entry);
    // Also set the entry on any other registered cards (e.g., generic) so they can render.
    for (const k of Object.keys(cardApis || {})) {
      const api = cardApis[k];
      if (api && typeof api.setEntry === 'function') api.setEntry(entry);
    }
    // Toggle visibility for every registered card according to user selection.
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      const api = cardApis[c.key];
      if (api && api.el) api.el.style.display = displaySet.has(c.key) ? '' : 'none';
    }
    
    // Update reveal button text based on current viewMode
    updateRevealButton();

    // Update learned/focus button state
    updateMarkButtons();
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // Pause/resume timing on visibility/focus changes

  // Removed local visibility handlers


  // React to store changes (e.g., virtual set finishing its background resolution)
  let unsub = null;
  if (store && typeof store.subscribe === 'function') {
    let lastKey = store?.collections?.getActiveCollection?.()?.key || null;
    unsub = store.subscribe(() => {
      const active = store?.collections?.getActiveCollection?.();
      const key = active?.key || null;
      // Refresh when active collection changes or when entries may have been updated.
      if (key !== lastKey) {
        lastKey = key;
        uiStateRestored = false;
      }
      refreshEntriesFromStore();
      render();
    });
  }

  

  // Footer caption (below the card)
  const footer = document.createElement('div');
  footer.className = 'view-footer-caption';
  footer.id = 'kanji-controls';
  footer.textContent = '← / →: navigate  •  ↑: full  •  ↓: kanji only';

  // mainCardApi.el already contains its internal wrapper

  // Append every registered card element (in registry order) into the view root
  for (const childEl of registryCardEls) {
    el.appendChild(childEl);
  }

  // Build a DocumentFragment containing header -> view root -> footer so
  // when the shell appends the fragment its children become siblings in
  // the correct order under `#shell-main`.
  const frag = document.createDocumentFragment();
  frag.appendChild(headerTools);
  frag.appendChild(el);
  frag.appendChild(footerControls.el);
  // mark mounted flags; the fragment will be appended by the shell into
  // `#shell-main` synchronously when this function returns.
  __mountedHeaderInShell = true;
  __mountedFooterInShell = true;

  // Tools behaviour
  // wire shuffle control after handler exists
  try {
    addShuffleControls(headerTools, {
      store,
      onShuffle: shuffleEntries,
      onClearShuffle: () => {
        try {
          refreshEntriesFromStore();
          index = 0;
          viewMode = defaultViewMode;
          isShuffled = false;
          render();
        } catch (e) {}
      },
      includeClearShuffle: true,
      includeClearLearned: false
    });
  } catch (e) {}
  // Ensure header order: shuffle, clearShuffle, studyFilter, then remaining controls
  try {
    const parent = headerTools;
    const getCtrlGroup = (key) => {
      const ctrl = (typeof headerTools.getControl === 'function') ? headerTools.getControl(key) : null;
      return ctrl && ctrl.parentNode ? ctrl.parentNode : null;
    };
    const shuffleGroup = getCtrlGroup('shuffle');
    const clearShuffleGroup = getCtrlGroup('clearShuffle');
    const studyFilterGroup = getCtrlGroup('studyFilter');

    // Insert in desired sequence at the start of the parent container.
    if (parent && shuffleGroup) parent.insertBefore(shuffleGroup, parent.firstChild);
    if (parent && clearShuffleGroup) parent.insertBefore(clearShuffleGroup, shuffleGroup ? shuffleGroup.nextSibling : parent.firstChild);
    if (parent && studyFilterGroup) parent.insertBefore(studyFilterGroup, (clearShuffleGroup && parent.contains(clearShuffleGroup)) ? clearShuffleGroup.nextSibling : (shuffleGroup && parent.contains(shuffleGroup) ? shuffleGroup.nextSibling : parent.firstChild));
  } catch (e) {}
  // Details toggle removed from header tools

  // Keyboard handling for footer shortcuts is handled by the footer component
  // (it registers an app-level key handler using id 'kanjiStudy').



  // Cleanup on unmount
  let __wasMounted = false;
  const observer = new MutationObserver(() => {
    // Avoid false-positive unmount before the shell has appended this view.
    if (!__wasMounted) {
      if (document.body.contains(el)) __wasMounted = true;
      else return;
    }

    if (!document.body.contains(el)) {
      // finalize any remaining credit when navigating away/unmounting
      progressTracker?.teardown?.();
      if (typeof unsub === 'function') unsub();
      
      // cleanup header/footer moved into shell
      if (__mountedHeaderInShell && headerTools && headerTools.parentNode) headerTools.parentNode.removeChild(headerTools);
      if (__mountedFooterInShell && footerControls && footerControls.el && footerControls.el.parentNode) footerControls.el.parentNode.removeChild(footerControls.el);
      // explicitly unregister footer key handler if provided
      if (footerControls && typeof footerControls.__unregister === 'function') footerControls.__unregister();
      if (mainCardApi && typeof mainCardApi.destroy === 'function') mainCardApi.destroy();
      if (relatedCardApi && typeof relatedCardApi.destroy === 'function') relatedCardApi.destroy();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose fragment so the shell can mount header -> view -> footer in order
  return frag;
}
