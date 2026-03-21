import { createTable } from '../components/shared/table.js';
import { card, el } from '../utils/browser/ui.js';
import { createViewHeaderTools } from '../components/features/viewHeaderTools.js';
import { openTableSettingsDialog } from '../components/dialogs/tableSettingsDialog.js';
import { formatDurationMs, formatIsoShort } from '../utils/browser/helpers.js';
import studyManagerController from '../controllers/studyManagerController.js';
import studyManagerViewController from '../controllers/studyManagerViewController.js';
import {
  normalizeTableSettings,
  applyTableColumnSettings,
  applyTableColumnStyles,
  applyTableActionSettings,
  buildTableColumnItems,
  attachCardTableSettingsButton,
} from '../utils/browser/tableSettings.js';

const TABLE_ACTION_ITEMS = [
  { key: 'clear', label: 'Clear' },
  { key: 'copyJson', label: 'Copy JSON' },
  { key: 'copyFullJson', label: 'Copy Full JSON' },
];

function asNumber(v) {
  return Math.max(0, Math.round(Number(v) || 0));
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

function buildDataRoute(collectionId, filterKey) {
  const coll = encodeURIComponent(String(collectionId || ''));
  const held = String(filterKey || '').trim();
  if (!held) return `/data?collection=${coll}`;
  return `/data?collection=${coll}&heldTableSearch=${encodeURIComponent(held)}`;
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

function buildDailyActivityCard({ report, onNavigate }) {
  const daily = report?.dailyActivity || null;
  const days = Array.isArray(daily?.days) ? daily.days : [];
  if (!days.length) return null;

  const summary = daily?.summary || {};
  const rows = days.map((day) => {
    const filters = (Array.isArray(day.topFilters) ? day.topFilters : [])
      .map((item) => makeRouteAction({
        label: shortFilterLabel(item.filterLabel || item.filterKey),
        meta: formatDurationMs(asNumber(item.durationMs)),
        path: buildDataRoute(report.collectionId, item.filterKey),
        onNavigate,
        className: 'study-manager-day-filter-link',
      }))
      .filter(Boolean);
    return el('div', {
      className: 'study-manager-day-row',
      children: [
        el('div', {
          className: 'study-manager-day-head',
          children: [
            el('div', { className: 'study-manager-day-label', text: String(day.dayLabel || day.dayStamp || '') }),
            el('div', { className: 'study-manager-day-meta', text: `${formatDurationMs(asNumber(day.totalDurationMs))} • ${asNumber(day.sessionCount)} sessions • ${asNumber(day.filterCount)} filters` }),
          ],
        }),
        filters.length ? el('div', { className: 'study-manager-day-filters', children: filters }) : null,
      ].filter(Boolean),
    });
  });

  return card({
    id: 'study-manager-daily-card',
    title: 'Daily Filter Activity',
    cornerCaption: `${days.length} days`,
    children: [
      el('div', {
        className: 'study-manager-summary-grid',
        children: [
          renderMetric('7d Time', formatDurationMs(asNumber(summary.totalDurationMs))),
          renderMetric('7d Sessions', String(asNumber(summary.totalSessions))),
          renderMetric('7d Active Days', String(asNumber(summary.activeDays))),
        ],
      }),
      el('div', { className: 'study-manager-day-list', children: rows }),
    ],
  });
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
      el('div', {
        className: 'study-manager-summary-grid',
        children: [
          renderMetric('Learned Words', String(asNumber(summary.learnedWordCount))),
          renderMetric('Unique Kanji', String(asNumber(summary.knownUniqueKanjiCount))),
          renderMetric('0 New Kanji', String(asNumber(summary.fullyKnownCandidateCount))),
          renderMetric('1 New Kanji', String(asNumber(summary.oneNewKanjiCandidateCount))),
        ],
      }),
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

  const rows = (Array.isArray(report?.filterRows) ? report.filterRows : []).map((row) => {
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
      formatDurationMs(asNumber(row.directDurationMs)),
      formatDurationMs(asNumber(row.rolledDownDurationMs)),
      formatDurationMs(asNumber(row.rolledUpDurationMs)),
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

  return { table, headers, rows, sourceInfo: `Filters: ${rows.length}` };
}

function buildAppsTable({ store, report, tableSettings }) {
  const rows = (Array.isArray(report?.appRows) ? report.appRows : []).map((r) => [
    String(r.appId || ''),
    formatDurationMs(asNumber(r.durationMs)),
    asNumber(r.durationMs),
  ]);
  const headers = [
    { key: 'appId', label: 'App' },
    { key: 'duration', label: 'Time' },
    { key: 'durationMs', label: 'Duration Ms', type: 'number' },
  ];

  const applied = applyTableColumnSettings({ headers, rows, tableSettings });
  const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (tableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: tableSettings?.table || {}, id: 'study-manager-apps-table', sortable: true, searchable: true });
  applyTableColumnStyles({ wrapper: table, tableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings, actionItems: TABLE_ACTION_ITEMS });

  return { table, headers, rows, sourceInfo: `Apps: ${rows.length}` };
}

function buildSessionsTable({ store, report, tableSettings }) {
  const sessions = (Array.isArray(report?.recentSessions) ? report.recentSessions : []).slice(0, 300);
  const rows = sessions.map((s) => [
    s.endIso ? formatIsoShort(s.endIso) : '',
    s.startIso ? formatIsoShort(s.startIso) : '',
    String(s.appId || ''),
    shortFilterLabel(s.heldTableSearch),
    String(s.studyFilter || ''),
    formatDurationMs(asNumber(s.durationMs)),
    asNumber(s.durationMs),
  ]);
  const headers = [
    { key: 'endIso', label: 'End' },
    { key: 'startIso', label: 'Start' },
    { key: 'appId', label: 'App' },
    { key: 'heldTableSearch', label: 'Held Search' },
    { key: 'studyFilter', label: 'Study Filter' },
    { key: 'duration', label: 'Duration' },
    { key: 'durationMs', label: 'Duration Ms', type: 'number' },
  ];

  const applied = applyTableColumnSettings({ headers, rows, tableSettings });
  const table = createTable({ store, headers: applied.headers, rows: applied.rows, columnRenderSettings: (tableSettings?.columns?.stylesByKey || {}),
    tableRenderSettings: tableSettings?.table || {}, id: 'study-manager-sessions-table', sortable: true, searchable: true });
  applyTableColumnStyles({ wrapper: table, tableSettings });
  applyTableActionSettings({ searchWrap: table.querySelector('.table-search'), tableSettings, actionItems: TABLE_ACTION_ITEMS });

  return { table, headers, rows, sourceInfo: `${sessions.length} shown` };
}

export function renderStudyManager({ store, onNavigate, route }) {
  const root = document.createElement('div');
  root.id = 'study-manager-root';

  let snapshot = studyManagerController.getSnapshot() || {};
  let pendingSnapshot = null;
  let selectedCollectionId = String(route?.query?.get('collection') || store?.collections?.getActiveCollectionId?.() || '').trim();

  let tableSettingsCtrl = null;
  let tableSettingsCollectionId = '';
  let filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
  let appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
  let sessionsTableSettings = studyManagerViewController.getDefaultSessionsTableSettings();

  function ensureTableSettingsController(collId) {
    const key = String(collId || '').trim();
    if (!key) {
      tableSettingsCtrl = null;
      tableSettingsCollectionId = '';
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      sessionsTableSettings = studyManagerViewController.getDefaultSessionsTableSettings();
      return;
    }
    if (tableSettingsCtrl && tableSettingsCollectionId === key) return;

    try { if (tableSettingsCtrl && typeof tableSettingsCtrl.dispose === 'function') tableSettingsCtrl.dispose(); } catch (e) {}

    tableSettingsCollectionId = key;
    try {
      tableSettingsCtrl = studyManagerViewController.create(key);
      filtersTableSettings = normalizeTableSettings(tableSettingsCtrl.getFiltersTableSettings());
      appsTableSettings = normalizeTableSettings(tableSettingsCtrl.getAppsTableSettings());
      sessionsTableSettings = normalizeTableSettings(tableSettingsCtrl.getSessionsTableSettings());
    } catch (e) {
      tableSettingsCtrl = null;
      filtersTableSettings = studyManagerViewController.getDefaultFiltersTableSettings();
      appsTableSettings = studyManagerViewController.getDefaultAppsTableSettings();
      sessionsTableSettings = studyManagerViewController.getDefaultSessionsTableSettings();
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

  async function persistSessionsTableSettings(nextSettings) {
    const normalized = normalizeTableSettings(nextSettings);
    sessionsTableSettings = normalized;
    try { if (tableSettingsCtrl) await tableSettingsCtrl.setSessionsTableSettings(normalized); } catch (e) {}
    renderBody();
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
        selectedCollectionId = String(next || '').trim();
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

    const summary = report.summary || {};
    const dailyActivityCard = buildDailyActivityCard({ report, onNavigate });
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
            renderMetric('Time', formatDurationMs(asNumber(summary.totalStudyDurationMs))),
            renderMetric('Sessions', String(asNumber(summary.totalStudySessions))),
            renderMetric('Entries Seen', String(asNumber(summary.seenCount))),
            renderMetric('Not Seen', String(asNumber(summary.notSeenCount))),
            renderMetric('States (N/F/L)', `${asNumber(summary.stateCounts?.null)} / ${asNumber(summary.stateCounts?.focus)} / ${asNumber(summary.stateCounts?.learned)}`),
            renderMetric('Tracked Filters', String(asNumber(summary.filterCount))),
          ],
        }),
      ].filter(Boolean),
    });

    ensureTableSettingsController(report.collectionId);

    const filtersTableObj = buildFilterTable({ store, report, onNavigate, tableSettings: filtersTableSettings });
    const filtersCard = makeTableCard({
      id: 'study-manager-filters-card',
      title: 'Filter Aggregates',
      caption: `${report.filterRows?.length || 0} filters`,
      table: filtersTableObj.table,
    });
    attachCardTableSettingsButton({
      cardEl: filtersCard,
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
      title: 'App Time Totals',
      caption: `${report.appRows?.length || 0} apps`,
      table: appsTableObj.table,
    });
    attachCardTableSettingsButton({
      cardEl: appsCard,
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

    const sessionsTableObj = buildSessionsTable({ store, report, tableSettings: sessionsTableSettings });
    const sessionsCard = makeTableCard({
      id: 'study-manager-sessions-card',
      title: 'Recent Study Sessions',
      caption: `${Math.min(300, report.recentSessions?.length || 0)} shown`,
      table: sessionsTableObj.table,
    });
    attachCardTableSettingsButton({
      cardEl: sessionsCard,
      onClick: async () => {
        const next = await openTableSettingsDialog({
          tableName: 'Study Manager Sessions Table',
          sourceInfo: `${report.collectionId} | ${sessionsTableObj.sourceInfo}`,
          columns: buildTableColumnItems(sessionsTableObj.headers, sessionsTableObj.rows),
          actions: TABLE_ACTION_ITEMS,
          settings: sessionsTableSettings,
        });
        if (next) await persistSessionsTableSettings(next);
      },
    });

    body.append(...[summaryCard, dailyActivityCard, recommendationsCard, filtersCard, appsCard, sessionsCard].filter(Boolean));
  }

  renderControls();
  renderBody();

  const unsub = studyManagerController.subscribe((next) => {
    const nextSnap = next || {};
    const reason = String(nextSnap?.reason || '').trim();
    const allowLiveRender = (!snapshot?.ready) || reason === 'init' || reason === 'manual';
    if (allowLiveRender) {
      snapshot = nextSnap;
      pendingSnapshot = null;
      renderControls();
      renderBody();
      return;
    }
    // Keep poll/store updates buffered so table/search state isn't reset while user is working.
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












