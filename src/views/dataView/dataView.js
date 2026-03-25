import { createTable } from '../../components/shared/table.js';
import { card } from '../../utils/browser/ui.js';
import { el } from '../../utils/browser/ui.js';
import { createViewHeaderTools } from '../../components/features/viewHeaderTools.js';
import { addShuffleControls } from '../../components/features/collectionControls.js';
import { addStudyFilter } from '../../components/features/studyControls.js';
import collectionSettingsManager from '../../managers/collectionSettingsManager.js';
import { createDropdown } from '../../components/shared/dropdown.js';
import { confirmDialog } from '../../components/dialogs/confirmDialog.js';
import { openTableSettingsDialog } from '../../components/dialogs/tableSettingsDialog.js';
import dataViewController from './dataViewController.js';
import { parseHashRoute, buildHashRoute } from '../../utils/browser/helpers.js';
import { buildTableColumnItems } from '../../utils/browser/tableSettings.js';
import { extractPathValues } from '../../utils/common/collectionParser.mjs';
import { timed } from '../../utils/browser/timing.js';

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
      out.push({
        ...raw,
        name,
        label: String(raw.label || raw.name || '').trim() || name,
        fields: Array.isArray(raw.fields) ? raw.fields.slice() : [],
      });
    }
    return out;
  }

  const SOURCE_VALUE_MODE_ITEMS = [
    { value: 'tokenList', label: 'Flatten to tokens' },
    { value: 'flatten', label: 'Flatten 1 level' },
    { value: 'flattenUnique', label: 'Flatten 1 level + unique' },
    { value: 'deepFlatten', label: 'Flatten all levels' },
    { value: 'deepFlattenUnique', label: 'Flatten all levels + unique' },
    { value: 'json', label: 'Keep nested JSON' },
  ];

  function getRelatedRecordsForEntry(entry, relationName) {
    const name = String(relationName || '').trim();
    if (!name) return [];
    return Array.isArray(entry?.relatedCollections?.[name]) ? entry.relatedCollections[name] : [];
  }

  function getRelatedCountForEntry(entry, relationName) {
    return getRelatedRecordsForEntry(entry, relationName).length;
  }

  function normalizeSearchTokens(values) {
    const list = Array.isArray(values) ? values : [values];
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      if (raw == null) continue;
      if (Array.isArray(raw)) {
        for (const item of normalizeSearchTokens(raw)) {
          if (seen.has(item)) continue;
          seen.add(item);
          out.push(item);
        }
        continue;
      }
      if (typeof raw === 'object') continue;
      const token = String(raw).trim();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }

  function flattenArrayValues(values, { deep = false } = {}) {
    const list = Array.isArray(values) ? values : [values];
    const out = [];
    for (const raw of list) {
      if (Array.isArray(raw)) {
        if (deep) out.push(...flattenArrayValues(raw, { deep: true }));
        else out.push(...raw);
        continue;
      }
      out.push(raw);
    }
    return out;
  }

  function dedupeValues(values) {
    const list = Array.isArray(values) ? values : [values];
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      const marker = (() => {
        if (raw == null) return '__null__';
        if (typeof raw === 'object') {
          try { return `obj:${JSON.stringify(raw)}`; } catch (e) { return `obj:${String(raw)}`; }
        }
        return `${typeof raw}:${String(raw)}`;
      })();
      if (seen.has(marker)) continue;
      seen.add(marker);
      out.push(raw);
    }
    return out;
  }

  function collectRelatedFieldRawValues(entry, relationName, fieldPath) {
    const path = String(fieldPath || '').trim();
    if (!path) return [];
    const values = [];
    for (const record of getRelatedRecordsForEntry(entry, relationName)) {
      try { values.push(...extractPathValues(record, path)); } catch (e) {}
    }
    return values;
  }

  function normalizeSourceMode(mode, { aggregate = false, sampleValues = [] } = {}) {
    if (aggregate) return 'count';
    const raw = String(mode || '').trim();
    const allowed = new Set(SOURCE_VALUE_MODE_ITEMS.map(item => item.value));
    if (allowed.has(raw)) return raw;
    const sampleList = Array.isArray(sampleValues) ? sampleValues : [];
    if (sampleList.some(value => Array.isArray(value) || (value && typeof value === 'object'))) return 'json';
    return 'tokenList';
  }

  function shapeRelatedSourceValues(rawValues, mode) {
    const normalizedMode = normalizeSourceMode(mode, { sampleValues: rawValues });
    const values = Array.isArray(rawValues) ? rawValues.slice() : [];
    if (normalizedMode === 'json') return values;
    if (normalizedMode === 'flatten') return flattenArrayValues(values, { deep: false });
    if (normalizedMode === 'flattenUnique') return dedupeValues(flattenArrayValues(values, { deep: false }));
    if (normalizedMode === 'deepFlatten') return flattenArrayValues(values, { deep: true });
    if (normalizedMode === 'deepFlattenUnique') return dedupeValues(flattenArrayValues(values, { deep: true }));
    return normalizeSearchTokens(values);
  }

  function inferValueType(value) {
    if (Array.isArray(value)) {
      const itemTypes = Array.from(new Set(value.map(item => inferValueType(item)).filter(Boolean)));
      const inner = itemTypes.length === 1 ? itemTypes[0] : (itemTypes.length ? itemTypes.join(' | ') : 'unknown');
      return `array<${inner}>`;
    }
    if (value == null) return 'unknown';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  function inferGroupedFieldType(values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) return 'array<string>';
    const typeSet = new Set();
    for (const value of list) {
      const type = inferValueType(value);
      if (type && type !== 'unknown') typeSet.add(type);
    }
    const inner = typeSet.size === 1 ? Array.from(typeSet)[0] : (typeSet.size ? Array.from(typeSet).join(' | ') : 'string');
    return `array<${inner}>`;
  }

  function inferShapedFieldType(rawValues, mode) {
    const normalizedMode = normalizeSourceMode(mode, { sampleValues: rawValues });
    if (normalizedMode === 'tokenList') return 'array<string>';
    return inferValueType(shapeRelatedSourceValues(rawValues, normalizedMode));
  }

  function createSearchTokenCell(tokens, { className = '' } = {}) {
    const values = normalizeSearchTokens(tokens);
    const cell = document.createElement('span');
    if (className) cell.className = className;
    cell.dataset.searchTokens = JSON.stringify(values);
    cell.dataset.searchValue = values.join(' | ');
    cell.textContent = values.join(' | ');
    cell.title = values.join(' | ');
    return cell;
  }

  function collectRelatedFieldOptions(entries, relatedConfigs, sourceConfigByKey = {}) {
    const sourceEntries = Array.isArray(entries) ? entries : [];
    const relations = Array.isArray(relatedConfigs) ? relatedConfigs : [];
    const configByKey = (sourceConfigByKey && typeof sourceConfigByKey === 'object') ? sourceConfigByKey : {};
    const out = [];

    for (const rel of relations) {
      const labelByKey = new Map();
      for (const field of Array.isArray(rel.fields) ? rel.fields : []) {
        const key = String(field?.key || '').trim();
        if (!key) continue;
        labelByKey.set(key, String(field?.label || key).trim() || key);
      }

      const discovered = new Map();
      for (const entry of sourceEntries) {
        for (const record of getRelatedRecordsForEntry(entry, rel.name)) {
          if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
          for (const [rawKey, rawValue] of Object.entries(record)) {
            const key = String(rawKey || '').trim();
            if (!key) continue;
            const bucket = discovered.get(key) || [];
            bucket.push(rawValue);
            discovered.set(key, bucket);
          }
        }
      }
      const fieldKeys = Array.from(new Set([
        ...discovered.keys(),
        ...labelByKey.keys(),
      ])).sort((a, b) => a.localeCompare(b));

      out.push({
        key: `${rel.name}.count`,
        label: `${rel.name}.count`,
        type: 'number',
        groupedType: 'number',
        sourceKind: 'related',
        relationName: rel.name,
        relationLabel: rel.label,
        aggregate: 'count',
        description: `Number of related ${rel.label || rel.name} records linked to this row.`,
        defaultSelected: true,
      });

      for (const fieldKey of fieldKeys) {
        const sourceKey = `${rel.name}.${fieldKey}`;
        const rawValues = discovered.get(fieldKey) || [];
        const groupedType = inferGroupedFieldType(rawValues);
        const mode = normalizeSourceMode(configByKey?.[sourceKey]?.mode, { sampleValues: rawValues });
        out.push({
          key: sourceKey,
          label: sourceKey,
          type: inferShapedFieldType(rawValues, mode),
          groupedType,
          sourceMode: mode,
          sourceKind: 'related',
          relationName: rel.name,
          relationLabel: rel.label,
          fieldPath: fieldKey,
          description: `Values pulled from ${rel.label || rel.name}.${labelByKey.get(fieldKey) || fieldKey}.`,
          defaultSelected: false,
          availableModes: SOURCE_VALUE_MODE_ITEMS.slice(),
        });
      }
    }

    return out;
  }

  const STUDY_PROGRESS_COLUMN_DEFS = [
    { key: 'studySeen', label: 'Seen', type: 'boolean', sourceKind: 'studyProgress', description: 'Whether the entry has been seen in study.', defaultSelected: true },
    { key: 'studyTimesSeen', label: 'Times Seen', type: 'number', sourceKind: 'studyProgress', description: 'How many times the entry has been marked seen.', defaultSelected: true },
    { key: 'studyTimeMs', label: 'Time (ms)', type: 'number', sourceKind: 'studyProgress', description: 'Total recorded study time in milliseconds.', defaultSelected: true },
  ];

  const relatedCollectionConfigs = normalizeRelatedCollectionsConfig(active?.metadata?.relatedCollections);

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
  let latestDataTableRelatedSources = [];
  let latestDataTableStudySources = STUDY_PROGRESS_COLUMN_DEFS.slice();

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

  function getAvailableDerivedColumns(entries = baseEntries) {
    return [
      ...collectRelatedFieldOptions(entries, relatedCollectionConfigs, dataTableSettings?.sources?.configByKey || {}),
      ...STUDY_PROGRESS_COLUMN_DEFS.map(def => ({ ...def })),
    ];
  }

  function getSelectedDerivedColumns(allDefs) {
    const defs = Array.isArray(allDefs) ? allDefs : [];
    const sourceSettings = dataTableSettings?.sources || {};
    const byKey = new Map(defs.map(def => [def.key, def]));

    if (sourceSettings.customized) {
      const relatedKeys = normalizeKeyList(sourceSettings.relatedColumns);
      const studyKeys = normalizeKeyList(sourceSettings.studyProgressFields);
      return [
        ...relatedKeys.map(key => byKey.get(key)).filter(Boolean),
        ...studyKeys.map(key => byKey.get(key)).filter(Boolean),
      ];
    }

    return defs.filter(def => def.defaultSelected !== false);
  }

  function buildDerivedCell(entry, def, metrics) {
    if (!def || typeof def !== 'object') return '';
    if (def.sourceKind === 'studyProgress') {
      if (def.key === 'studySeen') {
        const seenCell = document.createElement('span');
        seenCell.className = 'study-seen-cell';
        seenCell.dataset.searchValue = metrics.seen ? 'true' : 'false';
        seenCell.textContent = metrics.seen ? '✓' : '';
        seenCell.title = metrics.seen ? 'true' : 'false';
        return seenCell;
      }
      if (def.key === 'studyTimesSeen') return metrics.timesSeen > 0 ? metrics.timesSeen : '';
      if (def.key === 'studyTimeMs') return metrics.timeMs > 0 ? metrics.timeMs : '';
      return '';
    }
    if (def.aggregate === 'count') {
      const cell = document.createElement('span');
      cell.className = 'related-count-cell';
      const count = getRelatedCountForEntry(entry, def.relationName);
      cell.dataset.searchValue = String(count);
      cell.textContent = count > 0 ? String(count) : '';
      cell.title = String(count);
      return cell;
    }
    const rawValues = collectRelatedFieldRawValues(entry, def.relationName, def.fieldPath);
    const mode = normalizeSourceMode(def.sourceMode, { sampleValues: rawValues });
    const shaped = shapeRelatedSourceValues(rawValues, mode);
    if (mode === 'tokenList') {
      return createSearchTokenCell(shaped, { className: 'related-values-cell' });
    }
    return shaped;
  }

  async function persistDataTableSettings(nextDataTable, { rerender = true } = {}) {
    const normalized = normalizeDataTableSettingsLocal(nextDataTable);
    dataTableSettings = normalized;
    try {
      if (dataViewCtrl) await dataViewCtrl.setTableSettings(normalized);
      else if (active?.key) collectionSettingsManager.setView(active.key, 'dataView', { dataTable: normalized });
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
  const STUDY_FILTER_ITEMS = [
    { value: 'null', label: 'null', left: 'state', right: 'null' },
    { value: 'focus', label: 'focus', left: 'state', right: 'focus' },
    { value: 'learned', label: 'learned', left: 'state', right: 'learned' },
  ];

  function normalizeSavedSearchList(v) {
    const arr = Array.isArray(v)
      ? v
      : String(v || '').split(/[,|\n]+/g).map(x => String(x || '').trim()).filter(Boolean);
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

        const unit = 'item';
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
          if (typeof store?.kanjiProgress?.clearLearnedKanjiForValues === 'function') {
            const coll = store?.collections?.getActiveCollection?.();
            store.kanjiProgress.clearLearnedKanjiForValues(keys, { collectionKey: coll?.key });
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
  } catch (e) {
    // ignore
  }

  renderStudyFilterControl();

  // Helpers to read/save per-collection state
  function readCollState() {
    const coll = store.collections.getActiveCollection();
    if (!coll) return null;
    return collectionSettingsManager.get(coll.key) || {};
  }

  function getEntryKanjiValue(entry) {
    return store.collections.getEntryStudyKey(entry);
  }

  function getProgressAdapter() {
    const coll = (store?.collections && typeof store.collections.getActiveCollection === 'function')
      ? store.collections.getActiveCollection()
      : active;

    return {
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
    collectionSettingsManager.set(coll.key, { heldTableSearch: String(query || '') });
  }

  function persistSavedTableSearches(nextList) {
    const coll = store.collections.getActiveCollection();
    if (!coll) return;
    const list = normalizeSavedSearchList(nextList);
    if (!list.length) {
      collectionSettingsManager.set(coll.key, { savedTableSearches: [] });
      savedTableSearches = [];
      return;
    }

    savedTableSearches = list;
    collectionSettingsManager.set(coll.key, { savedTableSearches: list });
  }

  // pruneStudyIndicesToFilters removed — studyIndices/studyStart no longer used.

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  let baseEntries = Array.isArray(active.entries) ? active.entries.slice() : [];
  let lastRenderedEntries = [];
  let lastRenderedView = null;

  function getAvailableSearchHeaders(entries = baseEntries) {
    const allDerivedColumns = getAvailableDerivedColumns(entries);
    return [
      ...baseHeaders,
      ...allDerivedColumns.map(def => ({ key: def.key, label: def.label, type: def.type, description: def.description || '', sourceKind: def.sourceKind || '' })),
    ];
  }

  function getVisibleSearchHeaders(entries = baseEntries) {
    const selectedDerivedColumns = getSelectedDerivedColumns(getAvailableDerivedColumns(entries));
    const selectedHeaders = [
      ...baseHeaders,
      ...selectedDerivedColumns.map(def => ({ key: def.key, label: def.label, type: def.type, description: def.description || '', sourceKind: def.sourceKind || '' })),
    ];
    return applyDataTableColumnSettings({ headers: selectedHeaders, rows: [] }).headers;
  }

  function getCurrentCollectionView(opts = {}) {
    const coll = store?.collections?.getActiveCollection?.() || active;
    const collState = readCollState() || {};
    const sourceEntries = Array.isArray(opts?.entries) ? opts.entries : baseEntries;
    const tableSearchFields = Array.isArray(opts?.tableSearchFields) && opts.tableSearchFields.length
      ? opts.tableSearchFields
      : getAvailableSearchHeaders(sourceEntries);
    const tableGlobalSearchFields = Array.isArray(opts?.tableGlobalSearchFields) && opts.tableGlobalSearchFields.length
      ? opts.tableGlobalSearchFields
      : getVisibleSearchHeaders(sourceEntries);
    try {
      return store.collections.getCollectionViewForCollection(coll, collState, { windowSize: 10, entries: sourceEntries, tableSearchFields, tableGlobalSearchFields }) || { entries: [], indices: [] };
    } catch (e) {
      return { entries: [], indices: [], isShuffled: false, order_hash_int: null };
    }
  }

  function getCurrentVisibleEntries() {
    if (Array.isArray(lastRenderedView?.entries)) return lastRenderedView.entries.slice();
    const view = getCurrentCollectionView();
    return Array.isArray(view?.entries) ? view.entries : [];
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
      relatedSources: latestDataTableRelatedSources,
      studyProgressSources: latestDataTableStudySources,
    });
    if (!next) return;
    await persistDataTableSettings(next, { rerender: true });
  }

  const baseHeaders = [
    { key: 'status', label: '' },
    ...fields.map(f => ({
      key: f.key,
      label: f.label || f.key,
      type: f.type ?? (f.schema && f.schema.type) ?? null,
    })),
  ];

  function renderTable() {
    const coll = store?.collections?.getActiveCollection?.() || active;
    const collKey = String(coll?.key || active?.key || '(no-collection)');
    const heldQuery = String(heldTableSearch || '').trim();
    const label = `dataView.renderTable ${collKey} held=${heldQuery.length}`;
    return timed(label, () => {
      const view = getCurrentCollectionView();
      const visibleEntries = Array.isArray(view?.entries) ? view.entries : [];
      const visibleIdxs = Array.isArray(view?.indices) ? view.indices : [];
      lastRenderedView = view;
      lastRenderedEntries = visibleEntries.slice();

      const adapter = getProgressAdapter();
      const allDerivedColumns = getAvailableDerivedColumns(baseEntries);
      const selectedDerivedColumns = getSelectedDerivedColumns(allDerivedColumns);
      const selectedSourceKeySet = new Set(selectedDerivedColumns.map(def => String(def?.key || '').trim()).filter(Boolean));
      const allHeaders = [
        ...baseHeaders,
        ...allDerivedColumns.map(def => ({ key: def.key, label: def.label, type: def.type, description: def.description || '', sourceKind: def.sourceKind || '' })),
      ];
      const selectedHeaders = [
        ...baseHeaders,
        ...selectedDerivedColumns.map(def => ({ key: def.key, label: def.label, type: def.type, description: def.description || '', sourceKind: def.sourceKind || '' })),
      ];

      const allRows = [];
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

      const baseFieldCells = fields.map(f => entry[f.key] ?? '');
      const derivedCellByKey = new Map();
      for (const def of allDerivedColumns) derivedCellByKey.set(def.key, buildDerivedCell(entry, def, metrics));

      const allRow = [icon, ...baseFieldCells, ...allDerivedColumns.map(def => derivedCellByKey.get(def.key))];
      const row = [icon, ...baseFieldCells, ...selectedDerivedColumns.map(def => derivedCellByKey.get(def.key))];
      try { allRow.__id = String(i); } catch (e) {}
      try { row.__id = String(i); } catch (e) {}
      allRows.push(allRow);
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

      const configured = applyDataTableColumnSettings({ headers: selectedHeaders, rows });
      const selectedHeaderMetaByKey = new Map(selectedHeaders.map(h => [String(h?.key || '').trim(), h]));
      latestDataTableColumns = buildTableColumnItems(selectedHeaders, rows, {
        schemaFields: Array.isArray(fields) ? fields : [],
      }).map((item) => ({
        ...item,
        description: item.description || String(selectedHeaderMetaByKey.get(item.key)?.description || '').trim(),
        sourceKind: String(selectedHeaderMetaByKey.get(item.key)?.sourceKind || '').trim(),
      }));
      latestDataTableRelatedSources = allDerivedColumns.filter(def => def.sourceKind === 'related').map(def => ({
        key: def.key,
        label: def.label,
        relationName: def.relationName,
        relationLabel: def.relationLabel,
        description: def.description || '',
        type: def.type || '',
        groupedType: def.groupedType || '',
        sourceMode: def.sourceMode || '',
        availableModes: Array.isArray(def.availableModes) ? def.availableModes.slice() : [],
        sourceKind: 'related',
        selected: selectedSourceKeySet.has(def.key),
        defaultSelected: def.defaultSelected !== false,
      }));
      latestDataTableStudySources = STUDY_PROGRESS_COLUMN_DEFS.map(def => ({ ...def, selected: selectedSourceKeySet.has(def.key) }));

      const tbl = createTable({
        store,
        headers: configured.headers,
        rows: configured.rows,
        searchHeaders: allHeaders,
        searchRows: allRows,
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
        const total = visible;
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
        corner.textContent = parts.join(' • ');
        corner.title = titleParts.join('\n');
      }
      } catch (e) {
        // ignore
      }
    });
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

























