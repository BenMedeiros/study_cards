import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { createTable } from '../components/table.js';
import { card, el } from '../components/ui.js';
import { createDropdown } from '../components/dropdown.js';

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

  const headerTools = createViewHeaderTools();
  headerTools.id = 'manage-collections-header-tools';

  const keyLabel = document.createElement('div');
  keyLabel.className = 'mc-label';
  keyLabel.textContent = 'Collection';

  // collection selector (dropdown will be populated later)
  const keyInput = document.createElement('div');
  keyInput.className = 'mc-key-input';

  // wrap dropdown in a header caption group (like other view header tools)
  const collGroup = document.createElement('div');
  collGroup.className = 'data-expansion-group';
  const collSlot = document.createElement('div');
  collSlot.className = 'entity-explorer-source-slot';
  collSlot.append(keyInput);
  const collCaption = document.createElement('div');
  collCaption.className = 'data-expansion-caption';
  collCaption.textContent = 'Collection';
  collGroup.append(collSlot, collCaption);

  const versionSelect = document.createElement('select');
  versionSelect.className = 'mc-version-select';
  versionSelect.title = 'Active version (system or a saved revision)';

  const setActiveBtn = document.createElement('button');
  setActiveBtn.type = 'button';
  setActiveBtn.className = 'btn small';
  setActiveBtn.textContent = 'Set Active';

  const copyMetaBtn = document.createElement('button');
  copyMetaBtn.type = 'button';
  copyMetaBtn.className = 'btn small';
  copyMetaBtn.textContent = 'Copy Metadata';

  const copySchemaBtn = document.createElement('button');
  copySchemaBtn.type = 'button';
  copySchemaBtn.className = 'btn small';
  copySchemaBtn.textContent = 'Copy Schema';

  const copyTemplateBtn = document.createElement('button');
  copyTemplateBtn.type = 'button';
  copyTemplateBtn.className = 'btn small';
  copyTemplateBtn.textContent = 'Copy Meta+Schema+Examples';

  headerTools.append(collGroup, versionSelect, setActiveBtn);
  root.append(headerTools);

  // collections dropdown placeholder will be mounted into `keyInput`
  let collectionDropdownEl = null;
  function rebuildCollectionsDropdown(selectValue) {
    try {
      keyInput.innerHTML = '';
      let available = [];
      try {
        if (store?.collections?.getAvailableCollections) available = store.collections.getAvailableCollections() || [];
      } catch (e) { available = []; }
      if (!available || !available.length) {
        try {
          const cols = store?.collections?.getCollections ? store.collections.getCollections() : [];
          if (Array.isArray(cols) && cols.length) {
            if (typeof cols[0] === 'object') available = cols.map(c => c && (c.key || c.path) ? (c.key || c.path) : null).filter(Boolean);
            else available = cols.slice();
          }
        } catch (e) { available = []; }
      }

      const items = (Array.isArray(available) ? available : []).map(x => {
        if (x && typeof x === 'object') {
          const v = x.key || x.path || String(x || '');
          return { value: v, label: String(v) };
        }
        const v = String(x || '');
        return { value: v, label: v };
      });

      if (!items.length) {
        keyInput.append(el('div', { className: 'hint', text: 'No collections' }));
        return;
      }

      const initial = (selectValue && items.some(i => i.value === selectValue)) ? selectValue : items[0].value;
      const dd = createDropdown({
        items,
        value: initial,
        onChange: async (next) => {
          collectionKey = String(next || '').trim();
          try {
            const btn = dd.querySelector('.custom-dropdown-button');
            if (btn) btn.dataset.value = collectionKey;
          } catch (e) {}
          try { await loadCurrent(); } catch (e) {}
        },
        className: '',
        closeOverlaysOnOpen: true
      });
      keyInput.append(dd);
      collectionDropdownEl = dd;
      // set collectionKey to initial if not already set
      if (!collectionKey) collectionKey = String(initial || '').trim();
      try {
        const btn = dd.querySelector('.custom-dropdown-button');
        if (btn) btn.dataset.value = collectionKey;
      } catch (e) {}
    } catch (e) {
      keyInput.append(el('div', { className: 'hint', text: 'Failed to list collections' }));
    }
  }

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
  toggleJsonBtn.textContent = 'Collapse';

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
  const grp3 = document.createElement('div'); grp3.className = 'mc-json-group'; grp3.append(copyFullBtn, copyMetaBtn, copySchemaBtn, copyTemplateBtn);
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
  actionsRow.append(parseBtn, clearBtn, saveDiffBtn, saveSnapshotBtn);

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

  // append persistent cards (history card will be placed on the left)
  // these cards live directly in the right column (no extra wrapper)

  // place history on the left column (after historyMount is created)
  left.append(historyMount);

  right.append(
  card({ title: 'Import', className: 'mc-card', children: [el('p', { className: 'hint', text: 'Paste JSON here (full collection, entries array, metadata object, or schema array).' }), importArea, labelInput, actionsRow, statusEl, warningsEl] }),
    
    metadataCard,
    schemaCard,
    editedCard,
    newCard,
    removedCard,
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
    jsonViewerMount.innerHTML = '';
    if (src) {
      const wrapper = document.createElement('div');
      wrapper.className = 'json-view-wrapper mono';
      wrapper.id = JSON_WRAPPER_ID;
      wrapper.dataset.expanded = 'true';
      wrapper.style.position = 'relative';

      const pre = document.createElement('pre');
      pre.className = 'json-view mono';
      pre.id = JSON_PRE_ID;
      if (isJsonWrapped && pre.style) pre.style.setProperty('text-wrap', 'auto');
      pre.textContent = safeJsonStringify(src, 2);

      wrapper.appendChild(pre);
      jsonViewerMount.appendChild(wrapper);
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
    } else jsonViewerMount.textContent = '';
      snapshotToggleBtn.disabled = !(previewResult && previewResult.merged);
  }

  function setJsonCollapsed(collapsed) {
    const isCollapsed = !!collapsed;
    // collapse the viewer by hiding the mount
    jsonViewerMount.style.display = isCollapsed ? 'none' : '';
    toggleJsonBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
  }

  function refreshVersionSelect() {
    versionSelect.innerHTML = '';
    const optSystem = document.createElement('option');
    optSystem.value = '';
    optSystem.textContent = 'System (no diffs)';
    versionSelect.append(optSystem);

    const revs = Array.isArray(revisions) ? revisions.slice().reverse() : [];
    for (const r of revs) {
      const opt = document.createElement('option');
      opt.value = r.id;
      const label = r.label ? `${r.label} • ` : '';
      const kind = r.kind ? `${r.kind}` : 'diff';
      opt.textContent = `${label}${kind} • ${shortId(r.id, 12)} • ${String(r.createdAt || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z')}`;
      versionSelect.append(opt);
    }

    const active = (typeof activeRevisionId === 'string' && activeRevisionId.trim()) ? activeRevisionId.trim() : '';
    versionSelect.value = active;
  }

  function renderDiffPanels() {
    // clear persistent bodies
    
    metadataBody.innerHTML = '';
    schemaBody.innerHTML = '';
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    removedBody.innerHTML = '';

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
      metadataBody.append(el('p', { className: 'hint', text: 'These are the changes that will be saved if you click “Save Diff”.' }));
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
      schemaBody.append(el('p', { className: 'hint', text: 'These are the changes that will be saved if you click “Save Diff”.' }));
    }

    // ---- Entries: edited vs new ----
    const upsert = Array.isArray(patch?.entries?.upsert) ? patch.entries.upsert : [];
    const removeKeys = Array.isArray(patch?.entries?.removeKeys) ? patch.entries.removeKeys : [];

    const editedItems = [];
    const newItems = [];

    for (const incoming of upsert) {
      const k = (entryKeyField && incoming && typeof incoming === 'object' && incoming[entryKeyField] != null)
        ? String(incoming[entryKeyField]).trim()
        : '';
      const isNew = entryKeyField ? !baseMap.has(k) : true;
      const before = entryKeyField ? baseMap.get(k) : null;
      const after = entryKeyField ? (mergedMap.get(k) || incoming) : incoming;
      const changedFields = before ? diffEntryFields(before, after) : [];
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
      editedBody.append(el('p', { className: 'hint', text: 'These are the changes that will be saved if you click “Save Diff”.' }));
    }

    if (newItems.length) {
      setCorner(newCard, `${newItems.length}`);
      const list = el('div', { className: 'mc-diff-list', children: newItems.sort((a, b) => String(a.key).localeCompare(String(b.key))).map(x => x.node) });
      newBody.append(list);
    } else {
      setCorner(newCard, '');
      newBody.append(el('p', { className: 'hint', text: 'These are the changes that will be saved if you click “Save Diff”.' }));
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
      removedBody.append(el('p', { className: 'hint', text: 'These are the changes that will be saved if you click “Save Diff”.' }));
    }
  }

  function renderHistory() {
    historyMount.innerHTML = '';
    const rows = (Array.isArray(revisions) ? revisions.slice().reverse() : []).map(r => {
      const label = r.label || '';
      const active = (r.id && activeRevisionId && r.id === activeRevisionId) ? 'active' : '';
      const kind = r.kind || 'diff';
      const created = r.createdAt || '';
      const parent = r.parentId ? shortId(r.parentId, 10) : '';
      const patch = r.patch;
      const pSummary = (patch && typeof patch === 'object')
        ? `${(patch.metadata?.unset?.length || 0) + Object.keys(patch.metadata?.set || {}).length}m / ${(patch.schema?.removeKeys?.length || 0) + (patch.schema?.upsert?.length || 0)}s / ${(patch.entries?.upsert?.length || 0)}u / ${(patch.entries?.removeKeys?.length || 0)}r`
        : '';
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
            store.collectionDB.setActiveRevisionId(collectionKey, rid);
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
            const snap = await store.collectionDB.resolveCollectionAtRevision(collectionKey, rid);
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
          await copyToClipboard(safeJsonStringify({ id: rec.id, kind: rec.kind, parentId: rec.parentId, label: rec.label, patch: rec.patch }, 2));
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
    activeRevisionId = store.collectionDB.getActiveRevisionId(collectionKey);
    refreshVersionSelect();
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
    // populate dropdown and select active
    try { rebuildCollectionsDropdown(collectionKey); } catch (e) { /* ignore */ }
  }

  // ---- events ----

  setActiveBtn.addEventListener('click', async () => {
    const rid = String(versionSelect.value || '').trim();
    try {
      store.collectionDB.setActiveRevisionId(collectionKey, rid || null);
      await loadCurrent();
      setStatus(rid ? `Activated revision ${shortId(rid, 16)}` : 'Activated system version');
    } catch (e) {
      setStatus(`Failed to set active version: ${e?.message || e}`);
    }
  });

  

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

  copyMetaBtn.addEventListener('click', async () => {
    const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    const meta = src?.metadata || {};
    await copyToClipboard(safeJsonStringify(meta, 2));
    setStatus('Copied metadata.');
  });

  copySchemaBtn.addEventListener('click', async () => {
    const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    const schema = src?.metadata?.schema || src?.schema || [];
    await copyToClipboard(safeJsonStringify(schema, 2));
    setStatus('Copied schema.');
  });

  copyTemplateBtn.addEventListener('click', async () => {
    const src = (currentJsonMode === 'preview' && previewResult?.merged) ? previewResult.merged : currentCollection;
    if (!src) return;
    const arrayKey = detectArrayKey(src);
    const arr = Array.isArray(src[arrayKey]) ? src[arrayKey] : [];
    const ek = getEntryKeyField(src, arrayKey);
    const meta = src.metadata && typeof src.metadata === 'object' ? { ...src.metadata } : {};
    // Keep meta compact and include schema
    const out = {
      metadata: {
        name: meta.name ?? null,
        description: meta.description ?? null,
        version: meta.version ?? null,
        category: meta.category ?? null,
        entry_key: (meta.entry_key ?? (ek || null)),
        schema: Array.isArray(meta.schema) ? meta.schema : (Array.isArray(src.schema) ? src.schema : []),
      },
      [arrayKey]: arr.slice(0, 3),
    };
    await copyToClipboard(safeJsonStringify(out, 2));
    setStatus('Copied meta+schema+examples.');
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
    setStatus('');
    setWarnings([]);
    currentJsonMode = 'current';
    renderJson('current');
  });

  parseBtn.addEventListener('click', async () => {
    setStatus('');
    setWarnings([]);
    saveDiffBtn.disabled = true;
    saveSnapshotBtn.disabled = true;
    saveSnapshotBtn.style.display = 'none';
    // clear diff card bodies
    metadataBody.innerHTML = '';
    schemaBody.innerHTML = '';
    editedBody.innerHTML = '';
    newBody.innerHTML = '';
    removedBody.innerHTML = '';

    const raw = String(importArea.value || '').trim();
    if (!raw) return;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setStatus(`Invalid JSON: ${e?.message || e}`);
      return;
    }

    try {
      const res = await store.collectionDB.previewInputChanges(collectionKey, parsed, { treatFullAsReplace: false });
      previewResult = res;
      setWarnings(res?.warnings || []);

      // Enable save
      saveDiffBtn.disabled = false;
      snapshotToggleBtn.disabled = false;
      snapshotToggleBtn.textContent = 'Show Current';

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
      importArea.value = '';
      labelInput.value = '';
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
      await loadCurrent();
    } catch (e) {
      setStatus(`Failed to save snapshot: ${e?.message || e}`);
      saveSnapshotBtn.disabled = false;
    }
  });

  // ---- init ----
  initKeyFromActive();
  try { updateJsonWrapBtn(); } catch (e) {}
  setJsonCollapsed(false);
  Promise.resolve().then(loadCurrent);

  return root;
}
