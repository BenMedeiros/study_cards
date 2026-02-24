import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { el } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';
import { confirmDialog } from '../components/confirmDialog.js';
import { parseHashRoute, buildHashRoute } from '../utils/helpers.js';
import { compileTableSearchQuery, matchesTableSearch } from '../utils/tableSearch.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.collections.getActiveCollection();

  function normalizeRelatedCollectionsConfig(v) {
    const arr = Array.isArray(v) ? v : [];
    const out = [];
    const seen = new Set();
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name });
    }
    return out;
  }

  const relatedCollectionConfigs = normalizeRelatedCollectionsConfig(active?.metadata?.relatedCollections);
  const relatedCountColumns = relatedCollectionConfigs.map(rel => ({
    key: `${rel.name}.count`,
    label: `${rel.name}.count`,
    type: 'number',
    relationName: rel.name,
  }));

  function getRelatedCountForEntry(entry, relationName) {
    const name = String(relationName || '').trim();
    if (!name) return 0;
    const byCountMap = Number(entry?.__relatedCounts?.[name]);
    if (Number.isFinite(byCountMap)) return Math.max(0, Math.round(byCountMap));
    if (Array.isArray(entry?.__related?.[name])) return entry.__related[name].length;
    return 0;
  }

  const STUDY_STATE_ORDER = ['null', 'focus', 'learned'];
  let studyFilterStates = STUDY_STATE_ORDER.slice();

  // Persisted per-collection table search query (always applied)
  let heldTableSearch = '';

  // Persisted per-collection saved table search filters (autocomplete suggestions)
  let savedTableSearches = [];

  // Persisted per-collection adjective expansion (Data view header dropdowns)
  let expansionIForms = [];
  let expansionNaForms = [];

  const I_ADJ_BASE_FORM_ITEMS = [
    { value: 'plain', label: 'plain', left: 'plain', right: '~i' },
    { value: 'negative', label: 'negative', left: 'negative', right: '~kunai' },
    { value: 'past', label: 'past', left: 'past', right: '~katta' },
    { value: 'pastNegative', label: 'past neg', left: 'past', right: '~kunakatta' },
    { value: 'te', label: 'te-form', left: 'te-form', right: '~kute' },
    { value: 'adverb', label: 'adverb', left: 'adverb', right: '~ku' },
  ];

  const NA_ADJ_BASE_FORM_ITEMS = [
    { value: 'plain', label: 'plain', left: 'plain', right: '~da' },
    { value: 'negative', label: 'negative', left: 'negative', right: '~janai' },
    { value: 'past', label: 'past', left: 'past', right: '~datta' },
    { value: 'pastNegative', label: 'past neg', left: 'past', right: '~janakatta' },
    { value: 'te', label: 'te-form', left: 'te-form', right: '~de' },
    { value: 'adverb', label: 'adverb', left: 'adverb', right: '~ni' },
  ];

  const I_ADJ_FORM_ITEMS = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    ...I_ADJ_BASE_FORM_ITEMS,
  ];

  const NA_ADJ_FORM_ITEMS = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    ...NA_ADJ_BASE_FORM_ITEMS,
  ];

  const STUDY_FILTER_ITEMS = [
    { kind: 'action', action: 'toggleAllNone', value: '__toggle__', label: '(all/none)' },
    { value: 'null', label: 'null', left: 'state', right: 'null' },
    { value: 'focus', label: 'focus', left: 'state', right: 'focus' },
    { value: 'learned', label: 'learned', left: 'state', right: 'learned' },
  ];

  function normalizeFormList(v) {
    if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
    const s = String(v || '').trim();
    if (!s) return [];
    // accept legacy strings (single) or comma/space separated
    return s.split(/[,|\s]+/g).map(x => String(x || '').trim()).filter(Boolean);
  }

  function normalizeSavedSearchList(v) {
    const arr = Array.isArray(v) ? v : normalizeFormList(v);
    const out = [];
    const seen = new Set();
    for (const raw of arr) {
      const s = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= 100) break;
    }
    return out;
  }

  function isSavedTableSearch(q) {
    const s = String(q || '').trim().replace(/\s+/g, ' ');
    if (!s) return false;
    try {
      const list = Array.isArray(savedTableSearches) ? savedTableSearches : [];
      for (const it of list) {
        if (String(it || '').trim().replace(/\s+/g, ' ') === s) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function sameStringArray(a, b) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (String(aa[i]) !== String(bb[i])) return false;
    }
    return true;
  }

  function formatMultiSelectButtonLabel(selectedValues, items) {
    const baseItems = (Array.isArray(items) ? items : []).filter(it => {
      const kind = String(it?.kind || '').trim();
      return kind !== 'action' && kind !== 'divider';
    });

    const allValues = baseItems.map(it => String(it?.value ?? '')).filter(Boolean);
    const selectedSet = new Set((Array.isArray(selectedValues) ? selectedValues : []).map(v => String(v || '').trim()).filter(Boolean));
    const selectedInOrder = allValues.filter(v => selectedSet.has(v));

    if (!selectedInOrder.length) return '—';
    if (selectedInOrder.length === allValues.length) return 'all';
    if (selectedInOrder.length >= 2) return `${selectedInOrder.length} selected`;

    const byValue = new Map(baseItems.map(it => [String(it?.value ?? ''), String(it?.right ?? it?.label ?? it?.value ?? '')]));
    const v = selectedInOrder[0];
    return byValue.get(v) || v;
  }

  function orderFormsByItems(values, items) {
    const set = new Set((Array.isArray(values) ? values : []).map(v => String(v || '').trim()).filter(Boolean));
    const ordered = (Array.isArray(items) ? items : [])
      .map(it => String(it?.value ?? ''))
      .filter(v => v && set.has(v));
    return ordered;
  }

  function orderStudyStates(values) {
    const set = new Set((Array.isArray(values) ? values : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
    return STUDY_STATE_ORDER.filter(v => set.has(v));
  }

  function normalizeStudyFilterStates(value) {
    const arr = Array.isArray(value)
      ? value
      : String(value || '').split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);

    const out = [];
    const seen = new Set();
    const add = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (!s || seen.has(s)) return;
      if (s !== 'null' && s !== 'focus' && s !== 'learned') {
        throw new Error(`Invalid studyFilter state: ${s}. Allowed states: null, focus, learned`);
      }
      seen.add(s);
      out.push(s);
    };

    for (const tokenRaw of arr) {
      const t = String(tokenRaw || '').trim().toLowerCase();
      if (!t) continue;
      add(t);
    }

    return orderStudyStates(out);
  }

  function formatStudyFilterButtonLabel(selectedValues) {
    const ordered = orderStudyStates(selectedValues);
    if (!ordered.length) return 'none';
    if (ordered.length === STUDY_STATE_ORDER.length) return 'all';
    if (ordered.length >= 2) return `${ordered.length} selected`;
    return ordered[0];
  }

  function parseStudyFilter(value) {
    const raw = String(value || '').trim();
    if (!raw) return { states: STUDY_STATE_ORDER.slice() };
    const states = normalizeStudyFilterStates(raw);
    return { states: states.length ? states : STUDY_STATE_ORDER.slice() };
  }

  function serializeStudyFilter({ states = [] } = {}) {
    return orderStudyStates(states).join(',');
  }

  function getEntryStudyState(entry, adapter) {
    const a = adapter || getProgressAdapter();
    const key = a.getKey(entry);
    if (!key) return 'null';
    if (a.isLearned(key)) return 'learned';
    if (a.isFocus(key)) return 'focus';
    return 'null';
  }

  function normalizeType(v) {
    return String(v || '').trim().toLowerCase();
  }

  function collectionHasAdjectiveKind(kind) {
    const want = String(kind || '').trim().toLowerCase();
    if (want !== 'i' && want !== 'na') return false;
    const entries = Array.isArray(active?.entries) ? active.entries : [];
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const t = normalizeType(e.type);
      const isI = t === 'i-adjective' || t === 'i_adj' || t === 'i-adj';
      const isNa = t === 'na-adjective' || t === 'na_adj' || t === 'na-adj';
      if (want === 'i' && isI) return true;
      if (want === 'na' && isNa) return true;
    }
    return false;
  }

  function deleteExpansionSettingIfPresent(keys) {
    try {
      const coll = store.collections.getActiveCollection();
      if (!coll?.key) return;
      if (typeof store?.collections?.deleteCollectionStateKeys === 'function') {
        store.collections.deleteCollectionStateKeys(coll.key, keys);
      }
    } catch (e) {
      // ignore
    }
  }

  function getClearLearnedStats() {
    const adapter = getProgressAdapter();
    const keys = new Set();

    try {
      const entriesView = refreshEntriesView();
      for (const entry of (Array.isArray(entriesView) ? entriesView : [])) {
        if (!passesFilters(entry)) continue;
        const key = adapter.getKey(entry);
        if (!key) continue;
        if (!adapter.isLearned(key)) continue;
        keys.add(String(key));
      }
    } catch (e) {
      // ignore
    }

    const coll = store?.collections?.getActiveCollection?.() || active;
    const detailParts = [];
    if (coll?.key) detailParts.push(`Collection: ${coll.key}`);
    if (heldTableSearch) detailParts.push(`Held search: ${heldTableSearch}`);
    const filterState = serializeStudyFilter({ states: studyFilterStates });
    if (filterState) detailParts.push(`Study filter: ${filterState}`);

    return {
      kind: adapter?.kind || 'kanji',
      count: keys.size,
      keys: Array.from(keys),
      detail: detailParts.join(' • '),
    };
  }

  // Controls: header owns primary collection actions; pass callbacks so it can render and handle them
  const controls = createViewHeaderTools({ createControls: true,
    
    onShuffle: () => {
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      store.collections.shuffleCollection(coll.key);
      updateStudyLabel();
      markStudyRows();
    },
    onClearShuffle: () => {
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      store.collections.clearCollectionShuffle(coll.key);
      updateStudyLabel();
      markStudyRows();
    },
    onClearLearned: async () => {
      const stats = getClearLearnedStats();
      const n = Math.max(0, Math.round(Number(stats?.count) || 0));
      if (!n) return;

      const unit = (stats?.kind === 'grammar') ? 'pattern' : 'item';
      const unitPlural = `${unit}s`;

      const ok = await confirmDialog({
        title: 'Clear learned?',
        message: `Remove Learned flags for ${n} ${n === 1 ? unit : unitPlural}?`,
        detail: String(stats?.detail || '').trim(),
        confirmText: 'Clear Learned',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      try {
        const keys = Array.isArray(stats?.keys) ? stats.keys : [];
        const adapter = getProgressAdapter();
        if (adapter?.kind === 'grammar') {
          if (typeof store?.grammarProgress?.clearLearnedGrammarForKeys === 'function') {
            const coll = store?.collections?.getActiveCollection?.();
            store.grammarProgress.clearLearnedGrammarForKeys(keys, { collectionKey: coll?.key });
          }
        } else {
          if (typeof store?.kanjiProgress?.clearLearnedKanjiForValues === 'function') {
            const coll = store?.collections?.getActiveCollection?.();
            store.kanjiProgress.clearLearnedKanjiForValues(keys, { collectionKey: coll?.key });
          }
        }
      } catch (e) {}
      try {
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
      } catch (e) {}
    }
  });

  // append the study filter selector after the header-controlled buttons
  const studyFilterGroup = document.createElement('div');
  studyFilterGroup.className = 'data-expansion-group study-filter-group';
  studyFilterGroup.id = 'study-filter-group';
  studyFilterGroup.setAttribute('data-control', 'study-filter');
  studyFilterGroup.setAttribute('aria-label', 'Study filter selector group');
  const studyFilterControlMount = document.createElement('div');
  studyFilterControlMount.className = 'study-filter-control';
  const studyFilterCaption = document.createElement('div');
  studyFilterCaption.className = 'data-expansion-caption';
  studyFilterCaption.textContent = 'col.study-filter';
  studyFilterGroup.append(studyFilterControlMount, studyFilterCaption);
  controls.append(studyFilterGroup);

  function renderStudyFilterControl() {
    studyFilterControlMount.innerHTML = '';
    const dd = createDropdown({
      items: STUDY_FILTER_ITEMS,
      multi: true,
      values: orderStudyStates(studyFilterStates),
      commitOnClose: true,
      getButtonLabel: ({ selectedValues }) => formatStudyFilterButtonLabel(selectedValues),
      onChange: (vals) => {
        studyFilterStates = orderStudyStates(normalizeStudyFilterStates(vals));
        persistFilters();
        renderTable();
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
      },
      className: 'data-expansion-dropdown',
    });
    studyFilterControlMount.append(dd);
  }

  // Adjective expansion dropdowns (persisted per-collection)
  const expansionWrap = document.createElement('div');
  expansionWrap.className = 'data-expansion-tools';
  controls.append(expansionWrap);

  function renderExpansionControls() {
    expansionWrap.innerHTML = '';
    const hasI = collectionHasAdjectiveKind('i');
    const hasNa = collectionHasAdjectiveKind('na');

    const iGroup = document.createElement('div');
    iGroup.className = 'data-expansion-group';
    if (!hasI) iGroup.style.display = 'none';
    const iDd = createDropdown({
      items: I_ADJ_FORM_ITEMS,
      multi: true,
      values: expansionIForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        expansionIForms = orderFormsByItems(normalizeFormList(vals), I_ADJ_BASE_FORM_ITEMS);
        persistAdjectiveExpansions();
      },
      className: 'data-expansion-dropdown',
    });
    const iCaption = document.createElement('div');
    iCaption.className = 'data-expansion-caption';
    iCaption.textContent = 'i-adj';
    iGroup.append(iDd, iCaption);

    const naGroup = document.createElement('div');
    naGroup.className = 'data-expansion-group';
    if (!hasNa) naGroup.style.display = 'none';
    const naDd = createDropdown({
      items: NA_ADJ_FORM_ITEMS,
      multi: true,
      values: expansionNaForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        expansionNaForms = orderFormsByItems(normalizeFormList(vals), NA_ADJ_BASE_FORM_ITEMS);
        persistAdjectiveExpansions();
      },
      className: 'data-expansion-dropdown',
    });
    const naCaption = document.createElement('div');
    naCaption.className = 'data-expansion-caption';
    naCaption.textContent = 'na-adj';
    naGroup.append(naDd, naCaption);

    expansionWrap.append(iGroup, naGroup);
  }

  // studyLabel element is owned by the header controls when createControls=true
  let studyLabel = null;
  root.appendChild(controls);
  
  if (!active) {
    const emptyCard = card({
      id: 'data-card',
      children: [el('p', { className: 'hint', text: 'No active collection.' })]
    });
    root.append(emptyCard);
    return root;
  }

  // Load persisted filter toggles from collection state.
  try {
    const saved = readCollState();
    if (typeof saved?.studyFilter === 'string') {
      const parsed = parseStudyFilter(saved.studyFilter);
      studyFilterStates = orderStudyStates(parsed.states);
    } else {
      // Legacy booleans
      const skipLearned = !!saved?.skipLearned;
      const focusOnly = !!saved?.focusOnly;
      if (focusOnly) studyFilterStates = ['focus'];
      else if (skipLearned) studyFilterStates = ['null', 'focus'];
      else studyFilterStates = STUDY_STATE_ORDER.slice();
    }

    const held = String(saved?.heldTableSearch || '').trim();
    heldTableSearch = held;

    // If a heldTableSearch is provided via the route query, prefer and apply it.
    try {
      const { query } = parseHashRoute(location.hash);
      const fromQuery = String(query.get('heldTableSearch') || '').trim();
      if (fromQuery) {
        heldTableSearch = fromQuery;
        try { persistHeldTableSearch({ query: heldTableSearch }); } catch (e) {}
        // remove the heldTableSearch param from the URL so it doesn't persist across navigation
        try {
          const fullRoute = parseHashRoute(location.hash);
          fullRoute.query.delete('heldTableSearch');
          const newHash = buildHashRoute({ pathname: fullRoute.pathname, query: fullRoute.query });
          const newUrl = window.location.pathname + window.location.search + (newHash.startsWith('#') ? newHash : `#${newHash}`);
          history.replaceState(null, '', newUrl);
        } catch (e) {}
      }
    } catch (e) {}

    savedTableSearches = normalizeSavedSearchList(
      saved?.savedTableSearches ?? saved?.saved_table_searches ?? saved?.savedTableSearch ?? saved?.savedFiltersTableSearch ?? []
    );

    expansionIForms = normalizeFormList(saved?.expansion_i ?? saved?.expansion_iAdj ?? []);
    expansionNaForms = normalizeFormList(saved?.expansion_na ?? saved?.expansion_naAdj ?? []);

    // If the "true" active collection has no matching adjective types,
    // hide the control and delete the persisted setting to avoid future issues.
    const hasI = collectionHasAdjectiveKind('i');
    const hasNa = collectionHasAdjectiveKind('na');
    if (!hasI) {
      expansionIForms = [];
      if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_i')) {
        deleteExpansionSettingIfPresent(['expansion_i', 'expansion_iAdj', 'expansion_i_adjective']);
      }
    }
    if (!hasNa) {
      expansionNaForms = [];
      if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_na')) {
        deleteExpansionSettingIfPresent(['expansion_na', 'expansion_naAdj', 'expansion_na_adjective']);
      }
    }
  } catch (e) {
    // ignore
  }

  renderStudyFilterControl();
  renderExpansionControls();

  // Helpers to read/save per-collection state
  function readCollState() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return null;
    if (typeof store?.collections?.loadCollectionState === 'function') return store.collections.loadCollectionState(coll.key) || {};
    return {};
  }

  function writeCollState(patch) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    if (typeof store?.collections?.saveCollectionState === 'function') return store.collections.saveCollectionState(coll.key, patch);
  }

  function getEntryKanjiValue(entry) {
    return store.collections.getEntryStudyKey(entry);
  }

  function getEntryGrammarKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const v = entry.pattern;
    return (typeof v === 'string') ? v.trim() : '';
  }

  function getProgressAdapter() {
    const coll = (store?.collections && typeof store.collections.getActiveCollection === 'function')
      ? store.collections.getActiveCollection()
      : active;

    const category = String(coll?.metadata?.category || '').trim();
    const isGrammar = category === 'japanese.grammar' || category.endsWith('.grammar') || category.includes('.grammar.');

    if (isGrammar && store?.grammarProgress) {
      return {
        kind: 'grammar',
        getKey: (entry) => getEntryGrammarKey(entry),
        isLearned: (key) => !!(key && typeof store?.grammarProgress?.isGrammarLearned === 'function' && store.grammarProgress.isGrammarLearned(key, { collectionKey: coll?.key })),
        isFocus: (key) => !!(key && typeof store?.grammarProgress?.isGrammarFocus === 'function' && store.grammarProgress.isGrammarFocus(key, { collectionKey: coll?.key })),
        getProgressRecord: (key) => {
          try {
            if (!key) return null;
            if (typeof store?.grammarProgress?.getGrammarProgressRecord !== 'function') return null;
            return store.grammarProgress.getGrammarProgressRecord(key, { collectionKey: coll?.key }) || null;
          } catch (e) {
            return null;
          }
        },
        getStudyMetrics: (key) => {
          const rec = (key && typeof store?.grammarProgress?.getGrammarProgressRecord === 'function')
            ? (store.grammarProgress.getGrammarProgressRecord(key, { collectionKey: coll?.key }) || {})
            : {};
          const timesSeen = Math.max(0, Math.round(Number(rec?.timesSeen) || 0));
          const timeMs = Math.max(0, Math.round(Number(rec?.timeMs) || 0));
          const seen = !!rec?.seen || timesSeen > 0 || timeMs > 0;
          return { seen, timesSeen, timeMs };
        },
        clearLearned: () => {
          try {
            if (typeof store?.grammarProgress?.clearLearnedGrammar === 'function') store.grammarProgress.clearLearnedGrammar();
          } catch (e) {}
        },
      };
    }

    return {
      kind: 'kanji',
      getKey: (entry) => getEntryKanjiValue(entry),
      isLearned: (key) => !!(key && typeof store?.kanjiProgress?.isKanjiLearned === 'function' && store.kanjiProgress.isKanjiLearned(key, { collectionKey: coll?.key })),
      isFocus: (key) => !!(key && typeof store?.kanjiProgress?.isKanjiFocus === 'function' && store.kanjiProgress.isKanjiFocus(key, { collectionKey: coll?.key })),
      getProgressRecord: (key) => {
        try {
          if (!key) return null;
          if (typeof store?.kanjiProgress?.getKanjiProgressRecord !== 'function') return null;
          return store.kanjiProgress.getKanjiProgressRecord(key, { collectionKey: coll?.key }) || null;
        } catch (e) {
          return null;
        }
      },
      getStudyMetrics: (key) => {
        const rec = (key && typeof store?.kanjiProgress?.getKanjiProgressRecord === 'function')
          ? (store.kanjiProgress.getKanjiProgressRecord(key, { collectionKey: coll?.key }) || {})
          : {};
        const timesSeen = Math.max(0, Math.round(Number(rec?.timesSeen) || 0));
        const timeMs = Math.max(0, Math.round(Number(rec?.timeMs) || 0));
        const seen = !!rec?.seen || timesSeen > 0 || timeMs > 0;
        return { seen, timesSeen, timeMs };
      },
      clearLearned: () => {
        try {
          const coll = store?.collections?.getActiveCollection?.();
          store.collections.clearLearnedForCollection(coll?.key);
        } catch (e) {
          // ignore
        }
      },
    };
  }

  function passesFilters(entry) {
    const adapter = getProgressAdapter();
    const allowed = new Set(orderStudyStates(studyFilterStates));
    const state = getEntryStudyState(entry, adapter);
    if (!allowed.has(state)) return false;

    if (heldTableSearch) {
      try {
        if (!entryMatchesHeldTableSearch(entry, { query: heldTableSearch, adapter })) return false;
      } catch (e) {
        // ignore
      }
    }
    return true;
  }

  function buildTableSearchAccessorForEntry(entry, adapter) {
    const a = adapter || getProgressAdapter();
    const key = a.getKey(entry);
    const state = getEntryStudyState(entry, a);
    const metrics = (typeof a.getStudyMetrics === 'function')
      ? a.getStudyMetrics(key)
      : { seen: false, timesSeen: 0, timeMs: 0 };
    const relatedDynamic = {};
    for (const rel of relatedCollectionConfigs) {
      relatedDynamic[`${rel.name}.count`] = getRelatedCountForEntry(entry, rel.name);
    }

    const dynamicFieldValues = {
      status: state,
      studySeen: !!metrics.seen,
      studyTimesSeen: Math.max(0, Math.round(Number(metrics.timesSeen) || 0)),
      studyTimeMs: Math.max(0, Math.round(Number(metrics.timeMs) || 0)),
      ...relatedDynamic,
    };

    const metadataKeys = (Array.isArray(fields) ? fields : []).map(f => String(f?.key || '').trim()).filter(Boolean);
    const dynamicKeys = ['status', 'studySeen', 'studyTimesSeen', 'studyTimeMs', ...relatedCountColumns.map(c => c.key)];

    return {
      hasField: (k) => {
        const keyName = String(k || '').trim();
        if (!keyName) return false;
        if (Object.prototype.hasOwnProperty.call(dynamicFieldValues, keyName)) return true;
        return Object.prototype.hasOwnProperty.call(entry || {}, keyName);
      },
      getValue: (k) => {
        const keyName = String(k || '').trim();
        if (!keyName) return undefined;
        if (Object.prototype.hasOwnProperty.call(dynamicFieldValues, keyName)) return dynamicFieldValues[keyName];
        return entry ? entry[keyName] : undefined;
      },
      getFieldType: (k) => {
        const keyName = String(k || '').trim();
        if (keyName === 'studySeen') return 'boolean';
        if (keyName === 'studyTimesSeen' || keyName === 'studyTimeMs' || relatedCountColumns.some(c => c.key === keyName)) return 'number';
        const def = (Array.isArray(fields) ? fields : []).find(f => String(f?.key || '').trim() === keyName);
        return def?.type ?? (def?.schema && def.schema.type) ?? null;
      },
      getAllValues: () => {
        const out = [];
        for (const mk of metadataKeys) out.push(entry ? entry[mk] : undefined);
        for (const dk of dynamicKeys) out.push(dynamicFieldValues[dk]);
        return out;
      },
    };
  }

  function entryMatchesHeldTableSearch(entry, { query = '', adapter = null } = {}) {
    const q = String(query || '').trim();
    if (!q) return true;
    const compiled = compileTableSearchQuery(q);
    const fieldsMeta = [
      { key: 'status', type: null },
      ...(Array.isArray(fields) ? fields.map(f => ({ key: f.key, type: f.type ?? (f.schema && f.schema.type) ?? null })) : []),
      ...relatedCountColumns.map(c => ({ key: c.key, type: 'number' })),
      { key: 'studySeen', type: 'boolean' },
      { key: 'studyTimesSeen', type: 'number' },
      { key: 'studyTimeMs', type: 'number' },
    ];
    const accessor = buildTableSearchAccessorForEntry(entry, adapter || getProgressAdapter());
    return matchesTableSearch(accessor, compiled, { fields: fieldsMeta });
  }

  function updateFilterButtons() {
    renderStudyFilterControl();
  }

  function persistFilters() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    store.collections.setStudyFilter(coll.key, { states: orderStudyStates(studyFilterStates) });
  }

  function persistHeldTableSearch({ query }) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    // Persist only the held query; system always applies the held query.
    store.collections.saveCollectionState(coll.key, { heldTableSearch: String(query || '') });
  }

  function persistSavedTableSearches(nextList) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    const list = normalizeSavedSearchList(nextList);
    if (!list.length) {
      try {
        if (typeof store?.collections?.deleteCollectionStateKeys === 'function') {
          store.collections.deleteCollectionStateKeys(coll.key, ['savedTableSearches', 'saved_table_searches', 'savedTableSearch', 'savedFiltersTableSearch']);
        } else {
          store.collections.saveCollectionState(coll.key, { savedTableSearches: [] });
        }
      } catch (e) {
        // ignore
      }
      savedTableSearches = [];
      return;
    }

    savedTableSearches = list;
    store.collections.saveCollectionState(coll.key, { savedTableSearches: list });
  }

  function persistAdjectiveExpansions() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    store.collections.setAdjectiveExpansionForms(coll.key, { iForms: expansionIForms, naForms: expansionNaForms });
  }

  // pruneStudyIndicesToFilters removed — studyIndices/studyStart no longer used.

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  let baseEntries = Array.isArray(active.entries) ? active.entries.slice() : [];
  let allEntriesView = store.collections.expandEntriesByAdjectiveForm(baseEntries, { iForms: expansionIForms, naForms: expansionNaForms });
  let rowToOriginalIndex = [];

  // Background: request entries augmented with related collection counts/samples.
  Promise.resolve().then(async () => {
    try {
      if (!active?.key) return;
      if (store?.collections && typeof store.collections.getCollectionEntriesWithRelated === 'function') {
        const augmented = await store.collections.getCollectionEntriesWithRelated(active.key, { sample: 2 });
        if (Array.isArray(augmented) && augmented.length) {
          baseEntries = augmented.slice();
          allEntriesView = store.collections.expandEntriesByAdjectiveForm(baseEntries, { iForms: expansionIForms, naForms: expansionNaForms });
          try { renderExpansionControls(); } catch (e) {}
          try { renderTable(); } catch (e) {}
          try { markStudyRows(); } catch (e) {}
          try { updateStudyLabel(); } catch (e) {}
          try { updateControlStates(); } catch (e) {}
        }
      }
    } catch (e) {
      // ignore
    }
  });

  function refreshEntriesView() {
    allEntriesView = store.collections.expandEntriesByAdjectiveForm(baseEntries, { iForms: expansionIForms, naForms: expansionNaForms });
    return allEntriesView;
  }

  function getVisibleOriginalIndices() {
    const out = [];
    const entriesView = refreshEntriesView();
    for (let i = 0; i < entriesView.length; i++) {
      if (passesFilters(entriesView[i])) out.push(i);
    }
    return out;
  }

  const tableMount = document.createElement('div');
  tableMount.id = 'data-table-mount';

  // primary header controls are handled by header component callbacks (see createViewHeaderTools)

  // Remove shuffle button for this view and prepare control state updates
  const headerBtns = (typeof controls.getButtons === 'function') ? controls.getButtons() : null;
  if (headerBtns && headerBtns.shuffleBtn && headerBtns.shuffleBtn.parentNode) {
    headerBtns.shuffleBtn.parentNode.removeChild(headerBtns.shuffleBtn);
    // also remove reference to avoid accidental use
    delete headerBtns.shuffleBtn;
  }

  function updateControlStates() {
    try {
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      const saved = readCollState() || {};
      const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
      // clearShuffle disabled if not shuffled
      const isShuffled = !!saved.isShuffled;
      if (headerBtns && headerBtns.clearShuffleBtn) headerBtns.clearShuffleBtn.disabled = !isShuffled;
      // clearLearned disabled if no learned items in the CURRENT filtered results
      const stats = getClearLearnedStats();
      if (headerBtns && headerBtns.clearLearnedBtn) headerBtns.clearLearnedBtn.disabled = !(stats && stats.count > 0);
      // no study subset controls remain; nothing to do here
    } catch (e) {
      // ignore
    }
  }

  function updateStudyLabel() {
    const coll = store.collections.getActiveCollection();
    if (!coll) {
      // no study label in header tools
      updateControlStates();
      return;
    }
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    if (n === 0) { updateControlStates(); return; }
    // header tools no longer show study label; control state will reflect available actions
    updateControlStates();
  }

  // Build table headers from fields (preserve schema `key` and `label` separately)
  const headers = [
    { key: 'status', label: '' },
    ...fields.map(f => ({
    key: f.key,
    label: f.label || f.key,
    type: f.type ?? (f.schema && f.schema.type) ?? null,
  })),
    ...relatedCountColumns.map(c => ({ key: c.key, label: c.label, type: 'number' })),
    { key: 'studySeen', label: 'Seen', type: 'boolean' },
    { key: 'studyTimesSeen', label: 'Times Seen', type: 'number' },
    { key: 'studyTimeMs', label: 'Time (ms)', type: 'number' },
  ];

  function renderTable() {
    const visibleIdxs = getVisibleOriginalIndices();
    rowToOriginalIndex = visibleIdxs.slice();
    const entriesView = refreshEntriesView();
    const visibleEntries = visibleIdxs.map(i => entriesView[i]);

    const adapter = getProgressAdapter();
    const rows = visibleEntries.map((entry, i) => {
      const originalIndex = visibleIdxs[i];
      const key = adapter.getKey(entry);
      const learned = adapter.isLearned(key);
      const focus = adapter.isFocus(key);
      const metrics = (typeof adapter.getStudyMetrics === 'function')
        ? adapter.getStudyMetrics(key)
        : { seen: false, timesSeen: 0, timeMs: 0 };

      const icon = document.createElement('span');
      icon.className = 'kanji-status-icon';
      if (learned) {
        icon.textContent = '✓';
        icon.classList.add('learned');
        icon.title = 'Learned';
      } else if (focus) {
        icon.textContent = '🎯';
        icon.classList.add('focus');
        icon.title = 'More practice';
      } else {
        icon.textContent = '';
        icon.title = '';
      }

      const relatedCountCells = relatedCollectionConfigs.map(rel => {
        const el = document.createElement('span');
        el.className = 'related-count-cell';
        const count = getRelatedCountForEntry(entry, rel.name);
        el.textContent = count > 0 ? String(count) : '';
        return el;
      });

      const seenCell = document.createElement('span');
      seenCell.className = 'study-seen-cell';
      seenCell.dataset.searchValue = metrics.seen ? 'true' : 'false';
      seenCell.textContent = metrics.seen ? '✓' : '';
      seenCell.title = metrics.seen ? 'true' : 'false';
      const timesSeenCell = metrics.timesSeen > 0 ? metrics.timesSeen : '';
      const timeMsCell = metrics.timeMs > 0 ? metrics.timeMs : '';

      const row = [icon, ...fields.map(f => entry[f.key] ?? ''), ...relatedCountCells, seenCell, timesSeenCell, timeMsCell];
      // Stable identifier for this row so we can resolve the source entry
      // even after the table component filters/sorts.
      try { row.__id = String(originalIndex); } catch (e) {}
      return row;
    });

    // Preserve previous sort state when recreating the table (so applying held search doesn't lose sort)
    let initialSortKey = null;
    let initialSortDir = 'asc';
    try {
      const existing = tableMount.querySelector('table');
      if (existing) {
        const thSorted = existing.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]');
        if (thSorted && thSorted.dataset && thSorted.dataset.field) {
          initialSortKey = String(thSorted.dataset.field || '') || null;
          initialSortDir = thSorted.getAttribute('aria-sort') === 'descending' ? 'desc' : 'asc';
        }
      }
    } catch (e) {}

    const tbl = createTable({
      store,
      headers,
      rows,
      id: 'data-table',
      collection: active?.key || null,
      sourceMetadata: active?.metadata || null,
      sortable: true,
      searchable: true,
      initialSortKey,
      initialSortDir,
    });
    tableMount.innerHTML = '';
    tableMount.append(tbl);

    // Insert Hold Filter switch next to Copy JSON.
    try {
      const wrapper = tableMount.querySelector('.table-wrapper');
      const searchWrap = wrapper ? wrapper.querySelector('.table-search') : null;
      const searchInput = searchWrap ? searchWrap.querySelector('.table-search-input') : null;
      const clearBtn = searchWrap ? searchWrap.querySelector('.table-search-clear') : null;
      const copyBtn = searchWrap ? searchWrap.querySelector('.table-copy-json') : null;
      if (searchWrap && searchInput && copyBtn) {
        // NOTE (intentional UX): Data View has a two-layer search.
        // 1) The table component always supports a fast, local ("dumb") search while typing.
        //    This only filters the currently-rendered rows and is not persisted.
        // 2) When the user explicitly applies the search (Enter / Clear / pick saved filter),
        //    Data View persists it as `heldTableSearch` and re-renders by filtering the
        //    underlying collection entries (domain-aware via collectionsManager helpers).
        // This is desired: you can keep a persisted held filter while still doing ad-hoc
        // local filtering of the currently visible results.
        function applyHeldSearch(q) {
          const query = String(q || '').trim();
          heldTableSearch = query;
          persistHeldTableSearch({ query });
          renderTable();
          updateStudyLabel();
          markStudyRows();
          updateControlStates();
        }

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'table-save-filter btn small';
        saveBtn.title = 'Save this search filter for quick reuse';
        saveBtn.textContent = 'Save Filter';

        // Insert after Copy JSON
        if (!searchWrap.querySelector('.table-save-filter')) {
          copyBtn.insertAdjacentElement('afterend', saveBtn);
        }

        function updateSavedFilterButtons(q) {
          const query = String(q || '').trim();
          const has = !!query;
          const saved = has && isSavedTableSearch(query);
          saveBtn.disabled = !has || saved;
        }

        // Saved filter combobox UI (input + attached arrow + popover list)
        const comboboxClass = 'table-search-combobox';
        const toggleClass = 'table-search-saved-toggle';
        const menuClass = 'table-search-saved-menu';

        function ensureComboboxWrapper() {
          const existing = searchWrap.querySelector(`.${comboboxClass}`);
          if (existing && existing.contains(searchInput)) return existing;

          const wrap = document.createElement('div');
          wrap.className = comboboxClass;
          // Replace input position with wrapper containing the input
          searchWrap.insertBefore(wrap, searchInput);
          wrap.appendChild(searchInput);
          return wrap;
        }

        const comboWrap = ensureComboboxWrapper();

        function closeSavedMenu() {
          try { comboWrap.classList.remove('open'); } catch (e) {}
        }

        function isSavedMenuOpen() {
          try { return comboWrap.classList.contains('open'); } catch (e) { return false; }
        }

        function renderSavedMenu() {
          let menu = comboWrap.querySelector(`.${menuClass}`);
          if (!menu) {
            menu = document.createElement('div');
            menu.className = menuClass;
            comboWrap.appendChild(menu);
          }
          menu.innerHTML = '';

          const list = Array.isArray(savedTableSearches) ? savedTableSearches : [];
          if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'table-search-saved-empty';
            empty.textContent = '(no saved filters)';
            menu.appendChild(empty);
            return;
          }

          for (const s of list) {
            const v = String(s || '').trim();
            if (!v) continue;
            const row = document.createElement('div');
            row.className = 'table-search-saved-item';
            row.tabIndex = 0;

            const label = document.createElement('span');
            label.className = 'table-search-saved-label';
            label.textContent = v;

            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'table-saved-filter-x';
            x.textContent = '×';
            x.title = 'Delete saved filter';
            x.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const next = (Array.isArray(savedTableSearches) ? savedTableSearches : []).filter(x => String(x || '').trim() !== v);
              persistSavedTableSearches(next);
              updateSavedFilterButtons(searchInput.value);
              renderSavedMenu();
              renderTable();
              updateStudyLabel();
              markStudyRows();
              updateControlStates();
            });

            row.addEventListener('click', () => {
              try {
                searchInput.value = v;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              } catch (e) {}
              closeSavedMenu();
              applyHeldSearch(v);
              try { searchInput.focus(); } catch (e) {}
            });

            row.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                row.click();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSavedMenu();
                try { searchInput.focus(); } catch (e) {}
              }
            });

            row.append(label, x);
            menu.appendChild(row);
          }
        }

        let toggleBtn = comboWrap.querySelector(`button.${toggleClass}`);
        if (!toggleBtn) {
          toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = toggleClass;
          toggleBtn.title = 'Saved filters';
          toggleBtn.setAttribute('aria-label', 'Saved filters');
          toggleBtn.textContent = '▾';
          comboWrap.appendChild(toggleBtn);
        }

        renderSavedMenu();

        toggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const willOpen = !isSavedMenuOpen();
          if (willOpen) {
            renderSavedMenu();
            comboWrap.classList.add('open');
          } else {
            closeSavedMenu();
          }
        });

        // Close on outside click (scoped per-render; avoids global component complexity)
        setTimeout(() => {
          const onDocClick = (e) => {
            if (!comboWrap.isConnected) {
              document.removeEventListener('click', onDocClick);
              return;
            }
            if (comboWrap.contains(e.target)) return;
            closeSavedMenu();
          };
          document.addEventListener('click', onDocClick);
        }, 0);

        // If a held query exists, initialize the table search with it.
        if (heldTableSearch) {
          searchInput.value = heldTableSearch;
          try { searchInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        }

        updateSavedFilterButtons(searchInput.value);

        // Update save/delete button states while typing.
        searchInput.addEventListener('input', () => {
          try { updateSavedFilterButtons(searchInput.value); } catch (e) {}
        });

        // Persist held query when the table explicitly applies it (Enter/Clear).
        wrapper.addEventListener('table:searchApplied', (e) => {
          const q = String(e?.detail?.query ?? searchInput.value ?? '').trim();
          try { updateSavedFilterButtons(q); } catch (e) {}
          if (q === String(heldTableSearch || '').trim()) return;
          applyHeldSearch(q);
        });

        saveBtn.addEventListener('click', () => {
          const q = String(searchInput.value || '').trim();
          if (!q) return;
          if (isSavedTableSearch(q)) {
            updateSavedFilterButtons(q);
            return;
          }
          heldTableSearch = q;
          try { persistHeldTableSearch({ query: q }); } catch (e) {}
          persistSavedTableSearches([...(savedTableSearches || []), q]);
          updateSavedFilterButtons(q);
          renderTable();
          updateStudyLabel();
          markStudyRows();
          updateControlStates();
          try {
            const prev = saveBtn.textContent;
            saveBtn.textContent = 'Saved';
            setTimeout(() => { try { saveBtn.textContent = prev; } catch (e) {} }, 1200);
          } catch (e) {}
        });
      }
    } catch (e) {
      // ignore
    }

    // Update corner caption if present.
    // Show the *persisted* (held) filter, not the table's ephemeral local filter.
    try {
      const corner = root.querySelector('#data-card .card-corner-caption');
      if (corner) {
        const total = entriesView.length;
        const visible = visibleIdxs.length;
        const base = (visible < total) ? `${visible}/${total} Entries` : `${total} Entries`;

        // Architecture note: treat collection state as the source of truth for held filters.
        // Data View keeps a local copy (`heldTableSearch`) in sync for fast filtering.
        const saved = readCollState() || {};
        const held = String(saved?.heldTableSearch ?? heldTableSearch ?? '').trim();

        const parts = [base];
        const titleParts = [];

        if (held) {
          const max = 28;
          const short = (held.length > max) ? `${held.slice(0, max - 1)}…` : held;
          parts.push(`filter: ${short}`);
          titleParts.push(`Held filter: ${held}`);
        }

        // Ask CollectionsManager for expansion deltas so UI doesn't need to re-derive them.
        // IMPORTANT: these deltas should be based on the held-filtered base entries (pre-expansion),
        // so the numbers reflect the currently-held Data View dataset.
        try {
          let baseForDelta = baseEntries;
          try {
            const adapter = getProgressAdapter();
            const filtered = [];
            for (const entry of (Array.isArray(baseEntries) ? baseEntries : [])) {
              if (!entry || typeof entry !== 'object') continue;

              // Apply study state filter (these are part of the held view state)
              try {
                const allowed = new Set(orderStudyStates(studyFilterStates));
                const state = getEntryStudyState(entry, adapter);
                if (!allowed.has(state)) continue;
              } catch (e) {}

              // Apply held table search to base entries
              if (held) {
                try {
                  if (!entryMatchesHeldTableSearch(entry, { query: held, adapter })) continue;
                } catch (e) {}
              }

              filtered.push(entry);
            }
            baseForDelta = filtered;
          } catch (e) {
            baseForDelta = baseEntries;
          }

          const stats = (typeof store?.collections?.getAdjectiveExpansionDeltas === 'function')
            ? store.collections.getAdjectiveExpansionDeltas(baseForDelta, { iForms: expansionIForms, naForms: expansionNaForms })
            : null;
          const iDelta = Math.max(0, Math.round(Number(stats?.iDelta) || 0));
          const naDelta = Math.max(0, Math.round(Number(stats?.naDelta) || 0));
          if (iDelta) parts.push(`+${iDelta} i-adj`);
          if (naDelta) parts.push(`+${naDelta} na-adj`);
          if (iDelta || naDelta) titleParts.push(`Expansion delta: +${iDelta} i-adj, +${naDelta} na-adj`);
        } catch (e) {
          // ignore
        }

        corner.textContent = parts.join(' • ');
        corner.title = titleParts.join('\n');
      }
    } catch (e) {
      // ignore
    }
  }

  // Highlight rows that are part of the current study subset
  function markStudyRows() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    // Only update learned/focus icons; study subset highlighting removed.

    const adapter = getProgressAdapter();

    const wrapperEl = tableMount;
    const tbl = wrapperEl.querySelector('table');
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if (!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach((tr, rowIndex) => {
      // Update learned/focus icon in the leftmost column.
      try {
        const rowId = tr?.dataset?.rowId;
        const parsed = (rowId != null && rowId !== '' && !Number.isNaN(Number(rowId))) ? Number(rowId) : null;
        const originalIndex = (typeof parsed === 'number') ? parsed : rowToOriginalIndex[rowIndex];
        const entriesView = refreshEntriesView();
        const entry = (typeof originalIndex === 'number') ? entriesView[originalIndex] : null;
        const key = adapter.getKey(entry);
        const learned = adapter.isLearned(key);
        const focus = adapter.isFocus(key);

        const firstCell = tr.querySelector('td');
        const icon = firstCell ? firstCell.querySelector('.kanji-status-icon') : null;
        if (icon) {
          icon.classList.remove('learned', 'focus');
          if (learned) {
            icon.textContent = '✓';
            icon.classList.add('learned');
            icon.title = 'Learned';
          } else if (focus) {
            icon.textContent = '🎯';
            icon.classList.add('focus');
            icon.title = 'More practice';
          } else {
            icon.textContent = '';
            icon.title = '';
          }
        }
      } catch (e) {
        // ignore
      }

      // no study subset highlighting to update
    });
  }

  // initial label + marking
  // (initial render will occur after the data card is created and mounted)

  // Subscribe to store changes and update markings when session state changes
  let unsub = null;
  if (store && typeof store.subscribe === 'function') {
    try {
      unsub = store.subscribe(() => {
        // update label and highlighting when collection/session state changes
        try {
          const saved = readCollState();
          if (typeof saved?.studyFilter === 'string') {
            const parsed = parseStudyFilter(saved.studyFilter);
            studyFilterStates = orderStudyStates(parsed.states);
          } else {
            const skipLearned = !!saved?.skipLearned;
            const focusOnly = !!saved?.focusOnly;
            if (focusOnly) studyFilterStates = ['focus'];
            else if (skipLearned) studyFilterStates = ['null', 'focus'];
            else studyFilterStates = STUDY_STATE_ORDER.slice();
          }

          const held = String(saved?.heldTableSearch || '').trim();
          heldTableSearch = held;

          const nextSavedSearches = normalizeSavedSearchList(
            saved?.savedTableSearches ?? saved?.saved_table_searches ?? saved?.savedTableSearch ?? saved?.savedFiltersTableSearch ?? []
          );
          if (!sameStringArray(nextSavedSearches, savedTableSearches)) {
            savedTableSearches = nextSavedSearches;
          }

          const nextI = normalizeFormList(saved?.expansion_i ?? saved?.expansion_iAdj ?? []);
          const nextNa = normalizeFormList(saved?.expansion_na ?? saved?.expansion_naAdj ?? []);

          const hasI = collectionHasAdjectiveKind('i');
          const hasNa = collectionHasAdjectiveKind('na');
          const cleanedI = hasI ? nextI : [];
          const cleanedNa = hasNa ? nextNa : [];

          // If settings exist for a kind the collection doesn't contain, delete them.
          if (!hasI && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_i')) {
            deleteExpansionSettingIfPresent(['expansion_i', 'expansion_iAdj', 'expansion_i_adjective']);
          }
          if (!hasNa && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_na')) {
            deleteExpansionSettingIfPresent(['expansion_na', 'expansion_naAdj', 'expansion_na_adjective']);
          }

          const changed = (!sameStringArray(cleanedI, expansionIForms)) || (!sameStringArray(cleanedNa, expansionNaForms));
          expansionIForms = cleanedI;
          expansionNaForms = cleanedNa;
          if (changed) renderExpansionControls();
        } catch (e) {
          // ignore
        }
        updateFilterButtons();
        renderTable();
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
      });
    } catch (e) { /* ignore */ }
  }

  // Cleanup subscription when this view is removed from DOM
  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      if (typeof unsub === 'function') unsub();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  const dataCard = card({
    id: 'data-card',
    cornerCaption: `${refreshEntriesView().length} Entries`,
    children: [tableMount]
  });

  // Show the full path to the currently displayed collection file.
  const pathLabel = active?.key ? `Path: ${active.key}` : 'Path: (unknown)';
  root.append(
    dataCard
  );
  // initial UI updates now that the card is mounted and corner caption exists
  updateFilterButtons();
  renderTable();
  updateStudyLabel();
  markStudyRows();
  updateControlStates();

  return root;
}
