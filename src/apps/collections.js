import { createTable } from '../components/table.js';

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'collections-card';

  const collections = store.getCollections();

  const toolsRow = document.createElement('div');
  toolsRow.className = 'cardtools-row';
  toolsRow.id = 'collections-tools';

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = `${collections.length} Collections`;

  toolsRow.append(badge);

  // Build table headers
  const headers = ['Name', 'ID', 'Entries', 'Description'];

  // Build table rows
  const rows = collections.map(c => {
    const meta = c.metadata ?? {};
    const entryCount = Array.isArray(c.entries) ? c.entries.length : 0;
    
    return [
      meta.name ?? meta.id,
      meta.id,
      entryCount,
      meta.description ?? ''
    ];
  });

  const table = createTable({
    headers,
    rows,
    id: 'collections-table'
  });

  card.append(toolsRow, table);
  root.append(card);
  
  return root;
}
