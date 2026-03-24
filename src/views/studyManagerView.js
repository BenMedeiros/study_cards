import { createTable } from '../components/shared/table.js';
import { createJsonViewer } from '../components/shared/jsonViewer.js';
import { card, el } from '../utils/browser/ui.js';
import { createViewHeaderTools } from '../components/features/viewHeaderTools.js';
import { openTableSettingsDialog } from '../components/dialogs/tableSettingsDialog.js';
import { formatIsoShort } from '../utils/browser/helpers.js';
import studyManagerController from '../controllers/studyManagerController.js';
import studyManagerViewController from '../controllers/studyManagerViewController.js';
import {
  normalizeTableSettings,
  applyTableColumnSettings,
  applyTableColumnStyles,
  applyTableActionSettings,
  buildTableColumnItems,
} from '../utils/browser/tableSettings.js';

const TABLE_ACTION_ITEMS = [
  { key: 'clear', label: 'Clear' },
  { key: 'copyJson', label: 'Copy JSON' },
  { key: 'copyFullJson', label: 'Copy Full JSON' },
];

function asNumber(v) {
  return Math.max(0, Math.round(Number(v) || 0));
}

function formatMinutes(ms) {
  const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  return `${minutes} min`;
}

function cycleOption(options, currentValue) {
  const items = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!items.length) return currentValue;
  const index = items.findIndex((item) => String(item) === String(currentValue));
  if (index < 0) return items[0];
  return items[(index + 1) % items.length];
}

function shortFilterLabel(filterKey) {
  const key = String(filterKey || '').trim();
  if (!key) return '(no filter)';
  if (key.length <= 64) return key;
  return `${key.slice(0, 63)}...`;
}

function renderMetric(label, value) {
  return el('div', {
    className: 'study-manager-metric',
    children: [
      el('div', { className: 'study-manager-metric-label', text: label }),
      el('div', { className: 'study-manager-metric-value', text: value }),
    ],
  });
}

function makeTableCard({ id, title, caption = '', table }) {
  return card({ id, title, cornerCaption: caption, children: [table] });
}

function ensureCardTopRightArea(cardEl) {
  if (!cardEl) return null;

  let area = cardEl.querySelector('.study-manager-card-top-right');
  if (!area) {
    area = el('div', { className: 'study-manager-card-top-right' });
    cardEl.append(area);
  }

  const caption = cardEl.querySelector('.card-corner-caption');
  if (caption && caption.parentNode !== area) area.append(caption);

  let actions = area.querySelector('.study-manager-card-actions');
  if (!actions) {
    actions = el('div', { className: 'study-manager-card-actions' });
    area.append(actions);
  }

  return { area, actions };
}

function attachCardCornerButton({
  cardEl,
  text = 'Action',
  title = '',
  onClick,
  className = 'btn small table-card-settings-btn study-manager-card-btn',
} = {}) {
  if (!cardEl || typeof onClick !== 'function') return null;
  const topRight = ensureCardTopRightArea(cardEl);
  if (!topRight?.actions) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = String(text || 'Action');
  btn.title = String(title || text || 'Action');
  btn.addEventListener('click', () => { onClick(); });
  topRight.actions.append(btn);
  return btn;
}

function openStudyManagerJsonDialog({ title = 'JSON', data = null } = {}) {
  const mount = document.body || document.documentElement;
  if (!mount) return;

  const backdrop = el('div', { className: 'study-manager-json-backdrop' });
  const dialog = el('div', {
    className: 'study-manager-json-dialog card',
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': String(title || 'JSON'),
    },
  });
  dialog.tabIndex = -1;

  const header = el('div', {
    className: 'study-manager-json-header',
    children: [
      el('div', {
        children: [
          el('h2', { text: String(title || 'JSON') }),
          el('p', { className: 'hint', text: 'Raw card dataset' }),
        ],
      }),
    ],
  });

  const viewer = createJsonViewer(data, {
    expanded: true,
    maxChars: 200000,
    maxLines: 10000,
    previewLen: 400,
  });
  viewer.classList.add('study-manager-json-viewer');
  const jsonContent = viewer.querySelector('.json-content');
  if (jsonContent) {
    try { jsonContent.style.maxHeight = '68vh'; } catch (e) {}
    try { jsonContent.style.overflow = 'auto'; } catch (e) {}
    try { jsonContent.style.background = 'rgba(2, 6, 23, 0.92)'; } catch (e) {}
    try { jsonContent.style.borderRadius = '0.45rem'; } catch (e) {}
    try { jsonContent.style.padding = '0.35rem 0.35rem 0.5rem 0.35rem'; } catch (e) {}
  }
  const jsonTree = viewer.querySelector('.json-tree');
  if (jsonTree) {
    try { jsonTree.style.background = 'rgba(2, 6, 23, 0.96)'; } catch (e) {}
  }
  const jsonPre = viewer.querySelector('.json-view');
  if (jsonPre) {
    try { jsonPre.style.background = 'rgba(2, 6, 23, 0.96)'; } catch (e) {}
  }

  const body = el('div', { className: 'study-manager-json-body', children: [viewer] });
  const closeBtn = el('button', { className: 'btn', text: 'Close', attrs: { type: 'button' } });
  const footer = el('div', { className: 'study-manager-json-footer', children: [closeBtn] });
  dialog.append(header, body, footer);

  function finish() {
    try { dialog.remove(); } catch (e) {}
    try { backdrop.remove(); } catch (e) {}
  }
  closeBtn.addEventListener('click', finish);
  backdrop.addEventListener('click', finish);
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    finish();
  });

  mount.append(backdrop, dialog);
  try { dialog.focus(); } catch (e) {}
}

function appendCardHint(cardEl, text, beforeEl = null) {
  const value = String(text || '').trim();
  if (!cardEl || !value) return null;
  const hintEl = el('p', { className: 'hint', text: value });
  if (beforeEl && beforeEl.parentNode === cardEl) {
    cardEl.insertBefore(hintEl, beforeEl);
  } else {
    cardEl.append(hintEl);
  }
  return hintEl;
}

