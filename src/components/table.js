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
export function createTable({ headers, rows, className = '', id, collection, sortable = false, searchable = false, rowActions = [] } = {}) {
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

  // Helper to extract comparable text/number from a cell value
  function extractCellValue(cell) {
    if (cell instanceof HTMLElement) return (cell.textContent || '').trim();
    if (typeof cell === 'number') return cell;
    if (typeof cell === 'string') return cell.trim();
    return String(cell ?? '').trim();
  }

  // Keep original rows and a current filtered/sorted set
  const originalRows = Array.isArray(rows) ? rows.slice() : [];
  let currentRows = originalRows.slice();

  // Render rows into tbody from a provided rows array
  function renderRows(rowsArr) {
    tbody.innerHTML = '';
    rowsArr.forEach((rowData, rowIndex) => {
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

      // attach optional row id/meta from array-like property so action handlers
      // can resolve the original item if needed (e.g. rowData.__id)
      try { if (rowData && (rowData.__id || (rowData.meta && rowData.meta.id))) tr.dataset.rowId = rowData.__id || rowData.meta.id; } catch (e) {}

      // render action buttons if provided
      if (Array.isArray(rowActions) && rowActions.length) {
        const td = document.createElement('td');
        td.dataset.field = 'actions';
        td.classList.add('col-actions');
        for (const act of rowActions) {
          const btn = document.createElement('button');
          btn.type = 'button';
          if (act.className) btn.className = act.className;
          // ensure app-wide button styling is applied
          btn.classList.add('btn');
          btn.textContent = act.label || act.title || '';
          if (act.title) btn.title = act.title;
          btn.addEventListener('click', (ev) => {
            try {
              if (typeof act.onClick === 'function') act.onClick(rowData, rowIndex, { tr, td, table });
            } catch (e) {}
          });
          td.append(btn);
        }
        tr.append(td);
      }

      tbody.append(tr);
    });
  }

  // Sorting state
  let sortCol = null;
  let sortDir = 'asc';

  // Rebuild headerRow with proper content and optional sorting handlers
  headerRow.innerHTML = '';
  for (let i = 0; i < headerKeys.length; i++) {
    const hk = headerKeys[i];
    const th = document.createElement('th');
    const label = hk && hk.key ? (hk.key.charAt(0).toUpperCase() + hk.key.slice(1)) : '';
    th.textContent = label;
    th.dataset.field = hk.key || '';
    th.classList.add(`col-${hk.keyClass}`);

    if (sortable) {
      th.style.cursor = 'pointer';
      th.tabIndex = 0;
      th.addEventListener('click', () => {
        if (sortCol === i) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortCol = i; sortDir = 'asc'; }
        sortAndRender();
      });
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
      th.setAttribute('aria-sort', 'none');
    }

    headerRow.append(th);
  }

  // add actions header if rowActions provided
  if (Array.isArray(rowActions) && rowActions.length) {
    const th = document.createElement('th');
    th.textContent = 'Actions';
    th.dataset.field = 'actions';
    th.classList.add('col-actions');
    th.setAttribute('aria-sort', 'none');
    headerRow.append(th);
  }

  // Optional search UI
  if (searchable) {
    const searchWrap = document.createElement('div');
    searchWrap.className = 'table-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'table-search-input';
    searchInput.placeholder = 'Search (use % as wildcard)';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'table-search-clear';
    clearBtn.textContent = 'Clear';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'table-copy-json btn small';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.title = 'Copy current (filtered) rows as JSON';
    searchWrap.append(searchInput, clearBtn);
    searchWrap.append(copyBtn);
    wrapper.append(searchWrap);

    function makeRegex(q) {
      const s = String(q || '');
      if (!s) return null;
      let pat = s;
      if (!pat.includes('%')) pat = `%${pat}%`;
      // escape regex special chars except %
      pat = pat.replace(/([.+?^${}()|[\\]\\])/g, '\\$1');
      pat = pat.replace(/%/g, '.*');
      return new RegExp(pat, 'i');
    }

    function applyFilter(q) {
      const rx = makeRegex(q);
      if (!rx) currentRows = originalRows.slice();
      else {
        currentRows = originalRows.filter(r => {
          for (const cell of r) {
            const v = extractCellValue(cell);
            if (rx.test(String(v))) return true;
          }
          return false;
        });
      }
      sortAndRender();
    }

    searchInput.addEventListener('input', () => applyFilter(searchInput.value));
    clearBtn.addEventListener('click', () => { searchInput.value = ''; applyFilter(''); searchInput.focus(); });
    copyBtn.addEventListener('click', async () => {
      try {
        // Build array of objects from currentRows using headerKeys
        const out = currentRows.map(r => {
          const obj = {};
          for (let i = 0; i < headerKeys.length; i++) {
            const key = headerKeys[i]?.key || String(i);
            const v = extractCellValue(r[i]);
            obj[key || `col${i}`] = v;
          }
          return obj;
        });
        const txt = JSON.stringify(out, null, 2);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(txt);
        } else {
          const ta = document.createElement('textarea');
          ta.value = txt;
          document.body.append(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = prev; }, 1200);
      } catch (e) {
        try { alert('Copy failed'); } catch (er) {}
      }
    });
  }

  // Perform initial render
  renderRows(currentRows);

  // Sorting helper
  function sortAndRender() {
    if (sortCol === null) {
      renderRows(currentRows);
      Array.from(headerRow.children).forEach(th => th.setAttribute('aria-sort', 'none'));
      return;
    }

    const paired = currentRows.map((r, idx) => ({ idx, data: r, key: extractCellValue(r[sortCol]) }));
    paired.sort((a, b) => {
      const ka = a.key;
      const kb = b.key;
      const na = (typeof ka === 'string' && ka !== '' && !Number.isNaN(Number(ka))) ? Number(ka) : ka;
      const nb = (typeof kb === 'string' && kb !== '' && !Number.isNaN(Number(kb))) ? Number(kb) : kb;
      if (typeof na === 'number' && typeof nb === 'number') {
        return na - nb;
      }
      const sa = String(ka ?? '');
      const sb = String(kb ?? '');
      return sa.localeCompare(sb, undefined, { sensitivity: 'base', numeric: true });
    });

    if (sortDir === 'desc') paired.reverse();

    renderRows(paired.map(p => p.data));

    Array.from(headerRow.children).forEach((th, j) => {
      if (j === sortCol) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      else th.setAttribute('aria-sort', 'none');
    });
  }

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}
