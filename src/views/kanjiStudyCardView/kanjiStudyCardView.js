import { nowMs } from '../../utils/browser/helpers.js';
import { speak } from '../../utils/browser/speech.js';

import { createViewHeaderTools } from '../../components/features/viewHeaderTools.js';
import { createViewFooterControls } from './viewFooterControls.js';
import { getDefaultSpeechConfigForCollection } from './kanjiStudyController.js';
import { CARD_REGISTRY } from './cards/index.js';
import { addStudyFilter } from '../../components/features/studyControls.js';
import { addShuffleControls } from '../../components/features/collectionControls.js';
import kanjiStudyController from './kanjiStudyController.js';
import { openGenericFlatCardConfigDialog, openRelatedCardConfigDialog } from './cardConfigDialog.js';
import { createKanjiStudyFooterActionsController } from './actionsController.js';
import { createMainFieldCardCastSession } from '../../integrations/casting/mainFieldCardCastSession.js';
import { createGoogleCastSender } from '../../integrations/casting/googleCastSender.js';

const GENERIC_CARD_SETTINGS_KEY = 'genericFlatCard';
const MAIN_CARD_SETTINGS_KEY = 'main';
const RELATED_CARD_SETTINGS_KEY = 'related';
const MAIN_CARD_FLOW_VALUES = new Set(['row', 'column']);
const GENERIC_CARD_LABEL_WIDTH_VALUES = new Set(['6rem', '8rem', '10rem', '12rem', '14rem']);
const GENERIC_CARD_LABEL_SIZE_VALUES = new Set(['2xs', 'xs', 'sm', 'body']);
const GENERIC_CARD_LABEL_TONE_VALUES = new Set(['muted', 'default']);
const GENERIC_CARD_LABEL_VISIBILITY_VALUES = new Set(['show', 'hidden']);
const GENERIC_CARD_VALUE_SIZE_VALUES = new Set(['xs', 'sm', 'body', 'lg', 'xl']);
const GENERIC_CARD_ROW_PADDING_VALUES = new Set(['compact', 'default', 'relaxed']);
const GENERIC_CARD_ROW_DIVIDER_VALUES = new Set(['show', 'hide']);
const SCRUB_THRESHOLD_MIN_MS = 500;
const SCRUB_THRESHOLD_MAX_MS = 2000;
const SCRUB_THRESHOLD_STEP_MS = 100;
const SCRUB_THRESHOLD_DEFAULT_MS = 2000;
const DEFAULT_MAIN_CARD_LAYOUT = {
  topLeft: 'type',
  main: 'kanji',
  mainSecondary: '',
  bottomLeft: 'reading',
  bottomRight: 'meaning',
};
const COLLECTION_CARD_DEFAULTS = {
  'spanish/spanish_words.json': {
    genericFlatCard: {
      fields: ['term', 'meaning', 'type', 'semanticClass', 'gender', 'tags'],
    },
    main: {
      layout: {
        topLeft: 'type',
        main: 'term',
        bottomLeft: 'gender',
        bottomRight: 'meaning',
      },
    },
  },
  'spanish/spanish_sentences.json': {
    genericFlatCard: {
      fields: ['es', 'en', 'notes', 'chunks'],
    },
    main: {
      layout: {
        main: 'es',
        bottomRight: 'en',
      },
    },
  },
  'greek/greek_mythology.json': {
    main: {
      layout: {
        topLeft: 'englishName',
        main: 'greekName',
        bottomLeft: 'japaneseName',
        bottomRight: 'latinName',
      },
    },
  },
  'greek/greek_alphabet.json': {
    main: {
      layout: {
        topLeft: 'order',
        main: 'lowercase',
        mainSecondary: 'uppercase',
        bottomRight: 'classical_greek_name',
      },
      mainFlow: 'row',
    },
  },
};
const DEFAULT_GENERIC_CARD_STYLE = {
  labelWidth: '10rem',
  labelSize: 'xs',
  labelTone: 'muted',
  labelVisibility: 'show',
  valueSize: 'body',
  rowPadding: 'default',
  rowDivider: 'show',
};

function normalizeCardFieldList(fields) {
  if (!Array.isArray(fields)) return null;
  return Array.from(new Set(fields.map((field) => String(field || '').trim()).filter(Boolean)));
}

function normalizeGenericCardStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
  const next = {};
  const labelWidth = String(style.labelWidth || '').trim();
  const labelSize = String(style.labelSize || '').trim();
  const labelTone = String(style.labelTone || '').trim();
  const labelVisibility = String(style.labelVisibility || '').trim();
  const valueSize = String(style.valueSize || '').trim();
  const rowPadding = String(style.rowPadding || '').trim();
  const rowDivider = String(style.rowDivider || '').trim();
  if (GENERIC_CARD_LABEL_WIDTH_VALUES.has(labelWidth)) next.labelWidth = labelWidth;
  if (GENERIC_CARD_LABEL_SIZE_VALUES.has(labelSize)) next.labelSize = labelSize;
  if (GENERIC_CARD_LABEL_TONE_VALUES.has(labelTone)) next.labelTone = labelTone;
  if (GENERIC_CARD_LABEL_VISIBILITY_VALUES.has(labelVisibility)) next.labelVisibility = labelVisibility;
  if (GENERIC_CARD_VALUE_SIZE_VALUES.has(valueSize)) next.valueSize = valueSize;
  if (GENERIC_CARD_ROW_PADDING_VALUES.has(rowPadding)) next.rowPadding = rowPadding;
  if (GENERIC_CARD_ROW_DIVIDER_VALUES.has(rowDivider)) next.rowDivider = rowDivider;
  return next;
}

function normalizeGenericCardCustomStyles(customStyles) {
  if (!customStyles || typeof customStyles !== 'object' || Array.isArray(customStyles)) return {};
  const out = {};
  for (const [styleId, rawStyle] of Object.entries(customStyles)) {
    const id = String(styleId || '').trim();
    if (!id || !rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) continue;
    const style = normalizeGenericCardStyle(rawStyle);
    out[id] = {
      name: String(rawStyle.name || '').trim() || id,
      ...style,
    };
  }
  return out;
}

function normalizeGenericCardFieldStyles(fieldStyles, allowedFields = null, customStyles = null) {
  if (!fieldStyles || typeof fieldStyles !== 'object' || Array.isArray(fieldStyles)) return {};
  const allowedFieldSet = allowedFields instanceof Set ? allowedFields : null;
  const allowedStyleSet = customStyles && typeof customStyles === 'object'
    ? new Set(Object.keys(customStyles).map((item) => String(item || '').trim()).filter(Boolean))
    : null;
  const out = {};
  for (const [fieldKey, styleId] of Object.entries(fieldStyles)) {
    const field = String(fieldKey || '').trim();
    const style = String(styleId || '').trim();
    if (!field || !style) continue;
    if (allowedFieldSet && !allowedFieldSet.has(field)) continue;
    if (allowedStyleSet && !allowedStyleSet.has(style)) continue;
    out[field] = style;
  }
  return out;
}

function normalizeKanjiStudyCardsConfig(cards) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return {};
  const out = {};
  for (const [cardKey, rawConfig] of Object.entries(cards)) {
    const key = String(cardKey || '').trim();
    if (!key || !rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
    const nextConfig = {};
    const fields = normalizeCardFieldList(rawConfig.fields);
    if (fields) nextConfig.fields = fields;
    if (rawConfig.style && typeof rawConfig.style === 'object' && !Array.isArray(rawConfig.style)) {
      const style = normalizeGenericCardStyle(rawConfig.style);
      if (Object.keys(style).length) nextConfig.style = style;
    }
    if (rawConfig.customStyles && typeof rawConfig.customStyles === 'object' && !Array.isArray(rawConfig.customStyles)) {
      const customStyles = normalizeGenericCardCustomStyles(rawConfig.customStyles);
      if (Object.keys(customStyles).length) nextConfig.customStyles = customStyles;
    }
    if (rawConfig.fieldStyles && typeof rawConfig.fieldStyles === 'object' && !Array.isArray(rawConfig.fieldStyles)) {
      const fieldStyles = normalizeGenericCardFieldStyles(rawConfig.fieldStyles, null, rawConfig.customStyles);
      if (Object.keys(fieldStyles).length) nextConfig.fieldStyles = fieldStyles;
    }
    if (Array.isArray(rawConfig.controls)) {
      nextConfig.controls = Array.from(new Set(rawConfig.controls.map((item) => String(item || '').trim()).filter(Boolean)));
    }
    if (rawConfig.layout && typeof rawConfig.layout === 'object' && !Array.isArray(rawConfig.layout)) {
      nextConfig.layout = {};
      for (const [slotKey, fieldKey] of Object.entries(rawConfig.layout)) {
        const slot = String(slotKey || '').trim();
        const field = String(fieldKey || '').trim();
        if (!slot) continue;
        nextConfig.layout[slot] = field;
      }
    }
    if (Array.isArray(rawConfig.collections)) {
      nextConfig.collections = Array.from(new Set(rawConfig.collections.map((item) => String(item || '').trim()).filter(Boolean)));
    }
    if (rawConfig.relatedCollections && typeof rawConfig.relatedCollections === 'object' && !Array.isArray(rawConfig.relatedCollections)) {
      nextConfig.relatedCollections = {};
      for (const [relationName, relationConfig] of Object.entries(rawConfig.relatedCollections)) {
        const name = String(relationName || '').trim();
        if (!name || !relationConfig || typeof relationConfig !== 'object' || Array.isArray(relationConfig)) continue;
        nextConfig.relatedCollections[name] = {};
        if (Array.isArray(relationConfig.fields)) {
          nextConfig.relatedCollections[name].fields = Array.from(new Set(relationConfig.fields.map((item) => String(item || '').trim()).filter(Boolean)));
        }
        const detailsMode = String(relationConfig.detailsMode || '').trim().toLowerCase();
        if (detailsMode === 'click' || detailsMode === 'always') nextConfig.relatedCollections[name].detailsMode = detailsMode;
        if (Object.prototype.hasOwnProperty.call(relationConfig, 'collapsePrimaryWhenExpanded')) {
          nextConfig.relatedCollections[name].collapsePrimaryWhenExpanded = !!relationConfig.collapsePrimaryWhenExpanded;
        }
      }
    }
    const mainFlow = String(rawConfig.mainFlow || '').trim().toLowerCase();
    if (MAIN_CARD_FLOW_VALUES.has(mainFlow)) nextConfig.mainFlow = mainFlow;
    out[key] = nextConfig;
  }
  return out;
}

