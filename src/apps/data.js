import { createTable } from '../components/table.js';
import { card } from '../components/card.js';
import { el } from '../components/dom.js';

export function renderData({ store }) {
  const root = document.createElement('div');
  root.id = 'data-root';

  const active = store.getActiveCollection();
  
  if (!active) {
    const emptyCard = card({
      id: 'data-card',
      children: [el('p', { className: 'hint', text: 'No active collection.' })]
    });
    root.append(emptyCard);
    return root;
  }

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

  const dataCard = card({
    id: 'data-card',
    cornerCaption: `${entries.length} Entries`,
    children: [table]
  });

  root.append(dataCard);
  
  return root;
}
