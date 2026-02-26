import { nowMs } from '../utils/helpers.js';
import { speak, getLanguageCode } from '../utils/speech.js';

import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createViewFooterControls } from '../components/viewFooterControls.js';
import { CARD_REGISTRY } from '../cards/index.js';

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
    if (typeof store?.collections?.saveCollectionState === 'function') {
      // persist collection fundamentals at top-level
      store.collections.saveCollectionState(key, {
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

      // Persist per-card field selections as an object keyed by card key.
      const cardFieldsOut = {};
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
        const items = Array.isArray(c.toggleFields) ? c.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
        const sel = cardFieldSelections[c.key];
        if (sel === 'all') cardFieldsOut[c.key] = 'all';
        else if (Array.isArray(sel)) cardFieldsOut[c.key] = sel.slice();
        else cardFieldsOut[c.key] = items.slice();
      }

      store.collections.saveCollectionState(key, {
        kanjiStudyCardView: {
          currentIndex: index,
          cardFields: cardFieldsOut,
          displayCards: sliceOrAll(displayCardSelection, displayCardItems),
        }
      });

      // persist app-global default view mode under apps.kanjiStudy
      if (store?.settings && typeof store.settings.set === 'function') {
        store.settings.set('apps.kanjiStudy.defaultViewMode', defaultViewMode, { consumerId: 'kanjiStudyCardView' });
      }
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

  // --- Header dropdowns to control card field visibility ---
  // Use registry-driven per-card field selections and dropdowns.
  let cardFieldSelections = {}; // { [cardKey]: Array<string> | 'all' }
  let displayCardSelection = ['main', 'related'];
  const res = store?.collections?.getActiveCollectionView ? store.collections.getActiveCollectionView({ windowSize: 0 }) : null;
  const collState = res?.collState || {};
  const appState = collState?.kanjiStudyCardView || {};
    // Load legacy or new per-card saved state.
    // Initialize cardFieldSelections with registry defaults (all non-action fields)
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    // Prefer dynamic toggle fields from the instantiated card API when available.
    let items = Array.isArray(c.toggleFields) ? c.toggleFields.slice() : [];
    const api = cardApis[c.key];
    const active = store?.collections?.getActiveCollection?.() || null;
    const metadata = active?.metadata;
    console.log('[View] requesting getToggleFields()', { card: c.key, metadataPresent: !!metadata });
    if (api && typeof api.getToggleFields === 'function') {
      const dyn = api.getToggleFields(metadata);
      console.log('[View] getToggleFields() result', { card: c.key, count: Array.isArray(dyn) ? dyn.length : 0 });
      if (Array.isArray(dyn) && dyn.length) items = dyn.slice();
    }
    const out = Array.isArray(items) ? items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    cardFieldSelections[c.key] = out.slice();
  }

    if (appState && appState.cardFields) {
      // If saved as an object mapping, copy entries
    if (typeof appState.cardFields === 'object' && !Array.isArray(appState.cardFields)) {
      for (const k of Object.keys(appState.cardFields || {})) {
        cardFieldSelections[k] = appState.cardFields[k];
      }
    } else if (Array.isArray(appState.cardFields)) {
        // legacy: array -> treat as main card selection
        cardFieldSelections['main'] = appState.cardFields.slice();
      } else if (typeof appState.cardFields === 'string' && appState.cardFields === 'all') {
        for (const k of Object.keys(cardFieldSelections)) cardFieldSelections[k] = 'all';
      }
    }
    // support legacy relatedFields/fullFields keys
    if (Array.isArray(appState.relatedFields)) cardFieldSelections['related'] = appState.relatedFields.slice();
    else if (typeof appState.relatedFields === 'string' && appState.relatedFields === 'all') cardFieldSelections['related'] = 'all';
    if (Array.isArray(appState.fullFields)) cardFieldSelections['full'] = appState.fullFields.slice();
    else if (typeof appState.fullFields === 'string' && appState.fullFields === 'all') cardFieldSelections['full'] = 'all';
    if (Array.isArray(appState.displayCards)) displayCardSelection = appState.displayCards.slice();
    else if (typeof appState.displayCards === 'string' && appState.displayCards === 'all') displayCardSelection = 'all';

  // Create per-card toggle dropdowns based on CARD_REGISTRY entries.
  const cardFieldControls = {};
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    let items = Array.isArray(c.toggleFields) ? c.toggleFields.slice() : [];
    const api = cardApis[c.key];
    const active = store?.collections?.getActiveCollection?.() || null;
    const metadata = active?.metadata;
    console.log('[View] requesting getToggleFields()', { card: c.key, metadataPresent: !!metadata });
    if (api && typeof api.getToggleFields === 'function') {
      const dyn = api.getToggleFields(metadata);
      console.log('[View] getToggleFields() result', { card: c.key, count: Array.isArray(dyn) ? dyn.length : 0 });
      if (Array.isArray(dyn) && dyn.length) items = dyn.slice();
    }
        const key = `${c.key}Fields`;
        const values = (function() {
          const sel = cardFieldSelections[c.key];
          if (sel === 'all') return items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
          if (Array.isArray(sel)) return sel.slice();
          // default: all non-action values
          return items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
        })();

        const rec = headerTools.addElement({
          type: 'dropdown', key, items, multi: true,
          values, commitOnClose: true,
          onChange: (vals) => {
            const chosen = (typeof vals === 'string' && vals === 'all')
              ? items.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''))
              : (Array.isArray(vals) ? vals.slice() : []);
            // apply to card API: prefer setFieldsVisible(map), fallback to individual setters
            const api = cardApis[c.key];
            const set = new Set(chosen);
            if (api && typeof api.setFieldsVisible === 'function') {
              const map = {};
              for (const it of items) if (String(it?.kind || '') !== 'action') map[String(it.value || '')] = set.has(String(it.value || ''));
              api.setFieldsVisible(map);
            } else {
              for (const it of items) {
                const v = String(it?.value || '');
                const cap = v.charAt(0).toUpperCase() + v.slice(1);
                const fnName = `set${cap}Visible`;
                if (api && typeof api[fnName] === 'function') api[fnName](set.has(v));
                else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(v, set.has(v));
              }
            }
            cardFieldSelections[c.key] = chosen;
            saveUIState();
          },
          className: 'data-expansion-dropdown',
          caption: `${c.label}.visibility`
        });
    cardFieldControls[c.key] = rec && rec.control ? rec.control : null;
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
  // Unified speak helper: prefer reading/word/kana, fall back to kanji/character/text
  function speakEntry(entry) {
    if (!entry) return;
    const primary = getFieldValue(entry, ['reading', 'kana', 'word', 'text']);
    const fallback = getFieldValue(entry, ['kanji', 'character', 'text']);
    const speakText = primary || fallback || '';
    if (!speakText) return;
    const fieldKey = primary ? 'reading' : 'kanji';
    const lang = getLanguageCode(fieldKey);
    speak(speakText, lang);
  }
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
    onChange: (vals) => {
      const chosen = (typeof vals === 'string' && vals === 'all')
        ? displayCardItems.map(it => String(it?.value || ''))
        : (Array.isArray(vals) ? vals.slice() : []);
      const set = new Set(chosen);
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
        const api = cardApis[c.key];
        if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
      }
      displayCardSelection = chosen;
      saveUIState();
    },
    className: 'data-expansion-dropdown',
    caption: 'visible.cards'
  });


  // expose the same variable names used elsewhere so render() logic needs minimal changes
  const card = mainCardApi.el; // root .card kanji-card
  const wrapper = card.querySelector('.kanji-card-wrapper');
  // collect registry-ordered elements for appending into the view root
  const registryCardEls = [];
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    const api = cardApis[c.key];
    if (api && api.el) registryCardEls.push(api.el);
  }

  // Apply initial visibility/mute defaults to cards to match dropdown defaults
  if (displayCardSelection === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));
  for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
    const items = Array.isArray(c.toggleFields) ? c.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const sel = cardFieldSelections[c.key];
    const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : items.slice());
    const api = cardApis[c.key];
    const set = new Set(values);
    if (api && typeof api.setFieldsVisible === 'function') {
      const map = {};
      for (const v of items) map[v] = set.has(v);
      api.setFieldsVisible(map);
    } else {
      for (const v of items) {
        const cap = String(v).charAt(0).toUpperCase() + String(v).slice(1);
        const fnName = `set${cap}Visible`;
        if (api && typeof api[fnName] === 'function') api[fnName](set.has(v));
        else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(v, set.has(v));
      }
    }
  }
  // ensure related card toggles are applied even if no registry items matched earlier
  const regRelated = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(c => c.key === 'related') : null);
  if (regRelated) {
    const api = cardApis['related'];
    const sel = cardFieldSelections['related'];
    const items = Array.isArray(regRelated.toggleFields) ? regRelated.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : items.slice());
    const set = new Set(values);
    if (api && typeof api.setEnglishVisible === 'function') api.setEnglishVisible(set.has('english'));
    if (api && typeof api.setJapaneseVisible === 'function') api.setJapaneseVisible(set.has('japanese'));
    if (api && typeof api.setNotesVisible === 'function') api.setNotesVisible(set.has('notes'));
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
    const collState = res?.collState || {};
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
      const savedIndex = (collState && collState.kanjiStudyCardView && typeof collState.kanjiStudyCardView.currentIndex === 'number')
        ? collState.kanjiStudyCardView.currentIndex
        : undefined;
      if (typeof savedIndex === 'number') {
        index = savedIndex;
      }
      const appState = collState.kanjiStudyCardView || {};
      // Apply saved per-card field selections (supports new object format and legacy values)
      if (appState.cardFields && typeof appState.cardFields === 'object' && !Array.isArray(appState.cardFields)) {
        for (const k of Object.keys(appState.cardFields || {})) {
          const sel = appState.cardFields[k];
          const reg = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(x => x.key === k) : null);
          const items = (reg && Array.isArray(reg.toggleFields)) ? reg.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
          const values = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : []);
          const api = cardApis[k];
          const set = new Set(values);
          if (api && typeof api.setFieldsVisible === 'function') {
            const map = {};
            for (const val of items) map[val] = set.has(val);
            api.setFieldsVisible(map);
          } else {
            for (const val of items) {
              const cap = String(val).charAt(0).toUpperCase() + String(val).slice(1);
              const fnName = `set${cap}Visible`;
              if (api && typeof api[fnName] === 'function') api[fnName](set.has(val));
              else if (api && typeof api.setFieldVisible === 'function') api.setFieldVisible(val, set.has(val));
            }
          }
          cardFieldSelections[k] = sel === 'all' ? 'all' : (Array.isArray(sel) ? sel.slice() : values.slice());
        }
      } else if (Array.isArray(appState.cardFields)) {
        // legacy: treat as main card selection
        cardFieldSelections['main'] = appState.cardFields.slice();
        if (mainCardApi && typeof mainCardApi.setFieldsVisible === 'function') {
          const regMain = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find(x => x.key === 'main') : null);
          const items = (regMain && Array.isArray(regMain.toggleFields)) ? regMain.toggleFields.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
          const map = {};
          for (const val of items) map[val] = Array.isArray(appState.cardFields) ? appState.cardFields.includes(val) : false;
          mainCardApi.setFieldsVisible(map);
        }
      } else if (typeof appState.cardFields === 'string' && appState.cardFields === 'all') {
        for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) cardFieldSelections[c.key] = 'all';
      }
      // legacy singular keys
      if (Array.isArray(appState.relatedFields)) cardFieldSelections['related'] = appState.relatedFields.slice();
      if (typeof appState.relatedFields === 'string' && appState.relatedFields === 'all') cardFieldSelections['related'] = 'all';
      if (Array.isArray(appState.fullFields)) cardFieldSelections['full'] = appState.fullFields.slice();
      if (typeof appState.fullFields === 'string' && appState.fullFields === 'all') cardFieldSelections['full'] = 'all';
      if (Array.isArray(appState.displayCards)) {
        displayCardSelection = appState.displayCards.slice();
        const set = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
        for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
          const api = cardApis[c.key];
          if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
        }
      }
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
    headerTools.addElement({ type: 'button', key: 'shuffle', label: 'Shuffle', caption: 'col.shuffle', onClick: shuffleEntries });
  } catch (e) {}
  // Ensure header order: shuffle, visible.cards (displayCards), then others
  try {
    const parent = headerTools;
    const shuffleCtrl = (typeof headerTools.getControl === 'function') ? headerTools.getControl('shuffle') : null;
    const displayCtrl = (typeof headerTools.getControl === 'function') ? headerTools.getControl('displayCards') : null;
    const shuffleGroup = shuffleCtrl && shuffleCtrl.parentNode ? shuffleCtrl.parentNode : null;
    const displayGroup = displayCtrl && displayCtrl.parentNode ? displayCtrl.parentNode : null;
    if (parent && shuffleGroup) parent.insertBefore(shuffleGroup, parent.firstChild);
    if (parent && displayGroup) {
      const after = (shuffleGroup && parent.contains(shuffleGroup)) ? shuffleGroup.nextSibling : parent.firstChild;
      parent.insertBefore(displayGroup, after);
    }
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