function buildDataRoute(collectionId, filterKey, studyFilter = '') {
  const coll = encodeURIComponent(String(collectionId || ''));
  const held = String(filterKey || '').trim();
  const study = String(studyFilter || '').trim();
  const params = [`collection=${coll}`];
  if (held) params.push(`heldTableSearch=${encodeURIComponent(held)}`);
  if (study) params.push(`studyFilter=${encodeURIComponent(study)}`);
  return `/data?${params.join('&')}`;
}

function makeRouteAction({ label, meta = '', path = '', onNavigate, className = 'study-manager-route-action' }) {
  const route = String(path || '').trim();
  if (!route) return null;
  const link = el('a', {
    className,
    attrs: { href: `#${route}`, 'data-go': route },
    children: [
      el('span', { text: String(label || '') }),
      meta ? el('span', { className: 'study-manager-route-action-meta', text: String(meta) }) : null,
    ].filter(Boolean),
  });
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof onNavigate === 'function') onNavigate(route);
    else location.hash = route;
  });
  return link;
}

function makeDisabledRouteAction({ label, meta = '', className = 'study-manager-route-action is-disabled' }) {
  return el('span', {
    className,
    children: [
      el('span', { text: String(label || '') }),
      meta ? el('span', { className: 'study-manager-route-action-meta', text: String(meta) }) : null,
    ].filter(Boolean),
  });
}

function formatQueryCaption(query) {
  if (!query || typeof query !== 'object') return '';
  const parts = [];
  const data = Array.isArray(query.data) ? query.data.join('+') : String(query.data || '').trim();
  if (data) parts.push(data);
  const where = (query.where && typeof query.where === 'object') ? query.where : null;
  if (where) {
    for (const [key, value] of Object.entries(where)) {
      const v = String(value || '').trim();
      if (v) parts.push(`${key}=${v}`);
    }
  }
  if (Array.isArray(query.groupBy) && query.groupBy.length) {
    parts.push(`groupBy ${query.groupBy.join(', ')}`);
  }
  if (query.windowDays) parts.push(`window ${asNumber(query.windowDays)}d`);
  return parts.join(' | ');
}

function formatDayFilterMeta(item) {
  return formatMinutes(asNumber(item.durationMs));
}

function buildDailySummaryCard({ report }) {
  const summary = report?.studyTimeByDateSummary || null;
  if (!summary) return null;

  return card({
    id: 'study-manager-daily-summary-card',
    title: 'Daily Study Summary',
    children: [
      el('div', {
          className: 'study-manager-summary-grid',
          children: [
          renderMetric(`${asNumber(summary.windowDays)}d Time`, formatMinutes(asNumber(summary.totalDurationMs))),
          renderMetric(`${asNumber(summary.windowDays)}d Sessions`, String(asNumber(summary.totalSessions))),
          renderMetric(`${asNumber(summary.windowDays)}d Active Days`, String(asNumber(summary.activeDays))),
          renderMetric('Tracked Days', String(asNumber(summary.totalDays))),
        ],
      }),
    ],
  });
}

function buildDailyActivityCard({ report, onNavigate, hideRepeatedFilters = false, onToggleHideRepeated = null }) {
  const days = Array.isArray(report?.studyTimeByDate) ? report.studyTimeByDate : [];
  if (!days.length) return null;

  const seenFilters = new Set();
  const rows = days.map((day) => {
    const filterSummaries = Array.isArray(day.filterSummaries) ? day.filterSummaries : [];
    const filters = filterSummaries
      .map((item) => {
        const dedupeKey = String(item.filterKey || '');
        const alreadySeen = seenFilters.has(dedupeKey);
        const meta = formatDayFilterMeta(item);
        const node = (hideRepeatedFilters && alreadySeen)
          ? makeDisabledRouteAction({
              label: shortFilterLabel(item.filterLabel || item.filterKey),
              meta,
              className: 'study-manager-day-filter-link is-disabled',
            })
          : makeRouteAction({
              label: shortFilterLabel(item.filterLabel || item.filterKey),
              meta,
              path: buildDataRoute(report.collectionId, item.filterKey),
              onNavigate,
              className: 'study-manager-day-filter-link',
            });
        seenFilters.add(dedupeKey);
        return node;
      })
      .filter(Boolean);

    return el('div', {
      className: 'study-manager-day-row',
      children: [
        el('div', {
          className: 'study-manager-day-head',
          children: [
            el('div', { className: 'study-manager-day-label', text: String(day.dayLabel || day.dayStamp || '') }),
            el('div', { className: 'study-manager-day-meta', text: `${formatMinutes(asNumber(day.totalDurationMs))} • ${asNumber(day.sessionCount)} sessions` }),
          ],
        }),
        filters.length
          ? el('div', { className: 'study-manager-day-filters', children: filters })
          : el('div', {
              className: 'study-manager-day-empty hint',
              text: hideRepeatedFilters ? 'All filter summaries already shown on more recent days.' : 'No filter summaries.',
            }),
      ].filter(Boolean),
    });
  });

  const dailyCard = card({
    id: 'study-manager-daily-card',
    title: 'Study Time By Date',
    cornerCaption: `${days.length} days`,
    children: [
      el('div', { className: 'study-manager-day-list', children: rows }),
    ],
  });

  const toggleBtn = attachCardCornerButton({
    cardEl: dailyCard,
    text: hideRepeatedFilters ? 'Show Repeats' : 'Hide Repeats',
    title: 'Disable filter summaries that already appear on more recent days',
    onClick: () => {
      if (typeof onToggleHideRepeated === 'function') onToggleHideRepeated();
    },
  });
  if (toggleBtn) toggleBtn.classList.toggle('is-active', !!hideRepeatedFilters);

  return dailyCard;
}

