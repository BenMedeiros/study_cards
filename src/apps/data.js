import { createTable } from '../components/table.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'data-card';

  const active = store.getActiveCollection();
  
  if (!active) {
    card.innerHTML = '<p class="hint">No active collection.</p>';
    root.append(card);
    return root;
  }

  const toolsRow = document.createElement('div');
  toolsRow.className = 'cardtools-row';
  toolsRow.id = 'data-tools';

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = `${active.entries.length} Entries`;

  toolsRow.append(badge);

  const fields = Array.isArray(active.metadata.fields) ? active.metadata.fields : [];
  const entries = Array.isArray(active.entries) ? active.entries : [];

  // Build table headers from fields
  const headers = ['ID', ...fields.map(f => f.label || f.key)];

  // Build table rows from entries
  const rows = entries.map(entry => {
    return [
      entry.id ?? '',
      ...fields.map(f => entry[f.key] ?? '')
    ];
  });

  const table = createTable({
    headers,
    rows,
    id: 'data-table'
  });

  card.append(toolsRow, table);
  root.append(card);
  
  return root;
}
