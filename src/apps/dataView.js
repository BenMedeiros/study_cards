import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';
import { el } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { addShuffleControls } from '../components/collectionControls.js';
import { addStudyFilter } from '../components/studyControls.js';
import collectionSettingsController from '../controllers/collectionSettingsController.js';
import { createDropdown } from '../components/dropdown.js';
import { confirmDialog } from '../components/dialogs/confirmDialog.js';
import { openTableSettingsDialog } from '../components/dialogs/tableSettingsDialog.js';
import dataViewController from '../controllers/dataViewController.js';
import { parseHashRoute, buildHashRoute } from '../utils/helpers.js';
import { buildTableColumnItems } from '../utils/tableSettings.js';

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
    const arr = Array.isArray(entry?.relatedCollections?.[name]) ? entry.relatedCollections[name] : [];
    return arr.length;
  }

  const STUDY_STATE_ORDER = ['null', 'focus', 'learned'];
  let studyFilterStates = STUDY_STATE_ORDER.slice();

  // Persisted per-collection table search query (always applied)
  let heldTableSearch = '';

  // Persisted per-collection saved table search filters (autocomplete suggestions)
  let savedTableSearches = [];

  const DATA_TABLE_ACTION_ITEMS = [
    { key: 'clear', label: 'Clear' },
    { key: 'copyJson', label: 'Copy JSON' },
    { key: 'saveFilter', label: 'Save Filter' },
    { key: 'copyFullJson', label: 'Copy Full JSON' },
  ];

  let dataViewCtrl = null;
  let dataTableSettings = dataViewController.getDefaultTableSettings();
  let latestDataTableColumns = [];

  try {
    if (active?.key) {
      dataViewCtrl = dataViewController.create(active.key);
      dataTableSettings = dataViewCtrl.getTableSettings();
    }
  } catch (e) {
    dataViewCtrl = null;
    dataTableSettings = dataViewController.getDefaultTableSettings();
  }

  function normalizeKeyList(v) {
    const arr = Array.isArray(v) ? v : [];
    const out = [];
    const seen = new Set();
    for (const raw of arr) {
      const s = String(raw || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function resolveOrderedKeys(savedOrder, availableKeys) {
    const current = normalizeKeyList(availableKeys);
    const saved = normalizeKeyList(savedOrder).filter(k => current.includes(k));
    const missing = current.filter(k => !saved.includes(k));
    return [...saved, ...missing];
  }

  function normalizeDataTableSettingsLocal(v) {
    return dataViewController.normalizeDataTableSettings(v);
  }

  function sameDataTableSettings(a, b) {
    try { return JSON.stringify(normalizeDataTableSettingsLocal(a)) === JSON.stringify(normalizeDataTableSettingsLocal(b)); } catch (e) { return false; }
  }

  async function persistDataTableSettings(nextDataTable, { rerender = true } = {}) {
    const normalized = normalizeDataTableSettingsLocal(nextDataTable);
    dataTableSettings = normalized;
    try {
      if (dataViewCtrl) await dataViewCtrl.setTableSettings(normalized);
      else if (active?.key) collectionSettingsController.setView(active.key, 'dataView', { dataTable: normalized });
    } catch (e) {
      // ignore persistence errors; keep UI state
    }
    if (rerender) {
      renderTable();
      updateStudyLabel();
      markStudyRows();
      updateControlStates();
    }
  }

  function applyDataTableColumnSettings({ headers, rows }) {
    const hs = Array.isArray(headers) ? headers : [];
    const rs = Array.isArray(rows) ? rows : [];
    const byKey = new Map();
    hs.forEach((h, i) => {
      const key = String(h?.key || '').trim();
      if (key && !byKey.has(key)) byKey.set(key, i);
    });
    const allKeys = hs.map(h => String(h?.key || '').trim()).filter(Boolean);
    const orderKeys = resolveOrderedKeys(dataTableSettings?.columns?.orderKeys, allKeys);
    const hiddenSet = new Set(normalizeKeyList(dataTableSettings?.columns?.hiddenKeys).filter(k => allKeys.includes(k)));
    const visibleKeys = orderKeys.filter(k => !hiddenSet.has(k));

    const nextHeaders = visibleKeys.map(k => hs[byKey.get(k)]).filter(Boolean);
    const nextRows = rs.map((row) => {
      const out = visibleKeys.map((k) => {
        const idx = byKey.get(k);
        return (idx == null) ? '' : row[idx];
      });
      try { out.__id = row.__id; } catch (e) {}
      return out;
    });

    return {
      headers: nextHeaders,
      rows: nextRows,
      allKeys,
      orderKeys,
      hiddenKeys: Array.from(hiddenSet),
      visibleKeys,
    };
  }

  function applyDataTableColumnStyles(wrapper) {
    const map = (dataTableSettings?.columns?.stylesByKey && typeof dataTableSettings.columns.stylesByKey === 'object')
      ? dataTableSettings.columns.stylesByKey
      : {};
    const rootEl = wrapper || tableMount?.querySelector('.table-wrapper');
    if (!rootEl) return;
    for (const [rawKey, style] of Object.entries(map)) {
      const key = String(rawKey || '').trim();
      if (!key) continue;
      const nodes = rootEl.querySelectorAll(`th[data-field="${key}"], td[data-field="${key}"]`);
      if (!nodes || !nodes.length) continue;
      const wordBreak = String(style?.wordBreak || '').trim();
      const width = String(style?.width || '').trim();
      for (const node of Array.from(nodes)) {
        if (wordBreak) node.style.wordBreak = wordBreak;
        if (width) {
          node.style.setProperty('text-wrap-mode', 'wrap');
          node.style.width = width;
          node.style.minWidth = width;
          node.style.maxWidth = width;
        }
      }
    }
  }

  function applyDataTableActionSettings(searchWrap) {
    if (!searchWrap) return;
    const actionKeys = DATA_TABLE_ACTION_ITEMS.map(a => a.key);
    const order = resolveOrderedKeys(dataTableSettings?.actions?.orderKeys, actionKeys);
    const hidden = new Set(normalizeKeyList(dataTableSettings?.actions?.hiddenKeys).filter(k => actionKeys.includes(k)));

    const nodesByKey = new Map();
    for (const key of actionKeys) {
      const node = searchWrap.querySelector(`[data-table-action="${key}"]`);
      if (node) nodesByKey.set(key, node);
    }

    for (const [key, node] of nodesByKey.entries()) {
      node.style.display = hidden.has(key) ? 'none' : '';
    }

    for (const key of order) {
      if (hidden.has(key)) continue;
      const node = nodesByKey.get(key);
      if (node) searchWrap.append(node);
    }
  }
  // Persisted per-collection expansion settings (Data view header dropdowns)
  let expansionIForms = [];
  let expansionNaForms = [];
  let expansionIchidanForms = [];
  let expansionGodanForms = [];
  let expansionIrregularForms = [];
  let expansionCounterForms = [];
  let expansionSentenceMathForms = [];
  function getExpansionConfig() {
    try {
      if (typeof store?.collections?.getCollectionExpansionConfig !== 'function') return null;
      const coll = store.collections.getActiveCollection();
      return store.collections.getCollectionExpansionConfig(coll) || null;
    } catch (e) {
      return null;
    }
  }

  const STUDY_FILTER_ITEMS = [
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

    const byValue = new Map(baseItems.map(it => [String(it?.value ?? ''), String(it?.rightText ?? it?.right ?? it?.label ?? it?.value ?? '')]));
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
      const entriesView = getCurrentVisibleEntries();
      for (const entry of (Array.isArray(entriesView) ? entriesView : [])) {
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

  // Controls: header owns primary collection actions; declare buttons via viewHeaderTools
  const controls = createViewHeaderTools({ elements: [] });
  try {
    addShuffleControls(controls, {
      store,
      onShuffle: () => { updateStudyLabel(); markStudyRows(); },
      onClearShuffle: () => { try { updateStudyLabel(); markStudyRows(); } catch (e) {} },
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
  } catch (e) {}

  // append the study filter selector after the header-controlled buttons
  // use headerTools API to create the dropdown so viewHeaderTools manages structure
  // initial render will happen in renderStudyFilterControl()
  function renderStudyFilterControl() {
    controls.removeControl && controls.removeControl('studyFilter');
    addStudyFilter(controls, {
      getCurrentCollectionKey: () => store.collections.getActiveCollection()?.key,
      onChange: (ordered) => {
        studyFilterStates = orderStudyStates(ordered);
        persistFilters();
        renderTable();
        updateStudyLabel();
        markStudyRows();
        updateControlStates();
      }
    });
  }

  function applyExpansionSelectionChange() {
    persistCollectionExpansions();
    renderTable();
    updateStudyLabel();
    markStudyRows();
    updateControlStates();
  }
  // Collection expansion dropdowns (persisted per-collection)
  const expansionWrap = document.createElement('div');
  expansionWrap.className = 'data-expansion-tools';
  controls.append(expansionWrap);

  function renderExpansionControls() {
    expansionWrap.innerHTML = '';
    const expansionConfig = getExpansionConfig();
    const hasI = !!expansionConfig?.supports?.i;
    const hasNa = !!expansionConfig?.supports?.na;
    const hasIchidan = !!expansionConfig?.supports?.ichidan;
    const hasGodan = !!expansionConfig?.supports?.godan;
    const hasIrregular = !!expansionConfig?.supports?.irregular;
    const hasCounters = !!expansionConfig?.supports?.counters;
    const hasSentenceMath = !!expansionConfig?.supports?.sentenceMath;

    const iBaseItems = Array.isArray(expansionConfig?.iBaseItems) ? expansionConfig.iBaseItems : [];
    const naBaseItems = Array.isArray(expansionConfig?.naBaseItems) ? expansionConfig.naBaseItems : [];
    const ichidanBaseItems = Array.isArray(expansionConfig?.ichidanVerbBaseItems) ? expansionConfig.ichidanVerbBaseItems : [];
    const godanBaseItems = Array.isArray(expansionConfig?.godanVerbBaseItems) ? expansionConfig.godanVerbBaseItems : [];
    const irregularBaseItems = Array.isArray(expansionConfig?.irregularVerbBaseItems) ? expansionConfig.irregularVerbBaseItems : [];
    const counterBaseItems = Array.isArray(expansionConfig?.counterBaseItems) ? expansionConfig.counterBaseItems : [];
    const sentenceMathBaseItems = Array.isArray(expansionConfig?.sentenceMathBaseItems) ? expansionConfig.sentenceMathBaseItems : [];

    const iItems = Array.isArray(expansionConfig?.iItems) ? expansionConfig.iItems : [];
    const naItems = Array.isArray(expansionConfig?.naItems) ? expansionConfig.naItems : [];
    const ichidanItems = Array.isArray(expansionConfig?.ichidanVerbItems) ? expansionConfig.ichidanVerbItems : [];
    const godanItems = Array.isArray(expansionConfig?.godanVerbItems) ? expansionConfig.godanVerbItems : [];
    const irregularItems = Array.isArray(expansionConfig?.irregularVerbItems) ? expansionConfig.irregularVerbItems : [];
    const counterItems = Array.isArray(expansionConfig?.counterItems) ? expansionConfig.counterItems : [];
    const sentenceMathItems = Array.isArray(expansionConfig?.sentenceMathItems) ? expansionConfig.sentenceMathItems : [];

    // Expand any saved 'all' sentinel into explicit lists based on available items
    try {
      if (expansionIForms === 'all' || (Array.isArray(expansionIForms) && expansionIForms.includes('all'))) {
        expansionIForms = iItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionNaForms === 'all' || (Array.isArray(expansionNaForms) && expansionNaForms.includes('all'))) {
        expansionNaForms = naItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionIchidanForms === 'all' || (Array.isArray(expansionIchidanForms) && expansionIchidanForms.includes('all'))) {
        expansionIchidanForms = ichidanItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionGodanForms === 'all' || (Array.isArray(expansionGodanForms) && expansionGodanForms.includes('all'))) {
        expansionGodanForms = godanItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionIrregularForms === 'all' || (Array.isArray(expansionIrregularForms) && expansionIrregularForms.includes('all'))) {
        expansionIrregularForms = irregularItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionCounterForms === 'all' || (Array.isArray(expansionCounterForms) && expansionCounterForms.includes('all'))) {
        expansionCounterForms = counterItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
      if (expansionSentenceMathForms === 'all' || (Array.isArray(expansionSentenceMathForms) && expansionSentenceMathForms.includes('all'))) {
        expansionSentenceMathForms = sentenceMathItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || ''));
      }
    } catch (e) {}

    // use headerTools helper to create dropdowns then move the created groups into expansionWrap
    controls.removeControl && controls.removeControl('expansionI');
    const iRec = controls.addElement({
      type: 'dropdown', key: 'expansionI', items: iItems, multi: true,
      values: expansionIForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? iItems.map(it => String(it?.value || ''))
          : vals;
        expansionIForms = orderFormsByItems(normalizeFormList(chosen), iBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'i-adj'
    });
    try { if (iRec && iRec.group) { iRec.group.style.display = hasI ? '' : 'none'; expansionWrap.append(iRec.group); } } catch (e) {}

    controls.removeControl && controls.removeControl('expansionNa');
    const naRec = controls.addElement({
      type: 'dropdown', key: 'expansionNa', items: naItems, multi: true,
      values: expansionNaForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? naItems.map(it => String(it?.value || ''))
          : vals;
        expansionNaForms = orderFormsByItems(normalizeFormList(chosen), naBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'na-adj'
    });
    try { if (naRec && naRec.group) { naRec.group.style.display = hasNa ? '' : 'none'; expansionWrap.append(naRec.group); } } catch (e) {}

    controls.removeControl && controls.removeControl('expansionIchidan');
    const ichidanRec = controls.addElement({
      type: 'dropdown', key: 'expansionIchidan', items: ichidanItems, multi: true,
      values: expansionIchidanForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? ichidanItems.map(it => String(it?.value || ''))
          : vals;
        expansionIchidanForms = orderFormsByItems(normalizeFormList(chosen), ichidanBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'ichidan'
    });
    try { if (ichidanRec && ichidanRec.group) { ichidanRec.group.style.display = hasIchidan ? '' : 'none'; expansionWrap.append(ichidanRec.group); } } catch (e) {}

    controls.removeControl && controls.removeControl('expansionGodan');
    const godanRec = controls.addElement({
      type: 'dropdown', key: 'expansionGodan', items: godanItems, multi: true,
      values: expansionGodanForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? godanItems.map(it => String(it?.value || ''))
          : vals;
        expansionGodanForms = orderFormsByItems(normalizeFormList(chosen), godanBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'godan'
    });
    try { if (godanRec && godanRec.group) { godanRec.group.style.display = hasGodan ? '' : 'none'; expansionWrap.append(godanRec.group); } } catch (e) {}

    controls.removeControl && controls.removeControl('expansionIrregular');
    const irregularRec = controls.addElement({
      type: 'dropdown', key: 'expansionIrregular', items: irregularItems, multi: true,
      values: expansionIrregularForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? irregularItems.map(it => String(it?.value || ''))
          : vals;
        expansionIrregularForms = orderFormsByItems(normalizeFormList(chosen), irregularBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'irregular'
    });
    try { if (irregularRec && irregularRec.group) { irregularRec.group.style.display = hasIrregular ? '' : 'none'; expansionWrap.append(irregularRec.group); } } catch (e) {}
    controls.removeControl && controls.removeControl('expansionCounters');
    const counterRec = controls.addElement({
      type: 'dropdown', key: 'expansionCounters', items: counterItems, multi: true,
      values: expansionCounterForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? counterItems.map(it => String(it?.value || ''))
          : vals;
        expansionCounterForms = orderFormsByItems(normalizeFormList(chosen), counterBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'counters'
    });
    try { if (counterRec && counterRec.group) { counterRec.group.style.display = hasCounters ? '' : 'none'; expansionWrap.append(counterRec.group); } } catch (e) {}
    controls.removeControl && controls.removeControl('expansionSentenceMath');
    const sentenceMathRec = controls.addElement({
      type: 'dropdown', key: 'expansionSentenceMath', items: sentenceMathItems, multi: true,
      values: expansionSentenceMathForms,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues, items }) => formatMultiSelectButtonLabel(selectedValues, items),
      onChange: (vals) => {
        const chosen = (typeof vals === 'string' && vals === 'all')
          ? sentenceMathItems.map(it => String(it?.value || ''))
          : vals;
        expansionSentenceMathForms = orderFormsByItems(normalizeFormList(chosen), sentenceMathBaseItems);
        applyExpansionSelectionChange();
      },
      includeAllNone: true,
      className: 'data-expansion-dropdown',
      caption: 'math'
    });
    try { if (sentenceMathRec && sentenceMathRec.group) { sentenceMathRec.group.style.display = hasSentenceMath ? '' : 'none'; expansionWrap.append(sentenceMathRec.group); } } catch (e) {}
  }

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
      if (String(saved.studyFilter) === 'all') {
        studyFilterStates = STUDY_STATE_ORDER.slice();
      } else {
        const parsed = parseStudyFilter(saved.studyFilter);
        studyFilterStates = orderStudyStates(parsed.states);
      }
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
    expansionIchidanForms = normalizeFormList(saved?.expansion_ichidan ?? saved?.expansion_ichidanVerb ?? []);
    expansionGodanForms = normalizeFormList(saved?.expansion_godan ?? saved?.expansion_godanVerb ?? []);
    expansionIrregularForms = normalizeFormList(saved?.expansion_irregular ?? saved?.expansion_irregularVerb ?? []);
    expansionCounterForms = normalizeFormList(saved?.expansion_counters ?? saved?.expansion_counter ?? []);
    expansionSentenceMathForms = normalizeFormList(saved?.expansion_sentence_math ?? saved?.expansion_sentenceMath ?? []);

    // If the active collection does not support the expansion kind,
    // hide the control and delete the persisted setting to avoid future issues.
    const expansionConfig = getExpansionConfig();
    const hasI = !!expansionConfig?.supports?.i;
    const hasNa = !!expansionConfig?.supports?.na;
    const hasIchidan = !!expansionConfig?.supports?.ichidan;
    const hasGodan = !!expansionConfig?.supports?.godan;
    const hasIrregular = !!expansionConfig?.supports?.irregular;
    const hasCounters = !!expansionConfig?.supports?.counters;
    const hasSentenceMath = !!expansionConfig?.supports?.sentenceMath;

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
    if (!hasIchidan) {
      expansionIchidanForms = [];
      if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_ichidan')) {
        deleteExpansionSettingIfPresent(['expansion_ichidan', 'expansion_ichidanVerb', 'expansion_ichidan_verb']);
      }
    }
    if (!hasGodan) {
      expansionGodanForms = [];
      if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_godan')) {
        deleteExpansionSettingIfPresent(['expansion_godan', 'expansion_godanVerb', 'expansion_godan_verb']);
      }
    }
    if (!hasIrregular) {
      expansionIrregularForms = [];
      if (saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_irregular')) {
        deleteExpansionSettingIfPresent(['expansion_irregular', 'expansion_irregularVerb', 'expansion_irregular_verb']);
      }
    }
    if (!hasCounters) {
      expansionCounterForms = [];
      if (saved && typeof saved === 'object' && (Object.prototype.hasOwnProperty.call(saved, 'expansion_counters') || Object.prototype.hasOwnProperty.call(saved, 'expansion_counter'))) {
        deleteExpansionSettingIfPresent(['expansion_counters', 'expansion_counter']);
      }
    }
    if (!hasSentenceMath) {
      expansionSentenceMathForms = [];
      if (saved && typeof saved === 'object' && (Object.prototype.hasOwnProperty.call(saved, 'expansion_sentence_math') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentenceMath') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentence_math_seed') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentenceMathSeed'))) {
        deleteExpansionSettingIfPresent(['expansion_sentence_math', 'expansion_sentenceMath', 'expansion_sentence_math_seed', 'expansion_sentenceMathSeed']);
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
    return collectionSettingsController.get(coll.key) || {};
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
    collectionSettingsController.set(coll.key, { heldTableSearch: String(query || '') });
  }

  function persistSavedTableSearches(nextList) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    const list = normalizeSavedSearchList(nextList);
    if (!list.length) {
      collectionSettingsController.set(coll.key, { savedTableSearches: [] });
      savedTableSearches = [];
      return;
    }

    savedTableSearches = list;
    collectionSettingsController.set(coll.key, { savedTableSearches: list });
  }

  function persistCollectionExpansions() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    const cfg = getExpansionConfig();
    const iItems = Array.isArray(cfg?.iItems) ? cfg.iItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const naItems = Array.isArray(cfg?.naItems) ? cfg.naItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const ichidanItems = Array.isArray(cfg?.ichidanVerbItems) ? cfg.ichidanVerbItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const godanItems = Array.isArray(cfg?.godanVerbItems) ? cfg.godanVerbItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const irregularItems = Array.isArray(cfg?.irregularVerbItems) ? cfg.irregularVerbItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const counterItems = Array.isArray(cfg?.counterItems) ? cfg.counterItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];
    const sentenceMathItems = Array.isArray(cfg?.sentenceMathItems) ? cfg.sentenceMathItems.filter(it => String(it?.kind || '') !== 'action').map(it => String(it?.value || '')) : [];

    const iSave = (expansionIForms === 'all' || (Array.isArray(expansionIForms) && iItems.length > 0 && iItems.length === expansionIForms.length && iItems.every(v => expansionIForms.includes(v)))) ? 'all' : (Array.isArray(expansionIForms) ? expansionIForms.slice() : []);
    const naSave = (expansionNaForms === 'all' || (Array.isArray(expansionNaForms) && naItems.length > 0 && naItems.length === expansionNaForms.length && naItems.every(v => expansionNaForms.includes(v)))) ? 'all' : (Array.isArray(expansionNaForms) ? expansionNaForms.slice() : []);
    const ichidanSave = (expansionIchidanForms === 'all' || (Array.isArray(expansionIchidanForms) && ichidanItems.length > 0 && ichidanItems.length === expansionIchidanForms.length && ichidanItems.every(v => expansionIchidanForms.includes(v)))) ? 'all' : (Array.isArray(expansionIchidanForms) ? expansionIchidanForms.slice() : []);
    const godanSave = (expansionGodanForms === 'all' || (Array.isArray(expansionGodanForms) && godanItems.length > 0 && godanItems.length === expansionGodanForms.length && godanItems.every(v => expansionGodanForms.includes(v)))) ? 'all' : (Array.isArray(expansionGodanForms) ? expansionGodanForms.slice() : []);
    const irregularSave = (expansionIrregularForms === 'all' || (Array.isArray(expansionIrregularForms) && irregularItems.length > 0 && irregularItems.length === expansionIrregularForms.length && irregularItems.every(v => expansionIrregularForms.includes(v)))) ? 'all' : (Array.isArray(expansionIrregularForms) ? expansionIrregularForms.slice() : []);
    const counterSave = (expansionCounterForms === 'all' || (Array.isArray(expansionCounterForms) && counterItems.length > 0 && counterItems.length === expansionCounterForms.length && counterItems.every(v => expansionCounterForms.includes(v)))) ? 'all' : (Array.isArray(expansionCounterForms) ? expansionCounterForms.slice() : []);
    const sentenceMathSave = (expansionSentenceMathForms === 'all' || (Array.isArray(expansionSentenceMathForms) && sentenceMathItems.length > 0 && sentenceMathItems.length === expansionSentenceMathForms.length && sentenceMathItems.every(v => expansionSentenceMathForms.includes(v)))) ? 'all' : (Array.isArray(expansionSentenceMathForms) ? expansionSentenceMathForms.slice() : []);


    collectionSettingsController.set(coll.key, {
      expansion_i: iSave,
      expansion_na: naSave,
      expansion_ichidan: ichidanSave,
      expansion_godan: godanSave,
      expansion_irregular: irregularSave,
      expansion_counters: counterSave,
      expansion_sentence_math: sentenceMathSave,
      expansion_sentence_math_seed: Date.now(),
    });
  }

  // pruneStudyIndicesToFilters removed — studyIndices/studyStart no longer used.

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  let baseEntries = Array.isArray(active.entries) ? active.entries.slice() : [];
  let lastRenderedEntries = [];

  function getCurrentCollectionView(opts = {}) {
    const coll = store?.collections?.getActiveCollection?.() || active;
    const collState = readCollState() || {};
    const sourceEntries = Array.isArray(opts?.entries) ? opts.entries : baseEntries;
    try {
      return store.collections.getCollectionViewForCollection(coll, collState, { windowSize: 10, entries: sourceEntries }) || { entries: [], indices: [] };
    } catch (e) {
      return { entries: [], indices: [], isShuffled: false, order_hash_int: null };
    }
  }

  function getCurrentVisibleEntries() {
    const view = getCurrentCollectionView();
    return Array.isArray(view?.entries) ? view.entries : [];
  }

  function getUnexpandedFilteredBaseEntries() {
    const coll = store?.collections?.getActiveCollection?.() || active;
    const collState = readCollState() || {};
    const collStateNoExpansion = {
      ...collState,
      expansion_i: [],
      expansion_na: [],
      expansion_ichidan: [],
      expansion_godan: [],
      expansion_irregular: [],
      expansion_counters: [],
      expansion_counter: [],
      expansion_sentence_math: [],
      expansion_sentenceMath: [],
      expansion_sentence_math_seed: 0,
      expansion_sentenceMathSeed: 0,
      expansion_iAdj: [],
      expansion_naAdj: [],
      expansion_i_adjective: [],
      expansion_na_adjective: [],
      expansion_ichidanVerb: [],
      expansion_godanVerb: [],
      expansion_irregularVerb: [],
      expansion_ichidan_verb: [],
      expansion_godan_verb: [],
      expansion_irregular_verb: [],
    };
    try {
      const view = store.collections.getCollectionViewForCollection(coll, collStateNoExpansion, { windowSize: 10, entries: baseEntries });
      return Array.isArray(view?.entries) ? view.entries : [];
    } catch (e) {
      return Array.isArray(baseEntries) ? baseEntries : [];
    }
  }

  function getExpandedEntriesWithoutFilters() {
    const coll = store?.collections?.getActiveCollection?.() || active;
    const collState = readCollState() || {};
    const collStateNoFilters = {
      ...collState,
      studyFilter: 'null,focus,learned',
      heldTableSearch: '',
    };
    try {
      const view = store.collections.getCollectionViewForCollection(coll, collStateNoFilters, { windowSize: 10, entries: baseEntries });
      return Array.isArray(view?.entries) ? view.entries : [];
    } catch (e) {
      return [];
    }
  }

  // Background: request entries augmented with related collection counts/samples.
  Promise.resolve().then(async () => {
    try {
      if (!active?.key) return;
      if (!relatedCollectionConfigs.length) return;
      if (store?.collections && typeof store.collections.getCollectionEntriesWithRelated === 'function') {
        const augmented = await store.collections.getCollectionEntriesWithRelated(active.key, { sample: 2 });
        if (Array.isArray(augmented) && augmented.length) {
          baseEntries = augmented.slice();
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

  const tableMount = document.createElement('div');
  tableMount.id = 'data-table-mount';

  // primary header controls are handled by header component callbacks (see createViewHeaderTools)

  // Prepare control state references
  const headerShuffleBtn = (typeof controls.getControl === 'function') ? controls.getControl('shuffle') : null;
  const headerClearShuffleBtn = (typeof controls.getControl === 'function') ? controls.getControl('clearShuffle') : null;
  const headerClearLearnedBtn = (typeof controls.getControl === 'function') ? controls.getControl('clearLearned') : null;

  function updateControlStates() {
    try {
      const coll = store.collections.getActiveCollection();
      if (!coll) return;
      const saved = readCollState() || {};
      const n = Array.isArray(coll.entries) ? coll.entries.length : 0;
      // clearShuffle disabled if not shuffled
      const isShuffled = !!saved.isShuffled;
      if (headerClearShuffleBtn) headerClearShuffleBtn.disabled = !isShuffled;
      // clearLearned disabled if no learned items in the CURRENT filtered results
      const stats = getClearLearnedStats();
      if (headerClearLearnedBtn) headerClearLearnedBtn.disabled = !(stats && stats.count > 0);
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

  async function openDataTableSettings() {
    const coll = store.collections.getActiveCollection();
    const sourceInfoParts = [];
    if (coll?.key) sourceInfoParts.push(coll.key);
    if (Array.isArray(coll?.metadata?.fields)) sourceInfoParts.push(`${coll.metadata.fields.length} schema fields`);

    const next = await openTableSettingsDialog({
      tableName: 'Data Table',
      sourceInfo: sourceInfoParts.join(' | '),
      columns: latestDataTableColumns,
      actions: DATA_TABLE_ACTION_ITEMS,
      settings: dataTableSettings,
    });
    if (!next) return;
    await persistDataTableSettings(next, { rerender: true });
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
    const view = getCurrentCollectionView();
    const visibleEntries = Array.isArray(view?.entries) ? view.entries : [];
    const visibleIdxs = Array.isArray(view?.indices) ? view.indices : [];
    lastRenderedEntries = visibleEntries.slice();

    const adapter = getProgressAdapter();
    const rows = visibleEntries.map((entry, i) => {
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
      try { row.__id = String(i); } catch (e) {}
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

        const configured = applyDataTableColumnSettings({ headers, rows });
    latestDataTableColumns = buildTableColumnItems(headers, rows, {
      schemaFields: Array.isArray(fields) ? fields : [],
    });

    const tbl = createTable({
      store,
      headers: configured.headers,
      rows: configured.rows,
      id: 'data-table',
      collection: active?.key || null,
      sourceMetadata: active?.metadata || null,
      columnRenderSettings: (dataTableSettings?.columns?.stylesByKey || {}),
      tableRenderSettings: dataTableSettings?.table || {},
      sortable: true,
      searchable: true,
      initialSortKey,
      initialSortDir,
    });
    tableMount.innerHTML = '';
    tableMount.append(tbl);
    applyDataTableColumnStyles(tbl);

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
        saveBtn.dataset.tableAction = 'saveFilter';

        // Insert after Copy JSON
        if (!searchWrap.querySelector('.table-save-filter')) {
          copyBtn.insertAdjacentElement('afterend', saveBtn);
        }
        applyDataTableActionSettings(searchWrap);

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
          try { clearBtn.disabled = !(String(searchInput.value || '').trim().length > 0); } catch (e) {}
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
        const visible = visibleEntries.length;
        const expandedUnfiltered = getExpandedEntriesWithoutFilters();
        const total = Array.isArray(expandedUnfiltered) ? expandedUnfiltered.length : visible;
        const unexpandedBaseEntries = getUnexpandedFilteredBaseEntries();
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

        // Ask CollectionsManager for expansion deltas on the held/study-filtered,
        // unexpanded base entries.
        try {
          const stats = (typeof store?.collections?.getCollectionExpansionDeltas === 'function')
            ? store.collections.getCollectionExpansionDeltas(unexpandedBaseEntries, {
                iForms: expansionIForms,
                naForms: expansionNaForms,
                ichidanForms: expansionIchidanForms,
                godanForms: expansionGodanForms,
                irregularForms: expansionIrregularForms,
                counterForms: expansionCounterForms,
                sentenceMathForms: expansionSentenceMathForms,
              })
            : null;
          const iDelta = Math.max(0, Math.round(Number(stats?.iDelta) || 0));
          const naDelta = Math.max(0, Math.round(Number(stats?.naDelta) || 0));
          const ichidanDelta = Math.max(0, Math.round(Number(stats?.ichidanDelta) || 0));
          const godanDelta = Math.max(0, Math.round(Number(stats?.godanDelta) || 0));
          const irregularDelta = Math.max(0, Math.round(Number(stats?.irregularDelta) || 0));
          const counterDelta = Math.max(0, Math.round(Number(stats?.counterDelta) || 0));
          const sentenceMathDelta = Math.max(0, Math.round(Number(stats?.sentenceMathDelta) || 0));
          if (iDelta) parts.push(`+${iDelta} i-adj`);
          if (naDelta) parts.push(`+${naDelta} na-adj`);
          if (ichidanDelta) parts.push(`+${ichidanDelta} ichidan`);
          if (godanDelta) parts.push(`+${godanDelta} godan`);
          if (irregularDelta) parts.push(`+${irregularDelta} irregular`);
          if (counterDelta) parts.push(`+${counterDelta} counters`);
          if (sentenceMathDelta) parts.push(`+${sentenceMathDelta} math`);
          if (iDelta || naDelta || ichidanDelta || godanDelta || irregularDelta || counterDelta || sentenceMathDelta) {
            titleParts.push(`Expansion delta: +${iDelta} i-adj, +${naDelta} na-adj, +${ichidanDelta} ichidan, +${godanDelta} godan, +${irregularDelta} irregular, +${counterDelta} counters, +${sentenceMathDelta} math`);
          }
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
        const entryIndex = (typeof parsed === 'number') ? parsed : rowIndex;
        const entry = (typeof entryIndex === 'number') ? lastRenderedEntries[entryIndex] : null;
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
          const nextTable = normalizeDataTableSettingsLocal(saved?.dataView?.dataTable ?? dataTableSettings);
          if (!sameDataTableSettings(nextTable, dataTableSettings)) dataTableSettings = nextTable;
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
          const nextIchidan = normalizeFormList(saved?.expansion_ichidan ?? saved?.expansion_ichidanVerb ?? []);
          const nextGodan = normalizeFormList(saved?.expansion_godan ?? saved?.expansion_godanVerb ?? []);
          const nextIrregular = normalizeFormList(saved?.expansion_irregular ?? saved?.expansion_irregularVerb ?? []);
          const nextCounters = normalizeFormList(saved?.expansion_counters ?? saved?.expansion_counter ?? []);
          const nextSentenceMath = normalizeFormList(saved?.expansion_sentence_math ?? saved?.expansion_sentenceMath ?? []);

          const expansionConfig = getExpansionConfig();
          const hasI = !!expansionConfig?.supports?.i;
          const hasNa = !!expansionConfig?.supports?.na;
          const hasIchidan = !!expansionConfig?.supports?.ichidan;
          const hasGodan = !!expansionConfig?.supports?.godan;
          const hasIrregular = !!expansionConfig?.supports?.irregular;
          const hasCounters = !!expansionConfig?.supports?.counters;
          const hasSentenceMath = !!expansionConfig?.supports?.sentenceMath;

          const cleanedI = hasI ? nextI : [];
          const cleanedNa = hasNa ? nextNa : [];
          const cleanedIchidan = hasIchidan ? nextIchidan : [];
          const cleanedGodan = hasGodan ? nextGodan : [];
          const cleanedIrregular = hasIrregular ? nextIrregular : [];
          const cleanedCounters = hasCounters ? nextCounters : [];
          const cleanedSentenceMath = hasSentenceMath ? nextSentenceMath : [];

          // If settings exist for a kind the collection doesn't contain, delete them.
          if (!hasI && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_i')) {
            deleteExpansionSettingIfPresent(['expansion_i', 'expansion_iAdj', 'expansion_i_adjective']);
          }
          if (!hasNa && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_na')) {
            deleteExpansionSettingIfPresent(['expansion_na', 'expansion_naAdj', 'expansion_na_adjective']);
          }
          if (!hasIchidan && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_ichidan')) {
            deleteExpansionSettingIfPresent(['expansion_ichidan', 'expansion_ichidanVerb', 'expansion_ichidan_verb']);
          }
          if (!hasGodan && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_godan')) {
            deleteExpansionSettingIfPresent(['expansion_godan', 'expansion_godanVerb', 'expansion_godan_verb']);
          }
          if (!hasIrregular && saved && typeof saved === 'object' && Object.prototype.hasOwnProperty.call(saved, 'expansion_irregular')) {
            deleteExpansionSettingIfPresent(['expansion_irregular', 'expansion_irregularVerb', 'expansion_irregular_verb']);
          }
          if (!hasCounters && saved && typeof saved === 'object' && (Object.prototype.hasOwnProperty.call(saved, 'expansion_counters') || Object.prototype.hasOwnProperty.call(saved, 'expansion_counter'))) {
            deleteExpansionSettingIfPresent(['expansion_counters', 'expansion_counter']);
          }
          if (!hasSentenceMath && saved && typeof saved === 'object' && (Object.prototype.hasOwnProperty.call(saved, 'expansion_sentence_math') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentenceMath') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentence_math_seed') || Object.prototype.hasOwnProperty.call(saved, 'expansion_sentenceMathSeed'))) {
            deleteExpansionSettingIfPresent(['expansion_sentence_math', 'expansion_sentenceMath', 'expansion_sentence_math_seed', 'expansion_sentenceMathSeed']);
          }

          const changed =
            (!sameStringArray(cleanedI, expansionIForms)) ||
            (!sameStringArray(cleanedNa, expansionNaForms)) ||
            (!sameStringArray(cleanedIchidan, expansionIchidanForms)) ||
            (!sameStringArray(cleanedGodan, expansionGodanForms)) ||
            (!sameStringArray(cleanedIrregular, expansionIrregularForms)) ||
            (!sameStringArray(cleanedCounters, expansionCounterForms)) ||
            (!sameStringArray(cleanedSentenceMath, expansionSentenceMathForms));

          expansionIForms = cleanedI;
          expansionNaForms = cleanedNa;
          expansionIchidanForms = cleanedIchidan;
          expansionGodanForms = cleanedGodan;
          expansionIrregularForms = cleanedIrregular;
          expansionCounterForms = cleanedCounters;
          expansionSentenceMathForms = cleanedSentenceMath;
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
      try { if (dataViewCtrl && typeof dataViewCtrl.dispose === 'function') dataViewCtrl.dispose(); } catch (e) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  const dataCard = card({
    id: 'data-card',
    cornerCaption: `${getCurrentVisibleEntries().length} Entries`,
    children: [tableMount]
  });

  try {
    const corner = dataCard.querySelector('.card-corner-caption');
    if (corner) {
      const settingsBtn = document.createElement('button');
      settingsBtn.type = 'button';
      settingsBtn.className = 'btn small data-table-settings-btn';
      settingsBtn.textContent = 'Table';
      settingsBtn.title = 'Table settings';
      settingsBtn.addEventListener('click', () => { openDataTableSettings(); });
      corner.insertAdjacentElement('afterend', settingsBtn);
    }
  } catch (e) {
    // ignore
  }

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

























