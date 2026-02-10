import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { el } from '../components/ui.js';
import { createViewHeaderTools, createStudyFilterToggle } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';
import { confirmDialog } from '../components/confirmDialog.js';
import { parseHashRoute, buildHashRoute } from '../utils/helpers.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.collections.getActiveCollection();

  let skipLearned = false;
  let focusOnly = false;

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

  function parseStudyFilter(value) {
    const raw = String(value || '').trim();
    if (!raw) return { skipLearned: false, focusOnly: false };
    const parts = raw.split(/[,|\s]+/g).map(s => s.trim()).filter(Boolean);
    const set = new Set(parts);
    return {
      skipLearned: set.has('skipLearned') || set.has('skip_learned') || set.has('skip-learned'),
      focusOnly: set.has('focusOnly') || set.has('focus_only') || set.has('focus') || set.has('morePractice') || set.has('more_practice'),
    };
  }

  function serializeStudyFilter({ skipLearned, focusOnly }) {
    const parts = [];
    if (skipLearned) parts.push('skipLearned');
    if (focusOnly) parts.push('focusOnly');
    return parts.join(',');
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
    const filterState = skipLearned ? 'skipLearned' : (focusOnly ? 'focusOnly' : 'off');
    if (filterState !== 'off') detailParts.push(`Study filter: ${filterState}`);

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
            store.grammarProgress.clearLearnedGrammarForKeys(keys);
          }
        } else {
          if (typeof store?.kanjiProgress?.clearLearnedKanjiForValues === 'function') {
            store.kanjiProgress.clearLearnedKanjiForValues(keys);
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

  // three-state study filter toggle (off / skipLearned / focusOnly)
  const studyFilterToggle = createStudyFilterToggle({ state: 'off', onChange: (s) => {
    // update local state booleans based on new three-state value
    skipLearned = (s === 'skipLearned');
    focusOnly = (s === 'focusOnly');
    persistFilters();
    updateFilterButtons();
    renderTable();
    updateStudyLabel();
    markStudyRows();
  } });
  // append the study filter toggle after the header-controlled buttons
  const studyFilterGroup = document.createElement('div');
  studyFilterGroup.className = 'data-expansion-group';
  const studyFilterCaption = document.createElement('div');
  studyFilterCaption.className = 'data-expansion-caption';
  studyFilterCaption.textContent = 'col.study-filter';
  studyFilterGroup.append(studyFilterToggle.el, studyFilterCaption);
  controls.append(studyFilterGroup);

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
      skipLearned = !!parsed.skipLearned;
      focusOnly = !!parsed.focusOnly;
    } else {
      // Legacy booleans
      skipLearned = !!saved?.skipLearned;
      focusOnly = !!saved?.focusOnly;
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
        isLearned: (key) => !!(key && typeof store?.grammarProgress?.isGrammarLearned === 'function' && store.grammarProgress.isGrammarLearned(key)),
        isFocus: (key) => !!(key && typeof store?.grammarProgress?.isGrammarFocus === 'function' && store.grammarProgress.isGrammarFocus(key)),
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
      isLearned: (key) => !!(key && typeof store?.kanjiProgress?.isKanjiLearned === 'function' && store.kanjiProgress.isKanjiLearned(key)),
      isFocus: (key) => !!(key && typeof store?.kanjiProgress?.isKanjiFocus === 'function' && store.kanjiProgress.isKanjiFocus(key)),
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
    const key = adapter.getKey(entry);
    if (key) {
      if (skipLearned && adapter.isLearned(key)) return false;
      if (focusOnly && !adapter.isFocus(key)) return false;
    }

    if (heldTableSearch) {
      try {
        if (!store.collections.entryMatchesTableSearch(entry, { query: heldTableSearch, fields })) return false;
      } catch (e) {
        // ignore
      }
    }
    return true;
  }

  function updateFilterButtons() {
    const state = skipLearned ? 'skipLearned' : (focusOnly ? 'focusOnly' : 'off');
    if (studyFilterToggle && typeof studyFilterToggle.setState === 'function') studyFilterToggle.setState(state);
  }

  function persistFilters() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    store.collections.setStudyFilter(coll.key, { skipLearned: !!skipLearned, focusOnly: !!focusOnly });
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

  // Background: request entries augmented with example info so UI can show counts/samples.
  Promise.resolve().then(async () => {
    try {
      if (!active?.key) return;
      if (store?.collections && typeof store.collections.getCollectionEntriesWithExamples === 'function') {
        const augmented = await store.collections.getCollectionEntriesWithExamples(active.key, { sample: 2 });
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
    const saved = readCollState();
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    if (n === 0) { updateControlStates(); return; }
    // Show simplified study label: All or Filtered
    const raw = (saved && typeof saved.studyFilter === 'string') ? String(saved.studyFilter).trim() : '';
    // header tools no longer show study label; control state will reflect available actions
    updateControlStates();
  }

  // Build table headers from fields (preserve schema `key` and `label` separately)
  const headers = [{ key: 'status', label: '' }, ...fields.map(f => ({
    key: f.key,
    label: f.label || f.key,
    type: f.type ?? (f.schema && f.schema.type) ?? null,
  })), { key: 'examples', label: 'Examples' }];

  function renderTable() {
    const visibleIdxs = getVisibleOriginalIndices();
    rowToOriginalIndex = visibleIdxs.slice();
    const entriesView = refreshEntriesView();
    const visibleEntries = visibleIdxs.map(i => entriesView[i]);

    const adapter = getProgressAdapter();
    const currentActive = (store && store.collections && typeof store.collections.getActiveCollection === 'function') ? store.collections.getActiveCollection() : null;
    const showExamples = !!(currentActive && typeof currentActive.key === 'string' && String(currentActive.key).startsWith('japanese/words'));
    const rows = visibleEntries.map((entry, i) => {
      const originalIndex = visibleIdxs[i];
      const key = adapter.getKey(entry);
      const learned = adapter.isLearned(key);
      const focus = adapter.isFocus(key);

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

      const examplesCount = showExamples ? Number(entry.__examplesCount ?? (Array.isArray(entry.sentences) ? entry.sentences.length : 0)) || 0 : 0;
      const examplesEl = document.createElement('span');
      examplesEl.className = 'examples-cell';
      if (examplesCount) {
        examplesEl.textContent = String(examplesCount);
        const sample = Array.isArray(entry.__examplesSample) ? entry.__examplesSample : (Array.isArray(entry.sentences) ? entry.sentences.slice(0,2).map(s => ({ ja: s?.ja ?? null, en: s?.en ?? null })) : []);
        const tip = (Array.isArray(sample) ? sample.map(s => `${s.ja ?? ''}${s.en ? ' — ' + s.en : ''}`).join('\n') : '');
        if (tip) examplesEl.title = tip;
      } else {
        examplesEl.textContent = '';
      }

      const row = [icon, ...fields.map(f => entry[f.key] ?? ''), examplesEl];
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

    const tbl = createTable({ headers, rows, id: 'data-table', sortable: true, searchable: true, initialSortKey, initialSortDir });
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

              // Apply study filter toggles (these are part of the held view state)
              try {
                const key = adapter.getKey(entry);
                if (key) {
                  if (skipLearned && adapter.isLearned(key)) continue;
                  if (focusOnly && !adapter.isFocus(key)) continue;
                }
              } catch (e) {}

              // Apply held table search to base entries
              if (held) {
                try {
                  if (!store.collections.entryMatchesTableSearch(entry, { query: held, fields })) continue;
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
            skipLearned = !!parsed.skipLearned;
            focusOnly = !!parsed.focusOnly;
          } else {
            skipLearned = !!saved?.skipLearned;
            focusOnly = !!saved?.focusOnly;
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
