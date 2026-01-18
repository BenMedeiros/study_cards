import { el, safeId, kv } from '../components/dom.js';

// Use safeId instead of safeIdPart
const safeIdPart = safeId;

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.className = 'split';
  root.id = 'collections-root';

  const left = document.createElement('div');
  left.className = 'pane pane-left';
  left.id = 'collections-left-pane';

  const right = document.createElement('div');
  right.className = 'pane pane-right';
  right.id = 'collections-right-pane';

  const collections = store.getCollections();
  const activeId = route?.query?.get('collection') || store.getActiveCollectionId() || collections[0]?.metadata?.id || null;

  const leftHeader = el('div', 'row', null, 'collections-left-header');
  const title = el('h2', null, 'Collections', 'collections-title');
  title.style.margin = '0';

  const back = el('button', 'button', 'Back', 'collections-back');
  back.name = 'back';
  back.addEventListener('click', () => onNavigate('/'));

  leftHeader.append(title, back);

  const list = el('div', null, null, 'collections-list');
  list.style.marginTop = '10px';

  for (const c of collections) {
    const btn = el('button', 'button', c.metadata.name, `collections-select-${safeIdPart(c.metadata.id)}`);
    btn.name = 'selectCollection';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    if (c.metadata.id === activeId) {
      btn.style.borderColor = 'rgba(96, 165, 250, 0.6)';
    }
    btn.addEventListener('click', () => {
      onNavigate(`/collections?collection=${encodeURIComponent(c.metadata.id)}`);
    });
    list.append(btn);
  }

  left.append(leftHeader, list);

  const selected = collections.find((c) => c.metadata.id === activeId) ?? null;
  const card = el('div', 'card', null, 'collections-card');

  if (!selected) {
    card.innerHTML = '<h2>Collection</h2><p class="hint">No collection selected.</p>';
    right.append(card);
    root.append(left, right);
    return root;
  }

  const meta = selected.metadata ?? {};
  const fields = Array.isArray(meta.fields) ? meta.fields : [];
  const entries = Array.isArray(selected.entries) ? selected.entries : [];

  const header = el('div', 'row', null, 'collections-selected-header');
  const h2 = el('h2', null, meta.name ?? meta.id, 'collections-selected-title');
  h2.style.margin = '0';

  const badge = el('div', 'badge', meta.id, 'collections-selected-id');

  header.append(h2, badge);

  const detailsMeta = document.createElement('details');
  detailsMeta.id = 'collections-details-meta';
  detailsMeta.open = true;
  const sumMeta = el('summary', null, 'Metadata', 'collections-summary-meta');
  detailsMeta.append(sumMeta);

  const kvWrap = el('div', null, null, 'collections-meta-kv');
  kvWrap.style.marginTop = '8px';

  const kv = (k, v) => {
    const row = el('div', 'kv');
    row.append(el('div', 'k', k), el('div', null, String(v ?? '')));
    return row;
  };

  kvWrap.append(
    kv('id', meta.id),
    kv('name', meta.name),
    kv('description', meta.description),
    kv('version', meta.version)
  );

  const detailsFields = document.createElement('details');
  detailsFields.id = 'collections-details-fields';
  detailsFields.open = false;
  const sumFields = el('summary', null, 'Fields', 'collections-summary-fields');
  detailsFields.append(sumFields);

  const fieldsTable = document.createElement('table');
  fieldsTable.className = 'table';
  fieldsTable.id = 'collections-fields-table';
  fieldsTable.style.marginTop = '8px';
  fieldsTable.innerHTML = '<thead><tr><th>key</th><th>label</th><th>type</th></tr></thead>';
  const ftb = document.createElement('tbody');
  for (const f of fields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.key ?? ''}</td><td>${f.label ?? ''}</td><td>${f.type ?? ''}</td>`;
    ftb.append(tr);
  }
  fieldsTable.append(ftb);
  detailsFields.append(fieldsTable);

  detailsMeta.append(kvWrap, detailsFields);

  const entriesBox = el('div', null, null, 'collections-entries-box');
  entriesBox.style.marginTop = '12px';

  const eh = el('h3', null, `Entries (${entries.length})`, 'collections-entries-title');
  eh.style.margin = '0 0 8px 0';

  const entryTable = document.createElement('table');
  entryTable.className = 'table';
  entryTable.id = 'collections-entries-table';

  const cols = ['id', ...fields.map((f) => f.key).filter(Boolean)];
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    trh.append(th);
  }
  thead.append(trh);

  const tbody = document.createElement('tbody');
  for (const e of entries.slice(0, 300)) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      const val = e?.[c];
      td.textContent = val == null ? '' : String(val);
      tr.append(td);
    }
    tbody.append(tr);
  }

  entryTable.append(thead, tbody);

  const note = el('div', 'hint', entries.length > 300 ? 'Showing first 300 rows.' : '', 'collections-entries-note');
  note.style.marginTop = '6px';

  entriesBox.append(eh, entryTable, note);

  card.append(header, detailsMeta, entriesBox);
  right.append(card);

  root.append(left, right);
  return root;
}
