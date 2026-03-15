import { createTable } from '../components/table.js';
import { card, el } from '../components/ui.js';
import { createDropdown } from '../components/dropdown.js';
import { createJsonViewer } from '../components/jsonViewer.js';
import { buildImportFeedback } from '../utils/common/collectionImportFeedback.mjs';
import { validateEntriesAgainstSchema } from '../utils/common/validation.mjs';
import { parseCollectionImportInput } from '../utils/common/collectionImport.mjs';
import { openTableSettingsDialog } from '../components/dialogs/tableSettingsDialog.js';
import manageCollectionsViewController from '../controllers/manageCollectionsViewController.js';
import {
  normalizeTableSettings,
  applyTableColumnSettings,
  applyTableColumnStyles,
  applyTableActionSettings,
  buildTableColumnItems,
  attachCardTableSettingsButton,
} from '../utils/browser/tableSettings.js';

const TABLE_ACTION_ITEMS = [
  { key: 'clear', label: 'Clear' },
  { key: 'copyJson', label: 'Copy JSON' },
  { key: 'copyFullJson', label: 'Copy Full JSON' },
];

function safeJsonStringify(v, space = 2) {
  try { return JSON.stringify(v, null, space); } catch { return String(v ?? ''); }
}

function shortId(s, n = 10) {
  const t = String(s || '');
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

async function copyToClipboard(text) {
  const t = String(text ?? '');
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (e) {}

  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

function downloadTextFile({ fileName, content, mimeType = 'application/json' } = {}) {
  try {
    const name = String(fileName || '').trim() || 'download.json';
    const text = String(content ?? '');
    const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function detectArrayKey(collection) {
  if (!collection || typeof collection !== 'object') return 'entries';
  for (const k of ['entries', 'sentences', 'paragraphs', 'items', 'cards']) {
    if (Array.isArray(collection[k])) return k;
  }
  for (const [k, v] of Object.entries(collection)) {
    if (k === 'metadata' || k === 'schema') continue;
    if (Array.isArray(v)) return k;
  }
  return 'entries';
}

// Schema/entries validation provided by ../utils/common/validation.mjs

function preJson(v, maxHeight = '18rem') {
  return el('pre', {
    className: 'mc-pre',
    style: { maxHeight },
    text: safeJsonStringify(v, 2),
  });
}

// Simple JSON rendering: a single wrapper containing a pre element.
// We intentionally avoid the internal collapse toggle here — the
// top-level `toggleJsonBtn` and `jsonWrapBtn` control collapse/wrap.

function makeDetailsItem({ summaryLeft, summaryRight, children = [] } = {}) {
  const details = el('details', { className: 'mc-details' });
  const summary = el('summary', {
    className: 'mc-details-summary',
    children: [
      el('div', { className: 'mc-details-summary-left', text: String(summaryLeft || '') }),
      el('div', { className: 'mc-details-summary-right', text: String(summaryRight || '') }),
    ]
  });
  details.append(summary, ...children.filter(Boolean));
  return details;
}

function getEntryKeyField(collection, arrayKey) {
  const meta = collection?.metadata && typeof collection.metadata === 'object' ? collection.metadata : null;
  const ek = meta && typeof meta.entry_key === 'string' ? meta.entry_key.trim() : '';
  if (ek) return ek;
  const arr = Array.isArray(collection?.[arrayKey]) ? collection[arrayKey] : [];
  const sample = arr.find(x => x && typeof x === 'object');
  if (!sample) return '';
  if ('id' in sample) return 'id';
  if (arrayKey === 'sentences' && 'ja' in sample) return 'ja';
  if ('key' in sample) return 'key';
  if ('kanji' in sample) return 'kanji';
  return '';
}

export function renderManageCollections({ store, onNavigate }) {
  const root = document.createElement('div');
  root.id = 'manage-collections-root';

  // Header tools removed — collection selection and version controls
  // are handled elsewhere (collection browser / Activate action).

  // Collection dropdown removed — collection selection is handled by
  // the external collection browser. No in-view dropdown is needed.

  const layout = document.createElement('div');
  layout.className = 'mc-layout';

  // Left: JSON preview
  const left = document.createElement('div');
  left.className = 'mc-left';

  const jsonWrap = document.createElement('div');
  jsonWrap.className = 'mc-json-wrap';
  jsonWrap.id = 'mc-snapshot';

  const jsonHeaderRow = document.createElement('div');
  jsonHeaderRow.className = 'mc-json-header-row';
  const jsonModeRow = document.createElement('div');
  jsonModeRow.className = 'mc-json-mode-row';
  jsonModeRow.id = 'mc-snapshot-buttons';

  const snapshotToggleBtn = document.createElement('button');
  snapshotToggleBtn.type = 'button';
  snapshotToggleBtn.className = 'btn small';
  snapshotToggleBtn.textContent = 'Show Preview';
  snapshotToggleBtn.disabled = true;

  // collapse/expand handled by the JSON viewer itself; no toggle button needed


  // IDs for inner viewer elements so behavior is unambiguous
  const JSON_WRAPPER_ID = 'mc-snapshot-wrapper';
  const JSON_PRE_ID = 'mc-snapshot-pre';

  // track whether we've built the full JSON HTML blob yet
  let jsonBuilt = false;
  // track whether the JSON viewer is currently visible (expanded)
  let jsonVisible = false;


  // (copy full JSON button removed; use Export/Copy actions elsewhere)

  // group buttons into logical clusters
  const grp1 = document.createElement('div'); grp1.className = 'mc-json-group'; grp1.append(snapshotToggleBtn);
  // Copy AI Prompt button: copies a blurb + metadata + schema + a diverse sample of entries
  const copyAiBtn = document.createElement('button');
  copyAiBtn.type = 'button';
  copyAiBtn.className = 'btn small';
  copyAiBtn.textContent = 'Copy AI Prompt';
  copyAiBtn.title = 'Copy metadata, schema, and example entries for an AI prompt';
  copyAiBtn.addEventListener('click', async () => {
    try {
      const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
      if (!src) { setStatus('No collection loaded to build AI prompt.'); return; }

      const meta = (src.metadata && typeof src.metadata === 'object') ? src.metadata : (src.metadata ?? {});
      // exclude relatedCollections from the AI prompt metadata
      const metaForPrompt = (meta && typeof meta === 'object') ? { ...meta } : meta;
      try { if (metaForPrompt && typeof metaForPrompt === 'object') delete metaForPrompt.relatedCollections; } catch (e) {}
      const schema = Array.isArray(src?.metadata?.schema) ? src.metadata.schema : (Array.isArray(src?.schema) ? src.schema : []);
      const arrayKey = detectArrayKey(src) || 'entries';
      const entriesArr = Array.isArray(src[arrayKey]) ? src[arrayKey] : [];

      // New sampling strategy:
      // 1) Sample ~100 entries evenly across the collection: indices floor(i * total / 100) for i=0..99
      // 2) From that sample, try to find a field (schema order or entry keys) whose distinct value
      //    count across the sample is between 5 and 20 (i.e., grouped). If found, return one example
      //    entry per distinct value. Otherwise fall back to a small diverse slice.
      const examples = (function buildExamples() {
        if (!Array.isArray(entriesArr) || !entriesArr.length) return [];
        const total = entriesArr.length;
        // collect ~100 evenly spaced indices (deduplicated)
        const idxSet = new Set();
        for (let i = 0; i < 100; i++) {
          const idx = Math.floor(i * total / 100);
          idxSet.add(Math.min(total - 1, Math.max(0, idx)));
        }
        const sampled = Array.from(idxSet).sort((a, b) => a - b).map(i => entriesArr[i]).filter(Boolean);

        // derive candidate field keys from schema first, then from a sample entry
        let fieldKeys = [];
        if (Array.isArray(schema) && schema.length) {
          fieldKeys = schema.map(f => (f && typeof f === 'object' ? f.key : null)).filter(Boolean);
        }
        if (!fieldKeys.length) {
          const firstObj = entriesArr.find(e => e && typeof e === 'object');
          if (firstObj) fieldKeys = Object.keys(firstObj || []);
        }

        // helper to stringify a field value for counting/distinctness
        const valKey = (v) => {
          try { return safeJsonStringify(v); } catch (e) { return String(v); }
        };

        // find counts per distinct value for each candidate field
        let groupingKey = null;
        let bestCounts = null;
        for (const k of fieldKeys) {
          const counts = new Map();
          for (const e of sampled) {
            const v = e && typeof e === 'object' ? e[k] : undefined;
            const vk = valKey(v);
            counts.set(vk, (counts.get(vk) || 0) + 1);
            if (counts.size > 200) break; // too many distinct values, skip
          }
          const distinct = counts.size;
          if (distinct >= 5) {
            // prefer fields with moderate distinct counts; accept if distinct <= 200
            groupingKey = k;
            bestCounts = counts;
            break;
          }
        }

        // fallback: small evenly spaced sample (up to 5)
        function limitRelatedCollections(entry) {
          if (!entry || typeof entry !== 'object') return entry;
          const copy = { ...entry };
          if (copy.relatedCollections && typeof copy.relatedCollections === 'object') {
            const rc = {};
            for (const [rk, rv] of Object.entries(copy.relatedCollections)) {
              if (Array.isArray(rv)) rc[rk] = rv.length ? [rv[0]] : [];
              else rc[rk] = rv;
            }
            copy.relatedCollections = rc;
          }
          return copy;
        }

        if (!groupingKey || !bestCounts) {
          const take = Math.min(5, sampled.length);
          return sampled.slice(0, take).map(limitRelatedCollections);
        }

        // pick the top 5 most popular distinct values and return one representative entry per value
        const topValues = Array.from(bestCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
        const reps = [];
        for (const tv of topValues) {
          const found = sampled.find(e => valKey(e && e[groupingKey]) === tv) || entriesArr.find(e => valKey(e && e[groupingKey]) === tv);
          if (found) reps.push(limitRelatedCollections(found));
        }
        return reps.slice(0, 5);
      })();

      // remove relatedCollections from example entries for the AI prompt
      const examplesForPrompt = Array.isArray(examples) ? examples.map(e => {
        if (!e || typeof e !== 'object') return e;
        const c = { ...e };
        try { delete c.relatedCollections; } catch (err) {}
        return c;
      }) : examples;

      const blurb = `Context: I will paste the metadata, schema, and several example entries from a collection. Using the provided schema, please produce new entries that match the schema and reflect the concepts shown in the examples. Return only a JSON array of new entries.`;

      const parts = [];
      parts.push(blurb);
      parts.push('\nMetadata:\n' + safeJsonStringify(metaForPrompt, 0));
      // parts.push('\nSchema:\n' + safeJsonStringify(schema, 0)); // schema already in metadata
      parts.push('\nExamples:\n' + safeJsonStringify(examplesForPrompt, 0));
      parts.push('\nInstructions:\n- Produce new entries that follow the schema exactly.\n- Output only a JSON array of entries (no extra text).');

      const promptText = parts.join('\n\n');
      await copyToClipboard(promptText);
      setStatus('Copied AI prompt to clipboard.');
    } catch (e) {
      setStatus('Failed to copy AI prompt.');
    }
  });
  grp1.append(copyAiBtn);

  const downloadSnapshotBtn = document.createElement('button');
  downloadSnapshotBtn.type = 'button';
  downloadSnapshotBtn.className = 'btn small';
  downloadSnapshotBtn.textContent = '⬇ Snapshot';
  downloadSnapshotBtn.title = 'Download snapshot JSON using current selected fields';
  downloadSnapshotBtn.addEventListener('click', async () => {
    try {
      const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
      if (!src) { setStatus('No snapshot loaded to download.'); return; }

      const filtered = buildFilteredSnapshot(src);
      const collectionPart = String(collectionKey || 'collection')
        .replace(/\.json$/i, '')
        .replace(/[\\/]+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const modePart = currentJsonMode === 'preview' ? 'preview' : 'current';
      const fileName = `${collectionPart}.snapshot.${modePart}.json`;
      const ok = downloadTextFile({ fileName, content: safeJsonStringify(filtered, 2), mimeType: 'application/json' });
      if (ok) setStatus(`Downloaded snapshot JSON: ${fileName}`);
      else setStatus('Failed to download snapshot JSON.');
    } catch (e) {
      setStatus('Failed to download snapshot JSON.');
    }
  });
  grp1.append(downloadSnapshotBtn);

  // grp2 removed — per-view wrapping handled by the JSON viewer component
  // JSON fields dropdown (multi-select)
  const jsonFieldsItems = [
    { value: 'metadata', label: 'Metadata' },
    { value: 'schema', label: 'Schema' },
    { value: 'entries', label: 'Entries' },
    { value: 'relatedCollections', label: 'Related Collections' },
  ];
  let jsonFieldsSelected = jsonFieldsItems.map(i => i.value);
  const jsonFieldsMount = document.createElement('div');
  jsonFieldsMount.className = 'mc-json-group';
  // createDropdown may be provided globally or as an import; guard access
  const createDropdownFn = (typeof createDropdown === 'function') ? createDropdown : (window && window.createDropdown ? window.createDropdown : null);
  let jsonFieldsDropdown = null;
  if (createDropdownFn) {
    jsonFieldsDropdown = createDropdownFn({
      items: jsonFieldsItems,
      values: jsonFieldsSelected,
      multi: true,
      commitOnClose: true,
      getButtonLabel: ({ selectedValues }) => {
        if (!selectedValues || !selectedValues.length) return 'Fields: none';
        if (selectedValues.length === jsonFieldsItems.length) return 'Fields: all';
        return `Fields: ${selectedValues.length}`;
      },
      onChange: (vals) => {
        if (vals === 'all') jsonFieldsSelected = jsonFieldsItems.map(i => i.value);
        else jsonFieldsSelected = Array.isArray(vals) ? vals.map(v => String(v)) : [];
        // re-render snapshot viewer if currently visible
        renderJson(currentJsonMode);
      }
    });
    jsonFieldsMount.append(jsonFieldsDropdown);
  }
  jsonModeRow.append(grp1, jsonFieldsMount);
  jsonHeaderRow.append(jsonModeRow);

  // mount for the JSON viewer widget
  const jsonViewerMount = document.createElement('div');
  jsonViewerMount.className = 'mc-json-mount';
  jsonViewerMount.id = 'mc-snapshot-json';
  // viewer expose handle so we can update JSON without recreating the component
  let jsonViewerExpose = {};
  let jsonViewerWidget = null;

  jsonWrap.append(jsonHeaderRow, jsonViewerMount);
  left.append(card({ id: 'mc-snapshot-card', title: 'Snapshot', className: 'mc-card', children: [el('p', { className: 'hint', text: 'Shows the current collection JSON; switch to preview to view merged changes.' }), jsonWrap] }));

  // Right: import + diffs + history
  const right = document.createElement('div');
  right.className = 'mc-right';

  const importArea = document.createElement('textarea');
  importArea.className = 'mc-import';
  importArea.placeholder = 'Paste entry JSON here (entries array, entries object, or entry patch payload)…';
  importArea.spellcheck = false;
  importArea.title = 'Paste JSON or drag and drop a file here';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'mc-label-input';
  labelInput.placeholder = 'Optional label for this submission (e.g., "add N3 yokai")';
  labelInput.spellcheck = false;

  const parseBtn = document.createElement('button');
  parseBtn.type = 'button';
  parseBtn.className = 'btn';
  parseBtn.textContent = 'Parse & Diff';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear';

  const saveDiffBtn = document.createElement('button');
  saveDiffBtn.type = 'button';
  saveDiffBtn.className = 'btn primary';
  saveDiffBtn.textContent = 'Save Diff';
  saveDiffBtn.disabled = true;

  const saveSnapshotBtn = document.createElement('button');
  saveSnapshotBtn.type = 'button';
  saveSnapshotBtn.className = 'btn primary';
  saveSnapshotBtn.textContent = 'Save Snapshot';
  saveSnapshotBtn.disabled = true;
  saveSnapshotBtn.style.display = 'none';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'mc-actions-row';
  // place the label input inline with the action buttons so they read as a group
  actionsRow.append(parseBtn, clearBtn, labelInput, saveDiffBtn, saveSnapshotBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'mc-status';
  statusEl.textContent = '';

  const warningsEl = document.createElement('div');
  warningsEl.className = 'mc-warnings';
  warningsEl.textContent = '';

  // persistent diff cards will be appended directly into the right column

  const historyMount = document.createElement('div');
  historyMount.className = 'mc-history';

  // --- persistent diff cards (always present, initially empty) ---
  const editedBody = el('div', { id: 'mc-diff-edited-body', className: 'mc-diff-list' });
  const editedHint = el('p', { className: 'hint', text: 'Entries listed here will be updated with the shown changes.' });
  const editedCard = card({ id: 'mc-diff-edited', title: 'Edited Entries', cornerCaption: '', className: 'mc-card', children: [editedHint, editedBody] });

  const newBody = el('div', { id: 'mc-diff-new-body', className: 'mc-diff-list' });
  const newHint = el('p', { className: 'hint', text: 'These entries will be added to the collection.' });
  const newCard = card({ id: 'mc-diff-new', title: 'New Entries', cornerCaption: '', className: 'mc-card', children: [newHint, newBody] });

  const invalidBody = el('div', { id: 'mc-diff-invalid-body', className: 'mc-diff-list' });
  const invalidHint = el('p', { className: 'hint', text: 'Entries with missing or invalid keys/fields — will not be applied.' });
  const invalidCard = card({ id: 'mc-diff-invalid', title: 'Invalid Entries', cornerCaption: '', className: 'mc-card', children: [invalidHint, invalidBody] });

  const unchangedBody = el('div', { id: 'mc-diff-unchanged-body', className: 'mc-diff-list' });
  const unchangedHint = el('p', { className: 'hint', text: 'Entries submitted but with no detected changes; they will be ignored.' });
  const unchangedCard = card({ id: 'mc-diff-unchanged', title: 'Unchanged Entries', cornerCaption: '', className: 'mc-card', children: [unchangedHint, unchangedBody] });

  // append persistent cards (history card will be placed on the left)
  // these cards live directly in the right column (no extra wrapper)

  // place history on the left column (after historyMount is created)
  left.append(historyMount);

  right.append(
  card({ title: 'Import', className: 'mc-card', children: [el('p', { className: 'hint', text: 'Paste entry JSON only. Metadata and schema are managed in code and ignored here.' }), importArea, actionsRow, statusEl, warningsEl] }),
    unchangedCard,
    editedCard,
    newCard,
    invalidCard,
  );

  layout.append(left, right);
  root.append(layout);

  // ---- state ----
  let collectionKey = '';
  let currentCollection = null;
  let currentJsonMode = 'current'; // current | preview
  let previewResult = null; // {patch,diffs,merged,warnings}
  let revisions = [];
  let activeRevisionId = null;
  let historyTableSettings = manageCollectionsViewController.getDefaultHistoryTableSettings();
  let historyTableCtrl = null;

  function ensureHistoryTableController(collKey) {
    const key = String(collKey || '').trim();
    if (!key) {
      historyTableCtrl = null;
      historyTableSettings = manageCollectionsViewController.getDefaultHistoryTableSettings();
      return;
    }
    if (historyTableCtrl && historyTableCtrl.collKey === key) return;
    try { if (historyTableCtrl && typeof historyTableCtrl.dispose === 'function') historyTableCtrl.dispose(); } catch (e) {}
    try {
      historyTableCtrl = manageCollectionsViewController.create(key);
      historyTableSettings = normalizeTableSettings(historyTableCtrl.getHistoryTableSettings());
    } catch (e) {
      historyTableCtrl = null;
      historyTableSettings = manageCollectionsViewController.getDefaultHistoryTableSettings();
    }
  }

  async function persistHistoryTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    historyTableSettings = normalized;
    try { if (historyTableCtrl) await historyTableCtrl.setHistoryTableSettings(normalized); } catch (e) {}
    renderHistory();
  }

  // last parsed raw text (trimmed). Used to disable Parse when unchanged.
  let lastParsedRaw = null;

  function updateActionButtons() {
    try {
      const trimmed = String(importArea.value || '').trim();
      clearBtn.disabled = trimmed === '';
      // disable parse if empty or unchanged since last successful parse
      const parsedMatches = (lastParsedRaw != null && trimmed === lastParsedRaw);
      parseBtn.disabled = (trimmed === '') || parsedMatches;
      // if the current textarea differs from the last parsed text, force Save Diff disabled
      try {
        if (!parsedMatches) saveDiffBtn.disabled = true;
      } catch (e) {}
    } catch (e) {}
  }

  function setStatus(msg) {
    const txt = String(msg || '');
    statusEl.textContent = txt;
    try { if (store?.shell && typeof store.shell.setFooterLeftStatus === 'function') store.shell.setFooterLeftStatus(txt); } catch (e) {}
  }

  function setWarnings(list) {
    const arr = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!arr.length) {
      warningsEl.textContent = '';
      warningsEl.style.display = 'none';
      try { if (store?.shell && typeof store.shell.setFooterLeftWarnings === 'function') store.shell.setFooterLeftWarnings(null); } catch (e) {}
      return;
    }
    warningsEl.style.display = '';
    warningsEl.textContent = arr.map(s => `• ${String(s)}`).join('\n');
    try { if (store?.shell && typeof store.shell.setFooterLeftWarnings === 'function') store.shell.setFooterLeftWarnings(arr); } catch (e) {}
  }

  // Build a filtered snapshot object according to selected JSON fields
  function buildFilteredSnapshot(src) {
    if (!src || typeof src !== 'object') return src;
    const sel = new Set(Array.isArray(jsonFieldsSelected) ? jsonFieldsSelected : []);
    const out = {};

    // Metadata
    if (sel.has('metadata')) {
      const meta = (src.metadata && typeof src.metadata === 'object') ? { ...src.metadata } : (src.metadata ?? null);
      if (meta && !sel.has('schema')) delete meta.schema;
      if (meta !== null) out.metadata = meta;
    }

    // Schema when requested but metadata is not included: promote schema to top-level
    if (sel.has('schema') && !sel.has('metadata')) {
      const schema = Array.isArray(src?.metadata?.schema) ? src.metadata.schema : (Array.isArray(src?.schema) ? src.schema : null);
      if (schema) out.schema = schema;
    }

    // Entries / relatedCollections
    const arrayKey = detectArrayKey(src) || 'entries';
    const entriesArr = Array.isArray(src[arrayKey]) ? src[arrayKey] : [];

    const hasAnyRelated = entriesArr.some(e => e && typeof e.relatedCollections === 'object' && Object.values(e.relatedCollections).some(v => Array.isArray(v) && v.length > 0));
    const includeEntries = sel.has('entries') || (sel.has('relatedCollections') && hasAnyRelated);
    if (includeEntries) {
      // If `entries` is not selected but `relatedCollections` is, only include
      // those entries that actually have non-empty relatedCollections arrays.
      let baseList = entriesArr;
      if (!sel.has('entries') && sel.has('relatedCollections')) {
        baseList = entriesArr.filter(e => e && typeof e.relatedCollections === 'object' && Object.values(e.relatedCollections).some(v => Array.isArray(v) && v.length > 0));
      }

      const processed = baseList.map(e => {
        if (!e || typeof e !== 'object') return e;
        const copy = { ...e };
        if (!sel.has('relatedCollections')) delete copy.relatedCollections;
        return copy;
      });
      out[arrayKey] = processed;
    }

    return out;
  }

  function renderJson(mode = null) {
    const m = mode || currentJsonMode;
    const src = (m === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    const filteredSrc = buildFilteredSnapshot(src);
    // do not build the full JSON blob unless the viewer is visible (expanded)
    // If a viewer exists and exposes `setJson`, reuse it instead of clearing.
    if (!(jsonViewerExpose && typeof jsonViewerExpose.setJson === 'function')) jsonViewerMount.innerHTML = '';
    if (!src) {
      jsonViewerMount.textContent = '';
      snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
      return;
    }

    // Always update a lightweight summary / entry count (cheap) even when collapsed
    try {
      const cardEl = document.getElementById('mc-snapshot-card');
      if (cardEl) {
        const arrayKey = detectArrayKey(filteredSrc || src || {});
        const arr = Array.isArray(filteredSrc?.[arrayKey]) ? filteredSrc[arrayKey] : (Array.isArray(src?.[arrayKey]) ? src[arrayKey] : []);
        const count = Array.isArray(arr) ? arr.length : 0;
        const corner = cardEl.querySelector('.card-corner-caption');
        if (corner) corner.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
      }
    } catch (e) {}

    // If not visible, render only a lightweight placeholder (no stringify)
    if (!jsonVisible) {
      const placeholder = document.createElement('div');
      placeholder.className = 'json-view-placeholder mono';
      placeholder.textContent = '(JSON preview collapsed — click Expand to load)';
      jsonViewerMount.appendChild(placeholder);
      snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
      return;
    }

    // Visible: build the full JSON view (stringify now — lazy)
    try {
      const countKey = detectArrayKey(filteredSrc || src || {});
      const entryCount = Array.isArray((filteredSrc || {})[countKey]) ? (filteredSrc || {})[countKey].length : 0;
      console.log('[manageCollections] snapshot redraw — mode:', m, 'fields:', Array.isArray(jsonFieldsSelected) ? jsonFieldsSelected.slice() : jsonFieldsSelected, 'entries:', entryCount);
    } catch (e) {
      console.log('[manageCollections] snapshot redraw');
    }
    if (jsonViewerExpose && typeof jsonViewerExpose.setJson === 'function') {
      try { jsonViewerExpose.setJson(filteredSrc); } catch (e) {}
    } else {
      try {
        jsonViewerWidget = createJsonViewer(filteredSrc, { id: JSON_WRAPPER_ID, preId: JSON_PRE_ID, expanded: true, expose: jsonViewerExpose });
        jsonViewerMount.appendChild(jsonViewerWidget);
        jsonBuilt = true;
      } catch (e) {
        const viewer = createJsonViewer(filteredSrc, { id: JSON_WRAPPER_ID, preId: JSON_PRE_ID, expanded: true });
        jsonViewerMount.appendChild(viewer);
        jsonBuilt = true;
      }
    }
    snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
  }

  // collapse control removed — the JSON viewer manages its own collapse state.

  function refreshVersionSelect() {
    // Version select removed; keep no-op to avoid callers needing changes.
  }

  function renderDiffPanels() {
    // clear persistent bodies
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    unchangedBody.innerHTML = '';
    invalidBody.innerHTML = '';

    // helper to set corner caption for a card
    function setCorner(cardEl, text) {
      try { const c = cardEl.querySelector('.card-corner-caption'); if (c) c.textContent = text ?? ''; } catch (e) {}
    }

    if (!previewResult) {
      // no preview: clear corner captions and leave card bodies to their static hints
      setCorner(editedCard, '');
      setCorner(newCard, '');
      setCorner(invalidCard, '');
      setCorner(unchangedCard, '');
      // mark persistent cards as empty so they collapse visually
      try {
        const pairs = [
          { card: editedCard, body: editedBody },
          { card: newCard, body: newBody },
          { card: invalidCard, body: invalidBody },
          { card: unchangedCard, body: unchangedBody },
        ];
        for (const p of pairs) {
          try {
            if (p.body && p.body.children && p.body.children.length) p.card.classList.remove('mc-card-empty');
            else p.card.classList.add('mc-card-empty');
          } catch (e) {}
        }
      } catch (e) {}
      return;
    }

    const { patch, diffs } = previewResult;
    const feedback = previewResult?._importFeedback || buildImportFeedback({
      collectionKey,
      baseCollection: currentCollection,
      input: previewResult?._importInput || null,
      previewResult,
      entryValidation: null,
      patchPayloadDetected: false,
    });

    function renderEditedOrNewItem(item, { isNew = false } = {}) {
      const label = String(item?.key || '(no key)');
      const summaryBits = item?.summary ? ` • ${item.summary}` : '';
      const right = isNew
        ? `new${summaryBits}`
        : `${Array.isArray(item?.changedFields) ? item.changedFields.length : 0} field(s)${summaryBits}`;

      const before = item?.before ?? null;
      const after = item?.after ?? item?.entry ?? null;
      const minimalBefore = item?.minimalBefore ?? null;
      const minimalAfter = item?.minimalAfter ?? null;

      const toggleBtn = el('button', { className: 'btn small', text: 'Show Diffs', attrs: { type: 'button' } });
      const beforeCopyBtn = before ? el('button', { className: 'btn small', text: 'Copy Before', attrs: { type: 'button' } }) : null;
      const afterCopyBtn = el('button', { className: 'btn small', text: isNew ? 'Copy Entry' : 'Copy After', attrs: { type: 'button' } });
      const copyRow = el('div', { className: 'mc-diff-actions', children: [toggleBtn, beforeCopyBtn, afterCopyBtn].filter(Boolean) });

      const beforePre = before ? preJson(before, '18rem') : null;
      const afterPre = preJson(after, isNew ? '22rem' : '18rem');

      let showDiffOnly = true;
      const applyView = (diffOnly) => {
        try {
          if (beforePre) beforePre.textContent = safeJsonStringify(diffOnly && minimalBefore ? minimalBefore : before, 2);
          if (afterPre) afterPre.textContent = safeJsonStringify(diffOnly && minimalAfter ? minimalAfter : after, 2);
        } catch (e) {}
      };

      if ((!isNew && !(item?.changedFields || []).length) || (isNew && !minimalAfter)) showDiffOnly = false;
      applyView(showDiffOnly);
      toggleBtn.textContent = showDiffOnly ? 'Show Full' : 'Show Diffs';
      toggleBtn.addEventListener('click', () => {
        showDiffOnly = !showDiffOnly;
        applyView(showDiffOnly);
        toggleBtn.textContent = showDiffOnly ? 'Show Full' : 'Show Diffs';
      });

      if (beforeCopyBtn) {
        beforeCopyBtn.addEventListener('click', async () => {
          const value = showDiffOnly && minimalBefore ? minimalBefore : before;
          await copyToClipboard(safeJsonStringify(value, 2));
          setStatus('Copied before entry JSON.');
        });
      }
      if (afterCopyBtn) {
        afterCopyBtn.addEventListener('click', async () => {
          const value = showDiffOnly && minimalAfter ? minimalAfter : after;
          await copyToClipboard(safeJsonStringify(value, 2));
          setStatus('Copied entry JSON.');
        });
      }

      const body = el('div', {
        className: 'mc-diff-body',
        children: [
          copyRow,
          isNew
            ? el('div', { className: 'mc-single-col', children: [afterPre] })
            : el('div', {
              className: 'mc-diff-cols',
              children: [
                el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'Before' }), beforePre] }),
                el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'After' }), afterPre] }),
              ]
            }),
          (!isNew && Array.isArray(item?.changedFields) && item.changedFields.length)
            ? el('div', { className: 'mc-fields', children: [
              el('div', { className: 'mc-fields-title', text: 'Changed fields' }),
              el('div', { className: 'mc-fields-list', text: item.changedFields.join(', ') })
            ]})
            : null,
        ].filter(Boolean)
      });

      return { key: label, node: makeDetailsItem({ summaryLeft: label, summaryRight: right, children: [body] }) };
    }

    const editedItems = (Array.isArray(feedback?.edited) ? feedback.edited : []).map((item) => renderEditedOrNewItem(item, { isNew: false }));
    const newItems = (Array.isArray(feedback?.added) ? feedback.added : []).map((item) => renderEditedOrNewItem(item, { isNew: true }));
    const unchangedItems = (Array.isArray(feedback?.unchanged) ? feedback.unchanged : []).map((item) => {
      const label = String(item?.key || '(no key)');
      const right = `unchanged${item?.summary ? ` • ${item.summary}` : ''}`;
      const body = el('div', { className: 'mc-diff-body', children: [el('div', { className: 'mc-single-col', children: [preJson(item?.entry ?? item?.after ?? null, '18rem')] })] });
      return { key: label, node: makeDetailsItem({ summaryLeft: label, summaryRight: right, children: [body] }) };
    });
    const invalidItems = (Array.isArray(feedback?.invalid) ? feedback.invalid : []).map((item) => {
      const label = String(item?.key || '(no key)');
      const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
      const body = el('div', {
        className: 'mc-diff-body',
        children: [el('div', { className: 'mc-single-col', children: [preJson(item?.entry ?? null, '18rem'), el('div', { className: 'mc-validation-messages', text: reasons.join('; ') })] })]
      });
      return { key: label, node: makeDetailsItem({ summaryLeft: label, summaryRight: `invalid • ${reasons.length ? reasons.join('; ') : 'invalid'}`, children: [body] }) };
    });
    if (editedItems.length) {
      setCorner(editedCard, `${editedItems.length}`);
      const list = el('div', { className: 'mc-diff-list', children: editedItems.sort((a, b) => String(a.key).localeCompare(String(b.key))).map(x => x.node) });
      editedBody.append(list);
    } else {
      setCorner(editedCard, '');
      // leave editedBody empty; the static hint lives in the card header
    }

    if (newItems.length) {
      setCorner(newCard, `${newItems.length}`);
      const list = el('div', { className: 'mc-diff-list', children: newItems.sort((a, b) => String(a.key).localeCompare(String(b.key))).map(x => x.node) });
      newBody.append(list);
    } else {
      setCorner(newCard, '');
      // leave newBody empty; the static hint lives in the card header
    }

    if (unchangedItems.length) {
      setCorner(unchangedCard, `${unchangedItems.length}`);
      const list = el('div', { className: 'mc-diff-list', children: unchangedItems.sort((a, b) => String(a.key).localeCompare(String(b.key))).map(x => x.node) });
      unchangedBody.append(list);
    } else {
      setCorner(unchangedCard, '');
      // leave unchangedBody empty; the static hint lives in the card header
    }

    if (invalidItems.length) {
      setCorner(invalidCard, `${invalidItems.length}`);
      const list = el('div', { className: 'mc-diff-list', children: invalidItems.sort((a, b) => String(a.key).localeCompare(String(b.key))).map(x => x.node) });
      invalidBody.append(list);
    } else {
      setCorner(invalidCard, '');
      // leave invalidBody empty; the static hint lives in the card header
    }
    // toggle compact class for persistent diff cards based on whether they have content
    try {
      const pairs = [
        { card: editedCard, body: editedBody },
        { card: newCard, body: newBody },
        { card: invalidCard, body: invalidBody },
        { card: unchangedCard, body: unchangedBody },
      ];
      for (const p of pairs) {
        try {
          if (p.body && p.body.children && p.body.children.length) p.card.classList.remove('mc-card-empty');
          else p.card.classList.add('mc-card-empty');
        } catch (e) {}
      }
    } catch (e) {}
    try {
      setWarnings(Array.isArray(feedback?.messages?.warnings) ? feedback.messages.warnings.slice() : []);
    } catch (e) {}

    // Enable/disable Save Diff depending on whether there are meaningful changes
    try {
      const ne = Number(feedback?.summary?.added || diffs?.newEntries || 0);
      const ed = Number(feedback?.summary?.edited || diffs?.editedEntries || 0);
      const meaningful = (ne + ed) > 0;
      const hasInvalid = !!(invalidItems && invalidItems.length);
      const readOnlyPatchView = !!previewResult?._readOnlyPatchView;
      saveDiffBtn.disabled = readOnlyPatchView || !meaningful || hasInvalid || !previewResult?.patch;
      // visually indicate error state by toggling a scoped class
      try {
        if (hasInvalid) saveDiffBtn.classList.add('mc-save-invalid');
        else saveDiffBtn.classList.remove('mc-save-invalid');
      } catch (e) {}
    } catch (e) {
      try { saveDiffBtn.disabled = true; } catch (err) {}
    }
  }

  function clearDiffPanels() {
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    unchangedBody.innerHTML = '';
    invalidBody.innerHTML = '';
  }

  async function viewRevisionPatch(revisionId) {
    const rid = String(revisionId || '').trim();
    if (!rid) return;
    const rec = (Array.isArray(revisions) ? revisions.find(x => x && x.id === rid) : null);
    if (!rec) return;
    if (rec.kind !== 'diff' || !rec.patch || typeof rec.patch !== 'object') {
      clearDiffPanels();
      previewResult = null;
      setWarnings([]);
      setStatus('This revision does not have a patch to view.');
      return;
    }

    try {
      let base = null;
      if (rec.parentId) {
        base = await store.collectionDB.resolveCollectionAtRevision(collectionKey, rec.parentId).catch(() => null);
      } else {
        base = await store.collectionDB.getSystemCollection(collectionKey).catch(() => null);
      }
      const merged = await store.collectionDB.resolveCollectionAtRevision(collectionKey, rid).catch(() => null);
      const arrayKey = String(rec.patch?.targetArrayKey || detectArrayKey(base || merged || {}) || 'entries');
      const importInput = { [arrayKey]: Array.isArray(rec.patch?.entries?.upsert) ? rec.patch.entries.upsert.slice() : [] };
      const diffs = {
        arrayKey,
        entryKeyField: rec.patch?.entryKeyField || '',
        metadataChanges: 0,
        schemaChanges: 0,
        entriesUpsert: Number(Array.isArray(rec.patch?.entries?.upsert) ? rec.patch.entries.upsert.length : 0),
        entriesRemove: 0,
        newEntries: 0,
        editedEntries: 0,
      };

      previewResult = {
        patch: rec.patch,
        diffs,
        merged,
        warnings: [],
        _importInput: importInput,
        _readOnlyPatchView: true,
      };
      previewResult._importFeedback = buildImportFeedback({
        collectionKey,
        baseCollection: base,
        input: importInput,
        previewResult,
        entryValidation: { entryErrors: [], entryWarnings: [], warnings: [] },
        patchPayloadDetected: true,
      });

      clearDiffPanels();
      renderDiffPanels();
      setWarnings([]);
      setStatus(`Viewing patch for revision ${shortId(rid, 16)}.`);
      try { editedCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    } catch (e) {
      setStatus(`Failed to view patch: ${e?.message || e}`);
    }
  }

  function renderHistory() {
    historyMount.innerHTML = '';
    ensureHistoryTableController(collectionKey);

    function buildPatchExportPayload(rec) {
      const targetCollectionKey = String(rec?.collectionKey || collectionKey || '').trim() || null;
      if (rec?.kind === 'system') {
        return { id: rec.id, kind: rec.kind, collectionKey: targetCollectionKey, label: rec.label, blob: rec.blob };
      }
      return { id: rec?.id, kind: rec?.kind, collectionKey: targetCollectionKey, parentId: rec?.parentId ?? null, label: rec?.label ?? null, patch: rec?.patch ?? null };
    }

    function buildPatchExportFileName(rec) {
      const kind = String(rec?.kind || 'diff').trim() || 'diff';
      const collectionPart = String(rec?.collectionKey || collectionKey || 'collection')
        .replace(/\.json$/i, '')
        .replace(/[\\/]+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const idPart = String(rec?.id || 'revision').replace(/[^a-zA-Z0-9._-]/g, '_');
      return `${collectionPart}.${kind}.${idPart}.json`;
    }

    const rows = (Array.isArray(revisions) ? revisions.slice().reverse() : []).map(r => {
      const label = r.label || (r.kind === 'system' ? 'System base' : '');
      const active = ((r.id && activeRevisionId && r.id === activeRevisionId) || (r.kind === 'system' && !activeRevisionId)) ? 'active' : '';
      const kind = r.kind || 'diff';
      const created = r.createdAt || '';
      const parent = r.parentId ? shortId(r.parentId, 10) : '';
      const patch = r.patch;
      let pSummary = '';
      if (r.kind === 'system' && r.blob) {
        try {
          const ak = detectArrayKey(r.blob || {});
          const arr = Array.isArray(r.blob?.[ak]) ? r.blob[ak] : [];
          pSummary = `${arr.length} ${arr.length === 1 ? 'entry' : 'entries'}`;
        } catch (e) { pSummary = '' }
      } else {
        pSummary = (patch && typeof patch === 'object')
          ? `${(patch.entries?.upsert?.length || 0)}u`
          : '';
      }
      const arr = [active, kind, created, shortId(r.id, 12), label, parent, pSummary];
      try { arr.__id = r.id; } catch (e) {}
      return arr;
    });

    const rowActions = [
      {
        label: 'Activate',
        title: 'Set as active revision',
        className: 'btn small',
        onClick: async (rowData, rowIndex, { tr }) => {
          const rid = tr?.dataset?.rowId || rowData.__id;
          if (!rid) return;
          try {
            if (rid === '__system__') {
              store.collectionDB.setActiveRevisionId(collectionKey, null);
            } else {
              store.collectionDB.setActiveRevisionId(collectionKey, rid);
            }

            if (store?.collections?.getActiveCollectionId?.() === collectionKey && typeof store?.collections?.loadCollection === 'function') {
              await store.collections.loadCollection(collectionKey, { force: true });
            }

            await loadCurrent();
            setStatus(`Activated revision ${shortId(rid, 16)}.`);
          } catch (e) {
            setStatus(`Failed to activate revision: ${e?.message || e}`);
          }
        }
      },
      {
        label: 'View Patch',
        title: 'Populate edited/new entries from this saved patch',
        className: 'btn small',
        onClick: async (rowData, rowIndex, { tr }) => {
          const rid = tr?.dataset?.rowId || rowData.__id;
          if (!rid) return;
          await viewRevisionPatch(rid);
        }
      },
      {
        label: '⬇',
        title: 'Download patch JSON for this revision',
        className: 'btn small',
        onClick: async (rowData, rowIndex, { tr }) => {
          const rid = tr?.dataset?.rowId || rowData.__id;
          const rec = (Array.isArray(revisions) ? revisions.find(x => x && x.id === rid) : null);
          if (!rec) return;
          const payload = buildPatchExportPayload(rec);
          const fileName = buildPatchExportFileName(rec);
          const ok = downloadTextFile({ fileName, content: safeJsonStringify(payload, 2), mimeType: 'application/json' });
          if (ok) setStatus(`Downloaded patch JSON: ${fileName}`);
          else setStatus('Failed to download patch JSON.');
        }
      },
      {
        label: 'Copy Patch',
        title: 'Copy patch JSON for this revision',
        className: 'btn small',
        onClick: async (rowData, rowIndex, { tr }) => {
          const rid = tr?.dataset?.rowId || rowData.__id;
          const rec = (Array.isArray(revisions) ? revisions.find(x => x && x.id === rid) : null);
          if (!rec) return;
          const payload = buildPatchExportPayload(rec);
          await copyToClipboard(safeJsonStringify(payload, 2));
          setStatus('Copied patch JSON.');
        }
      }
    ];

    const historyHeaders = ['active', 'kind', 'createdAt', 'id', 'label', 'parent', 'summary'];
    const applied = applyTableColumnSettings({ headers: historyHeaders, rows, tableSettings: historyTableSettings });

    const table = createTable({
      headers: applied.headers,
      rows: applied.rows,
      columnRenderSettings: (historyTableSettings?.columns?.stylesByKey || {}),
      tableRenderSettings: historyTableSettings?.table || {},
      sortable: true,
      searchable: true,
      rowActions,
      getRowClassName: (rowData) => {
        const rid = String(rowData?.__id || '').trim();
        if (!rid) return '';
        if (rid === '__system__' && !activeRevisionId) return 'mc-history-row-active';
        if (activeRevisionId && rid === activeRevisionId) return 'mc-history-row-active';
        return '';
      },
    });
    applyTableColumnStyles({ wrapper: table, tableSettings: historyTableSettings });
    applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings: historyTableSettings, actionItems: TABLE_ACTION_ITEMS });

    const historyCard = card({
      title: 'History',
      cornerCaption: `${revisions.length} revisions`,
      className: 'mc-card',
      children: [el('p', { className: 'hint', text: 'List of saved revisions — activate a revision or inspect its saved patch from here.' }), table]
    });

    attachCardTableSettingsButton({
      cardEl: historyCard,
      onClick: async () => {
        const next = await openTableSettingsDialog({
          tableName: 'Manage Collections History Table',
          sourceInfo: `${collectionKey} | ${revisions.length} revisions`,
          columns: buildTableColumnItems(historyHeaders, rows),
          actions: TABLE_ACTION_ITEMS,
          settings: historyTableSettings,
        });
        if (next) await persistHistoryTableSettings(next);
      },
    });

    historyMount.append(historyCard);
  }

  async function loadHistory() {
    try {
      revisions = await store.collectionDB.listUserRevisions(collectionKey);
    } catch (e) {
      revisions = [];
    }

    let systemModifiedAt = '';
    try {
      const available = await store.collectionDB.listAvailableCollections();
      const rows = Array.isArray(available) ? available : [];
      const idx = rows.find(r => String(r?.key || r?.path || '').trim() === String(collectionKey || '').trim()) || null;
      systemModifiedAt = (idx && typeof idx.modifiedAt === 'string') ? idx.modifiedAt : '';
    } catch (e) {
      systemModifiedAt = '';
    }

    // Try to include the system/base collection as the first history item
    try {
      const sys = await store.collectionDB.getSystemCollection(collectionKey).catch(() => null);
      if (sys) {
        const sysRec = { id: '__system__', collectionKey, kind: 'system', createdAt: systemModifiedAt || '', parentId: null, label: 'System base', blob: sys, patch: null };
        revisions = [sysRec, ...(Array.isArray(revisions) ? revisions : [])];
      }
    } catch (e) {
      // ignore
    }

    activeRevisionId = store.collectionDB.getActiveRevisionId(collectionKey);
    renderHistory();
  }

  async function loadCurrent() {
    setStatus('');
    setWarnings([]);
    previewResult = null;
    saveDiffBtn.disabled = true;
    saveSnapshotBtn.disabled = true;
    saveSnapshotBtn.style.display = 'none';
    snapshotToggleBtn.disabled = true;

    activeRevisionId = store.collectionDB.getActiveRevisionId(collectionKey);

    try {
      currentCollection = await store.collectionDB.getCollection(collectionKey, { force: true });
      currentJsonMode = 'current';
      renderJson('current');
    } catch (e) {
      currentCollection = null;
      try { jsonViewerMount.textContent = ''; } catch (err) {}
      setStatus(`Failed to load collection: ${e?.message || e}`);
    }

    await loadHistory();
  }

  function initKeyFromActive() {
    const active = store?.collections?.getActiveCollection?.();
    const k = active?.key || active?.path || '';
    collectionKey = String(k || '').trim();
  }

  // ---- events ----

  // Set-active control removed; use History -> Activate instead.

  

  snapshotToggleBtn.addEventListener('click', () => {
    if (currentJsonMode === 'preview') {
      currentJsonMode = 'current';
      snapshotToggleBtn.textContent = 'Show Preview';
      renderJson('current');
    } else {
      if (!previewResult?.merged) return;
      currentJsonMode = 'preview';
      snapshotToggleBtn.textContent = 'Show Current';
      renderJson('preview');
    }
  });

  // collapse/expand handled by the JSON viewer; no handler needed

  // copy full JSON control removed
  // copyMeta/copySchema/copyTemplate controls removed from header.

  clearBtn.addEventListener('click', () => {
    importArea.value = '';
    labelInput.value = '';
    previewResult = null;
    saveDiffBtn.disabled = true;
    saveSnapshotBtn.disabled = true;
    saveSnapshotBtn.style.display = 'none';
    clearDiffPanels();
    setStatus('');
    setWarnings([]);
    currentJsonMode = 'current';
    renderJson('current');
    lastParsedRaw = null;
    updateActionButtons();
  });

  parseBtn.addEventListener('click', async () => {
    setStatus('');
    setWarnings([]);
    saveDiffBtn.disabled = true;
    saveSnapshotBtn.disabled = true;
    saveSnapshotBtn.style.display = 'none';
    // hold per-entry validation results here so we can attach to previewResult
    let entryValidation = null;
    let patchPayloadDetected = false;
    clearDiffPanels();

    const raw = String(importArea.value || '').trim();
    if (!raw) return;

    let inputForPreview = null;
    try {
      const parsedImport = parseCollectionImportInput({
        rawInput: raw,
        collectionKey,
        defaultArrayKey: detectArrayKey(currentCollection || {}) || 'entries',
        allowFullCollection: false,
      });
      inputForPreview = parsedImport.input;
      patchPayloadDetected = !!parsedImport.patchPayloadDetected;
    } catch (e) {
      setStatus(String(e?.message || e || 'Invalid JSON.'));
      return;
    }

    try {
      // Validate entries against the current collection schema.
      try {
        const ik = detectArrayKey(inputForPreview || {}) || 'entries';
        const inputEntries = Array.isArray(inputForPreview?.[ik]) ? inputForPreview[ik] : (Array.isArray(inputForPreview) ? inputForPreview : []);
        const baseSchemaArr = Array.isArray(currentCollection?.metadata?.schema)
          ? currentCollection.metadata.schema
          : (Array.isArray(currentCollection?.schema) ? currentCollection.schema : null);
        const schemaToUse = baseSchemaArr || null;
        if (schemaToUse && inputEntries && inputEntries.length) {
          // validate entries but don't abort — surface per-entry errors in the Invalid card
          try {
            const ev = validateEntriesAgainstSchema(inputEntries, schemaToUse, { entryKeyField: getEntryKeyField(currentCollection, ik) });
            // attach to a local var so we can add it to previewResult after preview returns
            entryValidation = ev;
            if (Array.isArray(ev.warnings) && ev.warnings.length) setWarnings(ev.warnings);
            if (Array.isArray(ev.entryErrors) && ev.entryErrors.length) setStatus(`${ev.entryErrors.length} entry validation error(s) detected.`);
          } catch (e) {
            // ignore validation failures
          }
        }
      } catch (e) {}

      const res = await store.collectionDB.previewInputChanges(collectionKey, inputForPreview, { treatFullAsReplace: false });
      previewResult = res;
      try {
        previewResult._importInput = inputForPreview;
        previewResult._importFeedback = buildImportFeedback({
          collectionKey,
          baseCollection: currentCollection,
          input: inputForPreview,
          previewResult,
          entryValidation: entryValidation || { entryErrors: [], entryWarnings: [], warnings: [] },
          patchPayloadDetected,
        });
      } catch (e) {}
      setWarnings(res?.warnings || []);
      snapshotToggleBtn.disabled = false;
      snapshotToggleBtn.textContent = 'Show Current';

      // remember the parsed text so we can disable Parse until it changes
      lastParsedRaw = raw;
      updateActionButtons();

      // If this looks like a full snapshot and we can't load system base, allow snapshot save.
      const canSnapshot = (res?.patch?.inputKind === 'full') && !currentCollection;
      if (canSnapshot) {
        saveSnapshotBtn.style.display = '';
        saveSnapshotBtn.disabled = false;
      }

      renderDiffPanels();
      currentJsonMode = 'preview';
      renderJson('preview');
      if (patchPayloadDetected) setStatus('Patch payload detected. Entry diff computed. Review changes, then save.');
      else setStatus('Diff computed. Review changes, then save.');
      try { unchangedCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    } catch (e) {
      setStatus(`Failed to diff: ${e?.message || e}`);
    }
  });

  saveDiffBtn.addEventListener('click', async () => {
    if (!previewResult?.patch) return;
    try {
      saveDiffBtn.disabled = true;
      const label = String(labelInput.value || '').trim() || null;
      await store.collectionDB.commitPatch(collectionKey, previewResult.patch, { label });
      setStatus('Saved diff revision.');
      previewResult = null;
      clearDiffPanels();
      importArea.value = '';
      labelInput.value = '';
      lastParsedRaw = null;
      updateActionButtons();
      await loadCurrent();
    } catch (e) {
      setStatus(`Failed to save diff: ${e?.message || e}`);
      saveDiffBtn.disabled = false;
    }
  });

  saveSnapshotBtn.addEventListener('click', async () => {
    if (!previewResult?.merged) return;
    try {
      saveSnapshotBtn.disabled = true;
      const label = String(labelInput.value || '').trim() || null;
      await store.collectionDB.commitSnapshot(collectionKey, previewResult.merged, { label });
      setStatus('Saved snapshot revision.');
      previewResult = null;
      clearDiffPanels();
      importArea.value = '';
      labelInput.value = '';
      lastParsedRaw = null;
      updateActionButtons();
      await loadCurrent();
    } catch (e) {
      setStatus(`Failed to save snapshot: ${e?.message || e}`);
      saveSnapshotBtn.disabled = false;
    }
  });

  // keep action buttons in sync as the user types
  importArea.addEventListener('input', () => updateActionButtons());

  // drag-and-drop file import for the textarea
  let importDragDepth = 0;
  const setImportDragState = (active) => {
    try {
      if (active) importArea.classList.add('mc-drag-over');
      else importArea.classList.remove('mc-drag-over');
    } catch (e) {}
  };

  importArea.addEventListener('dragenter', (e) => {
    try {
      e.preventDefault();
      importDragDepth += 1;
      setImportDragState(true);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    } catch (err) {}
  });

  importArea.addEventListener('dragover', (e) => {
    try {
      e.preventDefault();
      setImportDragState(true);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    } catch (err) {}
  });

  importArea.addEventListener('dragleave', (e) => {
    try {
      e.preventDefault();
      importDragDepth = Math.max(0, importDragDepth - 1);
      if (importDragDepth === 0) setImportDragState(false);
    } catch (err) {}
  });

  importArea.addEventListener('drop', async (e) => {
    try {
      e.preventDefault();
      importDragDepth = 0;
      setImportDragState(false);
      const dt = e.dataTransfer;
      if (!dt) return;

      const files = dt.files;
      if (files && files.length) {
        const file = files[0];
        if (!file) return;
        const text = await file.text();
        importArea.value = String(text || '');
        try { importArea.focus(); } catch (err) {}
        setStatus(`Loaded file into import box: ${file.name || 'file'}`);
        updateActionButtons();
        return;
      }

      const txt = dt.getData('text/plain');
      if (typeof txt === 'string' && txt.trim()) {
        importArea.value = txt;
        try { importArea.focus(); } catch (err) {}
        setStatus('Loaded dropped text into import box.');
        updateActionButtons();
      }
    } catch (err) {
      importDragDepth = 0;
      setImportDragState(false);
      setStatus(`Failed to load dropped file: ${err?.message || err}`);
    }
  });

  // initialize action button states
  updateActionButtons();

  // ---- init ----
  initKeyFromActive();
  // per-view wrapping handled by `jsonViewer`; no global wrap button to init
  // Ensure the JSON viewer is created on init — the viewer manages its own collapse state.
  jsonVisible = true;
  try { renderJson(currentJsonMode); } catch (e) {}
  Promise.resolve().then(loadCurrent);

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try { if (historyTableCtrl && typeof historyTableCtrl.dispose === 'function') historyTableCtrl.dispose(); } catch (e) {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return root;
}











