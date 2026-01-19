import { createTable } from '../components/table.js';
import { card } from '../components/card.js';

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';

  const collections = store.getCollections();

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

  const collectionsCard = card({
    id: 'collections-card',
    cornerCaption: `${collections.length} Collections`,
    children: [table]
  });

  root.append(collectionsCard);
  
  return root;
}
