import { createTable } from '../components/table.js';
import { card, el } from '../components/ui.js';
import { createDropdown } from '../components/dropdown.js';
import { createJsonViewer } from '../components/jsonViewer.js';
import { validateSchemaArray, validateEntriesAgainstSchema } from '../utils/validation.js';

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

function jsonEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
}

function diffEntryFields(before, after) {
  const o = before && typeof before === 'object' ? before : {};
  const n = after && typeof after === 'object' ? after : {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  const out = [];
  for (const k of keys) {
    if (!jsonEqual(o[k], n[k])) out.push(k);
  }
  out.sort();
  return out;
}

// --- Input scrubbing / parsing helpers ----------------------------------

// Trim leading/trailing junk until we find a likely JSON start/end.
function scrubRawText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  // find first useful char { or [
  const firstBrace = Math.min(
    ...['{','['].map(ch => { const i = s.indexOf(ch); return i === -1 ? Infinity : i; })
  );
  if (firstBrace === Infinity) return s;
  s = s.slice(firstBrace);
  // find last useful char } or ]
  const lastBrace = Math.max(
    s.lastIndexOf('}'),
    s.lastIndexOf(']')
  );
  if (lastBrace !== -1) s = s.slice(0, lastBrace + 1);
  return s.trim();
}

// Insert commas between adjacent object end/start like "}{" -> "},{".
function fixAdjacentObjects(text) {
  if (typeof text !== 'string') return text;
  // simple heuristic: replace '}{' with '},{' and ']][' with '],[' etc.
  return text.replace(/}\s*{/g, '},{').replace(/\]\s*\[/g, '],[');
}

// Extract balanced top-level JSON objects from text (returns array of JSON strings)
function extractTopLevelObjects(text) {
  const out = [];
  if (!text || typeof text !== 'string') return out;
  const len = text.length;
  let i = 0;
  while (i < len) {
    // skip until we find { or [
    while (i < len && text[i] !== '{' && text[i] !== '[') i++;
    if (i >= len) break;
    const startChar = text[i];
    const endChar = startChar === '{' ? '}' : ']';
    let depth = 0;
    let j = i;
    for (; j < len; j++) {
      const ch = text[j];
      if (ch === startChar) depth++;
      else if (ch === endChar) depth--;
      // naive string handling: skip over string literals to avoid brace counting inside strings
      else if (ch === '"') {
        j++;
        while (j < len && text[j] !== '"') {
          if (text[j] === '\\') j += 2; else j++;
        }
      }
      if (depth === 0) break;
    }
    if (depth === 0) {
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else break;
  }
  return out;
}

// Try to parse text into JSON using several heuristics and scrubbing steps.
function tryParseJsonLoose(raw) {
  if (raw == null) return null;
  let s = String(raw);
  // quick try
  try { return JSON.parse(s); } catch (e) {}

  // scrub outer junk
  s = scrubRawText(s);
  s = fixAdjacentObjects(s);
  try { return JSON.parse(s); } catch (e) {}

  // if it's a sequence of objects, extract them and wrap in array
  const objs = extractTopLevelObjects(s).map(x => x.trim()).filter(Boolean);
  if (objs.length === 1) {
    try { return JSON.parse(objs[0]); } catch (e) {}
  }
  if (objs.length > 1) {
    const combined = `[${objs.join(',')}]`;
    try { return JSON.parse(combined); } catch (e) {}
  }

  // last resort: try to repair obvious trailing commas and stray characters
  const cleaned = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(cleaned); } catch (e) {}

  return null;
}

// Schema/entries validation provided by ../utils/validation.js

// Deep equality that ignores object key ordering. Handles primitives, arrays, and plain objects.
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object') return false;
    const ak = Object.keys(a).filter(k => typeof a[k] !== 'undefined').sort();
    const bk = Object.keys(b).filter(k => typeof b[k] !== 'undefined').sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
    for (const k of ak) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  // functions, symbols, etc — fallback to strict equality
  return a === b;
}

