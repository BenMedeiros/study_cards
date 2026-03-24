import { nowMs } from '../../utils/browser/helpers.js';
import { speak, getLanguageCode } from '../../utils/browser/speech.js';

import { createViewHeaderTools } from '../../components/features/viewHeaderTools.js';
import { createViewFooterControls } from '../../components/features/viewFooterControls.js';
import { CARD_REGISTRY } from './cards/index.js';
import { addStudyFilter } from '../../components/features/studyControls.js';
import { addShuffleControls } from '../../components/features/collectionControls.js';
import kanjiStudyController from './kanjiStudyController.js';
import { createKanjiStudyFooterActionsController } from '../../controllers/actionsController.js';

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
  let defaultViewMode = 'kanji-only'; // controls what is shown when changing cards
  let shownAt = nowMs();
  let isShuffled = false;
  
  let uiStateRestored = false; // ensure saved UI (index/order) is applied only once
  let originalEntries = [];
  
  let orderHashInt = null; // deterministic seed for shuffle (preferred persisted form)
  let viewIndices = []; // indices into originalEntries for the current rendered entries array
  let relatedHydratedCollectionKey = null;
  let relatedHydrationPromise = null;
  let kanjiController = null;
  let kanjiUnsub = null;
  let entryFieldsControl = null;

  // Helpers
  function getFieldValue(entry, keys) {
    if (!entry) return '';
    for (const k of keys) {
      if (entry[k]) return entry[k];
    }
    return '';
  }

  function getPrimaryKanjiValue(entry) {
    if (!entry) return '';
    const studyKey = String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
    if (studyKey) return studyKey;
    return getFieldValue(entry, ['kanji', 'character', 'text', 'word', 'term', 'name', 'title', 'reading', 'kana']) || '';
  }

  // Persist small per-view patches to the controller (view delegates all state persistence)
  function persistViewState(patch) {
    const active = store?.collections?.getActiveCollection ? store.collections.getActiveCollection() : null;
    const key = active && active.key ? active.key : null;
    if (!key) return;
    (kanjiController || kanjiStudyController.create(key)).set(patch);
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
    if (kanjiController && kanjiController.collKey !== coll.key) {
      if (typeof kanjiUnsub === 'function') kanjiUnsub();
      try { kanjiController.dispose(); } catch (e) {}
      kanjiController = null;
      kanjiUnsub = null;
    }
    if (!kanjiController) {
      kanjiController = kanjiStudyController.create(coll.key);
      try {
        kanjiUnsub = kanjiController.subscribe((viewState, viewPatch) => {
          try {
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'currentIndex')) {
              const raw = viewState && typeof viewState.currentIndex === 'number' ? viewState.currentIndex : (typeof viewPatch.currentIndex === 'number' ? viewPatch.currentIndex : undefined);
              if (typeof raw === 'number') {
                const clamped = Math.min(Math.max(0, raw), Math.max(0, entries.length - 1));
                if (clamped !== index) {
                  index = clamped;
                  shownAt = nowMs();
                  render({ skipRefresh: true });
                }
              }
            }

            // entry field selection changed
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'entryFields')) {
              entryFieldSelection = (viewState && viewState.entryFields !== undefined) ? (viewState.entryFields === 'all' ? 'all' : (Array.isArray(viewState.entryFields) ? viewState.entryFields.slice() : viewState.entryFields)) : entryFieldSelection;
              try {
                if (entryFieldsControl && typeof entryFieldsControl.setValues === 'function') {
                  entryFieldsControl.setValues(
                    entryFieldSelection === 'all'
                      ? entryFieldItems.map(it => String(it.value || ''))
                      : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : [])
                  );
                }
              } catch (e) {}
              const resolvedMap = (viewPatch && viewPatch.resolved && viewPatch.resolved.entryFieldMap) ? viewPatch.resolved.entryFieldMap : (viewState && viewState.resolved && viewState.resolved.entryFieldMap) ? viewState.resolved.entryFieldMap : null;
              if (resolvedMap) applyEntryFieldVisibility(resolvedMap);
              else {
                const entrySelectedLocal = (entryFieldSelection === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []);
                const setLocal = new Set(entrySelectedLocal);
                const map = {};
                for (const it of entryFieldItems) map[String(it.value || '')] = setLocal.has(String(it.value || ''));
                applyEntryFieldVisibility(map);
              }
            }

            // display card selection changed
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'displayCards')) {
              const ds = viewState && viewState.displayCards !== undefined ? viewState.displayCards : viewPatch.displayCards;
              displayCardSelection = (ds === 'all') ? displayCardItems.map(it => String(it?.value || '')) : (Array.isArray(ds) ? ds.slice() : displayCardSelection);
              const resolvedDisplay = (viewPatch && viewPatch.resolved && Array.isArray(viewPatch.resolved.displayCards)) ? viewPatch.resolved.displayCards : ((viewState && viewState.resolved && Array.isArray(viewState.resolved.displayCards)) ? viewState.resolved.displayCards : null);
              try {
                const set = new Set(Array.isArray(resolvedDisplay) ? resolvedDisplay.map(String) : (Array.isArray(displayCardSelection) ? displayCardSelection.map(String) : []));
                for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
                  const api = cardApis[c.key];
                  if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
                }
                try {
                  if (Array.isArray(resolvedDisplay)) {
                    for (const rn of Object.keys(relatedDropdownControls || {})) {
                      const rc = relatedDropdownControls[rn];
                      if (rc && rc.parentNode) rc.parentNode.style.display = set.has('related') ? '' : 'none';
                    }
                  }
                } catch (e) {}
              } catch (e) {}
            }

            // related fields changed
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'relatedFields')) {
              const raw = viewState && viewState.relatedFields !== undefined ? viewState.relatedFields : viewPatch.relatedFields;
              if (raw && typeof raw === 'object') {
                for (const k of Object.keys(raw)) relatedFieldSelections[k] = Array.isArray(raw[k]) ? raw[k].slice() : raw[k];
              }
              const resolvedRelated = (viewPatch && viewPatch.resolved && viewPatch.resolved.relatedFieldMaps) ? viewPatch.resolved.relatedFieldMaps : ((viewState && viewState.resolved && viewState.resolved.relatedFieldMaps) ? viewState.resolved.relatedFieldMaps : null);
              if (resolvedRelated) {
                const api = cardApis['related'];
                for (const rn of Object.keys(resolvedRelated || {})) {
                  try { if (api && typeof api.setFieldsVisible === 'function') api.setFieldsVisible(resolvedRelated[rn]); } catch (e) {}
                }
              } else {
                // fallback: apply per-dropdown selection
                const api = cardApis['related'];
                for (const rel of relatedDefs) {
                  const name = String(rel?.name || '').trim();
                  if (!name) continue;
                  const items = Array.isArray(rel.fields) ? rel.fields.map(f => ({ value: String(f.key || f), left: f.label || String(f.key || f) })) : RELATED_DEFAULT_ITEMS.slice();
                  const sel = relatedFieldSelections[name] || 'all';
                  const chosen = (sel === 'all') ? items.map(it => String(it.value || '')) : (Array.isArray(sel) ? sel.slice() : []);
                  if (api && typeof api.setFieldsVisible === 'function') {
                    const set = new Set(chosen);
                    const map = {};
                    for (const it of items) map[String(it.value || '')] = set.has(String(it.value || ''));
                    try { api.setFieldsVisible(map); } catch (e) {}
                  }
                }
              }
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
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

  // derive entry field items from collection schema keys (authoritative)
  const activeColl = store?.collections?.getActiveCollection?.() || null;
  const metadata = activeColl?.metadata || {};
  function buildEntryFieldItemsFromSchema(meta, sampleEntry) {
    const candidates = Array.isArray(meta?.schema) ? meta.schema : (Array.isArray(meta?.fields) ? meta.fields : []);
    const out = [];
    const seen = new Set();
    const addField = (rawKey, rawLabel) => {
      const key = String(rawKey || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ value: key, left: String(rawLabel || key) });
    };

    for (const raw of candidates) {
      const key = (raw && typeof raw === 'object') ? (raw.key || '') : (raw || '');
      const label = (raw && typeof raw === 'object' && raw.label != null) ? raw.label : key;
      addField(key, label);
    }

    if (!out.length && sampleEntry && typeof sampleEntry === 'object') {
      for (const key of Object.keys(sampleEntry)) addField(key, key);
    }

    if (!out.length) {
      for (const key of ['kanji', 'reading', 'meaning', 'type']) addField(key, key);
    }

    return out;
  }
  const sampleEntry = (Array.isArray(res?.view?.entries) && res.view.entries.length)
    ? res.view.entries[0]
    : ((Array.isArray(coll?.entries) && coll.entries.length) ? coll.entries[0] : null);
  const entryFieldItems = buildEntryFieldItemsFromSchema(metadata, sampleEntry);

  // create entry-level dropdown
  const entryFieldsRec = headerTools.addElement({
    type: 'dropdown', key: 'entryFields', items: entryFieldItems, multi: true,
    values: (entryFieldSelection === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []),
    commitOnClose: true,
    includeAllNone: true,
    onChange: (vals) => {
      // Persist selection and let controller compute + publish resolved visibility maps.
      entryFieldSelection = (typeof vals === 'string' && vals === 'all') ? 'all' : (Array.isArray(vals) ? vals.slice() : []);
      persistViewState({ entryFields: (entryFieldSelection === 'all') ? 'all' : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []) });
    },
    className: 'data-expansion-dropdown',
    caption: 'entry.fields.visibility'
  });
  entryFieldsControl = entryFieldsRec && entryFieldsRec.control ? entryFieldsRec.control : null;

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
        // Persist selection and let controller compute + publish resolved related maps.
        const chosen = (typeof vals === 'string' && vals === 'all') ? items.map(it => String(it?.value || '')) : (Array.isArray(vals) ? vals.slice() : []);
        relatedFieldSelections[name] = (typeof vals === 'string' && vals === 'all') ? 'all' : chosen;
        const relatedOut = {};
        for (const k of Object.keys(relatedFieldSelections || {})) relatedOut[k] = Array.isArray(relatedFieldSelections[k]) ? relatedFieldSelections[k].slice() : relatedFieldSelections[k];
        persistViewState({ relatedFields: relatedOut });
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

  function goToIndex(newIndex) {
    const total = Array.isArray(entries) ? entries.length : 0;
    if (!total) return;
    const raw = Math.round(Number(newIndex));
    if (!Number.isFinite(raw)) return;
    const nextIndex = ((raw % total) + total) % total;
    try { progressTracker?.flush?.(); } catch (e) {}
    index = nextIndex;
    shownAt = nowMs();
    if (kanjiController && typeof kanjiController.setCurrentIndex === 'function') {
      kanjiController.setCurrentIndex(index);
    }
    render({ skipRefresh: true });
  }

  function showPrev() { goToIndex(index - 1); }
  function showNext() { goToIndex(index + 1); }

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

  function getSearchTerm() {
    const entry = entries && entries.length ? entries[index] : null;
    if (!entry) return '';
    const primary = (getPrimaryKanjiValue(entry) || '').trim();
    if (primary) return primary;
    return (getFieldValue(entry, ['meaning', 'definition', 'gloss', 'description']) || '').trim();
  }

  function getCurrentEntryKey() {
    const entry = entries && entries.length ? entries[index] : null;
    return String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
  }

  function getEntryFieldsSelection() {
    // Use local state first so sequential zero-delay footer actions compose
    // against the latest in-turn selection instead of async controller lag.
    if (entryFieldSelection === 'all') return 'all';
    if (Array.isArray(entryFieldSelection)) return entryFieldSelection.slice();
    try {
      const st = (kanjiController && typeof kanjiController.get === 'function') ? (kanjiController.get() || {}) : {};
      if (st && Object.prototype.hasOwnProperty.call(st, 'entryFields')) {
        const next = st.entryFields;
        return next === 'all' ? 'all' : (Array.isArray(next) ? next.slice() : next);
      }
    } catch (e) {}
    return entryFieldSelection;
  }

  function getAvailableEntryFields() {
    try {
      const vals = Array.isArray(entryFieldItems)
        ? entryFieldItems.map(it => String(it?.value || '')).filter(Boolean)
        : [];
      if (vals.length) return vals;
    } catch (e) {}
    try {
      const entry = entries && entries.length ? entries[index] : null;
      const dynamic = (entry && typeof entry === 'object')
        ? Object.keys(entry).map(k => String(k || '').trim()).filter(Boolean)
        : [];
      if (dynamic.length) return dynamic;
    } catch (e) {}
    return ['kanji', 'reading', 'meaning', 'type'];
  }

  function setEntryFieldsSelection(nextSelection) {
    // Update local selection immediately so multiple actions in one custom
    // button run can build on each other even before async controller writes resolve.
    entryFieldSelection = (nextSelection === 'all')
      ? 'all'
      : (Array.isArray(nextSelection) ? nextSelection.slice() : []);
    if (kanjiController && typeof kanjiController.setEntryFields === 'function') {
      kanjiController.setEntryFields(entryFieldSelection);
      return;
    }
    persistViewState({ entryFields: entryFieldSelection });
  }

  const footerActions = createKanjiStudyFooterActionsController({
    showPrev,
    showNext,
    shuffle: shuffleEntries,
    speakField,
    getSearchTerm,
    getEntryFields: getEntryFieldsSelection,
    getAvailableEntryFields,
    setEntryFields: setEntryFieldsSelection,
    kanjiProgress: store?.kanjiProgress || null,
    getCurrentCollectionKey,
    getCurrentEntryKey,
    onProgressChanged: ({ actionName }) => {
      updateMarkButtons();
      const view = store?.collections?.getActiveCollectionView?.({ windowSize: 10 })?.view;
      const isLearnedToggle = actionName === 'toggleKanjiLearned';
      const isPracticeToggle = actionName === 'toggleKanjiFocus';
      if (!isLearnedToggle && !isPracticeToggle) return;

      const needsRefresh = (isLearnedToggle && !!view?.skipLearned) || (isPracticeToggle && !!view?.focusOnly);
      if (!needsRefresh) return;

      refreshEntriesFromStore();
      const newIndex = Math.min(Math.max(0, index), Math.max(0, entries.length - 1));
      if (kanjiController && typeof kanjiController.setCurrentIndex === 'function') {
        kanjiController.setCurrentIndex(newIndex);
      }
    },
  });

  footerControls = createViewFooterControls(footerActions.baseControls, {
    appId: footerActions.appId,
    actionDefinitions: footerActions.actionDefinitions,
    defaultPrefs: footerActions.defaultPrefs,
    customOnly: true,
    getCollectionKey: getCurrentCollectionKey,
  });

  // Load default view mode from settings
  if (store?.settings && typeof store.settings.get === 'function') {
    const dvm = store.settings.get('apps.kanjiStudy.defaultViewMode', { consumerId: 'kanjiStudyCardView' });
    if (typeof dvm === 'string') defaultViewMode = dvm;
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
      // Persist selection and let controller compute + publish resolved display list.
      displayCardSelection = (typeof vals === 'string' && vals === 'all') ? displayCardItems.map(it => String(it?.value || '')) : (Array.isArray(vals) ? vals.slice() : []);
      persistViewState({ displayCards: (Array.isArray(vals) && vals.length === 0) ? [] : ((typeof vals === 'string' && vals === 'all') ? 'all' : (Array.isArray(vals) ? vals.slice() : [])) });
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

  // Resolved visibility and display are applied from controller `resolved` state on init/subscription.

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
    const view = res?.view || {};

    originalEntries = (active && Array.isArray(active.entries)) ? [...active.entries] : [];
    entries = Array.isArray(view?.entries) ? view.entries : [];
    viewIndices = Array.isArray(view?.indices) ? view.indices : [];
    isShuffled = !!view?.isShuffled;
    orderHashInt = (typeof view?.order_hash_int === 'number') ? view.order_hash_int : null;

    // Initialize app-scoped UI from the controller once on initial load.
    if (!uiStateRestored) {
      try {
        const appState = (kanjiController && typeof kanjiController.get === 'function') ? (kanjiController.get() || {}) : {};
        if (typeof appState.currentIndex === 'number') index = appState.currentIndex;
        if (appState.entryFields !== undefined) entryFieldSelection = appState.entryFields === 'all' ? 'all' : (Array.isArray(appState.entryFields) ? appState.entryFields.slice() : appState.entryFields);
        if (appState.relatedFields && typeof appState.relatedFields === 'object') {
          for (const k of Object.keys(appState.relatedFields)) relatedFieldSelections[k] = Array.isArray(appState.relatedFields[k]) ? appState.relatedFields[k].slice() : appState.relatedFields[k];
        }
        if (Array.isArray(appState.displayCards)) displayCardSelection = appState.displayCards.slice();
        else if (appState.displayCards === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));

        // apply resolved maps if controller provided them
        try {
          if (appState && appState.resolved) {
            if (appState.resolved.entryFieldMap) applyEntryFieldVisibility(appState.resolved.entryFieldMap);
            if (Array.isArray(appState.resolved.displayCards)) {
              const set = new Set(appState.resolved.displayCards.map(String));
              for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
                const api = cardApis[c.key];
                if (api && api.el) api.el.style.display = set.has(c.key) ? '' : 'none';
              }
              try {
                for (const rn of Object.keys(relatedDropdownControls || {})) {
                  const rc = relatedDropdownControls[rn];
                  if (rc && rc.parentNode) rc.parentNode.style.display = set.has('related') ? '' : 'none';
                }
              } catch (e) {}
            }
            if (appState.resolved.relatedFieldMaps) {
              const api = cardApis['related'];
              for (const rn of Object.keys(appState.resolved.relatedFieldMaps || {})) {
                try { if (api && typeof api.setFieldsVisible === 'function') api.setFieldsVisible(appState.resolved.relatedFieldMaps[rn]); } catch (e) {}
              }
            }
          } else {
            // fallback: apply selections directly
            const entrySelected = (entryFieldSelection === 'all') ? entryFieldItems.map(it => String(it.value || '')) : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []);
            const entrySet = new Set(entrySelected);
            const entryMap = {};
            for (const it of entryFieldItems) entryMap[String(it.value || '')] = entrySet.has(String(it.value || ''));
            applyEntryFieldVisibility(entryMap);
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
          }
        } catch (e) {}
      } catch (e) {}
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
          .finally(() => { relatedHydrationPromise = null; });
      }
    } catch (e) {}
  }
  // reveal/toggle removed; view mode is controlled via controller state
  

  function updateMarkButtons() {
    const learnedBtn = getFooterButton('learned');
    const practiceBtn = getFooterButton('practice');
    if (!learnedBtn || !practiceBtn) return;
    const { isLearned, isFocus } = footerActions.getCurrentProgressFlags();

    learnedBtn.classList.toggle('state-learned', isLearned);
    practiceBtn.classList.toggle('state-focus', isFocus);

    learnedBtn.setAttribute('aria-pressed', String(!!isLearned));
    practiceBtn.setAttribute('aria-pressed', String(!!isFocus));
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
    if (kanjiController && typeof kanjiController.goToIndex === 'function') kanjiController.goToIndex(0);
    isShuffled = true;
    const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', 'true');
    render();
  }

  // PRNG and permutation now in collectionsManager



  function toggleDefaultViewMode() {
    defaultViewMode = defaultViewMode === 'kanji-only' ? 'full' : 'kanji-only';
    render();
    if (store?.settings && typeof store.settings.set === 'function') {
      store.settings.set('apps.kanjiStudy.defaultViewMode', defaultViewMode, { consumerId: 'kanjiStudyCardView' });
    }
  }

  function render({ skipRefresh = false } = {}) {
    if (!skipRefresh && !isShuffled) {
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
    if (defaultViewMode === 'kanji-only') wrapper.classList.add('kanji-only');
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

    const displaySet = new Set(Array.isArray(displayCardSelection) ? displayCardSelection : []);
    if (relatedCardApi && typeof relatedCardApi.setEntry === 'function') relatedCardApi.setEntry(entry);
    // Set entry on any other registered cards (e.g., generic) so they can render.
    for (const k of Object.keys(cardApis || {})) {
      if (k === 'main' || k === 'full' || k === 'related') continue;
      const api = cardApis[k];
      if (api && typeof api.setEntry === 'function') api.setEntry(entry);
    }
    // Toggle visibility for every registered card according to user selection.
    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      const api = cardApis[c.key];
      if (api && api.el) api.el.style.display = displaySet.has(c.key) ? '' : 'none';
    }
    
    // (reveal toggle removed)

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
          if (kanjiController && typeof kanjiController.goToIndex === 'function') kanjiController.goToIndex(0);
          isShuffled = false;
          // ensure UI updates; controller will persist index when appropriate
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