function sortRecommendationItems(items, sortKey) {
  const rows = Array.isArray(items) ? items.slice() : [];
  rows.sort((a, b) => {
    if (sortKey === 'remainingCountDesc') {
      if (b.remainingCount !== a.remainingCount) return b.remainingCount - a.remainingCount;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      if (b.focusCount !== a.focusCount) return b.focusCount - a.focusCount;
    } else {
      if (b.focusCount !== a.focusCount) return b.focusCount - a.focusCount;
      if (b.remainingCount !== a.remainingCount) return b.remainingCount - a.remainingCount;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    }
    return String(a.token || '').localeCompare(String(b.token || ''));
  });
  return rows;
}

function getRecommendationSets(report) {
  const sets = Array.isArray(report?.recommendationSets) ? report.recommendationSets.filter(Boolean) : [];
  if (sets.length) return sets;
  return report?.recommendations ? [report.recommendations] : [];
}

function getRecommendationsState(recommendationSet, sortKey, minimumEntryCount) {
  const rec = recommendationSet || null;
  const summary = rec?.summary || null;
  const config = rec?.config || null;
  if (!summary || !config) return null;

  const sortOptions = Array.isArray(config.sortOptions) ? config.sortOptions : [];
  const minimumEntryCountOptions = Array.isArray(config.minimumEntryCountOptions) ? config.minimumEntryCountOptions : [];
  const activeSortKey = sortOptions.some((item) => item?.key === sortKey)
    ? sortKey
    : String(config.defaultSortKey || sortOptions[0]?.key || 'focusCountDesc');
  const activeMinimumEntryCount = minimumEntryCountOptions.includes(asNumber(minimumEntryCount))
    ? asNumber(minimumEntryCount)
    : asNumber(config.defaultMinimumEntryCount);
  const visibleItems = sortRecommendationItems(Array.isArray(rec.items) ? rec.items : [], activeSortKey)
    .filter((item) => asNumber(item.totalCount) >= activeMinimumEntryCount);
  const sortLabel = sortOptions.find((item) => item?.key === activeSortKey)?.label || activeSortKey;
  const tokenLabel = String(config.tokenLabel || summary.tokenLabel || 'Token');

  return {
    rec,
    summary,
    config,
    sortOptions,
    minimumEntryCountOptions,
    activeSortKey,
    activeMinimumEntryCount,
    visibleItems,
    sortLabel,
    tokenLabel,
  };
}