function pickEntrySummary(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const bits = [];
  if (typeof e.kanji === 'string' && e.kanji.trim()) bits.push(e.kanji.trim());
  if (typeof e.reading === 'string' && e.reading.trim()) bits.push(`(${e.reading.trim()})`);
  if (typeof e.ja === 'string' && e.ja.trim()) bits.push(e.ja.trim().slice(0, 24));
  if (typeof e.meaning === 'string' && e.meaning.trim()) bits.push(`— ${e.meaning.trim().slice(0, 40)}`);
  if (!bits.length && typeof e.name === 'string' && e.name.trim()) bits.push(e.name.trim().slice(0, 40));
  if (!bits.length) return '';
  return bits.join(' ');
}

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

  const toggleJsonBtn = document.createElement('button');
  toggleJsonBtn.type = 'button';
  toggleJsonBtn.className = 'btn small';
  toggleJsonBtn.textContent = 'Expand';

  // JSON wrap toggle (mirrors entityExplorerView behavior)
  const jsonWrapBtn = document.createElement('button');
  jsonWrapBtn.type = 'button';
  jsonWrapBtn.className = 'btn small';
  jsonWrapBtn.textContent = 'Wrap';
  jsonWrapBtn.title = 'Toggle JSON wrap';

  // IDs for inner viewer elements so behavior is unambiguous
  const JSON_WRAPPER_ID = 'mc-snapshot-wrapper';
  const JSON_PRE_ID = 'mc-snapshot-pre';

  // track wrap state (applies `text-wrap: auto` to the inner pre element)
  let isJsonWrapped = true;
  // track whether we've built the full JSON HTML blob yet
  let jsonBuilt = false;
  // track whether the JSON viewer is currently visible (expanded)
  let jsonVisible = false;

  function updateJsonWrapBtn() {
    jsonWrapBtn.textContent = isJsonWrapped ? 'Unwrap' : 'Wrap';
    jsonWrapBtn.setAttribute('aria-pressed', isJsonWrapped ? 'true' : 'false');
  }

  jsonWrapBtn.addEventListener('click', () => {
    isJsonWrapped = !isJsonWrapped;
    try {
      const pre = document.getElementById(JSON_PRE_ID);
      if (pre && pre.style) {
        if (isJsonWrapped) pre.style.setProperty('text-wrap', 'auto');
        else {
          pre.style.removeProperty('text-wrap');
          // also remove any fallback properties that might affect wrapping
          pre.style.removeProperty('overflow-wrap');
          pre.style.removeProperty('word-wrap');
          pre.style.removeProperty('white-space');
        }
      }
    } catch (e) {}
    updateJsonWrapBtn();
  });

  const copyFullBtn = document.createElement('button');
  copyFullBtn.type = 'button';
  copyFullBtn.className = 'btn small';
  copyFullBtn.textContent = 'Copy Full JSON';

  // group buttons into logical clusters
  const grp1 = document.createElement('div'); grp1.className = 'mc-json-group'; grp1.append(snapshotToggleBtn);
  const grp2 = document.createElement('div'); grp2.className = 'mc-json-group'; grp2.append(toggleJsonBtn, jsonWrapBtn);
  const grp3 = document.createElement('div'); grp3.className = 'mc-json-group'; grp3.append(copyFullBtn);
  jsonModeRow.append(grp1, grp2, grp3);
  jsonHeaderRow.append(jsonModeRow);

  // mount for the JSON viewer widget
  const jsonViewerMount = document.createElement('div');
  jsonViewerMount.className = 'mc-json-mount';
  jsonViewerMount.id = 'mc-snapshot-json';

  jsonWrap.append(jsonHeaderRow, jsonViewerMount);
  left.append(card({ id: 'mc-snapshot-card', title: 'Snapshot', className: 'mc-card', children: [el('p', { className: 'hint', text: 'Shows the current collection JSON; switch to preview to view merged changes.' }), jsonWrap] }));

  // Right: import + diffs + history
  const right = document.createElement('div');
  right.className = 'mc-right';

  const importArea = document.createElement('textarea');
  importArea.className = 'mc-import';
  importArea.placeholder = 'Paste JSON here (full collection, entries array, metadata object, or schema array)…';
  importArea.spellcheck = false;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'mc-label-input';
  labelInput.placeholder = 'Optional label for this submission (e.g., "add N3 yokai")';
  labelInput.spellcheck = false;

  const parseBtn = document.createElement('button');
  parseBtn.type = 'button';
  parseBtn.className = 'btn';
  parseBtn.textContent = 'Parse & Diff';

  const importHelpBtn = document.createElement('button');
  importHelpBtn.type = 'button';
  importHelpBtn.className = 'btn';
  importHelpBtn.textContent = 'Import Help';

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
  actionsRow.append(parseBtn, importHelpBtn, clearBtn, labelInput, saveDiffBtn, saveSnapshotBtn);

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
  

  const metadataBody = el('div', { id: 'mc-diff-metadata-body', className: 'mc-diff-list' });
  const metadataHint = el('p', { className: 'hint', text: 'Metadata changes affect collection-level properties like name and description.' });
  const metadataCard = card({ id: 'mc-diff-metadata', title: 'Metadata', cornerCaption: '', className: 'mc-card', children: [metadataHint, metadataBody] });

  const schemaBody = el('div', { id: 'mc-diff-schema-body', className: 'mc-diff-list' });
  const schemaHint = el('p', { className: 'hint', text: 'Schema changes modify field definitions used for entry validation and UI.' });
  const schemaCard = card({ id: 'mc-diff-schema', title: 'Schema', cornerCaption: '', className: 'mc-card', children: [schemaHint, schemaBody] });

  const editedBody = el('div', { id: 'mc-diff-edited-body', className: 'mc-diff-list' });
  const editedHint = el('p', { className: 'hint', text: 'Entries listed here will be updated with the shown changes.' });
  const editedCard = card({ id: 'mc-diff-edited', title: 'Edited Entries', cornerCaption: '', className: 'mc-card', children: [editedHint, editedBody] });

  const newBody = el('div', { id: 'mc-diff-new-body', className: 'mc-diff-list' });
  const newHint = el('p', { className: 'hint', text: 'These entries will be added to the collection.' });
  const newCard = card({ id: 'mc-diff-new', title: 'New Entries', cornerCaption: '', className: 'mc-card', children: [newHint, newBody] });

  const removedBody = el('div', { id: 'mc-diff-removed-body', className: 'mc-diff-list' });
  const removedHint = el('p', { className: 'hint', text: 'These entries will be removed from the collection.' });
  const removedCard = card({ id: 'mc-diff-removed', title: 'Entry Removals', cornerCaption: '', className: 'mc-card', children: [removedHint, removedBody] });

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
  card({ title: 'Import', className: 'mc-card', children: [el('p', { className: 'hint', text: 'Paste JSON here (full collection, entries array, metadata object, or schema array).' }), importArea, actionsRow, statusEl, warningsEl] }),
    
    metadataCard,
    schemaCard,
    unchangedCard,
    editedCard,
    newCard,
    removedCard,
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

  function renderJson(mode = null) {
    const m = mode || currentJsonMode;
    const src = (m === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    // do not build the full JSON blob unless the viewer is visible (expanded)
    jsonViewerMount.innerHTML = '';
    if (!src) {
      jsonViewerMount.textContent = '';
      snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
      return;
    }

    // Always update a lightweight summary / entry count (cheap) even when collapsed
    try {
      const cardEl = document.getElementById('mc-snapshot-card');
      if (cardEl) {
        const arrayKey = detectArrayKey(src || {});
        const arr = Array.isArray(src?.[arrayKey]) ? src[arrayKey] : [];
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
    const viewer = createJsonViewer(src, { id: JSON_WRAPPER_ID, preId: JSON_PRE_ID, expanded: true, wrapping: isJsonWrapped });
    jsonViewerMount.appendChild(viewer);
    jsonBuilt = true;
    snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
  }

  function setJsonCollapsed(collapsed) {
    const isCollapsed = !!collapsed;
    jsonVisible = !isCollapsed;
    // collapse the viewer by hiding the mount
    jsonViewerMount.style.display = isCollapsed ? 'none' : '';
    toggleJsonBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    // If we're expanding and haven't built the JSON yet, render it now
    try {
      if (!isCollapsed && !jsonBuilt) {
        // build using the current mode
        renderJson(currentJsonMode);
      }
    } catch (e) {}
  }

  function refreshVersionSelect() {
    // Version select removed; keep no-op to avoid callers needing changes.
  }

  function renderDiffPanels() {
    // clear persistent bodies
    
    metadataBody.innerHTML = '';
    schemaBody.innerHTML = '';
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    removedBody.innerHTML = '';
    unchangedBody.innerHTML = '';
    invalidBody.innerHTML = '';
    unchangedBody.innerHTML = '';
    unchangedBody.innerHTML = '';

    // helper to set corner caption for a card
    function setCorner(cardEl, text) {
      try { const c = cardEl.querySelector('.card-corner-caption'); if (c) c.textContent = text ?? ''; } catch (e) {}
    }

    if (!previewResult) {
      // no preview: clear corner captions and leave card bodies to their static hints
      setCorner(metadataCard, '');
      setCorner(schemaCard, '');
      setCorner(editedCard, '');
      setCorner(newCard, '');
      setCorner(removedCard, '');
      return;
    }

    const { patch, diffs, merged } = previewResult;
    const summary = `metadata: ${diffs?.metadataChanges ?? 0} • schema: ${diffs?.schemaChanges ?? 0} • new: ${diffs?.newEntries ?? 0} • edited: ${diffs?.editedEntries ?? 0} • removed: ${diffs?.entriesRemove ?? 0}`;
    

    // ---- base + merged helpers ----
    const arrayKey = diffs?.arrayKey || patch?.targetArrayKey || detectArrayKey(currentCollection) || 'entries';
    const entryKeyField = diffs?.entryKeyField || patch?.entryKeyField || getEntryKeyField(currentCollection, arrayKey) || '';
    const baseArr = Array.isArray(currentCollection?.[arrayKey]) ? currentCollection[arrayKey] : [];
    const mergedArr = Array.isArray(merged?.[arrayKey]) ? merged[arrayKey] : [];

    const baseMap = new Map();
    if (entryKeyField) {
      for (const e of baseArr) {
        const k = e && typeof e === 'object' && e[entryKeyField] != null ? String(e[entryKeyField]).trim() : '';
        if (k && !baseMap.has(k)) baseMap.set(k, e);
      }
    }
    const mergedMap = new Map();
    if (entryKeyField) {
      for (const e of mergedArr) {
        const k = e && typeof e === 'object' && e[entryKeyField] != null ? String(e[entryKeyField]).trim() : '';
        if (k && !mergedMap.has(k)) mergedMap.set(k, e);
      }
    }

    // ---- Metadata diff ----
    const metaSet = patch?.metadata?.set && typeof patch.metadata.set === 'object' ? patch.metadata.set : {};
    const metaUnset = Array.isArray(patch?.metadata?.unset) ? patch.metadata.unset : [];
    const metaChanges = [];
    const baseMeta = (currentCollection?.metadata && typeof currentCollection.metadata === 'object') ? currentCollection.metadata : {};
    for (const [k, v] of Object.entries(metaSet)) {
      metaChanges.push({ op: 'set', key: k, before: baseMeta?.[k], after: v });
    }
    for (const k of metaUnset) {
      metaChanges.push({ op: 'unset', key: String(k), before: baseMeta?.[k], after: undefined });
    }
    if (metaChanges.length) {
      setCorner(metadataCard, `${metaChanges.length} change(s)`);
      const list = el('div', { className: 'mc-diff-list' });
      for (const c of metaChanges.sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
        const body = el('div', {
          className: 'mc-diff-body',
          children: [
            el('div', { className: 'mc-diff-cols', children: [
              el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'Before' }), preJson(c.before, '10rem')] }),
              el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: c.op === 'unset' ? 'After (removed)' : 'After' }), preJson(c.after, '10rem')] }),
            ]})
          ]
        });
        list.append(makeDetailsItem({ summaryLeft: c.key, summaryRight: c.op, children: [body] }));
      }
      metadataBody.append(list);
    } else {
      setCorner(metadataCard, '');
      // leave metadataBody empty; the static hint lives in the card header
    }

    // ---- Schema diff ----
    const baseSchema = Array.isArray(currentCollection?.metadata?.schema)
      ? currentCollection.metadata.schema
      : (Array.isArray(currentCollection?.schema) ? currentCollection.schema : []);
    const mergedSchema = Array.isArray(merged?.metadata?.schema)
      ? merged.metadata.schema
      : (Array.isArray(merged?.schema) ? merged.schema : []);

    const baseSchemaMap = new Map();
    for (const f of (Array.isArray(baseSchema) ? baseSchema : [])) {
      const k = f && typeof f === 'object' && typeof f.key === 'string' ? f.key.trim() : '';
      if (k && !baseSchemaMap.has(k)) baseSchemaMap.set(k, f);
    }
    const mergedSchemaMap = new Map();
    for (const f of (Array.isArray(mergedSchema) ? mergedSchema : [])) {
      const k = f && typeof f === 'object' && typeof f.key === 'string' ? f.key.trim() : '';
      if (k && !mergedSchemaMap.has(k)) mergedSchemaMap.set(k, f);
    }

    const schemaAdded = [];
    const schemaChanged = [];
    const schemaRemoved = [];
    for (const [k, nf] of mergedSchemaMap.entries()) {
      if (!baseSchemaMap.has(k)) schemaAdded.push({ key: k, after: nf });
      else {
        const bf = baseSchemaMap.get(k);
        if (!jsonEqual(bf, nf)) schemaChanged.push({ key: k, before: bf, after: nf });
      }
    }
    for (const [k, bf] of baseSchemaMap.entries()) {
      if (!mergedSchemaMap.has(k)) schemaRemoved.push({ key: k, before: bf });
    }
    if (schemaAdded.length || schemaChanged.length || schemaRemoved.length) {
      setCorner(schemaCard, `+${schemaAdded.length} • ~${schemaChanged.length} • -${schemaRemoved.length}`);
      const list = el('div', { className: 'mc-diff-list' });
      const all = [
        ...schemaAdded.map(x => ({ op: 'add', ...x })),
        ...schemaChanged.map(x => ({ op: 'change', ...x })),
        ...schemaRemoved.map(x => ({ op: 'remove', ...x })),
      ].sort((a, b) => String(a.key).localeCompare(String(b.key)));
      for (const c of all) {
        const body = el('div', {
          className: 'mc-diff-body',
          children: [
            el('div', { className: 'mc-diff-cols', children: [
              el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'Before' }), preJson(c.before, '10rem')] }),
              el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: c.op === 'remove' ? 'After (removed)' : 'After' }), preJson(c.after, '10rem')] }),
            ]})
          ]
        });
        list.append(makeDetailsItem({ summaryLeft: c.key, summaryRight: c.op, children: [body] }));
      }
      schemaBody.append(list);
    } else {
      setCorner(schemaCard, '');
      // leave schemaBody empty; the static hint lives in the card header
    }

    // ---- Entries: edited vs new vs unchanged ----
    // Prepare entry validation maps (by id and by index) so we can surface per-entry schema errors
    const entryValidation = previewResult?._entryValidation || { entryErrors: [], entryWarnings: [], warnings: [] };
    const errorsById = new Map();
    const errorsByIndex = new Map();
    try {
      for (const ev of (entryValidation.entryErrors || [])) {
        if (!ev) continue;
        const rawId = typeof ev.id !== 'undefined' && ev.id !== null ? String(ev.id) : '';
        if (!rawId) continue;
        if (rawId && rawId[0] === '#') {
          const idx = parseInt(rawId.slice(1));
          if (!Number.isNaN(idx)) {
            const arr = errorsByIndex.get(idx) || [];
            arr.push(ev.message || String(ev.message || ''));
            errorsByIndex.set(idx, arr);
          }
        } else {
          const msg = ev.message || String(ev.message || '');
          const arr = errorsById.get(rawId) || [];
          arr.push(msg);
          errorsById.set(rawId, arr);
          // also store a trimmed-key entry to improve matching robustness
          try { const t = rawId.trim(); if (t !== rawId) errorsById.set(t, arr); } catch (e) {}
        }
      }
    } catch (e) {}
    const upsert = Array.isArray(patch?.entries?.upsert) ? patch.entries.upsert : [];
    // Prefer iterating the original parsed input entries (so unchanged items are visible).
    // Fall back to patch upserts only when the parsed input entries are not available.
    const inputEntriesForLoop = (Array.isArray(previewResult?._inputEntries) && previewResult._inputEntries.length)
      ? previewResult._inputEntries
      : (Array.isArray(upsert) ? upsert : []);

    // Detect duplicate keys within the import itself. If duplicates exist, mark
    // all entries with that key as invalid (dupkey in import).
    const importKeyCounts = new Map();
    const importDupKeys = new Set();
    try {
      if (entryKeyField) {
        for (const it of (Array.isArray(previewResult?._inputEntries) ? previewResult._inputEntries : inputEntriesForLoop)) {
          if (!it || typeof it !== 'object') continue;
          const k = it[entryKeyField] != null ? String(it[entryKeyField]).trim() : '';
          if (!k) continue;
          importKeyCounts.set(k, (importKeyCounts.get(k) || 0) + 1);
        }
        for (const [k, v] of importKeyCounts.entries()) if (v > 1) importDupKeys.add(k);
      }
    } catch (e) {}
    const removeKeys = Array.isArray(patch?.entries?.removeKeys) ? patch.entries.removeKeys : [];

    const editedItems = [];
    const newItems = [];
    const unchangedItems = [];
    const invalidItems = [];

    for (const incoming of inputEntriesForLoop) {
      // If this import contains duplicate keys, classify them as invalid up-front
      try {
        if (entryKeyField) {
          const candidateId = (incoming && typeof incoming === 'object' && incoming[entryKeyField] != null) ? String(incoming[entryKeyField]).trim() : null;
          if (candidateId && importDupKeys.has(candidateId)) {
            const label = candidateId || '(no key)';
            const body = el('div', { className: 'mc-diff-body', children: [ el('div', { className: 'mc-single-col', children: [preJson(incoming, '18rem'), el('div', { className: 'mc-validation-messages', text: 'dupkey in import' })] }) ] });
            const node = makeDetailsItem({ summaryLeft: label, summaryRight: `invalid • dupkey in import`, children: [body] });
            invalidItems.push({ key: label, node });
            continue;
          }
        }
      } catch (e) {}
      // Check for per-entry validation errors first and classify as invalid if present.
      try {
        if (entryKeyField) {
          const rawCandidate = (incoming && typeof incoming === 'object' && incoming[entryKeyField] != null) ? incoming[entryKeyField] : null;
          const candidateId = rawCandidate != null ? String(rawCandidate) : null;
          const candidateTrim = candidateId ? candidateId.trim() : candidateId;
          let msgs = [];
          if (candidateId && errorsById.has(candidateId)) msgs = errorsById.get(candidateId) || [];
          if ((!msgs || !msgs.length) && candidateTrim && errorsById.has(candidateTrim)) msgs = errorsById.get(candidateTrim) || [];
          // fallback: if no direct id match, try to find the original input entry with same key
          if ((!msgs || !msgs.length) && previewResult?._inputEntries && Array.isArray(previewResult._inputEntries)) {
            try {
              const idx = previewResult._inputEntries.findIndex(x => x && typeof x === 'object' && String(x[entryKeyField] ?? '').trim() === String(candidateId ?? '').trim());
              if (idx >= 0 && errorsByIndex.has(idx)) msgs = errorsByIndex.get(idx) || [];
            } catch (e) {}
          }
          if (msgs && msgs.length) {
            const label = candidateId || '(no key)';
            const body = el('div', { className: 'mc-diff-body', children: [ el('div', { className: 'mc-single-col', children: [preJson(incoming, '18rem'), el('div', { className: 'mc-validation-messages', text: msgs.join('; ') })] }) ] });
            const node = makeDetailsItem({ summaryLeft: label, summaryRight: `invalid • ${msgs.length} error(s)`, children: [body] });
            invalidItems.push({ key: label, node });
            continue;
          }
        } else {
          // no entry key: validation used index-based ids like '#0', '#1'
          if (Array.isArray(previewResult?._inputEntries)) {
            const idx = previewResult._inputEntries.findIndex(x => deepEqual(x, incoming));
            if (idx >= 0 && errorsByIndex.has(idx)) {
              const msgs = errorsByIndex.get(idx) || [];
              const label = `#${idx}`;
              const body = el('div', { className: 'mc-diff-body', children: [ el('div', { className: 'mc-single-col', children: [preJson(incoming, '18rem'), el('div', { className: 'mc-validation-messages', text: msgs.join('; ') })] }) ] });
              const node = makeDetailsItem({ summaryLeft: label, summaryRight: `invalid • ${msgs.length} error(s)`, children: [body] });
              invalidItems.push({ key: label, node });
              continue;
            }
          }
        }
      } catch (e) {}
      let k = '';
      let isNew = true;
      let before = null;
      let after = incoming;

      if (entryKeyField) {
        // If an entry key is expected but missing, classify as invalid.
        if (!incoming || typeof incoming !== 'object' || incoming[entryKeyField] == null) {
          const label = '(no key)';
          const body = el('div', { className: 'mc-diff-body', children: [ el('div', { className: 'mc-single-col', children: [preJson(incoming, '18rem')] }) ] });
          const node = makeDetailsItem({ summaryLeft: label, summaryRight: `invalid • missing '${entryKeyField}'`, children: [body] });
          invalidItems.push({ key: label, node });
          continue;
        }
        k = (incoming && typeof incoming === 'object' && incoming[entryKeyField] != null) ? String(incoming[entryKeyField]).trim() : '';
        isNew = !baseMap.has(k);
        before = baseMap.get(k) || null;
        after = mergedMap.get(k) || incoming;
      } else {
        // No entry key: try to find an exact matching base entry to detect unchanged rows
        for (const b of baseArr) {
          if (b && typeof b === 'object' && deepEqual(b, incoming)) {
            before = b;
            isNew = false;
            break;
          }
        }
        // after remains the incoming; we can't reliably map to mergedMap without a key
      }
      const changedFields = before ? diffEntryFields(before, after) : [];
      // if there's a before and the objects are deeply equal, classify as unchanged
      if (before && deepEqual(before, after)) {
        const summaryBits = pickEntrySummary(after);
        const label = k || '(no key)';
        const body = el('div', { className: 'mc-diff-body', children: [ el('div', { className: 'mc-single-col', children: [preJson(after, '18rem')] }) ] });
        const node = makeDetailsItem({ summaryLeft: label, summaryRight: `unchanged${summaryBits ? ' • ' + summaryBits : ''}`, children: [body] });
        unchangedItems.push({ key: label, node });
        continue;
      }
      const summaryBits = pickEntrySummary(after);
      const label = k || '(no key)';
      const right = isNew
        ? (summaryBits ? `new • ${summaryBits}` : 'new')
        : `${changedFields.length} field(s) • ${summaryBits}`.trim();

      const copyRow = el('div', {
        className: 'mc-diff-actions',
        children: [
          before ? el('button', { className: 'btn small', text: 'Copy Before', attrs: { type: 'button' } }) : null,
          el('button', { className: 'btn small', text: isNew ? 'Copy Entry' : 'Copy After', attrs: { type: 'button' } }),
        ].filter(Boolean)
      });
      const copyBtns = copyRow.querySelectorAll('button');
      if (before && copyBtns[0]) {
        copyBtns[0].addEventListener('click', async () => {
          await copyToClipboard(safeJsonStringify(before, 2));
          setStatus('Copied before entry JSON.');
        });
      }
      const afterBtn = before ? copyBtns[1] : copyBtns[0];
      if (afterBtn) {
        afterBtn.addEventListener('click', async () => {
          await copyToClipboard(safeJsonStringify(after, 2));
          setStatus('Copied entry JSON.');
        });
      }

      const body = el('div', {
        className: 'mc-diff-body',
        children: [
          copyRow,
          isNew
            ? el('div', { className: 'mc-single-col', children: [preJson(after, '22rem')] })
            : el('div', {
              className: 'mc-diff-cols',
              children: [
                el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'Before' }), preJson(before, '18rem')] }),
                el('div', { className: 'mc-diff-col', children: [el('div', { className: 'mc-diff-col-title', text: 'After' }), preJson(after, '18rem')] }),
              ]
            }),

          (!isNew && changedFields.length)
            ? el('div', { className: 'mc-fields', children: [
              el('div', { className: 'mc-fields-title', text: 'Changed fields' }),
              el('div', { className: 'mc-fields-list', text: changedFields.join(', ') })
            ]})
            : null,
        ].filter(Boolean)
      });

      const node = makeDetailsItem({ summaryLeft: label, summaryRight: right, children: [body] });
      if (isNew) newItems.push({ key: label, node });
      else editedItems.push({ key: label, node });
    }

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

    if (removeKeys.length) {
      setCorner(removedCard, `${removeKeys.length}`);
      const list = el('div', { className: 'mc-diff-list' });
      for (const k of removeKeys) {
        const label = String(k);
        const before = entryKeyField ? baseMap.get(label) : null;
        const body = el('div', { className: 'mc-diff-body', children: [before ? preJson(before, '18rem') : el('div', { className: 'hint', text: 'No base entry found.' })] });
        list.append(makeDetailsItem({ summaryLeft: label, summaryRight: 'remove', children: [body] }));
      }
      removedBody.append(list);
    } else {
      setCorner(removedCard, '');
      // leave removedBody empty; the static hint lives in the card header
    }
    // If schema changes exist, surface a warning so schema is reviewed first.
    try {
      const warn = Array.isArray(previewResult?.warnings) ? previewResult.warnings.slice() : [];
      if (schemaAdded.length || schemaChanged.length || schemaRemoved.length) {
        if ((upsert && upsert.length)) warn.unshift('Schema changes detected — review schema before entries.');
        else warn.unshift('Schema changes detected.');
      }
      setWarnings(warn);
    } catch (e) {}

    // Enable/disable Save Diff depending on whether there are meaningful changes
    try {
      const md = Number(diffs?.metadataChanges || 0);
      const sd = Number(diffs?.schemaChanges || 0);
      const ne = Number(diffs?.newEntries || 0);
      const ed = Number(diffs?.editedEntries || 0);
      const rm = Number(diffs?.entriesRemove || 0);
      const meaningful = (md + sd + ne + ed + rm) > 0;
      const hasInvalid = (invalidItems && invalidItems.length) ? true : false;
      saveDiffBtn.disabled = !meaningful || hasInvalid || !previewResult?.patch;
      // visually indicate error state by toggling a scoped class
      try {
        if (hasInvalid) saveDiffBtn.classList.add('mc-save-invalid');
        else saveDiffBtn.classList.remove('mc-save-invalid');
      } catch (e) {}
    } catch (e) {
      try { saveDiffBtn.disabled = true; } catch (err) {}
    }
  }

  function renderHistory() {
    historyMount.innerHTML = '';
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
          ? `${(patch.metadata?.unset?.length || 0) + Object.keys(patch.metadata?.set || {}).length}m / ${(patch.schema?.removeKeys?.length || 0) + (patch.schema?.upsert?.length || 0)}s / ${(patch.entries?.upsert?.length || 0)}u / ${(patch.entries?.removeKeys?.length || 0)}r`
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
            // If user selected the system/base row, clear active revision so
            // the system collection becomes the active base.
            if (rid === '__system__') {
              store.collectionDB.setActiveRevisionId(collectionKey, null);
            } else {
              store.collectionDB.setActiveRevisionId(collectionKey, rid);
            }
            await loadCurrent();
          } catch (e) {
            setStatus(`Failed to activate revision: ${e?.message || e}`);
          }
        }
      },
      {
        label: 'Preview',
        title: 'Load and preview snapshot at this revision (does not activate)',
        className: 'btn small',
        onClick: async (rowData, rowIndex, { tr }) => {
          const rid = tr?.dataset?.rowId || rowData.__id;
          if (!rid) return;
          try {
            let snap = null;
            if (rid === '__system__') {
              snap = await store.collectionDB.getSystemCollection(collectionKey).catch(() => null);
            } else {
              snap = await store.collectionDB.resolveCollectionAtRevision(collectionKey, rid);
            }
            previewResult = { patch: null, diffs: null, merged: snap, warnings: [] };
            currentJsonMode = 'preview';
            renderJson('preview');
            snapshotToggleBtn.disabled = false;
            snapshotToggleBtn.textContent = 'Show Current';
            setStatus(`Previewing revision ${shortId(rid, 16)}`);
          } catch (e) {
            setStatus(`Failed to preview revision: ${e?.message || e}`);
          }
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
          if (rec.kind === 'system') {
            await copyToClipboard(safeJsonStringify({ id: rec.id, kind: rec.kind, label: rec.label, blob: rec.blob }, 2));
          } else {
            await copyToClipboard(safeJsonStringify({ id: rec.id, kind: rec.kind, parentId: rec.parentId, label: rec.label, patch: rec.patch }, 2));
          }
          setStatus('Copied patch JSON.');
        }
      }
    ];

    const table = createTable({
      headers: ['active', 'kind', 'createdAt', 'id', 'label', 'parent', 'summary'],
      rows,
      sortable: true,
      searchable: true,
      rowActions,
    });

    historyMount.append(card({
      title: 'History',
      cornerCaption: `${revisions.length} revisions`,
      className: 'mc-card',
      children: [el('p', { className: 'hint', text: 'List of saved revisions — preview or activate a revision from here.' }), table]
    }));
  }

  async function loadHistory() {
    try {
      revisions = await store.collectionDB.listUserRevisions(collectionKey);
    } catch (e) {
      revisions = [];
    }
    // Try to include the system/base collection as the first history item
    try {
      const sys = await store.collectionDB.getSystemCollection(collectionKey).catch(() => null);
      if (sys) {
        const sysRec = { id: '__system__', collectionKey, kind: 'system', createdAt: '', parentId: null, label: 'System base', blob: sys, patch: null };
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
      currentCollection = await store.collectionDB.getCollection(collectionKey);
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

  toggleJsonBtn.addEventListener('click', () => {
    const collapsed = jsonViewerMount.style.display !== 'none' ? true : false;
    setJsonCollapsed(collapsed);
  });

  copyFullBtn.addEventListener('click', async () => {
    const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    if (!src) return;
    await copyToClipboard(safeJsonStringify(src, 2));
    setStatus('Copied full JSON.');
  });
  // copyMeta/copySchema/copyTemplate controls removed from header.

  importHelpBtn.addEventListener('click', async () => {
    try {
      const mod = await import('../components/dialogs/manageCollectionsImportHelpDialog.js');
      if (mod && typeof mod.showManageCollectionsImportHelpDialog === 'function') await mod.showManageCollectionsImportHelpDialog();
    } catch (e) {
      setStatus(`Failed to open help: ${e?.message || e}`);
    }
  });

  clearBtn.addEventListener('click', () => {
    importArea.value = '';
    labelInput.value = '';
    previewResult = null;
    saveDiffBtn.disabled = true;
    saveSnapshotBtn.disabled = true;
    saveSnapshotBtn.style.display = 'none';
    // clear diff card bodies
    metadataBody.innerHTML = '';
    schemaBody.innerHTML = '';
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    removedBody.innerHTML = '';
    unchangedBody.innerHTML = '';
    invalidBody.innerHTML = '';
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
    // clear diff card bodies
    metadataBody.innerHTML = '';
    schemaBody.innerHTML = '';
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    removedBody.innerHTML = '';

    const raw = String(importArea.value || '').trim();
    if (!raw) return;

    // Try loose parsing / scrubbing to handle messy inputs
    let parsed = null;
    try {
      parsed = tryParseJsonLoose(raw);
      if (parsed == null) {
        setStatus('Invalid JSON: unable to parse input after cleanup.');
        return;
      }
    } catch (e) {
      setStatus(`Invalid JSON: ${e?.message || e}`);
      return;
    }

    try {
      // Normalize input to be explicit about schema vs entries.
      // Rules:
      // - Schema update is only allowed if the input is { schema: [...] } or { metadata: { schema: [...] } }
      // - A bare array is interpreted as an entries array.
      // - A single object without schema/metadata is interpreted as a single entry (wrapped in entries array).
      // - Keys accepted as entry arrays/objects: entries, entry, sentences, paragraphs, items, cards
      let inputForPreview = parsed;
      try {
        const isArr = Array.isArray(parsed);
        const isObj = parsed && typeof parsed === 'object' && !isArr;
        const hasTopSchema = isObj && Array.isArray(parsed.schema);
        const hasMetaSchema = isObj && parsed.metadata && Array.isArray(parsed.metadata.schema);
        const entryKeys = ['entries', 'entry', 'sentences', 'paragraphs', 'items', 'cards'];
        const hasEntryKey = isObj && entryKeys.some(k => k in parsed);

        if (hasTopSchema || hasMetaSchema) {
          // explicit schema update — pass through as-is
          inputForPreview = parsed;
        } else if (isArr) {
          // bare array -> treat as entries
          const arrayKey = detectArrayKey(currentCollection || {}) || 'entries';
          inputForPreview = { [arrayKey]: parsed };
        } else if (isObj) {
          if (hasEntryKey) {
            // ensure entry key values are arrays (wrap single-object into array)
            const copy = { ...parsed };
            for (const k of entryKeys) {
              if (k in copy) {
                if (Array.isArray(copy[k])) {
                  // ok
                } else if (copy[k] && typeof copy[k] === 'object') {
                  copy[k] = [copy[k]];
                }
                break;
              }
            }
            inputForPreview = copy;
          } else {
            // simple object -> treat as single entry
            const arrayKey = detectArrayKey(currentCollection || {}) || 'entries';
            inputForPreview = { [arrayKey]: [parsed] };
          }
        }
      } catch (e) {
        inputForPreview = parsed;
      }

      // If the input contains a schema update, validate it before previewing.
      try {
        const schemaArr = Array.isArray(inputForPreview?.schema)
          ? inputForPreview.schema
          : (Array.isArray(inputForPreview?.metadata?.schema) ? inputForPreview.metadata.schema : null);
        if (schemaArr) {
          const sv = validateSchemaArray(schemaArr);
          if (Array.isArray(sv.errors) && sv.errors.length) {
            setStatus(`Schema error: ${sv.errors[0]}`);
            if (sv.warnings && sv.warnings.length) setWarnings(sv.warnings);
            return;
          }
          if (Array.isArray(sv.warnings) && sv.warnings.length) setWarnings(sv.warnings);
        }
      } catch (e) {}

      // Validate entries against the effective schema (input schema if present, otherwise base schema)
      try {
        const ik = detectArrayKey(inputForPreview || {}) || 'entries';
        const inputEntries = Array.isArray(inputForPreview?.[ik]) ? inputForPreview[ik] : (Array.isArray(inputForPreview) ? inputForPreview : []);
        const inputSchemaArr = Array.isArray(inputForPreview?.schema)
          ? inputForPreview.schema
          : (Array.isArray(inputForPreview?.metadata?.schema) ? inputForPreview.metadata.schema : null);
        const baseSchemaArr = Array.isArray(currentCollection?.metadata?.schema)
          ? currentCollection.metadata.schema
          : (Array.isArray(currentCollection?.schema) ? currentCollection.schema : null);
        const schemaToUse = inputSchemaArr || baseSchemaArr || null;
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
      // attach any entry-level validation results computed earlier during parse
      try {
        previewResult._entryValidation = entryValidation || { entryErrors: [], entryWarnings: [], warnings: [] };
      } catch (e) {}
      // attach normalized input entries so the renderer can classify unchanged rows
      try {
        const ik = detectArrayKey(inputForPreview || {}) || 'entries';
        const iarr = Array.isArray(inputForPreview?.[ik]) ? inputForPreview[ik] : (Array.isArray(inputForPreview) ? inputForPreview : []);
        previewResult._inputArrKey = ik;
        previewResult._inputEntries = iarr;
      } catch (e) {}
      setWarnings(res?.warnings || []);
      snapshotToggleBtn.disabled = false;
      snapshotToggleBtn.textContent = 'Show Current';

      // remember the parsed text so we can disable Parse until it changes
      lastParsedRaw = raw;
      updateActionButtons();

      // If this looks like a full snapshot and we can't load system base, allow snapshot save.
      const canSnapshot = (res?.patch?._inputKind === 'full') && !currentCollection;
      if (canSnapshot) {
        saveSnapshotBtn.style.display = '';
        saveSnapshotBtn.disabled = false;
      }

      renderDiffPanels();
      currentJsonMode = 'preview';
      renderJson('preview');
      setStatus('Diff computed. Review changes, then save.');
      try { metadataCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
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
      metadataBody.innerHTML = '';
      schemaBody.innerHTML = '';
      editedBody.innerHTML = '';
      newBody.innerHTML = '';
      removedBody.innerHTML = '';
      unchangedBody.innerHTML = '';
      invalidBody.innerHTML = '';
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
      metadataBody.innerHTML = '';
      schemaBody.innerHTML = '';
      editedBody.innerHTML = '';
      newBody.innerHTML = '';
      removedBody.innerHTML = '';
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

  // initialize action button states
  updateActionButtons();

  // ---- init ----
  initKeyFromActive();
  try { updateJsonWrapBtn(); } catch (e) {}
  // start collapsed and lazily build JSON when expanded
  setJsonCollapsed(true);
  Promise.resolve().then(loadCurrent);

  return root;
}
