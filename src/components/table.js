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
export function createTable({ headers, rows, className = '', id, collection, sortable = false, searchable = false, rowActions = [], colGroups = [] } = {}) {
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
  // Track which columns are currently hidden (by group collapse)
  const hiddenCols = new Set();
  const collapsedGroups = new Set();
  const defaultPlaceholderWidth = 36; // px

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
  // Build optional <colgroup> so we can mark columns and control layout
  const colgroup = document.createElement('colgroup');
  for (let i = 0; i < headerKeys.length; i++) {
    const col = document.createElement('col');
    col.dataset.colIndex = String(i);
    const keyClass = (headerKeys[i] && headerKeys[i].keyClass) ? headerKeys[i].keyClass : `col-${i}`;
    col.classList.add(`col-${keyClass}`);
    colgroup.append(col);
  }

  // If colGroups provided, render an additional header row above the regular headers
  let groupHeaderRow = null;
  if (Array.isArray(colGroups) && colGroups.length) {
    groupHeaderRow = document.createElement('tr');
    for (const g of colGroups) {
      const gLabel = g.label || '';
      const start = Number.isFinite(g.start) ? g.start : (g.startIndex ?? 0);
      const end = Number.isFinite(g.end) ? g.end : (g.endIndex ?? (start));
      const span = Math.max(1, (end - start) + 1);
      const th = document.createElement('th');
      th.colSpan = span;
      const groupId = (g.id ?? gLabel) || (String(start) + '-' + String(end));
      th.dataset.groupId = groupId;
      th.classList.add('colgroup-header');
      const titleWrap = document.createElement('div');
      titleWrap.className = 'colgroup-title';
      const caption = document.createElement('span');
      caption.textContent = gLabel;
      titleWrap.append(caption);
      if (g.collapsible !== false) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'colgroup-toggle btn small';
        btn.textContent = g.collapsed ? '+' : '\u2212';
        btn.title = g.collapsed ? `Expand ${gLabel}` : `Collapse ${gLabel}`;
        btn.addEventListener('click', () => {
          const willCollapse = !collapsedGroups.has(groupId);
          if (willCollapse) collapsedGroups.add(groupId); else collapsedGroups.delete(groupId);
          btn.textContent = willCollapse ? '+' : '\u2212';
          btn.title = willCollapse ? `Expand ${gLabel}` : `Collapse ${gLabel}`;
          updateColumnVisibility(start, end, !willCollapse);
        });
        titleWrap.append(btn);
      }
      // visual borders for the group header
      th.style.borderLeft = '1px solid rgba(255,255,255,0.06)';
      th.style.borderRight = '1px solid rgba(255,255,255,0.06)';
      th.append(titleWrap);
      groupHeaderRow.append(th);
    }
  }

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

        // If this column belongs to a collapsed group: keep only the group's
        // first column as a narrow placeholder, hide the others completely.
        const g = getGroupForIndex(i);
        if (g) {
          const gId = (g.id ?? g.label) || String((Number.isFinite(g.start) ? g.start : (g.startIndex ?? i))) + '-' + String((Number.isFinite(g.end) ? g.end : (g.endIndex ?? i)));
          const startIdx = Number.isFinite(g.start) ? g.start : (g.startIndex ?? i);
          if (collapsedGroups.has(gId)) {
            if (i === startIdx) {
              const w = (g && g.placeholderWidth) ? (typeof g.placeholderWidth === 'number' ? `${g.placeholderWidth}px` : g.placeholderWidth) : `${defaultPlaceholderWidth}px`;
              td.style.width = w;
              td.style.minWidth = w;
              td.style.maxWidth = w;
              td.textContent = '';
              td.classList.add('col-collapsed');
              td.style.display = '';
            } else {
              td.style.display = 'none';
            }
          } else {
            td.style.display = '';
            td.style.width = '';
            td.style.minWidth = '';
            td.style.maxWidth = '';
            td.classList.remove('col-collapsed');
          }
        } else {
          td.style.width = '';
          td.style.minWidth = '';
          td.style.maxWidth = '';
          td.classList.remove('col-collapsed');
          td.style.display = '';
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

  // Insert colgroup and optional group header before thead content
  // apply group borders and mark member columns
  if (Array.isArray(colGroups) && colGroups.length) {
    for (const g of colGroups) {
      const start = Number.isFinite(g.start) ? g.start : (g.startIndex ?? 0);
      const end = Number.isFinite(g.end) ? g.end : (g.endIndex ?? start);
      const groupId = (g.id ?? g.label) || (String(start) + '-' + String(end));
      for (let ci = start; ci <= end; ci++) {
        const colEl = colgroup.querySelector(`col[data-col-index="${ci}"]`);
        if (colEl) colEl.dataset.group = groupId;
        const hdr = headerRow.children[ci];
        if (hdr) {
          hdr.classList.add('colgroup-member');
          if (ci === start) hdr.style.borderLeft = '1px solid rgba(255,255,255,0.06)';
          if (ci === end) hdr.style.borderRight = '1px solid rgba(255,255,255,0.06)';
        }
        for (const tr of Array.from(tbody.children)) {
          const td = tr.children[ci];
          if (!td) continue;
          if (ci === start) td.style.borderLeft = '1px solid rgba(255,255,255,0.04)';
          if (ci === end) td.style.borderRight = '1px solid rgba(255,255,255,0.04)';
        }
      }
    }
  }
  if (groupHeaderRow) thead.append(groupHeaderRow);
  thead.append(headerRow);
  if (colgroup.children.length) table.append(colgroup);

  // helper to update visibility of a contiguous column range
  function updateColumnVisibility(start, end, show) {
    // Update <col> elements
    for (let ci = start; ci <= end; ci++) {
      const colEl = colgroup.querySelector(`col[data-col-index="${ci}"]`);
      if (colEl) {
        // when hiding a group, keep the first column as a placeholder
        if (!show) {
          if (ci === start) colEl.style.display = '';
          else colEl.style.display = 'none';
        } else {
          colEl.style.display = '';
        }
      }
      // update header cell
      const th = headerRow.children[ci];
      const g = getGroupForIndex(ci);
      const w = (g && g.placeholderWidth) ? (typeof g.placeholderWidth === 'number' ? `${g.placeholderWidth}px` : g.placeholderWidth) : `${defaultPlaceholderWidth}px`;
      if (th) {
        const group = getGroupForIndex(ci);
        const startIdx = Number.isFinite(group?.start) ? group.start : (group?.startIndex ?? ci);
        if (show) {
          th.style.width = '';
          th.style.minWidth = '';
          th.style.maxWidth = '';
          th.classList.remove('col-collapsed');
          th.style.display = '';
        } else {
          if (ci === startIdx) {
            th.style.width = w;
            th.style.minWidth = w;
            th.style.maxWidth = w;
            th.classList.add('col-collapsed');
            th.style.display = '';
          } else {
            th.style.display = 'none';
          }
        }
      }
    }
    // update body cells
    for (const tr of Array.from(tbody.children)) {
      for (let ci = start; ci <= end; ci++) {
        const td = tr.children[ci];
        if (!td) continue;
        const g = getGroupForIndex(ci);
        const w = (g && g.placeholderWidth) ? (typeof g.placeholderWidth === 'number' ? `${g.placeholderWidth}px` : g.placeholderWidth) : `${defaultPlaceholderWidth}px`;
        if (show) {
          td.style.width = '';
          td.style.minWidth = '';
          td.style.maxWidth = '';
          td.classList.remove('col-collapsed');
          td.style.display = '';
        } else {
          const startIdx = Number.isFinite(g?.start) ? g.start : (g?.startIndex ?? ci);
          if (ci === startIdx) {
            td.style.width = w;
            td.style.minWidth = w;
            td.style.maxWidth = w;
            td.textContent = '';
            td.classList.add('col-collapsed');
            td.style.display = '';
          } else {
            td.style.display = 'none';
          }
        }
      }
    }
  }

  // Initialize collapsed state from colGroups
  if (Array.isArray(colGroups) && colGroups.length) {
    for (const g of colGroups) {
      const start = Number.isFinite(g.start) ? g.start : (g.startIndex ?? 0);
      const end = Number.isFinite(g.end) ? g.end : (g.endIndex ?? start);
      if (g.collapsed) {
        collapsedGroups.add((g.id ?? g.label) || (String(start) + '-' + String(end)));
        updateColumnVisibility(start, end, false);
      }
    }
  }

  // helper: find group object for a column index
  function getGroupForIndex(i) {
    if (!Array.isArray(colGroups)) return null;
    for (const g of colGroups) {
      const start = Number.isFinite(g.start) ? g.start : (g.startIndex ?? 0);
      const end = Number.isFinite(g.end) ? g.end : (g.endIndex ?? start);
      if (i >= start && i <= end) return g;
    }
    return null;
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
      try {
        const has = String(q || '').trim().length > 0;
        clearBtn.disabled = !has;
      } catch (e) {}
    }

    // Initial state
    try { clearBtn.disabled = !(String(searchInput.value || '').trim().length > 0); } catch (e) {}

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