function buildRecommendationsTable({
  store,
  recommendationSet,
  recommendationReportResult = null,
  onNavigate,
  sortKey,
  minimumEntryCount,
  tableSettings,
  onSearchQueryChange = null,
} = {}) {
  const state = getRecommendationsState(recommendationSet, sortKey, minimumEntryCount);
  if (!state) return null;
  const hasWordsRoute = state.visibleItems.some((item) => String(item?.wordsRoute || '').trim());

  const headers = [
    { key: 'token', label: state.tokenLabel },
    ...(hasWordsRoute ? [{ key: 'wordsLink', label: 'Words Link' }] : []),
    { key: 'words', label: 'Word Count', type: 'number' },
    { key: 'seen', label: 'Seen', type: 'number' },
    { key: 'focus', label: 'Focus', type: 'number' },
    { key: 'learned', label: 'Learned', type: 'number' },
    { key: 'remaining', label: 'Remaining', type: 'number' },
  ];

  const rows = state.visibleItems.map((item) => {
    const route = String(item.route || '').trim();
    const wordsRoute = String(item.wordsRoute || '').trim();
    const tokenLink = route
      ? makeRouteAction({
          label: `${state.tokenLabel} ${item.token}`,
          meta: '',
          path: route,
          onNavigate,
          className: 'study-manager-rec-link',
        })
      : String(item.token || '');
    const wordsLink = wordsRoute
      ? makeRouteAction({
          label: 'Words',
          meta: '',
          path: wordsRoute,
          onNavigate,
          className: 'study-manager-rec-link',
        })
      : '';
    const out = [
      tokenLink,
      ...(hasWordsRoute ? [wordsLink] : []),
      asNumber(item.totalCount),
      asNumber(item.seenCount),
      asNumber(item.focusCount),
      asNumber(item.learnedCount),
      asNumber(item.remainingCount),
    ];
    out.__id = String(item.token || '');
    out.__route = route;
    out.__wordsRoute = wordsRoute;
    return out;
  });

  const applied = applyTableColumnSettings({ headers, rows, tableSettings });
  const table = createTable({
    store,
    headers: applied.headers,
    rows: applied.rows,
    columnRenderSettings: (tableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: tableSettings?.table || {},
    id: 'study-manager-recommendations-table',
    sortable: true,
    searchable: true,
    initialSearchQuery: String(tableSettings?.table?.searchQuery || '').trim(),
    onSearchQueryChange,
    rowActions: [
      {
        label: 'Open Data',
        title: 'Open Data view for this recommendation',
        className: 'btn small',
        onClick: (rowData) => {
          const path = String(rowData?.__route || '').trim();
          if (!path) return;
          if (typeof onNavigate === 'function') onNavigate(path);
          else location.hash = path;
        },
      },
      ...(hasWordsRoute ? [{
        label: 'Open Words',
        title: 'Open Data view for matching words',
        className: 'btn small',
        onClick: (rowData) => {
          const path = String(rowData?.__wordsRoute || '').trim();
          if (!path) return;
          if (typeof onNavigate === 'function') onNavigate(path);
          else location.hash = path;
        },
      }] : []),
    ],
  });

  applyTableColumnStyles({ wrapper: table, tableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings, actionItems: TABLE_ACTION_ITEMS });

  return { table, headers, rows, sourceInfo: formatQueryCaption(recommendationReportResult?.query), state };
}

function buildRecommendationsCard({
  store,
  recommendationSet,
  recommendationReportResult = null,
  onNavigate,
  sortKey = 'focusCountDesc',
  minimumEntryCount = 5,
  viewMode = 'cards',
  recommendationsTableSettings = null,
  onSearchQueryChange = null,
} = {}) {
  const state = getRecommendationsState(recommendationSet, sortKey, minimumEntryCount);
  if (!state) return null;

  const filterRows = state.visibleItems.map((item) => {
    const primaryAction = String(item.route || '').trim()
      ? makeRouteAction({
          label: `${state.tokenLabel} ${item.token}`,
          meta: `${asNumber(item.totalCount)} words`,
          path: String(item.route || '').trim(),
          onNavigate,
          className: 'study-manager-rec-link',
        })
      : makeDisabledRouteAction({
          label: `${state.tokenLabel} ${item.token}`,
          meta: `${asNumber(item.totalCount)} words`,
          className: 'study-manager-rec-link is-disabled',
        });
    const wordsAction = String(item.wordsRoute || '').trim()
      ? makeRouteAction({
          label: 'Words',
          meta: '',
          path: String(item.wordsRoute || '').trim(),
          onNavigate,
          className: 'study-manager-rec-link',
        })
      : null;
    return el('div', {
      className: 'study-manager-rec-row',
      children: [
        el('div', {
          className: 'study-manager-rec-head',
          children: [
            primaryAction,
            wordsAction,
            el('div', {
              className: 'hint',
              text: `seen ${asNumber(item.seenCount)} • focus ${asNumber(item.focusCount)} • learned ${asNumber(item.learnedCount)} • remaining ${asNumber(item.remainingCount)}`,
            }),
          ].filter(Boolean),
        }),
      ].filter(Boolean),
    });
  });

  const recommendationsTableObj = viewMode === 'table'
    ? buildRecommendationsTable({
        store,
        recommendationSet,
        recommendationReportResult,
        onNavigate,
        sortKey: state.activeSortKey,
        minimumEntryCount: state.activeMinimumEntryCount,
        tableSettings: recommendationsTableSettings,
        onSearchQueryChange,
      })
    : null;

  const cardEl = card({
    id: `study-manager-recommendations-card-${String(state.config.id || 'recommendations')}`,
    title: String(state.config.title || 'Recommendations'),
    cornerCaption: `${filterRows.length}/${asNumber(state.summary.itemCount)} shown`,
    children: [
      el('div', {
        className: 'study-manager-summary-grid',
        children: [
          renderMetric('Entries', String(asNumber(state.summary.sourceEntryCount))),
          renderMetric('Grouped', String(asNumber(state.summary.groupedEntryCount ?? state.summary.tokenizedEntryCount))),
          renderMetric(state.tokenLabel, String(asNumber(state.summary.itemCount))),
          renderMetric(`>= ${state.activeMinimumEntryCount} Words`, String(filterRows.length)),
          viewMode === 'table' ? null : renderMetric('Sort', state.sortLabel),
        ],
      }),
      filterRows.length
        ? (viewMode === 'table' && recommendationsTableObj?.table
            ? el('div', {
                className: 'study-manager-recommendations-section',
                children: [
                  el('div', { className: 'study-manager-insight-title', text: `${state.tokenLabel} Coverage` }),
                  recommendationsTableObj.table,
                ],
              })
            : el('div', {
                className: 'study-manager-recommendations-section',
                children: [
                  el('div', { className: 'study-manager-insight-title', text: `${state.tokenLabel} Coverage` }),
                  el('div', { className: 'study-manager-rec-list', children: filterRows }),
                ],
              }))
        : el('div', {
        className: 'study-manager-recommendations-section',
        children: [
          el('div', { className: 'hint', text: `No ${state.tokenLabel.toLowerCase()} items match the current minimum word count.` }),
        ],
      }),
    ].filter(Boolean),
  });

  return {
    card: cardEl,
    tableObj: recommendationsTableObj,
    recommendationReportResult,
    state,
  };
}

function buildFilterTable({ store, report, onNavigate, tableSettings }) {
  const headers = [
    { key: 'filter', label: 'Filter' },
    { key: 'savedFilter', label: 'Saved' },
    { key: 'directTime', label: 'Direct Time' },
    { key: 'rolledDownTime', label: 'With Subfilters' },
    { key: 'rolledUpTime', label: 'With Parents' },
    { key: 'entries', label: 'Entries', type: 'number' },
    { key: 'entriesSeen', label: 'Entries Seen', type: 'number' },
    { key: 'timesSeen', label: 'Times Seen', type: 'number' },
    { key: 'notSeen', label: 'Not Seen', type: 'number' },
    { key: 'nullState', label: 'Null', type: 'number' },
    { key: 'focusState', label: 'Focus', type: 'number' },
    { key: 'learnedState', label: 'Learned', type: 'number' },
    { key: 'learnedPct', label: 'Learned %', type: 'number' },
    { key: 'parentFilters', label: 'Parents' },
    { key: 'lastSession', label: 'Last Session' },
  ];

  const rows = (Array.isArray(report?.studyTimeByFilter) ? report.studyTimeByFilter : []).map((row) => {
    const path = buildDataRoute(report.collectionId, row.filterKey);
    const filterLink = el('a', {
      className: 'study-manager-filter-link',
      text: shortFilterLabel(row.filterKey),
      attrs: { href: `#${path}` },
    });
    filterLink.title = String(row.filterKey || '');
    filterLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof onNavigate === 'function') onNavigate(path);
      else location.hash = path;
    });

    const parentFilters = (Array.isArray(row.parents) ? row.parents : [])
      .map((p) => shortFilterLabel(p.filterKey))
      .join(' | ');

    const out = [
      filterLink,
      row.isSavedFilter ? 'true' : 'false',
      formatMinutes(asNumber(row.directDurationMs)),
      formatMinutes(asNumber(row.rolledDownDurationMs)),
      formatMinutes(asNumber(row.rolledUpDurationMs)),
      asNumber(row.totalEntries),
      asNumber(row.seenCount),
      asNumber(row.timesSeenTotal),
      asNumber(row.notSeenCount),
      asNumber(row.stateNullCount),
      asNumber(row.stateFocusCount),
      asNumber(row.stateLearnedCount),
      Number((Number(row.learnedPct) || 0).toFixed(1)),
      parentFilters,
      row.lastSessionIso ? formatIsoShort(row.lastSessionIso) : '',
    ];
    out.__id = row.filterKey;
    return out;
  });

  const applied = applyTableColumnSettings({ headers, rows, tableSettings });

  const table = createTable({
    store,
    headers: applied.headers,
    rows: applied.rows,
    columnRenderSettings: (tableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: tableSettings?.table || {},
    id: 'study-manager-filters-table',
    sortable: true,
    searchable: true,
    rowActions: [
      {
        label: 'Open Data',
        title: 'Open Data view with this held filter',
        className: 'btn small',
        onClick: (rowData) => {
          const key = String(rowData?.__id || '').trim();
          const path = buildDataRoute(report.collectionId, key);
          if (typeof onNavigate === 'function') onNavigate(path);
          else location.hash = path;
        },
      },
    ],
  });

  applyTableColumnStyles({ wrapper: table, tableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings, actionItems: TABLE_ACTION_ITEMS });

  return { table, headers, rows, sourceInfo: formatQueryCaption(report?.queries?.studyTimeByFilter) };
}

