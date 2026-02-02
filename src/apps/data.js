import { createTable } from '../components/table.js';
import { card } from '../components/card.js';
import { el } from '../components/dom.js';
import { createViewHeaderTools, createStudyFilterToggle } from '../components/viewHeaderTools.js';
import { createCollectionActions } from '../utils/collectionActions.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';
  const active = store.getActiveCollection();

  let skipLearned = false;
  let focusOnly = false;

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
    onStudy10: () => {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const entries = Array.isArray(coll.entries) ? coll.entries : [];
      if (entries.length === 0) return;
      const actions = createCollectionActions(store);
      actions.pickStudyWindow(coll.key, { windowSize: 10, skipLearned: !!skipLearned, focusOnly: !!focusOnly });
      controls.setStudyLabel && controls.setStudyLabel('Study 10');
      updateStudyLabel();
      markStudyRows();
    },
    onStudyAll: () => {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const actions = createCollectionActions(store);
      actions.setStudyAll(coll.key, { skipLearned: !!skipLearned, focusOnly: !!focusOnly });
      controls.setStudyLabel && controls.setStudyLabel('Study All');
      updateStudyLabel();
      markStudyRows();
    },
    onShuffle: () => {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const actions = createCollectionActions(store);
      actions.shuffleCollection(coll.key);
      updateStudyLabel();
      markStudyRows();
    },
    onClearShuffle: () => {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const actions = createCollectionActions(store);
      actions.clearCollectionShuffle(coll.key);
      updateStudyLabel();
      markStudyRows();
    },
    onClearLearned: () => {
      try {
        const coll = store?.getActiveCollection?.();
        const actions = createCollectionActions(store);
        actions.clearLearnedForCollection(coll?.key);
      } catch (e) {
        // ignore
      }
    }
  });

  // three-state study filter toggle (off / skipLearned / focusOnly)
  const studyFilterToggle = createStudyFilterToggle({ state: 'off', onChange: (s) => {
    // update local state booleans based on new three-state value
    skipLearned = (s === 'skipLearned');
    focusOnly = (s === 'focusOnly');
    persistFilters();
    pruneStudyIndicesToFilters();
    updateFilterButtons();
    renderTable();
    updateStudyLabel();
    markStudyRows();
  } });
  // append the study filter toggle after the header-controlled buttons
  controls.append(studyFilterToggle.el);

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
  } catch (e) {
    // ignore
  }

  // Helpers to read/save per-collection state
  function readCollState() {
    const coll = store.getActiveCollection();
    if (!coll) return null;
    if (typeof store.loadCollectionState === 'function') return store.loadCollectionState(coll.key) || {};
    // fallback for older API
    const saved = store.loadKanjiUIState ? store.loadKanjiUIState() : null;
    return saved || {};
  }

  function writeCollState(patch) {
    const coll = store.getActiveCollection();
    if (!coll) return;
    if (typeof store.saveCollectionState === 'function') return store.saveCollectionState(coll.key, patch);
    // fallback
    if (typeof store.saveKanjiUIState === 'function') return store.saveKanjiUIState(patch);
  }

  function getEntryKanjiValue(entry) {
    if (!entry || typeof entry !== 'object') return '';
    for (const k of ['kanji', 'character', 'text', 'word', 'reading', 'kana']) {
      const v = entry[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function passesFilters(entry) {
    const v = getEntryKanjiValue(entry);
    if (!v) return true;
    if (skipLearned && typeof store.isKanjiLearned === 'function') {
      if (store.isKanjiLearned(v)) return false;
    }
    if (focusOnly && typeof store.isKanjiFocus === 'function') {
      if (!store.isKanjiFocus(v)) return false;
    }
    return true;
  }

  function updateFilterButtons() {
    const state = skipLearned ? 'skipLearned' : (focusOnly ? 'focusOnly' : 'off');
    if (studyFilterToggle && typeof studyFilterToggle.setState === 'function') studyFilterToggle.setState(state);
  }

  function persistFilters() {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const actions = createCollectionActions(store);
    actions.setStudyFilter(coll.key, { skipLearned: !!skipLearned, focusOnly: !!focusOnly });
  }

  function pruneStudyIndicesToFilters() {
    try {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const actions = createCollectionActions(store);
      actions.pruneStudyIndicesToFilters(coll.key);
    } catch (e) {
      // ignore
    }
  }

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  const allEntries = Array.isArray(active.entries) ? active.entries : [];
  let rowToOriginalIndex = [];

  function getVisibleOriginalIndices() {
    const out = [];
    for (let i = 0; i < allEntries.length; i++) {
      if (passesFilters(allEntries[i])) out.push(i);
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

  // bind to header-owned studyLabel if present
  if (headerBtns && headerBtns.studyLabel) studyLabel = headerBtns.studyLabel;

  function updateControlStates() {
    try {
      const coll = store.getActiveCollection();
      if (!coll) return;
      const saved = readCollState() || {};
      const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
      // clearShuffle disabled if not shuffled
      const isShuffled = !!saved.isShuffled;
      if (headerBtns && headerBtns.clearShuffleBtn) headerBtns.clearShuffleBtn.disabled = !isShuffled;
      // clearLearned disabled if no learned items in this collection
      let hasLearned = false;
      if (typeof store.isKanjiLearned === 'function') {
        const entries = Array.isArray(coll.entries) ? coll.entries : [];
        for (const e of entries) {
          if (store.isKanjiLearned(getEntryKanjiValue(e))) { hasLearned = true; break; }
        }
      }
      if (headerBtns && headerBtns.clearLearnedBtn) headerBtns.clearLearnedBtn.disabled = !hasLearned;
      // studyAll disabled if already studying all (studyStart === null and no explicit indices)
      const isStudyAll = (saved && saved.studyStart === null && !Array.isArray(saved.studyIndices));
      if (headerBtns && headerBtns.studyAllBtn) headerBtns.studyAllBtn.disabled = !!isStudyAll;
    } catch (e) {
      // ignore
    }
  }

  function updateStudyLabel() {
    const coll = store.getActiveCollection();
    if (!coll) {
      studyLabel.textContent = '';
      updateControlStates();
      return;
    }
    const saved = readCollState();
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    if (n === 0) { studyLabel.textContent = ''; updateControlStates(); return; }
    if (saved && Array.isArray(saved.studyIndices)) {
      const cnt = saved.studyIndices.length;
      studyLabel.textContent = `Study: (${cnt}/${n})`;
    } else if (saved && saved.studyStart === null) {
      studyLabel.textContent = `Study: All`;
    } else if (saved && typeof saved.studyStart === 'number') {
      const sz = Array.isArray(saved.studyIndices) ? saved.studyIndices.length : 10;
      studyLabel.textContent = `Study: (${sz}/${n})`;
    } else {
      studyLabel.textContent = `Study: All`;
    }
    updateControlStates();
  }

  // Build table headers from fields
  const headers = [{ key: 'status', label: '' }, ...fields.map(f => f.label || f.key)];

  function renderTable() {
    const visibleIdxs = getVisibleOriginalIndices();
    rowToOriginalIndex = visibleIdxs.slice();
    const visibleEntries = visibleIdxs.map(i => allEntries[i]);

    const rows = visibleEntries.map(entry => {
      const v = getEntryKanjiValue(entry);
      const learned = (v && typeof store.isKanjiLearned === 'function') ? store.isKanjiLearned(v) : false;
      const focus = (v && typeof store.isKanjiFocus === 'function') ? store.isKanjiFocus(v) : false;

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

      return [icon, ...fields.map(f => entry[f.key] ?? '')];
    });

    const tbl = createTable({ headers, rows, id: 'data-table', sortable: true });
    tableMount.innerHTML = '';
    tableMount.append(tbl);

    // Update corner caption if present.
    try {
      const corner = root.querySelector('#data-card .card-corner-caption');
      if (corner) {
        const total = allEntries.length;
        const visible = visibleIdxs.length;
        corner.textContent = (skipLearned || focusOnly) ? `${visible}/${total} Entries` : `${total} Entries`;
      }
    } catch (e) {
      // ignore
    }
  }

  // Highlight rows that are part of the current study subset
  function markStudyRows() {
    const coll = store.getActiveCollection();
    if (!coll) return;
    const collState = (typeof store.loadCollectionState === 'function') ? store.loadCollectionState(coll.key) : (store.loadKanjiUIState ? store.loadKanjiUIState() : null);
    const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
    let subsetIndices = null;
    if (collState && Array.isArray(collState.studyIndices)) {
      subsetIndices = new Set(collState.studyIndices.map(i => Number(i)).filter(Number.isFinite));
    } else if (collState && typeof collState.studyStart === 'number') {
      subsetIndices = new Set();
      for (let i = 0; i < 10; i++) subsetIndices.add((collState.studyStart + i) % n);
    } else if (collState && collState.studyStart === null) {
      // study all
      subsetIndices = new Set(Array.from({ length: n }, (_, i) => i));
    }

    const wrapperEl = tableMount;
    const tbl = wrapperEl.querySelector('table');
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if (!tbody) return;
    Array.from(tbody.querySelectorAll('tr')).forEach((tr, rowIndex) => {
      // Update learned/focus icon in the leftmost column.
      try {
        const originalIndex = rowToOriginalIndex[rowIndex];
        const entry = (typeof originalIndex === 'number') ? allEntries[originalIndex] : null;
        const v = getEntryKanjiValue(entry);
        const learned = (v && typeof store.isKanjiLearned === 'function') ? store.isKanjiLearned(v) : false;
        const focus = (v && typeof store.isKanjiFocus === 'function') ? store.isKanjiFocus(v) : false;

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

      if (!subsetIndices) {
        tr.classList.remove('in-study');
        return;
      }
      const originalIndex = rowToOriginalIndex[rowIndex];
      if (subsetIndices.has(originalIndex)) tr.classList.add('in-study');
      else tr.classList.remove('in-study');
    });
  }

  // initial label + marking
  updateFilterButtons();
  renderTable();
  updateStudyLabel();
  markStudyRows();

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
        } catch (e) {
          // ignore
        }
        updateFilterButtons();
        pruneStudyIndicesToFilters();
        renderTable();
        updateStudyLabel();
        markStudyRows();
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

  const defaultsDetails = el('details', {
    className: 'defaults-details',
    children: [
      el('summary', { text: 'Collection defaults' }),
      el('pre', { text: JSON.stringify(active.defaults || {}, null, 2) })
    ]
  });

  const folderMetaDetails = el('details', {
    className: 'folder-meta-details',
    children: [
      el('summary', { text: 'Inherited folder _metadata.json' }),
      el('pre', { id: 'folder-meta-pre', text: 'Loading...' })
    ]
  });

  wrapper.append(collMetaDetails, defaultsDetails, folderMetaDetails);

  // Load inherited folder metadata asynchronously via the store API
  if (store && typeof store.getInheritedFolderMetadata === 'function') {
    store.getInheritedFolderMetadata(active.key)
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
    cornerCaption: `${allEntries.length} Entries`,
    children: [wrapper, tableMount]
  });

  // Show the full path to the currently displayed collection file.
  const pathLabel = active?.key ? `Path: ${active.key}` : 'Path: (unknown)';
  root.append(
    el('div', { className: 'hint', text: pathLabel }),
    dataCard
  );
  
  return root;
}
