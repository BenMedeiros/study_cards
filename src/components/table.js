let _tableGlobalResizeHookInstalled = false;

import { timed } from '../utils/timing.js';
import { openRightClickMenu, registerRightClickContext } from './rightClickMenu.js';
import { cleanSearchQuery } from '../utils/helpers.js';
import { compileTableSearchQuery, matchesTableSearch } from '../utils/tableSearch.js';

// register the table context class so CSS and code searches can find it
try { registerRightClickContext('table-context-menu'); } catch (e) {}

function _installGlobalTableResizeHook() {
  if (_tableGlobalResizeHookInstalled) return;
  _tableGlobalResizeHookInstalled = true;
  try {
    let t = null;
    window.addEventListener('resize', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        try {
          for (const wrapper of Array.from(document.querySelectorAll('.table-wrapper'))) {
            const searchWrap = wrapper.querySelector('.table-search');
            const top = searchWrap ? (searchWrap.offsetHeight || 0) : 0;
            try { wrapper.style.setProperty('--table-sticky-top', `${top}px`); } catch (e) {}
            try {
              if (wrapper.querySelector('table.table.is-virtualized')) {
                wrapper.dispatchEvent(new Event('scroll'));
              }
            } catch (e) {}
          }
        } catch (e) {}
      }, 120);
    });
  } catch (e) {
    // ignore
  }
}

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
export function createTable({ store = null, headers, rows, className = '', id, collection, sortable = false, searchable = false, rowActions = [], initialSortKey = null, initialSortDir = 'asc' } = {}) {
  const __tableLabel = (() => {
    const parts = [];
    if (id) parts.push(String(id));
    if (collection) parts.push(String(collection));
    const s = parts.join(' / ').trim();
    return s ? `table.create ${s}` : 'table.create';
  })();

  return timed(__tableLabel, () => {
  _installGlobalTableResizeHook();

  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  if (id) wrapper.id = `${id}-wrapper`;

  const VIRTUALIZE_THRESHOLD = 50;
  const VIRTUAL_ROW_HEIGHT_PX = 36;
  const VIRTUAL_OVERSCAN = 10;
  let searchWrapEl = null;
  let searchInputEl = null;
  let displayRows = Array.isArray(rows) ? rows.slice() : [];
  let _virtualScrollHandlerAttached = false;
  let _lastVirtualKey = '';
  let _virtualRenderNonce = 0;
  
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
      // Treat bare strings as field keys (from metadata). Use key as-is.
      key = String(header).trim();
      label = humanizeKey(header);
    } else if (header && typeof header === 'object') {
      // Prefer explicit key; use it as provided. If missing, derive a key from the label.
      if (header.key) {
        key = String(header.key).trim();
        label = header.label ?? humanizeKey(String(header.key).trim());
      } else if (header.label) {
        label = header.label;
        key = String(header.label).trim();
      } else {
        label = '';
        key = '';
      }
    } else {
      label = String(header ?? '');
      key = String(label).trim();
    }

    const keyClass = toKebabCase(key || 'col');

    th.textContent = label;
    th.dataset.field = key;
    th.classList.add(`col-${keyClass}`);
    headerKeys.push({ key, keyClass, label, type: (header && typeof header === 'object') ? (header.type ?? null) : null });
    headerRow.append(th);
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
  displayRows = currentRows.slice();

  function getStickyTopPx() {
    try { return searchWrapEl ? (searchWrapEl.offsetHeight || 0) : 0; } catch (e) { return 0; }
  }

  function updateStickyOffsets() {
    try {
      const top = getStickyTopPx();
      wrapper.style.setProperty('--table-sticky-top', `${top}px`);
    } catch (e) {}
  }

  function shouldVirtualize(rowsArr) {
    return Array.isArray(rowsArr) && rowsArr.length > VIRTUALIZE_THRESHOLD;
  }

  function getTotalColumnCount() {
    return headerKeys.length + ((Array.isArray(rowActions) && rowActions.length) ? 1 : 0);
  }

  function getTableHeadHeightPx() {
    try {
      const r = thead.getBoundingClientRect();
      return Math.max(0, Math.round(r.height || 0));
    } catch (e) {
      return 0;
    }
  }

  function createSpacerRow(heightPx) {
    const tr = document.createElement('tr');
    tr.dataset.kind = 'spacer';
    tr.className = 'table-virtual-spacer-row';
    const td = document.createElement('td');
    td.colSpan = Math.max(1, getTotalColumnCount());
    td.className = 'table-virtual-spacer-cell';
    td.style.height = `${Math.max(0, Math.round(heightPx || 0))}px`;
    td.style.padding = '0';
    td.style.border = '0';
    td.style.background = 'transparent';
    tr.append(td);
    return tr;
  }

  

  function createRowTr(rowData, rowIndex) {
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

      td.style.width = '';
      td.style.minWidth = '';
      td.style.maxWidth = '';
      td.style.display = '';

      tr.append(td);
    }

    try { if (rowData && (rowData.__id || (rowData.meta && rowData.meta.id))) tr.dataset.rowId = rowData.__id || rowData.meta.id; } catch (e) {}

    if (Array.isArray(rowActions) && rowActions.length) {
      const td = document.createElement('td');
      td.dataset.field = 'actions';
      td.classList.add('col-actions');
      for (const act of rowActions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (act.className) btn.className = act.className;
        btn.classList.add('btn');
        btn.textContent = act.label || act.title || '';
        if (act.title) btn.title = act.title;
        btn.addEventListener('click', () => {
          try {
            if (typeof act.onClick === 'function') act.onClick(rowData, rowIndex, { tr, td, table });
          } catch (e) {}
        });
        td.append(btn);
      }
      tr.append(td);
    }

    return tr;
  }

  // Render rows into tbody from a provided rows array
  function renderRows(rowsArr) {
    tbody.innerHTML = '';
    rowsArr.forEach((rowData, rowIndex) => {
      tbody.append(createRowTr(rowData, rowIndex));
    });
  }

  function renderVirtualRows(rowsArr) {
    const total = rowsArr.length;
    if (total === 0) {
      tbody.innerHTML = '';
      return;
    }

    const stickyTop = getStickyTopPx();
    const headH = getTableHeadHeightPx();
    const viewportH = Math.max(0, wrapper.clientHeight - stickyTop - headH);
    const visibleCount = Math.max(1, Math.ceil(viewportH / VIRTUAL_ROW_HEIGHT_PX));
    const scrollTop = wrapper.scrollTop || 0;
    const rawStart = Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT_PX) - VIRTUAL_OVERSCAN;
    const start = Math.max(0, Math.min(total - 1, rawStart));
    const end = Math.max(start, Math.min(total - 1, start + visibleCount + (VIRTUAL_OVERSCAN * 2)));

    const key = `${_virtualRenderNonce}:${total}:${start}:${end}`;
    if (_lastVirtualKey === key) return;
    _lastVirtualKey = key;

    const topPad = start * VIRTUAL_ROW_HEIGHT_PX;
    const bottomPad = Math.max(0, (total - (end + 1)) * VIRTUAL_ROW_HEIGHT_PX);

    tbody.innerHTML = '';
    tbody.append(createSpacerRow(topPad));
    for (let i = start; i <= end; i++) {
      tbody.append(createRowTr(rowsArr[i], i));
    }
    tbody.append(createSpacerRow(bottomPad));
  }

  function attachVirtualScrollHandler() {
    if (_virtualScrollHandlerAttached) return;
    _virtualScrollHandlerAttached = true;
    wrapper.addEventListener('scroll', () => {
      if (!shouldVirtualize(displayRows)) return;
      renderVirtualRows(displayRows);
    }, { passive: true });
  }

  function renderMaybeVirtual(rowsArr) {
    displayRows = Array.isArray(rowsArr) ? rowsArr : [];
    // Bump nonce so virtual renderer knows the underlying data changed
    _virtualRenderNonce++;
    if (!shouldVirtualize(displayRows)) {
      _lastVirtualKey = '';
      table.classList.remove('is-virtualized');
      renderRows(displayRows);
      return;
    }

    table.classList.add('is-virtualized');
    attachVirtualScrollHandler();
    renderVirtualRows(displayRows);
  }

  // Sorting state
  let sortCol = null;
  let sortDir = 'asc';

  // Rebuild headerRow with proper content and optional sorting handlers
  headerRow.innerHTML = '';
  for (let i = 0; i < headerKeys.length; i++) {
    const hk = headerKeys[i];
    const th = document.createElement('th');
    const label = (hk && hk.label) ? hk.label : (hk && hk.key ? humanizeKey(hk.key) : '');
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
      // right-click context menu for column header
      th.addEventListener('contextmenu', (ev) => {
        try {
          ev.preventDefault();
          ev.stopPropagation();
          const field = String(th.dataset.field || '').trim();
          const items = [];
          items.push({ label: 'Sort ascending', onClick: () => { sortCol = i; sortDir = 'asc'; sortAndRender(); } });
          items.push({ label: 'Sort descending', onClick: () => { sortCol = i; sortDir = 'desc'; sortAndRender(); } });
          items.push({ label: 'Clear sort', onClick: () => { sortCol = null; sortAndRender(); } });
          if (field) {
            // generic placeholder add-to-search (keeps existing behavior)
            items.push({ label: 'Add to search', onClick: () => {
              try {
                if (!searchInputEl) return;
                const existing = String(searchInputEl.value || '');
                const token = `{${field}:}`;
                const needsSep = existing.length > 0 && !(/[\s|]$/.test(existing));
                const sep = needsSep ? ' | ' : '';
                searchInputEl.value = existing + sep + token;
                searchInputEl.focus();
                try { searchInputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
              } catch (e) {}
            } });

            // Add per-column stats (value -> count) and top-5 quick-add entries
            try {
              if (searchInputEl) {
                const ci = headerKeys.findIndex(h => h.key === String(field));
                if (ci >= 0 && Array.isArray(currentRows) && currentRows.length) {
                  const counts = new Map();
                  for (const r of currentRows) {
                    try {
                      const v = extractCellValue(r[ci]);
                      const k = String(v ?? '');
                      counts.set(k, (counts.get(k) || 0) + 1);
                    } catch (e) {}
                  }
                  const entries = Array.from(counts.entries()).sort((a, b) => {
                    const diff = b[1] - a[1];
                    if (diff !== 0) return diff;
                    return String(a[0] ?? '').localeCompare(String(b[0] ?? ''), undefined, { sensitivity: 'base' });
                  });
                  const top = entries.slice(0, 5);
                  for (const [val, cnt] of top) {
                    const displayVal = (val === '') ? '(empty)' : val;
                    const safeVal = (val === '') ? '' : String(val).replace(/}/g, '').replace(/\|/g, ' ').trim();
                    const label = `Add to Search {${displayVal}} | ${cnt}`;
                    items.push({ label, onClick: () => {
                      try {
                        if (!searchInputEl) return;
                        const existing = String(searchInputEl.value || '');
                        const token = `{${field}:${safeVal}}`;
                        const needsSep = existing.length > 0 && !(/[\s|]$/.test(existing));
                        const sep = needsSep ? ' | ' : '';
                        searchInputEl.value = existing + sep + token;
                        searchInputEl.focus();
                        try { searchInputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                      } catch (e) {}
                    } });
                  }
                }
              }
            } catch (e) {}
          }
          openRightClickMenu({ x: ev.clientX, y: ev.clientY, items, context: 'table-context-menu' });
        } catch (e) {}
      });
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

  thead.append(headerRow);

  

  

  

  // Optional search UI
  if (searchable) {
    const searchWrap = document.createElement('div');
    searchWrap.className = 'table-search';
    searchWrapEl = searchWrap;
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'table-search-input';
    searchInput.placeholder = 'Search (use % as wildcard)';
    // expose search input so header context menu can append tokens
    searchInputEl = searchInput;
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
    updateStickyOffsets();

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

    // Local (ephemeral) table filter.
    // This only affects the currently-rendered rows in this table component.
    // Views can additionally listen for explicit "apply" events (Enter/Clear) to
    // persist a domain-level filter and re-render from their source data.
    function isAutoCleanEnabled() {
      try {
        const sm = store?.settings;
        if (!(sm && typeof sm.isReady === 'function' && sm.isReady() && typeof sm.get === 'function')) return true;
        const consumerId = id ? `table.${String(id)}` : 'table';
        return !!sm.get('utils.tableSearch.log.autoCleanQuery', { consumerId });
      } catch (e) {
        return true;
      }
    }

    function applyFilter(q) {
      const total = Array.isArray(originalRows) ? originalRows.length : 0;
      const label = `table.applyFilter (${total})`;
      return timed(label, () => {
        const rawQuery = String(q || '').trim();
        if (!rawQuery) {
          currentRows = originalRows.slice();
          sortAndRender();
          try { clearBtn.disabled = true; } catch (e) {}
          return;
        }

        // While typing, optionally evaluate against a cleaned query so the
        // ephemeral filter behaves the same as the "submit" behavior (Enter)
        // without mutating the user's input value.
        const autoClean = isAutoCleanEnabled();
        let evalQuery = rawQuery;
        if (autoClean) {
          try { evalQuery = String(cleanSearchQuery(rawQuery) || '').trim(); } catch (e) { evalQuery = rawQuery; }
        }
        if (!evalQuery) {
          currentRows = originalRows.slice();
          sortAndRender();
          try { clearBtn.disabled = !(rawQuery.length > 0); } catch (e) {}
          return;
        }

        const compiled = compileTableSearchQuery(evalQuery);
        const fieldsMeta = headerKeys.map(h => ({ key: h.key, type: h.type ?? null })).filter(h => h && h.key);
        const fieldIndexByKey = new Map();
        for (let i = 0; i < headerKeys.length; i++) {
          const k = headerKeys[i]?.key;
          if (k) fieldIndexByKey.set(String(k), i);
        }

        currentRows = originalRows.filter((row) => {
          try {
            const accessor = {
              hasField: (k) => fieldIndexByKey.has(String(k)),
              getValue: (k) => {
                const idx = fieldIndexByKey.get(String(k));
                if (idx == null || idx < 0) return undefined;
                return extractCellValue(row[idx]);
              },
              getFieldType: (k) => {
                const idx = fieldIndexByKey.get(String(k));
                const t = (idx != null && idx >= 0) ? headerKeys[idx]?.type : null;
                return t ?? null;
              },
              getAllValues: () => row.slice(0, headerKeys.length).map(c => extractCellValue(c)),
            };
            return matchesTableSearch(accessor, compiled, { fields: fieldsMeta });
          } catch {
            return false;
          }
        });

        sortAndRender();
        try {
          const has = rawQuery.length > 0;
          clearBtn.disabled = !has;
        } catch (e) {}
      });
    }

    // Emitted when the user explicitly applies the search (Enter/Clear).
    // This is intentionally *not* emitted on every keystroke so consumers can
    // keep fast local filtering while typing without persisting/requerying.
    function emitSearchApplied({ via = 'enter' } = {}) {
      try {
        wrapper.dispatchEvent(new CustomEvent('table:searchApplied', {
          bubbles: true,
          detail: {
            query: String(searchInput.value || '').trim(),
            via: String(via || '').trim() || 'enter',
          }
        }));
      } catch (e) {
        // ignore
      }
    }

    // Initial state
    try { clearBtn.disabled = !(String(searchInput.value || '').trim().length > 0); } catch (e) {}

    // Debounce filtering to avoid running expensive filter on every keystroke.
    let _filterTimeout = null;
    const _debounceMs = 150;
    function scheduleApplyFilter(q) {
      if (_filterTimeout) clearTimeout(_filterTimeout);
      _filterTimeout = setTimeout(() => { applyFilter(q); _filterTimeout = null; }, _debounceMs);
    }

    // Apply immediately on Enter for snappy UX.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (_filterTimeout) { clearTimeout(_filterTimeout); _filterTimeout = null; }
        try {
          const autoClean = isAutoCleanEnabled();
          if (autoClean) {
            const cleaned = cleanSearchQuery(searchInput.value);
            searchInput.value = cleaned;
            applyFilter(cleaned);
          } else {
            applyFilter(searchInput.value);
          }
          emitSearchApplied({ via: 'enter' });
        } catch (err) {
          applyFilter(searchInput.value);
          emitSearchApplied({ via: 'enter' });
        }
      }
    });

    searchInput.addEventListener('input', () => scheduleApplyFilter(searchInput.value));
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      if (_filterTimeout) { clearTimeout(_filterTimeout); _filterTimeout = null; }
      applyFilter('');
      emitSearchApplied({ via: 'clear' });
      searchInput.focus();
    });
    copyBtn.addEventListener('click', async () => {
      try {
        // Build array of objects from current (filtered + sorted) rows using headerKeys
        const srcRows = Array.isArray(displayRows) ? displayRows : currentRows;
        const out = srcRows.map(r => {
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

  // Perform initial render (respect any initial sort passed in)
  timed('table.initialRender', () => {
    // If caller provided an initial sort key, resolve it to a column index
    try {
      if (initialSortKey) {
        const idx = headerKeys.findIndex(h => h.key === String(initialSortKey));
        if (idx >= 0) {
          sortCol = idx;
          sortDir = (String(initialSortDir || '').toLowerCase() === 'desc') ? 'desc' : 'asc';
        }
      }
    } catch (e) {}
    sortAndRender();
  });

  // Sorting helper
  function sortAndRender() {
    return timed('table.sortAndRender', () => {
    if (sortCol === null) {
      renderMaybeVirtual(currentRows);
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

    renderMaybeVirtual(paired.map(p => p.data));

    Array.from(headerRow.children).forEach((th, j) => {
      if (j === sortCol) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      else th.setAttribute('aria-sort', 'none');
    });
    });
  }

  table.append(thead, tbody);
  wrapper.append(table);
  updateStickyOffsets();
  return wrapper;
  });
}
