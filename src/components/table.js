/**
 * Create a table component with headers and rows
 * @param {Object} options
 * @param {Array<string>} options.headers - Column headers
 * @param {Array<Array<string|HTMLElement>>} options.rows - Table rows (array of arrays)
 * @param {string} options.className - Additional CSS classes
 * @param {string} options.id - Table ID
 * @returns {HTMLTableElement}
 */
export function createTable({ headers, rows, className = '', id }) {
  const table = document.createElement('table');
  table.className = `table ${className}`.trim();
  if (id) table.id = id;

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  
  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.append(th);
  }
  
  thead.append(headerRow);

  const tbody = document.createElement('tbody');
  
  for (const rowData of rows) {
    const tr = document.createElement('tr');
    
    for (const cellData of rowData) {
      const td = document.createElement('td');
      
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
  return table;
}
