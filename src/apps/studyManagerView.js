import { createTable } from '../components/table.js';
import { card, el } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { openTableSettingsDialog } from '../components/dialogs/tableSettingsDialog.js';
import { formatDurationMs, formatIsoShort, formatRelativeFromIso } from '../utils/browser/helpers.js';
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

function makeInsightLink({ item, onNavigate }) {
  const path = String(item?.route || '').trim();
  if (!path) return null;
  const a = el('a', {
    className: 'home-link',
    attrs: { href: `#${path}`, 'data-go': path },
    children: [
      el('span', { className: 'home-link-label', text: shortFilterLabel(item?.label || item?.filterKey || '') }),
      el('span', { className: 'home-link-meta', text: formatDurationMs(asNumber(item?.durationMs)) }),
    ],
  });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof onNavigate === 'function') onNavigate(path);
    else location.hash = path;
  });
  const hintParts = [];
  if (item?.lastSessionIso) hintParts.push(`${formatIsoShort(item.lastSessionIso)} (${formatRelativeFromIso(item.lastSessionIso)})`);
  if (item?.hint) hintParts.push(String(item.hint));
  return el('div', {
    className: 'home-link-row',
    children: [a, el('div', { className: 'hint', text: hintParts.join(' • ') })],
  });
}

function buildInsightsSection({ report, onNavigate }) {
  const groups = Array.isArray(report?.insights?.groups) ? report.insights.groups : [];
  const populated = groups.filter((g) => Array.isArray(g?.items) && g.items.length);
  if (!populated.length) return null;
  const blocks = populated.map((group) => {
    const links = (Array.isArray(group.items) ? group.items : [])
      .map((item) => makeInsightLink({ item, onNavigate }))
      .filter(Boolean);
    return el('div', {
      className: 'study-manager-insight-group',
      children: [
        el('div', { className: 'study-manager-insight-title', text: String(group.title || '') }),
        el('div', { className: 'home-links', children: links }),
      ],
    });
  });
  return el('div', { className: 'study-manager-insights', children: blocks });
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
  try { studyManagerController.init({ store }); } catch {}

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
    const reports = Array.isArray(snap?.collections) ? snap.collections : [];
    if (!reports.length) return null;
    if (!selectedCollectionId || !reports.some((r) => r.collectionId === selectedCollectionId)) {
      selectedCollectionId = reports[0].collectionId;
    }
    return snap?.collectionMap?.[selectedCollectionId] || null;
  }

  function renderControls() {
    controls.removeControl && controls.removeControl('collection');
    controls.removeControl && controls.removeControl('refresh');

    const collections = Array.isArray(snapshot?.collections) ? snapshot.collections : [];
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
        try { studyManagerController.requestRefresh('manual', { delayMs: 0 }); } catch {}
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
      body.append(card({ id: 'study-manager-empty-card', title: 'Study Manager', subtitle: 'No collection study data available yet.' }));
      return;
    }

    const summary = report.summary || {};
    const insightsSection = buildInsightsSection({ report, onNavigate });
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
        insightsSection,
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

    body.append(summaryCard, filtersCard, appsCard, sessionsCard);
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












