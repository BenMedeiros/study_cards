import { createTable } from '../components/table.js';
import { card } from '../components/ui.js';

export function renderCollectionsManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'collections-root';

  const collections = store.getAvailableCollections();

  // Build table headers
  const headers = ['Name', 'Path', 'Entries', 'Description'];

  // Build table rows
  const rows = collections.map(c => {
    const entryCount = (typeof c.entries === 'number') ? c.entries : (c.entries ? c.entries : 0);
    return [
      c.name || c.path,
      c.path,
      entryCount,
      c.description || ''
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
