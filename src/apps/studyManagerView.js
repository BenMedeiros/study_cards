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

function buildRecommendationsCard({ report, onNavigate }) {
  const rec = report?.recommendations || null;
  const summary = rec?.summary || null;
  if (!summary) return null;

  const filterRows = (Array.isArray(rec.topFilters) ? rec.topFilters : []).map((item) => {
    const action = makeRouteAction({
      label: `Kanji ${item.kanjiChar}`,
      meta: `${asNumber(item.totalWords)} words`,
      path: String(item.route || '').trim(),
      onNavigate,
      className: 'study-manager-rec-link',
    });
    const samples = Array.isArray(item.sampleWords) ? item.sampleWords.filter(Boolean).join(' | ') : '';
    return el('div', {
      className: 'study-manager-rec-row',
      children: [
        el('div', {
          className: 'study-manager-rec-head',
          children: [
            action,
            el('div', {
              className: 'hint',
              text: `${asNumber(item.fullyKnownWords)} fully-known • ${asNumber(item.oneNewKanjiWords)} with 1 new kanji`,
            }),
          ].filter(Boolean),
        }),
        samples ? el('div', { className: 'study-manager-rec-samples hint', text: samples }) : null,
      ].filter(Boolean),
    });
  });

  const easyWords = (Array.isArray(rec.easyWords) ? rec.easyWords : []).map((item) => {
    const unknown = Array.isArray(item.unknownChars) ? item.unknownChars.join(' ') : '';
    const known = Array.isArray(item.knownChars) ? item.knownChars.join(' ') : '';
    const hint = unknown ? `known: ${known} • new: ${unknown}` : `known only: ${known}`;
    return el('div', { className: 'study-manager-easy-word', text: `${String(item.label || '')} (${hint})` });
  });

  return card({
    id: 'study-manager-recommendations-card',
    title: 'Related Word Recommendations',
    cornerCaption: `${asNumber(summary.candidateWordCount)} candidates`,
    children: [
      filterRows.length ? el('div', {
        className: 'study-manager-recommendations-section',
        children: [
          el('div', { className: 'study-manager-insight-title', text: 'Suggested Filters' }),
          el('div', { className: 'study-manager-rec-list', children: filterRows }),
        ],
      }) : null,
      easyWords.length ? el('div', {
        className: 'study-manager-recommendations-section',
        children: [
          el('div', { className: 'study-manager-insight-title', text: 'Easy Next Words' }),
          el('div', { className: 'study-manager-easy-word-list', children: easyWords }),
        ],
      }) : null,
    ].filter(Boolean),
  });
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
  let hideRepeatedDateFilters = false;
  const collapsedCards = Object.create(null);

  let tableSettingsCtrl = null;
  let tableSettingsCollectionId = '';
  let filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
  let appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();

  function ensureTableSettingsController(collId) {
    const key = String(collId || '').trim();
    if (!key) {
      tableSettingsCtrl = null;
      tableSettingsCollectionId = '';
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      hideRepeatedDateFilters = false;
      return;
    }
    if (tableSettingsCtrl && tableSettingsCollectionId === key) return;

    try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch (e) {}

    tableSettingsCollectionId = key;
    try {
      tableSettingsCtrl = studyManagerViewController.create(key);
      filtersTableSettings = normalizeTableSettings(tableSettingsCtrl.getFiltersTableSettings());
      appsTableSettings = normalizeTableSettings(tableSettingsCtrl.getAppsTableSettings());
      const cardsState = tableSettingsCtrl.getCardsState();
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      collapsedCards.summary = !!cardsState?.summary?.collapsed;
      collapsedCards.dailySummary = !!cardsState?.dailySummary?.collapsed;
      collapsedCards.studyTimeByDate = !!cardsState?.studyTimeByDate?.collapsed;
      collapsedCards.recommendations = !!cardsState?.recommendations?.collapsed;
      collapsedCards.studyTimeByFilter = !!cardsState?.studyTimeByFilter?.collapsed;
      collapsedCards.groupByAppId = !!cardsState?.groupByAppId?.collapsed;
      hideRepeatedDateFilters = !!cardsState?.studyTimeByDate?.hideRepeated;
    } catch (e) {
      tableSettingsCtrl = null;
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      for (const k of Object.keys(collapsedCards)) delete collapsedCards[k];
      hideRepeatedDateFilters = false;
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

  async function persistCardsState() {
    const nextCards = {
      summary: { collapsed: !!collapsedCards.summary },
      dailySummary: { collapsed: !!collapsedCards.dailySummary },
      studyTimeByDate: {
        collapsed: !!collapsedCards.studyTimeByDate,
        hideRepeated: !!hideRepeatedDateFilters,
      },
      recommendations: { collapsed: !!collapsedCards.recommendations },
      studyTimeByFilter: { collapsed: !!collapsedCards.studyTimeByFilter },
      groupByAppId: { collapsed: !!collapsedCards.groupByAppId },
    };
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setCardsState(nextCards); } catch (e) {}
  }

  const controls = createViewHeaderTools({ elements: [] });
  const body = el('div', { className: 'study-manager-body' });
  root.append(controls, body);

  function getReport(snap = snapshot) {
    const reportMap = (snap?.collections && typeof snap.collections === 'object') ? snap.collections : {};
    const reports = Object.values(reportMap);
    const availableCollections = Array.isArray(snap?.availableCollections) ? snap.availableCollections : [];
    if (!selectedCollectionId) {
      selectedCollectionId = String(
        availableCollections[0]?.collectionId
        || reports[0]?.collectionId
        || ''
      ).trim();
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

    const collections = Array.isArray(snapshot?.availableCollections) ? snapshot.availableCollections : [];
    if (!collections.length) return;

    controls.addElement({
      type: 'dropdown',
      key: 'collection',
      caption: 'collection',
      className: 'align-right',
      items: collections.map((c) => ({ value: c.collectionId, label: c.collectionName || c.collectionId })),
      value: selectedCollectionId,
      onChange: (next) => {
        const nextId = String(next || '').trim();
        if (!nextId || nextId === selectedCollectionId) return;
        selectedCollectionId = nextId;
        try { studyManagerController.ensureCollections([selectedCollectionId]); } catch {}
        renderControls();
        renderBody();
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
        if (selectedCollectionId && !snapshot?.isComputing) {
          studyManagerController.ensureCollections([selectedCollectionId]);
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

    const summary = report.collectionSummary || {};
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
    const recommendationsCard = buildRecommendationsCard({ report, onNavigate });
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
        data: {
          query: report?.queries?.collectionSummary || null,
          data: report?.collectionSummary || null,
        },
      }),
    });

    ensureTableSettingsController(report.collectionId);

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
        data: {
          query: report?.queries?.studyTimeByFilter || null,
          data: report?.studyTimeByFilter || [],
        },
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
        data: {
          query: report?.queries?.groupByAppId || null,
          data: report?.groupByAppId || [],
        },
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
        data: {
          query: report?.queries?.studyTimeByDateSummary || null,
          data: report?.studyTimeByDateSummary || null,
        },
      }),
    });
    attachCardCornerButton({
      cardEl: dailyActivityCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Study Time By Date JSON',
        data: {
          query: report?.queries?.studyTimeByDate || null,
          data: report?.studyTimeByDate || [],
        },
      }),
    });
    attachCardCornerButton({
      cardEl: recommendationsCard,
      text: 'JSON',
      title: 'Open JSON viewer for this card',
      onClick: () => openStudyManagerJsonDialog({
        title: 'Recommendations JSON',
        data: report?.recommendations || null,
      }),
    });

    [
      ['summary', summaryCard],
      ['dailySummary', dailySummaryCard],
      ['studyTimeByDate', dailyActivityCard],
      ['recommendations', recommendationsCard],
      ['studyTimeByFilter', filtersCard],
      ['groupByAppId', appsCard],
    ].forEach(([key, cardEl]) => {
      if (cardEl) applyCollapsibleCard(cardEl, key);
    });

    body.append(...[summaryCard, dailySummaryCard, dailyActivityCard, recommendationsCard, filtersCard, appsCard].filter(Boolean));
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
