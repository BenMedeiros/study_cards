import { createTable } from '../components/table.js';
import { card, el } from '../components/ui.js';
import { createViewHeaderTools } from '../components/viewHeaderTools.js';
import { formatDurationMs, formatIsoShort, formatRelativeFromIso } from '../utils/helpers.js';
import studyManagerController from '../controllers/studyManagerController.js';

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

function buildFilterTable({ store, report, onNavigate }) {
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

  return createTable({
    store,
    headers,
    rows,
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
}

function buildAppsTable({ store, report }) {
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
  return createTable({ store, headers, rows, id: 'study-manager-apps-table', sortable: true, searchable: true });
}

function buildSessionsTable({ store, report }) {
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
  return createTable({ store, headers, rows, id: 'study-manager-sessions-table', sortable: true, searchable: true });
}

export function renderStudyManager({ store, onNavigate, route }) {
  try { studyManagerController.init({ store }); } catch {}

  const root = document.createElement('div');
  root.id = 'study-manager-root';

  let snapshot = studyManagerController.getSnapshot() || {};
  let pendingSnapshot = null;
  let selectedCollectionId = String(route?.query?.get('collection') || store?.collections?.getActiveCollectionId?.() || '').trim();

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

    const filtersCard = makeTableCard({
      id: 'study-manager-filters-card',
      title: 'Filter Aggregates',
      caption: `${report.filterRows?.length || 0} filters`,
      table: buildFilterTable({ store, report, onNavigate }),
    });

    const appsCard = makeTableCard({
      id: 'study-manager-apps-card',
      title: 'App Time Totals',
      caption: `${report.appRows?.length || 0} apps`,
      table: buildAppsTable({ store, report }),
    });

    const sessionsCard = makeTableCard({
      id: 'study-manager-sessions-card',
      title: 'Recent Study Sessions',
      caption: `${Math.min(300, report.recentSessions?.length || 0)} shown`,
      table: buildSessionsTable({ store, report }),
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
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return root;
}
