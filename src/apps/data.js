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
  const headers = fields.map(f => f.label || f.key);

  // Build table rows from entries
  const rows = entries.map(entry => {
    return fields.map(f => entry[f.key] ?? '');
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

  // Show the full path to the currently displayed collection file.
  const pathLabel = active?.key ? `Path: ${active.key}` : 'Path: (unknown)';
  root.append(
    el('div', { className: 'hint', text: pathLabel }),
    dataCard
  );
  
  return root;
}