function buildAppsTable({ store, report, tableSettings }) {
  const rows = (Array.isArray(report?.groupByAppId) ? report.groupByAppId : []).map((r) => [
    String(r.appId || ''),
    formatMinutes(asNumber(r.durationMs)),
    asNumber(r.durationMs),
  ]);
  const headers = [
    { key: 'appId', label: 'App' },
    { key: 'duration', label: 'Time' },
    { key: 'durationMs', label: 'Duration Ms', type: 'number' },
  ];

  const applied = applyTableColumnSettings({ headers, rows, tableSettings });
  const table = createTable({
    store,
    headers: applied.headers,
    rows: applied.rows,
    columnRenderSettings: (tableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: tableSettings?.table || {},
    id: 'study-manager-apps-table',
    sortable: true,
    searchable: true,
  });
  applyTableColumnStyles({ wrapper: table, tableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings, actionItems: TABLE_ACTION_ITEMS });

  return { table, headers, rows, sourceInfo: formatQueryCaption(report?.queries?.groupByAppId) };
}

export function renderStudyManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'study-manager-root';

  let snapshot = studyManagerController.getSnapshot() || {};
  let pendingSnapshot = null;
  let selectedCollectionId = String(route?.query?.get('collection') || store?.collections?.getActiveCollectionId?.() || '').trim();
  let pendingEnsureCollectionId = '';
  let hideRepeatedDateFilters = false;
  let recommendationsSortKey = 'focusCountDesc';
  let recommendationsMinimumEntryCount = 5;
  let recommendationsViewMode = 'cards';
  const collapsedCards = Object.create(null);

  let tableSettingsCtrl = null;
  let tableSettingsCollectionId = '';
  let filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
  let appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
  let recommendationsTableSettingsById = Object.create(null);

  function ensureTableSettingsController(collId) {
    const key = String(collId || '').trim();
    if (!key) {
      tableSettingsCtrl = null;
      tableSettingsCollectionId = '';
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      recommendationsTableSettingsById = Object.create(null);
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      hideRepeatedDateFilters = false;
      recommendationsViewMode = 'cards';
      return;
    }
    if (tableSettingsCtrl && tableSettingsCollectionId === key) return;

    try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch (e) {}

    tableSettingsCollectionId = key;
    try {
      tableSettingsCtrl = studyManagerViewController.create(key);
      filtersTableSettings = normalizeTableSettings(tableSettingsCtrl.getFiltersTableSettings());
      appsTableSettings = normalizeTableSettings(tableSettingsCtrl.getAppsTableSettings());
      recommendationsTableSettingsById = Object.create(null);
      const cardsState = tableSettingsCtrl.getCardsState();
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      collapsedCards.summary = !!cardsState?.summary?.collapsed;
      collapsedCards.dailySummary = !!cardsState?.dailySummary?.collapsed;
      collapsedCards.studyTimeByDate = !!cardsState?.studyTimeByDate?.collapsed;
      collapsedCards.recommendations = !!cardsState?.recommendations?.collapsed;
      for (const [id, collapsed] of Object.entries(cardsState?.recommendations?.collapsedById || {})) {
        collapsedCards[`recommendations:${id}`] = !!collapsed;
      }
      collapsedCards.studyTimeByFilter = !!cardsState?.studyTimeByFilter?.collapsed;
      collapsedCards.groupByAppId = !!cardsState?.groupByAppId?.collapsed;
      hideRepeatedDateFilters = !!cardsState?.studyTimeByDate?.hideRepeated;
      recommendationsSortKey = String(cardsState?.recommendations?.sortKey || 'focusCountDesc').trim() || 'focusCountDesc';
      recommendationsMinimumEntryCount = asNumber(cardsState?.recommendations?.minimumEntryCount) || 5;
      recommendationsViewMode = String(cardsState?.recommendations?.viewMode || 'cards').trim() === 'table' ? 'table' : 'cards';
    } catch (e) {
      tableSettingsCtrl = null;
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      recommendationsTableSettingsById = Object.create(null);
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      hideRepeatedDateFilters = false;
      recommendationsSortKey = 'focusCountDesc';
      recommendationsMinimumEntryCount = 5;
      recommendationsViewMode = 'cards';
    }
  }

  async function persistFiltersTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    filtersTableSettings = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setFiltersTableSettings(normalized); } catch (e) {}
    renderBody();
  }

  async function persistAppsTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    appsTableSettings = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setAppsTableSettings(normalized); } catch (e) {}
    renderBody();
  }

  function getRecommendationTableSettings(recommendationId = '') {
    const id = String(recommendationId || '').trim();
    if (id && recommendationsTableSettingsById[id]) return recommendationsTableSettingsById[id];
    try {
      if (tableSettingsCtrl) {
        const normalized = normalizeTableSettings(tableSettingsCtrl.getRecommendationsTableSettings(id));
        if (id) recommendationsTableSettingsById[id] = normalized;
        return normalized;
      }
    } catch (e) {}
    return studyManagerViewController.getDefaultRecommendationsTableSettings();
  }

  async function persistRecommendationsTableSettings(recommendationId, nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    const id = String(recommendationId || '').trim();
    if (id) recommendationsTableSettingsById[id] = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setRecommendationsTableSettings(normalized, { recommendationId: id }); } catch (e) {}
    renderBody();
  }

  async function persistRecommendationsTableSearchQuery(recommendationId, query) {
    const id = String(recommendationId || '').trim();
    const normalized = normalizeTableSettings({
      ...getRecommendationTableSettings(id),
      table: {
        ...(getRecommendationTableSettings(id)?.table || {}),
        searchQuery: String(query || '').trim(),
      },
    });
    if (id) recommendationsTableSettingsById[id] = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setRecommendationsTableSettings(normalized, { recommendationId: id }); } catch (e) {}
  }

  async function persistCardsState() {
    const recommendationCollapsedById = Object.fromEntries(
      Object.entries(collapsedCards)
        .filter(([key]) => key.startsWith('recommendations:'))
        .map(([key, value]) => [key.slice('recommendations:'.length), !!value])
        .filter(([key]) => key)
    );
    const nextCards = {
      summary: { collapsed: !!collapsedCards.summary },
      dailySummary: { collapsed: !!collapsedCards.dailySummary },
      studyTimeByDate: {
        collapsed: !!collapsedCards.studyTimeByDate,
        hideRepeated: !!hideRepeatedDateFilters,
      },
      recommendations: {
        collapsed: !!collapsedCards.recommendations,
        collapsedById: recommendationCollapsedById,
        sortKey: recommendationsSortKey,
        minimumEntryCount: recommendationsMinimumEntryCount,
        viewMode: recommendationsViewMode,
      },
      studyTimeByFilter: { collapsed: !!collapsedCards.studyTimeByFilter },
      groupByAppId: { collapsed: !!collapsedCards.groupByAppId },
    };
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setCardsState(nextCards); } catch (e) {}
  }

  const controls = createViewHeaderTools({ elements: [] });
  const body = el('div', { className: 'study-manager-body' });
  root.append(controls, body);

  function getSelectableCollections() {
    const available = (typeof store?.collections?.getAvailableCollections === 'function')
      ? store.collections.getAvailableCollections()
      : [];
    const rows = Array.isArray(available) ? available : [];
    return rows
      .map((item) => ({
        collectionId: String(item?.path || item?.collectionId || '').trim(),
        collectionName: String(item?.name || item?.collectionName || item?.path || item?.collectionId || '').trim(),
      }))
      .filter((item) => item.collectionId);
  }

  async function ensureCollectionLoaded(collectionId) {
    const id = String(collectionId || '').trim();
    if (!id) return null;
    const loaded = Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections() : [];
    const existing = loaded.find((item) => String(item?.key || '').trim() === id);
    if (existing) return existing;
    if (typeof store?.collections?.loadCollection === 'function') {
      try { return await store.collections.loadCollection(id); } catch {}
    }
    return null;
  }

  function getReport(snap = snapshot) {
    const reportMap = (snap?.collections && typeof snap.collections === 'object') ? snap.collections : {};
    const reports = Object.values(reportMap);
    const availableCollections = getSelectableCollections();
    const fallbackCollectionId = String(
      availableCollections[0]?.collectionId
      || reports[0]?.collectionId
      || ''
    ).trim();
    if (!selectedCollectionId) {
      selectedCollectionId = fallbackCollectionId;
    } else if (!reportMap[selectedCollectionId] && fallbackCollectionId) {
      const availableSet = new Set(availableCollections.map((item) => String(item?.collectionId || '').trim()).filter(Boolean));
      if (!availableSet.has(selectedCollectionId)) {
        selectedCollectionId = fallbackCollectionId;
      }
    }
    return reportMap[selectedCollectionId] || null;
  }

  function applyCollapsibleCard(cardEl, key) {
    if (!cardEl || !key) return;
    const titleEl = Array.from(cardEl.children).find((child) => child?.tagName === 'H2');
    if (!titleEl) return;

    function setCollapsed(collapsed) {
      collapsedCards[key] = !!collapsed;
      cardEl.classList.toggle('study-manager-card-collapsed', !!collapsed);
      for (const child of Array.from(cardEl.children)) {
        if (child === titleEl) continue;
        if (child.classList.contains('study-manager-card-top-right')) continue;
        child.hidden = !!collapsed;
      }
      titleEl.setAttribute('aria-expanded', String(!collapsed));
      void persistCardsState();
    }

    titleEl.classList.add('study-manager-collapsible-title');
    titleEl.tabIndex = 0;
    titleEl.setAttribute('role', 'button');
    titleEl.addEventListener('click', () => {
      setCollapsed(!collapsedCards[key]);
    });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setCollapsed(!collapsedCards[key]);
    });

    setCollapsed(!!collapsedCards[key]);
  }

  function renderControls() {
    controls.removeControl && controls.removeControl('collection');
    controls.removeControl && controls.removeControl('refresh');

    const collections = getSelectableCollections();
    if (!collections.length) return;

    controls.addElement({
      type: 'dropdown',
      key: 'collection',
      caption: 'collection',
      className: 'align-right',
      items: collections.map((c) => ({ value: c.collectionId, label: c.collectionName || c.collectionId })),
      value: selectedCollectionId,
      onChange: async (next) => {
        const nextId = String(next || '').trim();
        if (!nextId || nextId === selectedCollectionId) return;
        selectedCollectionId = nextId;
        pendingEnsureCollectionId = nextId;
        renderControls();
        renderBody();
        await ensureCollectionLoaded(selectedCollectionId);
        try { studyManagerController.ensureCollections([selectedCollectionId]); } catch {}
      },
    });

    controls.addElement({
      type: 'button',
      key: 'refresh',
      caption: 'data',
      label: snapshot?.isComputing ? 'Refreshing...' : 'Refresh',
      className: 'btn small',
      onClick: () => {
        if (pendingSnapshot) {
          snapshot = pendingSnapshot;
          pendingSnapshot = null;
          renderControls();
          renderBody();
        }
        try { studyManagerController.requestRefresh('manual', { delayMs: 0, collectionIds: [selectedCollectionId] }); } catch {}
      },
      disabled: !!snapshot?.isComputing,
    });
  }

  function renderBody() {
    body.innerHTML = '';

    if (!snapshot?.ready) {
      body.append(card({ id: 'study-manager-loading-card', title: 'Study Manager', subtitle: 'Building study summaries in the background...' }));
      return;
    }

    const report = getReport(snapshot);
    if (!report) {
      try {
        if (selectedCollectionId && !snapshot?.isComputing && pendingEnsureCollectionId !== selectedCollectionId) {
          pendingEnsureCollectionId = selectedCollectionId;
          void ensureCollectionLoaded(selectedCollectionId).then(() => {
            try { studyManagerController.ensureCollections([selectedCollectionId]); } catch {}
          });
        }
      } catch {}
      body.append(card({
        id: 'study-manager-empty-card',
        title: 'Study Manager',
        subtitle: selectedCollectionId
          ? `Building study summary for ${selectedCollectionId}...`
          : 'No collection study data available yet.',
      }));
      return;
    }
    pendingEnsureCollectionId = '';

    const summary = report.collectionSummary || {};
    ensureTableSettingsController(report.collectionId);
    const dailySummaryCard = buildDailySummaryCard({ report });
    const dailyActivityCard = buildDailyActivityCard({
      report,
      onNavigate,
      hideRepeatedFilters: hideRepeatedDateFilters,
      onToggleHideRepeated: () => {
        hideRepeatedDateFilters = !hideRepeatedDateFilters;
        void persistCardsState();
        renderBody();
      },
    });
    const recommendationCardObjs = getRecommendationSets(report).map((recommendationSet) => {
      const recommendationId = String(recommendationSet?.config?.id || '').trim();
      const recommendationReportResult = report?.reportResults?.recommendationSets?.[recommendationId]
        || (recommendationId === 'kanjiCoverage' ? report?.reportResults?.recommendations : null)
        || null;
      return buildRecommendationsCard({
        store,
        recommendationSet,
        recommendationReportResult,
        onNavigate,
        sortKey: recommendationsSortKey,
        minimumEntryCount: recommendationsMinimumEntryCount,
        viewMode: recommendationsViewMode,
        recommendationsTableSettings: getRecommendationTableSettings(recommendationId),
        onSearchQueryChange: (query) => persistRecommendationsTableSearchQuery(recommendationId, query),
      });
    }).filter(Boolean);
    const recommendationCards = recommendationCardObjs.map((item) => item?.card).filter(Boolean);
    const summaryCard = card({
      id: 'study-manager-summary-card',
      title: 'Study Summary',
      cornerCaption: snapshot.updatedAtIso ? formatIsoShort(snapshot.updatedAtIso) : '',
      children: [
        el('div', {
          className: 'study-manager-summary-grid',
          children: [
            renderMetric('Collection', report.collectionName || report.collectionId),
            renderMetric('Entries', String(asNumber(summary.entryCount))),
            renderMetric('Time', formatMinutes(asNumber(summary.totalStudyDurationMs))),
            renderMetric('Sessions', String(asNumber(summary.totalStudySessions))),
            renderMetric('Entries Seen', String(asNumber(summary.seenCount))),
            renderMetric('Not Seen', String(asNumber(summary.notSeenCount))),
            renderMetric('Null', String(asNumber(summary.stateCounts?.null))),
            renderMetric('Focus', String(asNumber(summary.stateCounts?.focus))),
            renderMetric('Learned', String(asNumber(summary.stateCounts?.learned))),
            renderMetric('Tracked Filters', String(asNumber(summary.filterCount))),
          ],
        }),
      ].filter(Boolean),
    });
    attachCardCornerButton({
      cardEl: summaryCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Study Summary JSON',
        data: report?.reportResults?.collectionSummary || null,
      }),
    });

    const filtersTableObj = buildFilterTable({ store, report, onNavigate, tableSettings: filtersTableSettings });
    const filtersCard = makeTableCard({
      id: 'study-manager-filters-card',
      title: 'Study Time By Filter',
      caption: `${report.studyTimeByFilter?.length || 0} filters`,
      table: filtersTableObj.table,
    });
    attachCardCornerButton({
      cardEl: filtersCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Study Time By Filter JSON',
        data: report?.reportResults?.studyTimeByFilter || null,
      }),
    });
    attachCardCornerButton({
      cardEl: filtersCard,
      text: 'Table',
      title: 'Table settings',
      onClick: async () => {
        const next = await openTableSettingsDialog({
          tableName: 'Study Manager Filters Table',
          sourceInfo: `${report.collectionId} | ${filtersTableObj.sourceInfo}`,
          columns: buildTableColumnItems(filtersTableObj.headers, filtersTableObj.rows),
          actions: TABLE_ACTION_ITEMS,
          settings: filtersTableSettings,
        });
        if (next) await persistFiltersTableSettings(next);
      },
    });

    const appsTableObj = buildAppsTable({ store, report, tableSettings: appsTableSettings });
    const appsCard = makeTableCard({
      id: 'study-manager-apps-card',
      title: 'Group By App Id',
      caption: `${report.groupByAppId?.length || 0} apps`,
      table: appsTableObj.table,
    });
    attachCardCornerButton({
      cardEl: appsCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Group By App Id JSON',
        data: report?.reportResults?.groupByAppId || null,
      }),
    });
    attachCardCornerButton({
      cardEl: appsCard,
      text: 'Table',
      title: 'Table settings',
      onClick: async () => {
        const next = await openTableSettingsDialog({
          tableName: 'Study Manager Apps Table',
          sourceInfo: `${report.collectionId} | ${appsTableObj.sourceInfo}`,
          columns: buildTableColumnItems(appsTableObj.headers, appsTableObj.rows),
          actions: TABLE_ACTION_ITEMS,
          settings: appsTableSettings,
        });
        if (next) await persistAppsTableSettings(next);
      },
    });

    attachCardCornerButton({
      cardEl: dailySummaryCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Daily Study Summary JSON',
        data: report?.reportResults?.studyTimeByDateSummary || null,
      }),
    });
    attachCardCornerButton({
      cardEl: dailyActivityCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Study Time By Date JSON',
        data: report?.reportResults?.studyTimeByDate || null,
      }),
    });
    recommendationCardObjs.forEach((recommendationsCardObj) => {
      const recommendationsCard = recommendationsCardObj?.card || null;
      const recommendationState = recommendationsCardObj?.state || null;
      const recommendationTitle = String(recommendationState?.config?.title || 'Recommendations');
      if (!recommendationsCard || !recommendationState) return;

      attachCardCornerButton({
        cardEl: recommendationsCard,
        text: recommendationsViewMode === 'table' ? 'Cards' : 'Table',
        title: 'Toggle recommendation list view',
        onClick: () => {
          recommendationsViewMode = recommendationsViewMode === 'table' ? 'cards' : 'table';
          void persistCardsState();
          renderBody();
        },
      });
      if (recommendationsViewMode !== 'table') {
        attachCardCornerButton({
          cardEl: recommendationsCard,
          text: `Sort ${String(recommendationState.sortLabel || 'Focus')}`,
          title: 'Toggle recommendation sorting',
          onClick: () => {
            const options = recommendationState.sortOptions.map((item) => String(item?.key || '').trim()).filter(Boolean);
            recommendationsSortKey = cycleOption(options, recommendationsSortKey);
            void persistCardsState();
            renderBody();
          },
        });
      }
      if (recommendationsViewMode === 'table' && recommendationsCardObj?.tableObj) {
        const recommendationId = String(recommendationState?.config?.id || '').trim();
        const recommendationTableSettings = getRecommendationTableSettings(recommendationId);
        attachCardCornerButton({
          cardEl: recommendationsCard,
          text: 'Table',
          title: 'Table settings',
          onClick: async () => {
            const next = await openTableSettingsDialog({
              tableName: `${recommendationTitle} Table`,
              sourceInfo: `${report.collectionId} | ${recommendationsCardObj.tableObj.sourceInfo}`,
              columns: buildTableColumnItems(recommendationsCardObj.tableObj.headers, recommendationsCardObj.tableObj.rows),
              actions: TABLE_ACTION_ITEMS,
              settings: recommendationTableSettings,
            });
            if (next) await persistRecommendationsTableSettings(recommendationId, next);
          },
        });
      }
      attachCardCornerButton({
        cardEl: recommendationsCard,
        text: `Min ${asNumber(recommendationsMinimumEntryCount)}`,
        title: 'Toggle recommendation minimum word count',
        onClick: () => {
          const options = recommendationState.minimumEntryCountOptions.map((value) => asNumber(value)).filter(Boolean);
          recommendationsMinimumEntryCount = asNumber(cycleOption(options, recommendationsMinimumEntryCount));
          void persistCardsState();
          renderBody();
        },
      });
      attachCardCornerButton({
        cardEl: recommendationsCard,
        text: 'JSON',
        title: 'Open JSON viewer for this card',
        onClick: () => openStudyManagerJsonDialog({
          title: `${recommendationTitle} JSON`,
          data: recommendationsCardObj?.recommendationReportResult || null,
        }),
      });
    });

    [
      ['summary', summaryCard],
      ['dailySummary', dailySummaryCard],
      ['studyTimeByDate', dailyActivityCard],
      ['studyTimeByFilter', filtersCard],
      ['groupByAppId', appsCard],
    ].forEach(([key, cardEl]) => {
      if (cardEl) applyCollapsibleCard(cardEl, key);
    });
    recommendationCards.forEach((cardEl, index) => {
      const id = String(recommendationCardObjs[index]?.state?.config?.id || '').trim() || `set-${index}`;
      if (typeof collapsedCards[`recommendations:${id}`] === 'undefined') {
        collapsedCards[`recommendations:${id}`] = !!collapsedCards.recommendations;
      }
      applyCollapsibleCard(cardEl, `recommendations:${id}`);
    });

    body.append(...[summaryCard, dailySummaryCard, dailyActivityCard, ...recommendationCards, filtersCard, appsCard].filter(Boolean));
  }

  renderControls();
  renderBody();

  const unsub = studyManagerController.subscribe((next) => {
    const nextSnap = next || {};
    const reason = String(nextSnap?.reason || '').trim();
    const allowLiveRender = (!snapshot?.ready) || reason === 'init' || reason === 'manual' || reason === 'ensureCollections';
    if (allowLiveRender) {
      snapshot = nextSnap;
      pendingSnapshot = null;
      renderControls();
      renderBody();
      return;
    }
    pendingSnapshot = nextSnap;
  });

  const mo = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try { if (typeof unsub === 'function') unsub(); } catch {}
      try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return root;
}