function normalizeLayoutConfig(layout, allowedFields) {
  const allowed = allowedFields instanceof Set ? allowedFields : new Set();
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {};
  const out = {};
  for (const [slotKey, fieldKey] of Object.entries(layout)) {
    const slot = String(slotKey || '').trim();
    const field = String(fieldKey || '').trim();
    if (!slot || (field && !allowed.has(field))) continue;
    out[slot] = field;
  }
  return out;
}

function getCollectionScopedCardDefaults(collectionKey) {
  const key = String(collectionKey || '').trim();
  return COLLECTION_CARD_DEFAULTS[key] || {};
}

function getDefaultGenericCardFields(collectionKey, availableFields) {
  const allowed = new Set((Array.isArray(availableFields) ? availableFields : []).map((item) => String(item?.key || '').trim()).filter(Boolean));
  const collectionDefaults = getCollectionScopedCardDefaults(collectionKey);
  const configured = Array.isArray(collectionDefaults?.[GENERIC_CARD_SETTINGS_KEY]?.fields)
    ? collectionDefaults[GENERIC_CARD_SETTINGS_KEY].fields
    : null;
  if (configured) {
    return configured.map((field) => String(field || '').trim()).filter((field) => allowed.has(field));
  }
  return Array.from(allowed);
}

function getDefaultMainCardLayout(collectionKey, availableFields) {
  const allowed = new Set((Array.isArray(availableFields) ? availableFields : []).map((item) => String(item?.key || '').trim()).filter(Boolean));
  const collectionDefaults = getCollectionScopedCardDefaults(collectionKey);
  const configured = normalizeLayoutConfig(collectionDefaults?.[MAIN_CARD_SETTINGS_KEY]?.layout, allowed);
  if (Object.keys(configured).length) return configured;
  return {
    topLeft: allowed.has('type') ? 'type' : '',
    main: allowed.has('kanji') ? 'kanji' : (allowed.has('term') ? 'term' : (allowed.has('lemma') ? 'lemma' : (allowed.has('es') ? 'es' : ''))),
    mainSecondary: '',
    bottomLeft: allowed.has('reading') ? 'reading' : (allowed.has('gender') ? 'gender' : ''),
    bottomRight: allowed.has('meaning') ? 'meaning' : (allowed.has('en') ? 'en' : ''),
  };
}

function getDefaultMainCardFlow(collectionKey) {
  const collectionDefaults = getCollectionScopedCardDefaults(collectionKey);
  const mainFlow = String(collectionDefaults?.[MAIN_CARD_SETTINGS_KEY]?.mainFlow || '').trim().toLowerCase();
  return MAIN_CARD_FLOW_VALUES.has(mainFlow) ? mainFlow : 'row';
}

function inferRelatedFieldItems(collection = null, relationName = '') {
  const name = String(relationName || '').trim();
  if (!name) return [];
  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  const keys = new Set();
  for (const entry of entries) {
    const records = Array.isArray(entry?.relatedCollections?.[name]) ? entry.relatedCollections[name] : [];
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      for (const key of Object.keys(record)) {
        const fieldKey = String(key || '').trim();
        if (!fieldKey || fieldKey === 'relatedCollections') continue;
        keys.add(fieldKey);
      }
    }
  }
  return Array.from(keys).map((fieldKey) => ({ value: fieldKey, left: fieldKey }));
}

function getDefaultRelatedCardFieldItems() {
  return [
    { key: 'title', label: 'Title' },
    { key: 'japanese', label: 'Japanese' },
    { key: 'english', label: 'English' },
    { key: 'notes', label: 'Notes' },
    { key: 'sentences', label: 'Sentences' },
    { key: 'chunks', label: 'Chunks' },
  ];
}

function normalizeScrubThresholdMs(value) {
  const n = Math.round(Number(value) || 0);
  if (!Number.isFinite(n)) return SCRUB_THRESHOLD_DEFAULT_MS;
  const clamped = Math.min(SCRUB_THRESHOLD_MAX_MS, Math.max(SCRUB_THRESHOLD_MIN_MS, n));
  const snapped = Math.round(clamped / SCRUB_THRESHOLD_STEP_MS) * SCRUB_THRESHOLD_STEP_MS;
  return Math.min(SCRUB_THRESHOLD_MAX_MS, Math.max(SCRUB_THRESHOLD_MIN_MS, snapped));
}

function createScrubThresholdItems() {
  const out = [];
  for (let ms = SCRUB_THRESHOLD_MIN_MS; ms <= SCRUB_THRESHOLD_MAX_MS; ms += SCRUB_THRESHOLD_STEP_MS) {
    const seconds = (ms / 1000).toFixed(1);
    out.push({
      value: String(ms),
      left: `${seconds}s`,
      label: `${seconds}s`,
    });
  }
  return out;
}

