import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { el } from '../components/ui.js';
import { createViewHeaderTools, createStudyFilterToggle } from '../components/viewHeaderTools.js';
import { createDropdown } from '../components/dropdown.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.collections.getActiveCollection();

  let skipLearned = false;
  let focusOnly = false;

  // Persisted per-collection table search filter ("Hold Filter")
  let holdTableSearch = false;
  let heldTableSearch = '';

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
    if (selectedInOrder.length > 3) return `${selectedInOrder.length} selected`;

    const byValue = new Map(baseItems.map(it => [String(it?.value ?? ''), String(it?.right ?? it?.label ?? it?.value ?? '')]));
    return selectedInOrder.map(v => byValue.get(v) || v).join('\n');
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
    onClearLearned: () => {
      try {
        const adapter = getProgressAdapter();
        adapter.clearLearned();
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
  controls.append(studyFilterToggle.el);

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
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        expansionIForms = orderFormsByItems(normalizeFormList(vals), I_ADJ_BASE_FORM_ITEMS);
        persistAdjectiveExpansions();
        renderTable();
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
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
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        expansionNaForms = orderFormsByItems(normalizeFormList(vals), NA_ADJ_BASE_FORM_ITEMS);
        persistAdjectiveExpansions();
        renderTable();
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
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
    holdTableSearch = !!saved?.holdTableSearch;
    heldTableSearch = held;

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

    if (holdTableSearch && heldTableSearch) {
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

  function persistHeldTableSearch({ hold, query }) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    store.collections.setHeldTableSearch(coll.key, { hold: !!hold, query: String(query || '') });
  }

  function persistAdjectiveExpansions() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    store.collections.setAdjectiveExpansionForms(coll.key, { iForms: expansionIForms, naForms: expansionNaForms });
  }

  // pruneStudyIndicesToFilters removed — studyIndices/studyStart no longer used.

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  const baseEntries = Array.isArray(active.entries) ? active.entries : [];
  let allEntriesView = store.collections.expandEntriesByAdjectiveForm(baseEntries, { iForms: expansionIForms, naForms: expansionNaForms });
  let rowToOriginalIndex = [];

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
      // clearLearned disabled if no learned items in this collection
      const adapter = getProgressAdapter();
      let hasLearned = false;
      const entries = refreshEntriesView();
      for (const e of (Array.isArray(entries) ? entries : [])) {
        const key = adapter.getKey(e);
        if (key && adapter.isLearned(key)) { hasLearned = true; break; }
      }
      if (headerBtns && headerBtns.clearLearnedBtn) headerBtns.clearLearnedBtn.disabled = !hasLearned;
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

  // Build table headers from fields
  const headers = [{ key: 'status', label: '' }, ...fields.map(f => f.label || f.key)];

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

      const row = [icon, ...fields.map(f => entry[f.key] ?? '')];
      // Stable identifier for this row so we can resolve the source entry
      // even after the table component filters/sorts.
      try { row.__id = String(originalIndex); } catch (e) {}
      return row;
    });

    const tbl = createTable({ headers, rows, id: 'data-table', sortable: true, searchable: true });
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
        const holdLabel = document.createElement('label');
        holdLabel.className = 'table-hold-filter';
        const holdText = document.createElement('span');
        holdText.className = 'table-hold-filter-text';
        holdText.textContent = 'Hold Filter';

        const holdInput = document.createElement('input');
        holdInput.type = 'checkbox';
        holdInput.className = 'table-hold-filter-input';
        holdInput.setAttribute('role', 'switch');

        const holdUi = document.createElement('span');
        holdUi.className = 'table-hold-filter-ui';

        holdLabel.append(holdText, holdInput, holdUi);
        copyBtn.insertAdjacentElement('afterend', holdLabel);

        const syncUI = () => {
          holdInput.checked = !!holdTableSearch;
          holdLabel.title = holdTableSearch
            ? 'Hold Filter is On (saved for this collection)'
            : 'Hold Filter is Off (not saved)';
        };

        // Initialize input from persisted held filter.
        if (holdTableSearch && heldTableSearch) {
          searchInput.value = heldTableSearch;
          try { searchInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        }

        searchInput.addEventListener('input', () => {
          // no-op; the switch is independent of input
        });

        // When held, persist on blur/change so we don't rerender while typing.
        searchInput.addEventListener('change', () => {
          if (!holdTableSearch) return;
          const q = String(searchInput.value || '').trim();
          heldTableSearch = q;
          persistHeldTableSearch({ hold: true, query: q });
          renderTable();
          updateStudyLabel();
          markStudyRows();
        });

        // The table's Clear button sets input.value programmatically and applies its
        // own filter, but it does not trigger input/change events. If Hold Filter is
        // on, we must also clear the persisted held query immediately.
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            if (!holdTableSearch) return;
            // Defer so the table's handler runs first.
            setTimeout(() => {
              try {
                const q = String(searchInput.value || '').trim();
                heldTableSearch = q;
                persistHeldTableSearch({ hold: true, query: q });
              } catch (e) {}
              renderTable();
              updateStudyLabel();
              markStudyRows();
            }, 0);
          });
        }

        holdInput.addEventListener('change', () => {
          const next = !!holdInput.checked;
          holdTableSearch = next;
          const q = String(searchInput.value || '').trim();
          if (next) {
            heldTableSearch = q;
            persistHeldTableSearch({ hold: true, query: q });
          } else {
            // keep the last held query persisted so turning it back on restores it
            persistHeldTableSearch({ hold: false, query: heldTableSearch });
          }
          syncUI();
          renderTable();
          updateStudyLabel();
          markStudyRows();
        });

        syncUI();
      }
    } catch (e) {
      // ignore
    }

    // Update corner caption if present. Use visible count (filtered) so it stays correct
    try {
      const corner = root.querySelector('#data-card .card-corner-caption');
      if (corner) {
        const total = entriesView.length;
        const visible = visibleIdxs.length;
        corner.textContent = (visible < total) ? `${visible}/${total} Entries` : `${total} Entries`;
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
          holdTableSearch = !!saved?.holdTableSearch;
          heldTableSearch = held;

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

  // Collapsible metadata sections (each collapsible individually)
  const wrapper = el('div', { className: 'collection-metadata' });

  const collMetaDetails = el('details', {
    className: 'metadata-details',
    children: [
      el('summary', { text: 'Collection metadata' }),
      el('pre', { text: JSON.stringify(active.metadata || {}, null, 2) })
    ]
  });

  const folderMetaDetails = el('details', {
    className: 'folder-meta-details',
    children: [
      el('summary', { text: 'Inherited folder _metadata.json' }),
      el('pre', { id: 'folder-meta-pre', text: 'Loading...' })
    ]
  });

  wrapper.append(collMetaDetails, folderMetaDetails);

  // Load inherited folder metadata asynchronously via the store API
  if (store?.collections && typeof store.collections.getInheritedFolderMetadata === 'function') {
    store.collections.getInheritedFolderMetadata(active.key)
      .then(folderMeta => {
        const pre = wrapper.querySelector('#folder-meta-pre');
        if (pre) pre.textContent = folderMeta ? JSON.stringify(folderMeta, null, 2) : 'None';
      })
      .catch(() => {
        const pre = wrapper.querySelector('#folder-meta-pre');
        if (pre) pre.textContent = 'Error loading folder metadata';
      });
  } else {
    const pre = wrapper.querySelector('#folder-meta-pre');
    if (pre) pre.textContent = 'Unavailable';
  }

  const dataCard = card({
    id: 'data-card',
    cornerCaption: `${refreshEntriesView().length} Entries`,
    children: [tableMount]
  });

  const metaCard = card({
    id: 'metadata-card',
    children: [wrapper]
  });

  // Show the full path to the currently displayed collection file.
  const pathLabel = active?.key ? `Path: ${active.key}` : 'Path: (unknown)';
  root.append(
    el('div', { className: 'hint', text: pathLabel }),
    dataCard,
    metaCard
  );
  // initial UI updates now that the card is mounted and corner caption exists
  updateFilterButtons();
  renderTable();
  updateStudyLabel();
  markStudyRows();
  updateControlStates();

  return root;
}
