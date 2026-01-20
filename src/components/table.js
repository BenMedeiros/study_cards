/**
 * Create a table component with headers and rows
 * @param {Object} options
 * @param {Array<string>} options.headers - Column headers
 * @param {Array<Array<string|HTMLElement>>} options.rows - Table rows (array of arrays)
 * @param {string} options.className - Additional CSS classes
 * @param {string} options.id - Table ID
 * @param {string} [options.collection] - Optional collection name the table was populated from
 * @returns {HTMLTableElement}
 */
export function createTable({ headers, rows, className = '', id, collection } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  if (id) wrapper.id = `${id}-wrapper`;
  
  const table = document.createElement('table');
  table.className = `table ${className}`.trim();
  if (id) table.id = id;
  if (collection) {
    const safe = String(collection).replace(/[^\w-]/g, '-').toLowerCase();
    table.classList.add(`collection-${safe}`);
    table.dataset.collection = String(collection);
  }

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headerKeys = [];

  function toKebabCase(s) {
    return String(s)
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase();
  }

  function humanizeKey(k) {
    const withSpaces = k
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ');
    return withSpaces.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function toCamelCase(s) {
    const parts = String(s)
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map(p => p.toLowerCase());
    if (parts.length === 0) return '';
    return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  }

  for (const header of headers) {
    const th = document.createElement('th');
    let label = '';
    let key = '';

    if (typeof header === 'string') {
      // Treat bare strings as field keys (from metadata). Normalize to camelCase.
      key = toCamelCase(header);
      label = humanizeKey(header);
    } else if (header && typeof header === 'object') {
      // Prefer explicit key; normalize it to camelCase. If missing, derive from the label.
      if (header.key) {
        key = toCamelCase(String(header.key).trim());
        label = header.label ?? humanizeKey(String(header.key).trim());
      } else if (header.label) {
        label = header.label;
        key = toCamelCase(header.label);
      } else {
        label = '';
        key = '';
      }
    } else {
      label = String(header ?? '');
      key = toCamelCase(label);
    }

    const keyClass = toKebabCase(key || 'col');

    th.textContent = label;
    th.dataset.field = key;
    th.classList.add(`col-${keyClass}`);
    headerKeys.push({ key, keyClass });
    headerRow.append(th);
  }

  thead.append(headerRow);

  const tbody = document.createElement('tbody');
  
  for (const rowData of rows) {
    const tr = document.createElement('tr');

    for (let i = 0; i < rowData.length; i++) {
      const cellData = rowData[i];
      const td = document.createElement('td');
      const hk = headerKeys[i] ?? { key: `col-${i}`, keyClass: `col-${i}` };
      const key = hk.key;
      const keyClass = hk.keyClass ?? String(key).replace(/\s+/g, '-').replace(/[^A-Za-z0-9\-_]/g, '');

      td.dataset.field = key;
      td.classList.add(`col-${keyClass}`);

      if (typeof cellData === 'string' || typeof cellData === 'number') {
        td.textContent = cellData;
      } else if (cellData instanceof HTMLElement) {
        td.append(cellData);
      } else {
        td.textContent = String(cellData ?? '');
      }

      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}