export function renderKanjiStudyCard({ store }) {
  const el = document.createElement('div');
  el.id = 'kanji-study-root';
  el.className = 'kanji-study-card-view';

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

  function getSpeechSettings() {
    try {
      const collectionKey = getCurrentCollectionKey();
      return (kanjiController && typeof kanjiController.getSpeech === 'function')
        ? (kanjiController.getSpeech() || {})
        : ((kanjiController?.get?.() || {}).speech || getDefaultSpeechConfigForCollection(collectionKey));
    } catch (e) {
      try { return getDefaultSpeechConfigForCollection(getCurrentCollectionKey()); } catch (e2) {}
      return {};
    }
  }

  function setSpeechSettings(nextSpeech) {
    if (!kanjiController) return;
    if (typeof kanjiController.setSpeech === 'function') {
      kanjiController.setSpeech(nextSpeech || {}).catch(() => {});
      return;
    }
    persistViewState({ speech: nextSpeech || {} });
  }

  function speakText(text, { fieldKey = '', lang = '' } = {}) {
    const value = String(text || '').trim();
    if (!value) return;
    const options = {};
    const normalizedFieldKey = String(fieldKey || '').trim();
    const normalizedLang = String(lang || '').trim();
    if (normalizedFieldKey) options.fieldKey = normalizedFieldKey;
    if (normalizedLang) options.lang = normalizedLang;
    const collectionKey = String(getCurrentCollectionKey() || '').trim();
    if (collectionKey) options.collectionKey = collectionKey;
    speak(value, options);
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
  let scrubThresholdControl = null;
  let scrubHoldDelayMs = SCRUB_THRESHOLD_DEFAULT_MS;
  let pendingLocalControllerIndex = null;
  const scrubState = {
    active: false,
    pendingIndex: 0,
    key: '',
  };
  const scrubHoldState = {
    key: '',
    startedAtMs: 0,
  };
  const arrowPressState = {
    key: '',
    handledInitialPress: false,
  };

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
  const cardApis = {};
  const mainFieldCastSession = createMainFieldCardCastSession();
  const googleCastSender = createGoogleCastSender({
    getReceiverAppId: () => {
      try {
        return store?.settings?.get?.('apps.kanjiStudy.castReceiverAppId', { consumerId: 'kanjiStudyCardView' }) || '';
      } catch (e) {
        return '';
      }
    },
    setReceiverAppId: (nextValue) => {
      try {
        store?.settings?.set?.('apps.kanjiStudy.castReceiverAppId', String(nextValue || '').trim(), { consumerId: 'kanjiStudyCardView' });
      } catch (e) {}
    },
  });

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
                if (pendingLocalControllerIndex != null && clamped === pendingLocalControllerIndex) {
                  pendingLocalControllerIndex = null;
                  return;
                }
                pendingLocalControllerIndex = null;
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

            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'scrubHoldDelayMs')) {
              const rawDelay = (viewState && viewState.scrubHoldDelayMs !== undefined)
                ? viewState.scrubHoldDelayMs
                : viewPatch.scrubHoldDelayMs;
              scrubHoldDelayMs = normalizeScrubThresholdMs(rawDelay);
              try {
                if (scrubThresholdControl && typeof scrubThresholdControl.setValue === 'function') {
                  scrubThresholdControl.setValue(String(scrubHoldDelayMs));
                }
              } catch (e) {}
            }

            // display card selection changed
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'displayCards')) {
              const ds = viewState && viewState.displayCards !== undefined ? viewState.displayCards : viewPatch.displayCards;
              displayCardSelection = (ds === 'all') ? displayCardItems.map(it => String(it?.value || '')) : (Array.isArray(ds) ? ds.slice() : displayCardSelection);
              const resolvedDisplay = (viewPatch && viewPatch.resolved && Array.isArray(viewPatch.resolved.displayCards)) ? viewPatch.resolved.displayCards : ((viewState && viewState.resolved && Array.isArray(viewState.resolved.displayCards)) ? viewState.resolved.displayCards : null);
              applyDisplayCardVisibility(resolvedDisplay, { renderNewlyVisible: true });
            }

            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'cards')) {
              cardsConfigState = normalizeKanjiStudyCardsConfig(
                (viewState && viewState.cards !== undefined) ? viewState.cards : viewPatch.cards
              );
              applyMainCardConfig();
              applyGenericCardConfig();
              applyJsonCardConfig();
              applyRelatedCardConfig();
            }

            // related fields changed
            if (viewPatch && Object.prototype.hasOwnProperty.call(viewPatch, 'relatedFields')) {
              const raw = viewState && viewState.relatedFields !== undefined ? viewState.relatedFields : viewPatch.relatedFields;
              if (raw && typeof raw === 'object') {
                for (const k of Object.keys(raw)) relatedFieldSelections[k] = Array.isArray(raw[k]) ? raw[k].slice() : raw[k];
              }
              const resolvedRelated = (viewPatch && viewPatch.resolved && viewPatch.resolved.relatedFieldMaps) ? viewPatch.resolved.relatedFieldMaps : ((viewState && viewState.resolved && viewState.resolved.relatedFieldMaps) ? viewState.resolved.relatedFieldMaps : null);
              if (resolvedRelated) {
                resolvedRelatedFieldMaps = { ...resolvedRelated };
                const api = getCardApi('related', { createIfMissing: false });
                for (const rn of Object.keys(resolvedRelated || {})) {
                  try {
                    if (api && typeof api.setCollectionFieldsVisible === 'function') api.setCollectionFieldsVisible(rn, resolvedRelated[rn]);
                    else if (api && typeof api.setFieldsVisible === 'function') api.setFieldsVisible(resolvedRelated[rn]);
                  } catch (e) {}
                }
              } else {
                resolvedRelatedFieldMaps = null;
                // fallback: apply per-dropdown selection
                const api = getCardApi('related', { createIfMissing: false });
                for (const rel of relatedDefs) {
                  const name = String(rel?.name || '').trim();
                  if (!name) continue;
                  const items = RELATED_DEFAULT_ITEMS.slice();
                  const sel = relatedFieldSelections[name] || 'all';
                  const chosen = (sel === 'all') ? items.map(it => String(it.value || '')) : (Array.isArray(sel) ? sel.slice() : []);
                  if (api && (typeof api.setCollectionFieldsVisible === 'function' || typeof api.setFieldsVisible === 'function')) {
                    const set = new Set(chosen);
                    const map = {};
                    for (const it of items) map[String(it.value || '')] = set.has(String(it.value || ''));
                    try {
                      if (typeof api.setCollectionFieldsVisible === 'function') api.setCollectionFieldsVisible(name, map);
                      else api.setFieldsVisible(map);
                    } catch (e) {}
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
  let cardsConfigState = normalizeKanjiStudyCardsConfig(appState?.cards);
  let activeDisplayCardKeys = new Set();
  let resolvedEntryFieldMap = null;
  let resolvedRelatedFieldMaps = null;

  // state for visibility selections
  let entryFieldSelection = Array.isArray(appState?.entryFields) ? appState.entryFields.slice() : 'all';
  const relatedFieldSelections = (appState && typeof appState.relatedFields === 'object') ? { ...appState.relatedFields } : {};

  // helper to apply an entry-level visibility map to all card APIs
  function applyEntryFieldVisibility(map) {
    resolvedEntryFieldMap = map && typeof map === 'object' ? { ...map } : null;
    for (const k of Object.keys(cardApis || {})) {
      const api = cardApis[k];
      if (!api) continue;
      if (typeof api.setFieldsVisible === 'function') api.setFieldsVisible(map);
      else if (typeof api.setFieldVisible === 'function') {
        for (const fk of Object.keys(map)) api.setFieldVisible(fk, !!map[fk]);
      }
    }
    syncMainFieldCastView();
  }

  function getEntryFieldVisibilityMap() {
    if (resolvedEntryFieldMap && typeof resolvedEntryFieldMap === 'object') return { ...resolvedEntryFieldMap };
    const selected = (entryFieldSelection === 'all')
      ? entryFieldItems.map((it) => String(it.value || ''))
      : (Array.isArray(entryFieldSelection) ? entryFieldSelection.slice() : []);
    const selectedSet = new Set(selected);
    const map = {};
    for (const it of entryFieldItems) map[String(it.value || '')] = selectedSet.has(String(it.value || ''));
    return map;
  }

  function getRelatedFieldVisibilityMaps() {
    if (resolvedRelatedFieldMaps && typeof resolvedRelatedFieldMaps === 'object') {
      const out = {};
      for (const k of Object.keys(resolvedRelatedFieldMaps)) out[k] = { ...resolvedRelatedFieldMaps[k] };
      return out;
    }
    const out = {};
    for (const rel of relatedDefs) {
      const name = String(rel?.name || '').trim();
      if (!name) continue;
      const items = RELATED_DEFAULT_ITEMS.slice();
      const sel = relatedFieldSelections[name] || 'all';
      const chosen = (sel === 'all') ? items.map((it) => String(it.value || '')) : (Array.isArray(sel) ? sel.slice() : []);
      const set = new Set(chosen);
      const map = {};
      for (const it of items) map[String(it.value || '')] = set.has(String(it.value || ''));
      out[name] = map;
    }
    return out;
  }

  function applyCurrentVisibilityToCard(cardKey, api) {
    if (!api) return;
    if (cardKey === 'related') {
      const relatedMaps = getRelatedFieldVisibilityMaps();
      for (const name of Object.keys(relatedMaps)) {
        try {
          if (typeof api.setCollectionFieldsVisible === 'function') api.setCollectionFieldsVisible(name, relatedMaps[name]);
          else if (typeof api.setFieldsVisible === 'function') api.setFieldsVisible(relatedMaps[name]);
        } catch (e) {}
      }
      return;
    }

    const entryMap = getEntryFieldVisibilityMap();
    if (typeof api.setFieldsVisible === 'function') api.setFieldsVisible(entryMap);
    else if (typeof api.setFieldVisible === 'function') {
      for (const fieldKey of Object.keys(entryMap)) api.setFieldVisible(fieldKey, !!entryMap[fieldKey]);
    }
  }

  // derive entry field items from collection schema keys (authoritative)
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

  function getCurrentEntryFieldItems() {
    const activeColl = store?.collections?.getActiveCollection?.() || null;
    const activeMetadata = activeColl?.metadata || {};
    const currentEntry = (Array.isArray(entries) && entries.length && entries[index]) ? entries[index] : null;
    const sampleEntry = currentEntry || ((Array.isArray(activeColl?.entries) && activeColl.entries.length) ? activeColl.entries[0] : null);
    return buildEntryFieldItemsFromSchema(activeMetadata, sampleEntry);
  }

  let entryFieldItems = getCurrentEntryFieldItems();

  function refreshEntryFieldItems() {
    entryFieldItems = getCurrentEntryFieldItems();
    return entryFieldItems;
  }

  function getGenericCardAvailableFields() {
    return refreshEntryFieldItems().map((item) => ({
      key: String(item?.value || '').trim(),
      label: String(item?.left || item?.value || '').trim() || String(item?.value || '').trim(),
    })).filter((item) => item.key && !item.key.startsWith('__'));
  }

  function getGenericCardConfig() {
    const collectionKey = getCurrentCollectionKey();
    const config = cardsConfigState[GENERIC_CARD_SETTINGS_KEY] || {};
    const availableFields = getGenericCardAvailableFields();
    const allowed = new Set(availableFields.map((item) => item.key));
    const style = {
      ...DEFAULT_GENERIC_CARD_STYLE,
      ...normalizeGenericCardStyle(config.style),
    };
    const fields = Array.isArray(config.fields)
      ? config.fields.map((field) => String(field || '').trim()).filter((field) => allowed.has(field))
      : undefined;
    const customStyles = normalizeGenericCardCustomStyles(config.customStyles);
    const fieldStyles = normalizeGenericCardFieldStyles(config.fieldStyles, allowed, customStyles);
    if (fields) return { ...config, fields, style, customStyles, fieldStyles };
    return { ...config, fields: getDefaultGenericCardFields(collectionKey, availableFields), style, customStyles, fieldStyles };
  }

  function getMainCardConfig() {
    const collectionKey = getCurrentCollectionKey();
    const config = cardsConfigState[MAIN_CARD_SETTINGS_KEY] || {};
    const availableFields = getGenericCardAvailableFields();
    const allowed = new Set(availableFields.map((item) => item.key));
    const layout = normalizeLayoutConfig(config.layout, allowed);
    const mainFlow = MAIN_CARD_FLOW_VALUES.has(String(config.mainFlow || '').trim().toLowerCase())
      ? String(config.mainFlow || '').trim().toLowerCase()
      : getDefaultMainCardFlow(collectionKey);
    return {
      ...config,
      layout: Object.keys(layout).length ? layout : getDefaultMainCardLayout(collectionKey, availableFields),
      mainFlow,
    };
  }

  function getJsonCardConfig() {
    const config = cardsConfigState.json || {};
    const allowed = new Set(['maximize', 'wrap', 'copy', 'toggle']);
    const controls = Array.isArray(config.controls)
      ? config.controls.map((item) => String(item || '').trim()).filter((item) => allowed.has(item))
      : undefined;
    return controls ? { ...config, controls } : { ...config };
  }

  function getAvailableRelatedCollections() {
    return relatedDefs
      .map((rel) => ({
        key: String(rel?.name || '').trim(),
        label: String(rel?.label || rel?.name || '').trim() || String(rel?.name || '').trim(),
      }))
      .filter((item) => item.key);
  }

  function getRelatedCollectionFieldItems() {
    const out = {};
    for (const rel of relatedDefs) {
      const key = String(rel?.name || '').trim();
      if (!key) continue;
      out[key] = getDefaultRelatedCardFieldItems();
    }
    return out;
  }

  function getRelatedCardConfig() {
    const config = cardsConfigState[RELATED_CARD_SETTINGS_KEY] || {};
    const available = getAvailableRelatedCollections();
    const allowedCollections = new Set(available.map((item) => item.key));
    const fieldItems = getRelatedCollectionFieldItems();
    const defaultFields = getDefaultRelatedCardFieldItems().map((item) => item.key);
    const collections = Array.isArray(config.collections)
      ? config.collections.map((item) => String(item || '').trim()).filter((item) => allowedCollections.has(item))
      : available.map((item) => item.key);
    const relatedCollections = {};
    for (const collectionName of collections) {
      const allowedFields = new Set((fieldItems[collectionName] || []).map((item) => item.key));
      const raw = (config.relatedCollections && typeof config.relatedCollections === 'object' && !Array.isArray(config.relatedCollections))
        ? config.relatedCollections[collectionName]
        : null;
      const fields = Array.isArray(raw?.fields)
        ? raw.fields.map((item) => String(item || '').trim()).filter((item) => allowedFields.has(item))
        : defaultFields.slice();
      relatedCollections[collectionName] = {
        fields: fields.length ? fields : defaultFields.slice(),
        detailsMode: String(raw?.detailsMode || '').trim().toLowerCase() === 'always' ? 'always' : 'click',
        collapsePrimaryWhenExpanded: !!raw?.collapsePrimaryWhenExpanded,
      };
    }
    return { ...config, collections, relatedCollections };
  }

  function applyMainCardConfig() {
    const mainCardApi = getCardApi('main', { createIfMissing: false });
    const availableFields = getGenericCardAvailableFields();
    const mainCardConfig = getMainCardConfig();
    if (mainCardApi) {
      if (typeof mainCardApi.setAvailableFields === 'function') mainCardApi.setAvailableFields(availableFields);
      if (typeof mainCardApi.setConfig === 'function') mainCardApi.setConfig(mainCardConfig);
    }
    syncMainFieldCastView();
  }

  function applyGenericCardConfig() {
    const genericCardApi = getCardApi('generic', { createIfMissing: false });
    if (!genericCardApi) return;
    if (typeof genericCardApi.setAvailableFields === 'function') genericCardApi.setAvailableFields(getGenericCardAvailableFields());
    if (typeof genericCardApi.setConfig === 'function') genericCardApi.setConfig(getGenericCardConfig());
  }

  function applyJsonCardConfig() {
    const jsonCardApi = getCardApi('json', { createIfMissing: false });
    if (!jsonCardApi) return;
    if (typeof jsonCardApi.setConfig === 'function') jsonCardApi.setConfig(getJsonCardConfig());
  }

  function applyRelatedCardConfig() {
    const relatedCardApi = getCardApi('related', { createIfMissing: false });
    if (!relatedCardApi) return;
    if (typeof relatedCardApi.setAvailableCollections === 'function') {
      relatedCardApi.setAvailableCollections(getAvailableRelatedCollections(), getRelatedCollectionFieldItems());
    }
    if (typeof relatedCardApi.setConfig === 'function') relatedCardApi.setConfig(getRelatedCardConfig());
  }

  async function openMainCardSettings() {
    const active = store?.collections?.getActiveCollection?.();
    const key = String(active?.key || '').trim();
    if (!key) return;
    const availableFields = getGenericCardAvailableFields();
    const currentConfig = getMainCardConfig();
    const fallbackLayout = getDefaultMainCardLayout(key, availableFields);
    const next = await openGenericFlatCardConfigDialog({
      title: 'Main Card Settings',
      subtitle: 'Choose the fixed card positions. Use the One/Two toggle on Center Primary to control whether the center has one panel or two.',
      fields: availableFields,
      layoutSlots: [
        { key: 'topLeft', label: 'Top Left' },
        { key: 'main', label: 'Center Primary' },
        {
          key: 'mainSecondary',
          label: 'Center Secondary',
          showWhen: { option: 'centerMode', equals: 'two' },
        },
        { key: 'bottomLeft', label: 'Bottom Left' },
        { key: 'bottomRight', label: 'Bottom Right' },
      ],
      optionControls: [
        {
          key: 'centerMode',
          label: 'Center Panels',
          attachToLayoutKey: 'main',
          renderAs: 'toggle',
          items: [
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
          ],
        },
        {
          key: 'mainFlow',
          label: 'Center Flow',
          items: [
            { value: 'row', label: 'Row' },
            { value: 'column', label: 'Column' },
          ],
          showWhen: { option: 'centerMode', equals: 'two' },
        },
      ],
      selectedLayout: currentConfig.layout || fallbackLayout,
      defaultLayout: fallbackLayout,
      selectedOptions: {
        centerMode: String(currentConfig?.layout?.mainSecondary || '').trim() ? 'two' : 'one',
        mainFlow: currentConfig.mainFlow || getDefaultMainCardFlow(key),
      },
      defaultOptions: {
        centerMode: String(fallbackLayout?.mainSecondary || '').trim() ? 'two' : 'one',
        mainFlow: getDefaultMainCardFlow(key),
      },
      namespace: 'kanjiStudyCardView.cards.mainFieldCard.js',
      collection: key,
    });
    if (!next) return;
    const layout = next.layout && typeof next.layout === 'object' ? { ...next.layout } : {};
    const centerMode = String(next.centerMode || '').trim().toLowerCase() === 'two' ? 'two' : 'one';
    if (centerMode !== 'two') layout.mainSecondary = '';
    const mainFlow = MAIN_CARD_FLOW_VALUES.has(String(next.mainFlow || '').trim().toLowerCase())
      ? String(next.mainFlow || '').trim().toLowerCase()
      : getDefaultMainCardFlow(key);
    cardsConfigState = {
      ...cardsConfigState,
      [MAIN_CARD_SETTINGS_KEY]: { ...currentConfig, layout, mainFlow },
    };
    applyMainCardConfig();
    try {
      (kanjiController || kanjiStudyController.create(key)).setCardConfig(MAIN_CARD_SETTINGS_KEY, { ...currentConfig, layout, mainFlow });
    } catch (e) {}
  }

  async function openGenericCardSettings() {
    const active = store?.collections?.getActiveCollection?.();
    const key = String(active?.key || '').trim();
    if (!key) return;
    const availableFields = getGenericCardAvailableFields();
    const currentConfig = getGenericCardConfig();
    const allowed = new Set(availableFields.map((field) => field.key));
    const next = await openGenericFlatCardConfigDialog({
      title: 'Generic Card Settings',
      subtitle: 'Use Fields to choose order and visibility. Use Style to tune the generic row layout and labels.',
      fields: availableFields,
      selectedFields: Array.isArray(currentConfig.fields)
        ? currentConfig.fields.filter((field) => allowed.has(String(field || '').trim()))
        : getDefaultGenericCardFields(key, availableFields),
      styleControls: [
        {
          key: 'labelWidth',
          label: 'Label Column Width',
          items: [
            { value: '6rem', label: 'Narrow' },
            { value: '8rem', label: 'Small' },
            { value: '10rem', label: 'Default' },
            { value: '12rem', label: 'Wide' },
            { value: '14rem', label: 'Extra Wide' },
          ],
        },
        {
          key: 'labelSize',
          label: 'Label Font Size',
          renderAs: 'toggle',
          items: [
            { value: '2xs', label: 'XS-' },
            { value: 'xs', label: 'XS' },
            { value: 'sm', label: 'SM' },
            { value: 'body', label: 'Body' },
          ],
        },
        {
          key: 'labelTone',
          label: 'Label Color',
          renderAs: 'toggle',
          items: [
            { value: 'muted', label: 'Muted' },
            { value: 'default', label: 'Text' },
          ],
        },
        {
          key: 'labelVisibility',
          label: 'Show Labels',
          renderAs: 'toggle',
          items: [
            { value: 'show', label: 'Show' },
            { value: 'hidden', label: 'Hide' },
          ],
        },
        {
          key: 'valueSize',
          label: 'Value Font Size',
          renderAs: 'toggle',
          items: [
            { value: 'xs', label: 'XS' },
            { value: 'sm', label: 'SM' },
            { value: 'body', label: 'Body' },
            { value: 'lg', label: 'LG' },
            { value: 'xl', label: 'XL' },
          ],
        },
        {
          key: 'rowPadding',
          label: 'Row Density',
          renderAs: 'toggle',
          items: [
            { value: 'compact', label: 'Tight' },
            { value: 'default', label: 'Default' },
            { value: 'relaxed', label: 'Loose' },
          ],
        },
        {
          key: 'rowDivider',
          label: 'Row Divider',
          renderAs: 'toggle',
          items: [
            { value: 'show', label: 'Show' },
            { value: 'hide', label: 'Hide' },
          ],
        },
      ],
      selectedStyles: currentConfig.style || DEFAULT_GENERIC_CARD_STYLE,
      defaultStyles: DEFAULT_GENERIC_CARD_STYLE,
      customStyles: currentConfig.customStyles || {},
      fieldStyles: currentConfig.fieldStyles || {},
      namespace: 'kanjiStudyCardView.cards.genericFlatCard.js',
      collection: key,
    });
    if (!next) return;
    const fields = normalizeCardFieldList(next.fields) || [];
    const style = {
      ...DEFAULT_GENERIC_CARD_STYLE,
      ...normalizeGenericCardStyle(next.style),
    };
    const customStyles = normalizeGenericCardCustomStyles(next.customStyles);
    const fieldStyles = normalizeGenericCardFieldStyles(next.fieldStyles, new Set(fields), customStyles);
    cardsConfigState = {
      ...cardsConfigState,
      [GENERIC_CARD_SETTINGS_KEY]: { fields, style, customStyles, fieldStyles },
    };
    applyGenericCardConfig();
    try {
      (kanjiController || kanjiStudyController.create(key)).setCardConfig(GENERIC_CARD_SETTINGS_KEY, { fields, style, customStyles, fieldStyles });
    } catch (e) {}
  }

  async function openJsonCardSettings() {
    const active = store?.collections?.getActiveCollection?.();
    const key = String(active?.key || '').trim();
    if (!key) return;
    const availableControls = [
      { key: 'maximize', label: 'Maximize' },
      { key: 'wrap', label: 'Wrap' },
      { key: 'copy', label: 'Copy' },
      { key: 'toggle', label: 'Collapse Toggle' },
    ];
    const currentConfig = getJsonCardConfig();
    const next = await openGenericFlatCardConfigDialog({
      title: 'JSON Card Settings',
      fields: availableControls,
      selectedFields: Array.isArray(currentConfig.controls)
        ? currentConfig.controls.slice()
        : availableControls.map((item) => item.key),
      namespace: 'kanjiStudyCardView.cards.jsonViewerCard.js',
      collection: key,
    });
    if (!next) return;
    const controls = Array.isArray(next.fields)
      ? next.fields.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    cardsConfigState = {
      ...cardsConfigState,
      json: { ...currentConfig, controls },
    };
    applyJsonCardConfig();
    try {
      (kanjiController || kanjiStudyController.create(key)).setCardConfig('json', { ...currentConfig, controls });
    } catch (e) {}
  }

  async function openRelatedCardSettings() {
    const active = store?.collections?.getActiveCollection?.();
    const key = String(active?.key || '').trim();
    if (!key) return;
    const availableCollections = getAvailableRelatedCollections();
    const currentConfig = getRelatedCardConfig();
    const next = await openRelatedCardConfigDialog({
      title: 'Related Card Settings',
      collections: availableCollections,
      selectedCollections: Array.isArray(currentConfig.collections) ? currentConfig.collections.slice() : availableCollections.map((item) => item.key),
      collectionFieldItems: getRelatedCollectionFieldItems(),
      collectionConfigs: currentConfig.relatedCollections || {},
      namespace: 'kanjiStudyCardView.cards.kanjiExampleCard.js',
      collection: key,
    });
    if (!next) return;
    const relatedConfig = {
      collections: Array.isArray(next.collections) ? next.collections.map((item) => String(item || '').trim()).filter(Boolean) : [],
      relatedCollections: (next.relatedCollections && typeof next.relatedCollections === 'object' && !Array.isArray(next.relatedCollections))
        ? { ...next.relatedCollections }
        : {},
    };
    cardsConfigState = {
      ...cardsConfigState,
      [RELATED_CARD_SETTINGS_KEY]: relatedConfig,
    };
    applyRelatedCardConfig();
    try {
      (kanjiController || kanjiStudyController.create(key)).setCardConfig(RELATED_CARD_SETTINGS_KEY, relatedConfig);
    } catch (e) {}
  }

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

  headerTools.addElement({
    type: 'custom',
    key: 'castMainField',
    caption: 'cast',
    create: () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-button view-header-cast-button';
      btn.title = 'Cast main card to a device. Alt+Click to configure receiver app ID.';
      btn.setAttribute('aria-label', 'Cast main card to a device');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 18h2a1 1 0 0 1 1 1v2H4a1 1 0 0 1-1-1z"></path>
          <path d="M3 14a7 7 0 0 1 7 7H8a5 5 0 0 0-5-5z"></path>
          <path d="M3 10a11 11 0 0 1 11 11h-2A9 9 0 0 0 3 12z"></path>
          <path d="M5 4h14a2 2 0 0 1 2 2v7h-2V6H5v2H3V6a2 2 0 0 1 2-2z"></path>
        </svg>
      `;
      btn.addEventListener('click', async (event) => {
        try {
          if (event.altKey || event.shiftKey) {
            await googleCastSender.configure();
          } else {
            await googleCastSender.send(getMainFieldCastSnapshot());
          }
        } catch (e) {
          try { console.warn('[casting] unable to start Google Cast session', e); } catch (err) {}
        } finally {
          btn.setAttribute('aria-pressed', String(googleCastSender.isActive()));
        }
      });
      return btn;
    },
  });

  headerTools.addElement({
    type: 'custom',
    key: 'pipMainField',
    caption: 'pip',
    create: () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-button view-header-pip-button';
      btn.title = 'Open main card in Picture-in-Picture';
      btn.setAttribute('aria-label', 'Open main card in Picture-in-Picture');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 2v10h16V7z"></path>
          <path d="M13 11h6v4h-6z"></path>
        </svg>
      `;
      if (!mainFieldCastSession.isSupported()) {
        btn.disabled = true;
        btn.title = 'Picture-in-Picture view is not supported in this browser';
        btn.setAttribute('aria-label', 'Picture-in-Picture view not supported in this browser');
      }
      btn.addEventListener('click', async () => {
        try {
          const isOpen = await mainFieldCastSession.toggle(getMainFieldCastSnapshot());
          btn.setAttribute('aria-pressed', String(!!isOpen));
        } catch (e) {
          btn.setAttribute('aria-pressed', 'false');
          try { console.warn('[casting] unable to open cast session', e); } catch (err) {}
        }
      });
      return btn;
    },
  });

  const scrubThresholdItems = createScrubThresholdItems();
  const scrubThresholdRec = headerTools.addElement({
    type: 'dropdown',
    key: 'scrubThreshold',
    items: scrubThresholdItems,
    value: String(scrubHoldDelayMs),
    multi: false,
    onChange: (nextValue) => {
      scrubHoldDelayMs = normalizeScrubThresholdMs(nextValue);
      persistViewState({ scrubHoldDelayMs });
      try { if (scrubThresholdControl && typeof scrubThresholdControl.setValue === 'function') scrubThresholdControl.setValue(String(scrubHoldDelayMs)); } catch (e) {}
    },
    className: 'data-expansion-dropdown',
    caption: 'scrub.threshold'
  });
  scrubThresholdControl = scrubThresholdRec && scrubThresholdRec.control ? scrubThresholdRec.control : null;

  // For each related-collection declared in the collection metadata, add a dropdown.
  const relatedDefs = Array.isArray(coll?.metadata?.relatedCollections) ? coll.metadata.relatedCollections.slice() : [];
  const relatedDropdownControls = {};
  const RELATED_DEFAULT_ITEMS = [
    { value: 'title', left: 'Title' },
    { value: 'english', left: 'English' },
    { value: 'japanese', left: 'Japanese' },
    { value: 'notes', left: 'Notes' },
    { value: 'sentences', left: 'Sentences' },
    { value: 'chunks', left: 'Chunks' },
  ];

  for (const rel of relatedDefs) {
    const name = String(rel?.name || '').trim();
    if (!name) continue;
    const items = RELATED_DEFAULT_ITEMS.slice();
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

  applyMainCardConfig();
  applyGenericCardConfig();
  applyJsonCardConfig();
  applyRelatedCardConfig();

  // No legacy UI load: visual defaults used.

  // Footer controls: describe actions and let footer build UI + register shortcuts
  function getFooterButton(key) {
    if (!footerControls) return null;
    if (typeof footerControls.getButton === 'function') return footerControls.getButton(key);
    return (footerControls.buttons && footerControls.buttons[key]) || null;
  }

  function isEditableTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest('[role="dialog"][aria-modal="true"]')) return true;
    if (el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
    return false;
  }

  function getIndexCaption(nextIndex = index) {
    const total = Array.isArray(entries) ? entries.length : 0;
    if (!total) return 'Empty';
    return `${Math.max(0, Number(nextIndex) + 1)} / ${total}`;
  }

  function setDisplayedCardCaptions(text) {
    const caption = String(text || '').trim();
    for (const api of Object.values(cardApis || {})) {
      if (api && typeof api.setIndexText === 'function') {
        try { api.setIndexText(caption); } catch (e) {}
      }
    }
  }

  function setScrubPlaceholderActive(active, caption = '') {
    const isActive = !!active;
    for (const [cardKey, api] of Object.entries(cardApis || {})) {
      const root = api?.el;
      if (!root) continue;
      root.classList.toggle('scrub-preview', isActive);
      if (!isActive) continue;
      const targets = [];
      if (cardKey === 'main') {
        targets.push(...root.querySelectorAll('.main-field-card-top-left, .main-field-card-main, .main-field-card-bottom-left, .main-field-card-bottom-right'));
      } else if (cardKey === 'related') {
        targets.push(...root.querySelectorAll('.kanji-related-text, .kanji-related-notes, .kanji-related-empty'));
      } else if (cardKey === 'generic') {
        targets.push(...root.querySelectorAll('.kanji-full-value'));
      } else if (cardKey === 'json') {
        targets.push(...root.querySelectorAll('.json-viewer-body'));
      } else {
        targets.push(root);
      }
      for (const node of targets) {
        if (!(node instanceof HTMLElement)) continue;
        node.textContent = '...';
      }
      try { if (typeof api.setIndexText === 'function') api.setIndexText(caption); } catch (e) {}
    }
  }

  function showScrubPreview() {
    if (!scrubState.active) return;
    const caption = getIndexCaption(scrubState.pendingIndex);
    setDisplayedCardCaptions(caption);
    setScrubPlaceholderActive(true, caption);
  }

  function hideScrubPreview() {
    setScrubPlaceholderActive(false);
  }

  function beginScrub(key) {
    scrubState.active = true;
    scrubState.pendingIndex = index;
    scrubState.key = String(key || '');
    showScrubPreview();
  }

  function stepScrub(delta) {
    const total = Array.isArray(entries) ? entries.length : 0;
    if (!total) return;
    if (!scrubState.active) return;
    const raw = Math.round(Number(scrubState.pendingIndex) + Number(delta || 0));
    scrubState.pendingIndex = ((raw % total) + total) % total;
    showScrubPreview();
  }

  function settleScrub() {
    if (!scrubState.active) return false;
    const targetIndex = scrubState.pendingIndex;
    scrubState.active = false;
    scrubState.key = '';
    hideScrubPreview();
    if (targetIndex === index) {
      setDisplayedCardCaptions(getIndexCaption(index));
      return true;
    }
    goToIndex(targetIndex);
    return true;
  }

  function goToIndex(newIndex) {
    const total = Array.isArray(entries) ? entries.length : 0;
    if (!total) return;
    const raw = Math.round(Number(newIndex));
    if (!Number.isFinite(raw)) return;
    const nextIndex = ((raw % total) + total) % total;
    try {
      console.info('[kanjiStudy] goToIndex', {
        fromIndex: index,
        toIndex: nextIndex,
        currentEntryKey: getCurrentEntryKey(),
        targetEntryKey: String(store?.collections?.getEntryStudyKey?.(entries[nextIndex]) || '').trim(),
      });
    } catch (e) {}
    try { progressTracker?.flush?.(); } catch (e) {}
    index = nextIndex;
    shownAt = nowMs();
    if (kanjiController && typeof kanjiController.setCurrentIndex === 'function') {
      pendingLocalControllerIndex = index;
      kanjiController.setCurrentIndex(index);
    }
    try { progressTracker?.syncToCurrent?.({ flushCurrent: false }); } catch (e) {}
    render({ skipRefresh: true, skipTrackerSync: true });
  }

  function showPrev() {
    try {
      console.info('[kanjiStudy] showPrev', {
        index,
        entryKey: getCurrentEntryKey(),
      });
    } catch (e) {}
    goToIndex(index - 1);
  }
  function showNext() {
    try {
      console.info('[kanjiStudy] showNext', {
        index,
        entryKey: getCurrentEntryKey(),
      });
    } catch (e) {}
    goToIndex(index + 1);
  }

  let footerControls = null;
  // Auto-speak setting removed from UI.

  // Speak a specific field from the current entry (used for sound.X actions)
  function speakField(field) {
    const entry = entries && entries.length ? entries[index] : null;
    if (!entry || !field) return;
    const text = getFieldValue(entry, [field]);
    if (!text) return;
    speakText(text, { fieldKey: field });
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
      const isLearnedToggle = actionName === 'toggleKanjiLearned';
      const isPracticeToggle = actionName === 'toggleKanjiFocus';
      if (!isLearnedToggle && !isPracticeToggle) return;
      const view = store?.collections?.getActiveCollectionView?.({ windowSize: 10 })?.view;

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
    getSpeechConfig: getSpeechSettings,
    setSpeechConfig: setSpeechSettings,
  });

  // Load default view mode from settings
  if (store?.settings && typeof store.settings.get === 'function') {
    const dvm = store.settings.get('apps.kanjiStudy.defaultViewMode', { consumerId: 'kanjiStudyCardView' });
    if (typeof dvm === 'string') defaultViewMode = dvm;
  }

  // Dropdown to choose which cards are displayed
  // Build display card items from the card registry so new cards appear automatically.
  const displayCardItems = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : []).map(c => ({ value: c.key, left: c.label }));

  function createCardApi(cardKey) {
    const cardDef = (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY.find((c) => c.key === cardKey) : null);
    if (!cardDef || typeof cardDef.factory !== 'function') return null;

    let api = null;
    if (cardKey === 'related') {
        api = cardDef.factory({
          entry: null,
          indexText: '',
          config: { cardId: RELATED_CARD_SETTINGS_KEY },
          handlers: {
            onSpeak: (text) => {
              if (!text) return;
              speakText(text, { fieldKey: 'reading' });
            },
            onNext: () => {},
            onPrev: () => {},
            onOpenConfig: () => { openRelatedCardSettings(); },
          },
        });
        if (api && typeof api.setAvailableCollections === 'function') {
          api.setAvailableCollections(getAvailableRelatedCollections(), getRelatedCollectionFieldItems());
        }
        if (api && typeof api.setConfig === 'function') api.setConfig(getRelatedCardConfig());
    } else if (cardKey === 'main') {
      api = cardDef.factory({
        entry: null,
        indexText: '',
        config: { cardId: MAIN_CARD_SETTINGS_KEY },
        handlers: {
          onOpenConfig: () => { openMainCardSettings(); },
        },
      });
      if (api && typeof api.setAvailableFields === 'function') api.setAvailableFields(getGenericCardAvailableFields());
      if (api && typeof api.setConfig === 'function') api.setConfig(getMainCardConfig());
    } else if (cardKey === 'generic') {
      api = cardDef.factory({
        entry: null,
        indexText: '',
        config: { cardId: GENERIC_CARD_SETTINGS_KEY },
        handlers: {
          onOpenConfig: () => { openGenericCardSettings(); },
        },
      });
      if (api && typeof api.setAvailableFields === 'function') api.setAvailableFields(getGenericCardAvailableFields());
      if (api && typeof api.setConfig === 'function') api.setConfig(getGenericCardConfig());
    } else if (cardKey === 'json') {
      api = cardDef.factory({
        entry: null,
        indexText: '',
        config: { cardId: 'json' },
        handlers: {
          onOpenConfig: () => { openJsonCardSettings(); },
        },
      });
      if (api && typeof api.setConfig === 'function') api.setConfig(getJsonCardConfig());
    } else {
      api = cardDef.factory({ entry: null, indexText: '' });
    }

    cardApis[cardKey] = api;
    applyCurrentVisibilityToCard(cardKey, api);
    return api;
  }

  function getCardApi(cardKey, { createIfMissing = true } = {}) {
    if (!cardApis[cardKey] && createIfMissing) return createCardApi(cardKey);
    return cardApis[cardKey] || null;
  }

  function destroyCardApi(cardKey) {
    const api = cardApis[cardKey];
    if (!api) return;
    try { if (typeof api.destroy === 'function') api.destroy(); } catch (e) {}
    cardApis[cardKey] = null;
  }

  function getResolvedDisplayCardKeys(resolvedDisplay) {
    const source = Array.isArray(resolvedDisplay)
      ? resolvedDisplay
      : (Array.isArray(displayCardSelection) ? displayCardSelection : []);
    return source.map((key) => String(key || '').trim()).filter(Boolean);
  }

  function setCardDisplayed(cardApi, isVisible) {
    if (!cardApi) return;
    if (isVisible && typeof cardApi.setVisible === 'function') cardApi.setVisible(true);
    if (isVisible && cardApi.el) cardApi.el.style.display = '';
  }

  function syncDisplayedCardsInDom(displaySet) {
    for (let i = 0; i < CARD_REGISTRY.length; i += 1) {
      const cardDef = CARD_REGISTRY[i];
      const api = displaySet.has(cardDef.key)
        ? getCardApi(cardDef.key)
        : getCardApi(cardDef.key, { createIfMissing: false });
      const cardEl = api?.el;

      if (!displaySet.has(cardDef.key)) {
        destroyCardApi(cardDef.key);
        continue;
      }

      if (!cardEl) continue;

      let nextSibling = null;
      for (let j = i + 1; j < CARD_REGISTRY.length; j += 1) {
        const laterKey = CARD_REGISTRY[j].key;
        const laterEl = getCardApi(laterKey, { createIfMissing: false })?.el;
        if (displaySet.has(laterKey) && laterEl && laterEl.parentNode === el) {
          nextSibling = laterEl;
          break;
        }
      }

      if (cardEl.parentNode !== el || cardEl.nextSibling !== nextSibling) {
        el.insertBefore(cardEl, nextSibling);
      }
    }
  }

  function applyDisplayCardVisibility(resolvedDisplay, { renderNewlyVisible = false } = {}) {
    const nextSet = new Set(getResolvedDisplayCardKeys(resolvedDisplay));
    const newlyVisible = new Set();

    for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) {
      const isVisible = nextSet.has(c.key);
      if (isVisible && !activeDisplayCardKeys.has(c.key)) newlyVisible.add(c.key);
      const api = isVisible ? getCardApi(c.key) : getCardApi(c.key, { createIfMissing: false });
      setCardDisplayed(api, isVisible);
    }

    syncDisplayedCardsInDom(nextSet);

    try {
      for (const rn of Object.keys(relatedDropdownControls || {})) {
        const rc = relatedDropdownControls[rn];
        if (rc && rc.parentNode) rc.parentNode.style.display = nextSet.has('related') ? '' : 'none';
      }
    } catch (e) {}

    activeDisplayCardKeys = nextSet;

    if (renderNewlyVisible && newlyVisible.size) {
      render({ skipRefresh: true, forceCardKeys: newlyVisible });
    }

    return nextSet;
  }

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

  // Apply initial visibility defaults based on entry-level and related selections
  if (displayCardSelection === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));

  // Resolved visibility and display are applied from controller `resolved` state on init/subscription.

  // render a single card body
  function renderCard(body, entry) {
    body.innerHTML = '';

    // main primary field centered
    const kanjiWrap = document.createElement('div');
    kanjiWrap.className = 'main-field-card-main-wrap';
    const kanjiMain = document.createElement('div');
    kanjiMain.className = 'main-field-card-main';
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
    topLeft.className = 'main-field-card-top-left';
    topLeft.textContent = getFieldValue(entry, ['type']) || '';

    // bottom-left reading
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'main-field-card-bottom-left';
    bottomLeft.textContent = getFieldValue(entry, ['reading', 'kana', 'onyomi', 'kunyomi']) || '';

    // bottom-right meaning
    const bottomRight = document.createElement('div');
    bottomRight.className = 'main-field-card-bottom-right';
    bottomRight.textContent = getFieldValue(entry, ['meaning', 'definition', 'gloss']) || '';

    body.append(topLeft, kanjiWrap, bottomLeft, bottomRight);
  }

  function refreshEntriesFromStore() {
    refreshEntryFieldItems();
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
        scrubHoldDelayMs = normalizeScrubThresholdMs(appState.scrubHoldDelayMs);
        try {
          if (scrubThresholdControl && typeof scrubThresholdControl.setValue === 'function') {
            scrubThresholdControl.setValue(String(scrubHoldDelayMs));
          }
        } catch (e) {}
        if (appState.entryFields !== undefined) entryFieldSelection = appState.entryFields === 'all' ? 'all' : (Array.isArray(appState.entryFields) ? appState.entryFields.slice() : appState.entryFields);
        if (appState.relatedFields && typeof appState.relatedFields === 'object') {
          for (const k of Object.keys(appState.relatedFields)) relatedFieldSelections[k] = Array.isArray(appState.relatedFields[k]) ? appState.relatedFields[k].slice() : appState.relatedFields[k];
        }
        cardsConfigState = normalizeKanjiStudyCardsConfig(appState.cards);
        if (Array.isArray(appState.displayCards)) displayCardSelection = appState.displayCards.slice();
        else if (appState.displayCards === 'all') displayCardSelection = displayCardItems.map(it => String(it?.value || ''));
        applyMainCardConfig();
        applyGenericCardConfig();
        applyJsonCardConfig();
        applyRelatedCardConfig();

        // apply resolved maps if controller provided them
        try {
          if (appState && appState.resolved) {
            if (appState.resolved.entryFieldMap) applyEntryFieldVisibility(appState.resolved.entryFieldMap);
            if (Array.isArray(appState.resolved.displayCards)) {
              applyDisplayCardVisibility(appState.resolved.displayCards);
            }
            if (appState.resolved.relatedFieldMaps) {
              resolvedRelatedFieldMaps = { ...appState.resolved.relatedFieldMaps };
              const api = getCardApi('related', { createIfMissing: false });
              for (const rn of Object.keys(appState.resolved.relatedFieldMaps || {})) {
                try {
                  if (api && typeof api.setCollectionFieldsVisible === 'function') api.setCollectionFieldsVisible(rn, appState.resolved.relatedFieldMaps[rn]);
                  else if (api && typeof api.setFieldsVisible === 'function') api.setFieldsVisible(appState.resolved.relatedFieldMaps[rn]);
                } catch (e) {}
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
              const items = RELATED_DEFAULT_ITEMS.map(it => it.value);
              const sel = relatedFieldSelections[name] || 'all';
              const chosen = (sel === 'all') ? items.slice() : (Array.isArray(sel) ? sel.slice() : []);
              const api = getCardApi('related', { createIfMissing: false });
              if (api && (typeof api.setCollectionFieldsVisible === 'function' || typeof api.setFieldsVisible === 'function')) {
                const set = new Set(chosen);
                const map = {};
                for (const v of items) map[v] = set.has(v);
                if (typeof api.setCollectionFieldsVisible === 'function') api.setCollectionFieldsVisible(name, map);
                else api.setFieldsVisible(map);
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

  function getMainFieldCastSnapshot(overrides = {}) {
    const entry = Object.prototype.hasOwnProperty.call(overrides, 'entry') ? overrides.entry : entries[index];
    const total = Array.isArray(entries) ? entries.length : 0;
    const indexText = Object.prototype.hasOwnProperty.call(overrides, 'indexText')
      ? overrides.indexText
      : (total ? `${index + 1} / ${total}` : 'Empty');
    const collectionKey = getCurrentCollectionKey();
    return {
      entry: entry || null,
      indexText,
      availableFields: getGenericCardAvailableFields(),
      cardConfig: getMainCardConfig(),
      visibilityMap: getEntryFieldVisibilityMap(),
      mode: defaultViewMode,
      title: collectionKey ? `Study Cards Cast - ${collectionKey}` : 'Study Cards Cast',
    };
  }

  function syncMainFieldCastView(overrides = {}) {
    const castBtn = typeof headerTools.getControl === 'function' ? headerTools.getControl('castMainField') : null;
    const pipBtn = typeof headerTools.getControl === 'function' ? headerTools.getControl('pipMainField') : null;
    if (castBtn) castBtn.setAttribute('aria-pressed', String(googleCastSender.isActive()));
    if (pipBtn) pipBtn.setAttribute('aria-pressed', String(mainFieldCastSession.isActive()));
    if (!mainFieldCastSession.isActive()) return;
    mainFieldCastSession.update(getMainFieldCastSnapshot(overrides));
    if (pipBtn) pipBtn.setAttribute('aria-pressed', String(mainFieldCastSession.isActive()));
  }

  function render({ skipRefresh = false, forceCardKeys = null, skipTrackerSync = false } = {}) {
    if (!skipRefresh && !isShuffled) {
      refreshEntriesFromStore();
    }
    if (!scrubState.active) hideScrubPreview();
    const sb = headerTools.getControl && headerTools.getControl('shuffle'); if (sb) sb.setAttribute('aria-pressed', String(!!isShuffled));
    // render

    // If the underlying entry changed due to refresh, keep timing aligned.
    // (e.g., store updates, filter changes, virtual set resolution)
    if (!skipTrackerSync) {
      progressTracker?.syncToCurrent?.();
    }

    const entry = entries[index];
    const total = entries.length;
    const entryLabel = entry ? String(store?.collections?.getEntryStudyKey?.(entry) || getPrimaryKanjiValue(entry) || '').trim() : '';

    function logCardUpdate(cardKey, reason = 'setEntry') {
      try {
        console.info(`[kanjiStudy] updating ${String(cardKey || '')} to ${entryLabel || '(empty)'}`, {
          cardKey: String(cardKey || ''),
          entryKey: entryLabel || '',
          index,
          total,
          reason,
          skipRefresh: !!skipRefresh,
        });
      } catch (e) {}
    }

    // update view mode class on the wrapper (maintains previous behavior)
    const displaySet = applyDisplayCardVisibility();
    const cardsToRefresh = (forceCardKeys instanceof Set)
      ? new Set(Array.from(forceCardKeys).filter((key) => displaySet.has(key)))
      : displaySet;
    const liveMainCardApi = displaySet.has('main') ? getCardApi('main') : null;
    const liveRelatedCardApi = displaySet.has('related') ? getCardApi('related') : null;
    const wrapper = liveMainCardApi?.el?.querySelector('.main-field-card-wrapper') || null;

    if (wrapper) {
      if (defaultViewMode === 'kanji-only') wrapper.classList.add('kanji-only');
      else wrapper.classList.remove('kanji-only');
    }

    // update main card content and corner caption
    const caption = total ? `${index + 1} / ${total}` : 'Empty';

    if (displaySet.has('main') && liveMainCardApi && cardsToRefresh.has('main')) {
      liveMainCardApi.setIndexText(caption);
      if (!entry) {
        logCardUpdate('main', 'setEntry(null)');
        liveMainCardApi.setEntry(null);
      } else {
        logCardUpdate('main');
        liveMainCardApi.setEntry(entry);
      }
    }

    if (displaySet.has('related') && liveRelatedCardApi && typeof liveRelatedCardApi.setEntry === 'function' && cardsToRefresh.has('related')) {
      logCardUpdate('related');
      if (typeof liveRelatedCardApi.setIndexText === 'function') liveRelatedCardApi.setIndexText(caption);
      liveRelatedCardApi.setEntry(entry);
    }

    // Set entry only on currently displayed cards so hidden cards do not redraw on navigation.
    for (const k of Object.keys(cardApis || {})) {
      if (k === 'main' || k === 'related') continue;
      if (!displaySet.has(k) || !cardsToRefresh.has(k)) continue;
      const api = cardApis[k];
      if (api && typeof api.setIndexText === 'function') api.setIndexText(caption);
      if (k === 'json' && typeof api.setConfig === 'function') api.setConfig(getJsonCardConfig());
      if (api && typeof api.setEntry === 'function') {
        logCardUpdate(k);
        api.setEntry(entry);
      }
    }
    
    // (reveal toggle removed)

    // Update learned/focus button state
    updateMarkButtons();
    syncMainFieldCastView({ entry, indexText: caption });
    if (googleCastSender.isActive()) {
      googleCastSender.send(getMainFieldCastSnapshot({ entry, indexText: caption })).catch(() => {});
    }
  }

  // Initial population — refresh entries and render (saved order is applied in refresh)
  refreshEntriesFromStore();
  render();

  // Pause/resume timing on visibility/focus changes

  // Removed local visibility handlers


  // React to store changes (e.g., virtual set finishing its background resolution)
  let isViewActive = true;
  let pendingStoreRefresh = false;
  function syncFromStoreAndRender() {
    pendingStoreRefresh = false;
    refreshEntriesFromStore();
    render();
  }

  const unsubs = [];
  let lastKey = store?.collections?.getActiveCollection?.()?.key || null;
  const onRelevantStateChanged = (event = null) => {
    const eventType = String(event?.type || '').trim();
    if (eventType === 'collections.progress.changed') {
      return;
    }
    if (!isViewActive) {
      pendingStoreRefresh = true;
      return;
    }
    const active = store?.collections?.getActiveCollection?.();
    const key = active?.key || null;
    if (key !== lastKey) {
      lastKey = key;
      uiStateRestored = false;
    }
    syncFromStoreAndRender();
  };
  try {
    if (store?.collections && typeof store.collections.subscribe === 'function') {
      unsubs.push(store.collections.subscribe((event) => {
        onRelevantStateChanged(event);
      }));
    }
  } catch (e) {}

  

  // Footer caption (below the card)
  const footer = document.createElement('div');
  footer.className = 'view-footer-caption';
  footer.id = 'kanji-controls';
  footer.textContent = '← / →: navigate  •  ↑: full  •  ↓: kanji only';

  // Build a DocumentFragment containing header -> view root -> footer so
  // when the shell appends the fragment its children become siblings in
  // the correct order under `#shell-main`.
  const frag = document.createDocumentFragment();
  frag.appendChild(headerTools);
  frag.appendChild(el);
  frag.appendChild(footerControls.el);
  el.__activate = () => {
    isViewActive = true;
    if (pendingStoreRefresh) syncFromStoreAndRender();
  };
  el.__deactivate = () => {
    settleScrub();
    isViewActive = false;
  };
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

  function onScrubKeyDownCapture(e) {
    if (!isViewActive) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (isEditableTarget(e.target)) return;
    const key = String(e?.key || '');
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    const total = Array.isArray(entries) ? entries.length : 0;
    if (!total) return;
    const now = Date.now();
    if (!e?.repeat) {
      if (arrowPressState.key === key && arrowPressState.handledInitialPress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      arrowPressState.key = key;
      arrowPressState.handledInitialPress = true;
      scrubHoldState.key = key;
      scrubHoldState.startedAtMs = now;
      return;
    }
    if (scrubHoldState.key !== key) {
      scrubHoldState.key = key;
      scrubHoldState.startedAtMs = now;
      return;
    }
    if ((now - Number(scrubHoldState.startedAtMs || 0)) < scrubHoldDelayMs) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!scrubState.active) beginScrub(key);
    scrubState.key = key;
    stepScrub(key === 'ArrowRight' ? 1 : -1);
  }

  function onScrubKeyUpCapture(e) {
    const key = String(e?.key || '');
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    if (arrowPressState.key === key) {
      arrowPressState.key = '';
      arrowPressState.handledInitialPress = false;
    }
    if (scrubHoldState.key === key) {
      scrubHoldState.key = '';
      scrubHoldState.startedAtMs = 0;
    }
    if (!scrubState.active) return;
    e.preventDefault();
    e.stopPropagation();
    settleScrub();
  }

  function onScrubWindowBlur() {
    arrowPressState.key = '';
    arrowPressState.handledInitialPress = false;
    scrubHoldState.key = '';
    scrubHoldState.startedAtMs = 0;
    settleScrub();
  }

  try { document.addEventListener('keydown', onScrubKeyDownCapture, true); } catch (e) {}
  try { document.addEventListener('keyup', onScrubKeyUpCapture, true); } catch (e) {}
  try { window.addEventListener('blur', onScrubWindowBlur); } catch (e) {}

  // Keyboard handling for non-arrow footer shortcuts is still handled by the footer component.



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
      settleScrub();
      progressTracker?.teardown?.();
      try { document.removeEventListener('keydown', onScrubKeyDownCapture, true); } catch (e) {}
      try { document.removeEventListener('keyup', onScrubKeyUpCapture, true); } catch (e) {}
      try { window.removeEventListener('blur', onScrubWindowBlur); } catch (e) {}
      for (const unsub of unsubs) {
        try { if (typeof unsub === 'function') unsub(); } catch (e) {}
      }
      
      // cleanup header/footer moved into shell
      if (__mountedHeaderInShell && headerTools && headerTools.parentNode) headerTools.parentNode.removeChild(headerTools);
      if (__mountedFooterInShell && footerControls && footerControls.el && footerControls.el.parentNode) footerControls.el.parentNode.removeChild(footerControls.el);
      // explicitly unregister footer key handler if provided
      if (footerControls && typeof footerControls.__unregister === 'function') footerControls.__unregister();
      mainFieldCastSession.close();
      for (const c of (Array.isArray(CARD_REGISTRY) ? CARD_REGISTRY : [])) destroyCardApi(c.key);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // expose fragment so the shell can mount header -> view -> footer in order
  return frag;
}
