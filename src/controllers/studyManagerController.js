import { cleanSearchQuery, splitTopLevel } from '../utils/browser/tableSearch.js';
import { buildStudyTimeByDate } from '../reports/studyManager/buildStudyTimeByDate.js';
import { buildStudyTimeByDateSummary } from '../reports/studyManager/buildStudyTimeByDateSummary.js';
import { buildWordLearningRecommendations } from '../reports/studyManager/buildWordLearningRecommendations.js';

const STUDY_STATES = ['null', 'focus', 'learned'];
const STUDY_STATS_APP_ID = 'kanji';

function nowIso() {
  return new Date().toISOString();
}

function clonePlain(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function normalizeState(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'focus' || s === 'learned') return s;
  return 'null';
}

function normalizeStudyFilterString(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const toks = raw
    .split(/[,|\s]+/g)
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  const set = new Set(toks);
  const ordered = STUDY_STATES.filter((s) => set.has(s));
  const normalized = ordered.join(',');
  return normalized === STUDY_STATES.join(',') ? '' : normalized;
}

function normalizeSearchQuery(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  try {
    return String(cleanSearchQuery(raw) || '').trim();
  } catch {
    return raw;
  }
}

function hashString(s, seed = 0) {
  let h = (Number(seed) >>> 0);
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (((h * 31) >>> 0) + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function makeStateCounts() {
  return { null: 0, focus: 0, learned: 0 };
}

function makeProgressSummary(collectionKey) {
  return {
    collectionKey,
    progressRecordCount: 0,
    seenCount: 0,
    stateCounts: makeStateCounts(),
    recordsByEntry: new Map(),
    signatureHash: 2166136261 >>> 0,
  };
}

function makeSessionAggregate(collectionId) {
  return {
    collectionId,
    totalDurationMs: 0,
    totalSessions: 0,
    lastEndIso: null,
    directByFilter: new Map(),
    appTotals: new Map(),
    byDay: new Map(),
  };
}

function makeFilterAggregate(filterKey) {
  return {
    filterKey,
    durationMs: 0,
    sessionCount: 0,
    lastStartIso: null,
    lastEndIso: null,
    apps: new Map(),
    studyFilters: new Map(),
  };
}

function makeDateAggregate(dayStamp) {
  return {
    dayStamp,
    totalDurationMs: 0,
    sessionCount: 0,
    filterSummaries: new Map(),
  };
}

function makeDateFilterSummary(filterKey) {
  return {
    filterKey,
    durationMs: 0,
    sessionCount: 0,
  };
}

function makeDateFilterSummaryKey(filterKey) {
  return String(filterKey || '');
}

function parseAndClauses(query) {
  const q = normalizeSearchQuery(query);
  if (!q) return [];
  const semiParts = splitTopLevel(q, ';').map((x) => String(x || '').trim()).filter(Boolean);
  const rawParts = [];
  for (const part of semiParts) {
    const andParts = splitTopLevel(part, '&').map((x) => String(x || '').trim()).filter(Boolean);
    for (const andPart of andParts) rawParts.push(andPart);
  }
  const out = [];
  const seen = new Set();
  for (const raw of rawParts) {
    const norm = raw.replace(/\s+/g, ' ').trim();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function canonicalClausesKey(clauses) {
  const arr = Array.isArray(clauses) ? clauses : [];
  if (!arr.length) return '';
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const clause = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!clause || seen.has(clause)) continue;
    seen.add(clause);
    out.push(clause);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out.join(' & ');
}

function buildRelationGraph(filterKeys, clauseSetByFilter) {
  const keys = Array.isArray(filterKeys) ? filterKeys.slice() : [];
  const children = new Map(keys.map((k) => [k, new Set()]));
  const parents = new Map(keys.map((k) => [k, new Set()]));
  const canonicalToFilter = new Map();

  // Parent/child relations are based on query clause subsets only.
  // A parent is valid only if it already exists in the known filter universe.
  for (const key of keys) {
    const clauses = clauseSetByFilter.get(key) || [];
    const ck = canonicalClausesKey(clauses);
    if (!canonicalToFilter.has(ck)) {
      canonicalToFilter.set(ck, key);
    } else if (key === '') {
      // Prefer explicit no-filter key for empty clause set.
      canonicalToFilter.set(ck, key);
    }
  }

  for (const childKey of keys) {
    const clauses = clauseSetByFilter.get(childKey) || [];
    if (!clauses.length) continue;
    for (let i = 0; i < clauses.length; i++) {
      const parentClauses = clauses.filter((_, idx) => idx !== i);
      const parentCanonical = canonicalClausesKey(parentClauses);
      if (!canonicalToFilter.has(parentCanonical)) continue;
      const parentKey = canonicalToFilter.get(parentCanonical);
      if (!parentKey || parentKey === childKey) continue;
      parents.get(childKey)?.add(parentKey);
      children.get(parentKey)?.add(childKey);
    }
  }

  // Deterministic traversal order.
  for (const k of keys) {
    const p = Array.from(parents.get(k) || []).sort((a, b) => a.localeCompare(b));
    const c = Array.from(children.get(k) || []).sort((a, b) => a.localeCompare(b));
    parents.set(k, new Set(p));
    children.set(k, new Set(c));
  }

  const descendantsMemo = new Map();
  const ancestorsMemo = new Map();

  function computeDescendants(key) {
    if (descendantsMemo.has(key)) return descendantsMemo.get(key);
    const out = new Set();
    const stack = [...(children.get(key) || [])];
    while (stack.length) {
      const next = stack.pop();
      if (!next || out.has(next)) continue;
      out.add(next);
      for (const c of (children.get(next) || [])) stack.push(c);
    }
    descendantsMemo.set(key, out);
    return out;
  }

  function computeAncestors(key) {
    if (ancestorsMemo.has(key)) return ancestorsMemo.get(key);
    const out = new Set();
    const stack = [...(parents.get(key) || [])];
    while (stack.length) {
      const next = stack.pop();
      if (!next || out.has(next)) continue;
      out.add(next);
      for (const p of (parents.get(next) || [])) stack.push(p);
    }
    ancestorsMemo.set(key, out);
    return out;
  }

  for (const k of keys) {
    computeDescendants(k);
    computeAncestors(k);
  }

  return { children, parents, descendantsMemo, ancestorsMemo };
}

const studyManagerController = (() => {
  let store = null;
  let initialized = false;
  let pollMs = 20_000;
  let pollTimer = null;
  let debounceTimer = null;
  let unsubStore = null;
  let isComputing = false;
  let pendingReason = null;
  let pendingCollectionIds = null;

  let sessionCursor = 0;
  const sessionByCollection = new Map();
  const cacheByCollection = new Map();
  const subs = new Set();

  const managerMeta = {
    owner: 'studyManager',
    module: 'src/controllers/studyManagerController.js',
    scheduleFunction: 'requestRefresh',
    runFunction: 'recompute',
    createdAt: nowIso(),
    state: 'idle',
    lastScheduledAt: null,
    lastScheduledReason: null,
    lastRunRequestedAt: null,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunReason: null,
    lastRunStatus: null,
    runCount: 0,
    rerunRequested: false,
    isRunning: false,
    pendingPromise: false,
    lastCollectionCount: 0,
    lastReadyCollectionCount: 0,
    lastTargetCollectionCount: 0,
  };

  let snapshot = {
    meta: clonePlain(managerMeta) || { ...managerMeta },
    ready: false,
    isComputing: false,
    updatedAtIso: null,
    reason: '',
    collections: {},
  };

  function syncSnapshotMeta(patch = null) {
    if (patch && typeof patch === 'object') Object.assign(managerMeta, patch);
    snapshot = {
      ...snapshot,
      meta: clonePlain(managerMeta) || { ...managerMeta },
    };
  }

  function emit() {
    syncSnapshotMeta();
    for (const cb of Array.from(subs)) {
      try { cb(snapshot); } catch {}
    }
  }

  function getSnapshot() {
    return snapshot;
  }

  function subscribe(cb) {
    if (typeof cb !== 'function') return () => {};
    subs.add(cb);
    try { cb(snapshot); } catch {}
    return () => subs.delete(cb);
  }

  function getOrCreateSessionAggregate(collectionId) {
    const key = String(collectionId || '').trim();
    if (!key) return null;
    if (!sessionByCollection.has(key)) sessionByCollection.set(key, makeSessionAggregate(key));
    return sessionByCollection.get(key);
  }

  function listAvailableCollections() {
    const collections = store?.collections?.getCollections?.() || [];
    return Array.isArray(collections) ? collections : [];
  }

  function normalizeCollectionIds(input, { fallbackToActive = true } = {}) {
    const available = listAvailableCollections();
    const validIds = new Set(
      available.map((coll) => String(coll?.key || '').trim()).filter(Boolean)
    );
    const out = [];
    const seen = new Set();
    const arr = Array.isArray(input) ? input : [];
    for (const raw of arr) {
      const key = String(raw || '').trim();
      if (!key || seen.has(key) || !validIds.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    if (out.length || !fallbackToActive) return out;
    const active = String(store?.collections?.getActiveCollectionId?.() || '').trim();
    if (active && validIds.has(active)) return [active];
    const first = available.find((coll) => String(coll?.key || '').trim());
    return first ? [String(first.key).trim()] : [];
  }

  function mergePendingCollectionIds(nextIds) {
    const incoming = normalizeCollectionIds(nextIds, { fallbackToActive: false });
    if (!incoming.length) return Array.isArray(pendingCollectionIds) ? pendingCollectionIds.slice() : [];
    const merged = new Set(Array.isArray(pendingCollectionIds) ? pendingCollectionIds : []);
    for (const id of incoming) merged.add(id);
    pendingCollectionIds = Array.from(merged);
    return pendingCollectionIds.slice();
  }

  function buildAvailableCollectionRefs(collections) {
    return collections
      .map((coll) => ({
        collectionId: String(coll?.key || '').trim(),
        collectionName: String(coll?.metadata?.name || coll?.key || '').trim(),
      }))
      .filter((coll) => coll.collectionId)
      .sort((a, b) => String(a.collectionName || a.collectionId).localeCompare(String(b.collectionName || b.collectionId)));
  }

  function sortReports(reports) {
    return reports.sort((a, b) => {
      const ta = a?.collectionSummary?.lastSessionIso ? new Date(a.collectionSummary.lastSessionIso).getTime() : 0;
      const tb = b?.collectionSummary?.lastSessionIso ? new Date(b.collectionSummary.lastSessionIso).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return String(a.collectionName || '').localeCompare(String(b.collectionName || ''));
    });
  }

  function ingestSession(session) {
    const s = session && typeof session === 'object' ? session : null;
    if (!s) return;
    const collectionId = String(s.collectionId || '').trim();
    if (!collectionId) return;
    const appId = String(s.appId || '').trim() || 'unknown';
    const durationMs = Math.max(0, Math.round(Number(s.durationMs) || 0));
    if (!durationMs) return;

    const agg = getOrCreateSessionAggregate(collectionId);
    if (!agg) return;

    agg.appTotals.set(appId, (agg.appTotals.get(appId) || 0) + durationMs);
    if (appId !== STUDY_STATS_APP_ID) return;

    const filterKey = normalizeSearchQuery(s.heldTableSearch || '');
    const studyFilter = normalizeStudyFilterString(s.studyFilter || '');
    const startIso = String(s.startIso || '').trim() || null;
    const endIso = String(s.endIso || '').trim() || null;
    const dayStamp = dayStampFromIso(endIso || startIso || '');

    agg.totalDurationMs += durationMs;
    agg.totalSessions += 1;
    if (endIso && (!agg.lastEndIso || endIso > agg.lastEndIso)) agg.lastEndIso = endIso;

    let perFilter = agg.directByFilter.get(filterKey);
    if (!perFilter) {
      perFilter = makeFilterAggregate(filterKey);
      agg.directByFilter.set(filterKey, perFilter);
    }
    perFilter.durationMs += durationMs;
    perFilter.sessionCount += 1;
    if (startIso && (!perFilter.lastStartIso || startIso > perFilter.lastStartIso)) perFilter.lastStartIso = startIso;
    if (endIso && (!perFilter.lastEndIso || endIso > perFilter.lastEndIso)) perFilter.lastEndIso = endIso;
    perFilter.apps.set(appId, (perFilter.apps.get(appId) || 0) + durationMs);
    if (studyFilter) perFilter.studyFilters.set(studyFilter, (perFilter.studyFilters.get(studyFilter) || 0) + durationMs);

    if (dayStamp) {
      let perDay = agg.byDay.get(dayStamp);
      if (!perDay) {
        perDay = makeDateAggregate(dayStamp);
        agg.byDay.set(dayStamp, perDay);
      }
      perDay.totalDurationMs += durationMs;
      perDay.sessionCount += 1;

      const dateFilterKey = makeDateFilterSummaryKey(filterKey);
      const current = perDay.filterSummaries.get(dateFilterKey) || makeDateFilterSummary(filterKey);
      current.durationMs += durationMs;
      current.sessionCount += 1;
      perDay.filterSummaries.set(dateFilterKey, current);
    }
  }

  function processSessionsIncremental() {
    const sessions = store?.studyTime?.getStudyTimeRecord?.()?.sessions;
    const arr = Array.isArray(sessions) ? sessions : [];
    if (arr.length < sessionCursor) {
      sessionByCollection.clear();
      sessionCursor = 0;
    }
    for (let i = sessionCursor; i < arr.length; i++) ingestSession(arr[i]);
    sessionCursor = arr.length;
  }

  function buildProgressByCollection() {
    const progressMap = store?.kanjiProgress?._unsafeGetMap?.();
    const src = (progressMap && typeof progressMap === 'object') ? progressMap : {};
    const out = new Map();
    for (const [id, recRaw] of Object.entries(src)) {
      const idStr = String(id || '');
      const cut = idStr.indexOf('|');
      if (cut <= 0 || cut >= idStr.length - 1) continue;
      const collectionKey = idStr.slice(0, cut);
      const entryKey = idStr.slice(cut + 1);
      if (!collectionKey || !entryKey) continue;
      const rec = (recRaw && typeof recRaw === 'object') ? recRaw : {};
      const state = normalizeState(rec.state);
      const timesSeen = Math.max(0, Math.round(Number(rec.timesSeen) || 0));
      const timeMs = Math.max(0, Math.round(Number(rec.timeMs) || 0));
      const seen = !!rec.seen || timesSeen > 0 || timeMs > 0;

      if (!out.has(collectionKey)) out.set(collectionKey, makeProgressSummary(collectionKey));
      const sum = out.get(collectionKey);
      sum.progressRecordCount += 1;
      sum.stateCounts[state] += 1;
      if (seen) sum.seenCount += 1;
      sum.recordsByEntry.set(entryKey, { state, seen, timesSeen, timeMs });
      sum.signatureHash = hashString(entryKey, sum.signatureHash);
      sum.signatureHash = hashString(state, sum.signatureHash);
      sum.signatureHash = hashString(seen ? '1' : '0', sum.signatureHash);
      sum.signatureHash = hashString(String(timesSeen), sum.signatureHash);
      sum.signatureHash = hashString(String(timeMs), sum.signatureHash);
    }
    return out;
  }

  function buildCollectionFilters(collectionKey, sessionAgg) {
    const set = new Set(['']);
    const collState = store?.collections?.loadCollectionState?.(collectionKey) || {};
    const saved = Array.isArray(collState?.savedTableSearches) ? collState.savedTableSearches : [];
    for (const q of saved) {
      const norm = normalizeSearchQuery(q);
      if (norm) set.add(norm);
    }
    const held = normalizeSearchQuery(collState?.heldTableSearch || '');
    if (held) set.add(held);
    if (sessionAgg?.directByFilter instanceof Map) {
      for (const q of sessionAgg.directByFilter.keys()) set.add(normalizeSearchQuery(q));
    }
    const out = Array.from(set).filter((x) => x === '' || !!String(x).trim());
    out.sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      const byLen = a.length - b.length;
      return byLen !== 0 ? byLen : a.localeCompare(b);
    });
    return out;
  }

  function computeFilterStatsForCollection(collection, filters, progressSummary) {
    const collectionKey = String(collection?.key || '').trim();
    const collStateRaw = store?.collections?.loadCollectionState?.(collectionKey) || {};
    const collState = (collStateRaw && typeof collStateRaw === 'object') ? collStateRaw : {};
    // Keep expansion settings from collection state but force aggregate scope to
    // all states and no held filter.
    const aggregateState = {
      ...collState,
      focusOnly: false,
      skipLearned: false,
      heldTableSearch: '',
      studyFilter: 'null,focus,learned',
    };
    const view = store?.collections?.getCollectionViewForCollection?.(collection, aggregateState, {
      windowSize: Math.max(10, Math.round(Number(collection?.entries?.length) || 10)),
    }) || { entries: [], indices: [] };
    const entries = Array.isArray(view?.entries) ? view.entries : [];
    const indices = Array.isArray(view?.indices) ? view.indices : entries.map((_, i) => i);
    const fields = Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : null;
    function getEntryKey(entry) {
      return String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
    }

    function getProgressRecord(entryKey) {
      if (!entryKey) return null;
      try {
        if (typeof store?.kanjiProgress?.getKanjiProgressRecord === 'function') {
          return store.kanjiProgress.getKanjiProgressRecord(entryKey, { collectionKey }) || null;
        }
      } catch {}
      return null;
    }

    const filterStats = new Map();
    const entrySetByFilter = new Map();
    const clauseSetByFilter = new Map();

    for (const filterKey of filters) {
      let matchedIndices = indices;
      if (filterKey) {
        const filtered = store?.collections?.filterEntriesAndIndicesByTableSearch?.(
          entries,
          indices,
          { query: filterKey, fields, collection },
        ) || { indices: [] };
        matchedIndices = Array.isArray(filtered.indices) ? filtered.indices : [];
      }
      const set = new Set(matchedIndices);
      entrySetByFilter.set(filterKey, set);
      clauseSetByFilter.set(filterKey, parseAndClauses(filterKey));

      const stateCounts = makeStateCounts();
      let seenCount = 0;
      let notSeenCount = 0;
      let totalEntries = 0;
      let timesSeenTotal = 0;
      for (const idx of matchedIndices) {
        const entry = entries[idx];
        const key = getEntryKey(entry);
        const rec = getProgressRecord(key);
        const state = rec ? normalizeState(rec.state) : 'null';
        const timesSeen = rec ? Math.max(0, Math.round(Number(rec.timesSeen) || 0)) : 0;
        const timeMs = rec ? Math.max(0, Math.round(Number(rec.timeMs) || 0)) : 0;
        const seen = !!(rec?.seen) || timesSeen > 0 || timeMs > 0;
        stateCounts[state] += 1;
        if (seen) seenCount += 1;
        else notSeenCount += 1;
        timesSeenTotal += timesSeen;
        totalEntries += 1;
      }
      filterStats.set(filterKey, {
        filterKey,
        totalEntries,
        seenCount,
        notSeenCount,
        timesSeenTotal,
        stateCounts,
      });
    }

    const relationGraph = buildRelationGraph(filters, clauseSetByFilter);
    return { filterStats, entrySetByFilter, clauseSetByFilter, relationGraph };
  }

  function dayStampFromIso(iso) {
    const s = String(iso || '').trim();
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function makeFilterLabel(key) {
    return key ? key : '(no filter)';
  }

  function makeReportResult({
    reportId,
    builder = '',
    collectionId = '',
    generatedAtIso = '',
    inputs = null,
    query = null,
    output = null,
  } = {}) {
    return {
      meta: {
        reportId: String(reportId || '').trim(),
        builder: String(builder || '').trim(),
        collectionId: String(collectionId || '').trim(),
        generatedAtIso: String(generatedAtIso || nowIso()).trim(),
      },
      inputs: inputs && typeof inputs === 'object' ? inputs : {},
      query: query && typeof query === 'object' ? query : null,
      output: output ?? null,
    };
  }

  function buildCollectionReport(collection, progressSummary, sessionAgg) {
    const collectionId = String(collection?.key || '').trim();
    const collectionName = String(collection?.metadata?.name || collectionId).trim();
    const entryCount = Array.isArray(collection?.entries) ? collection.entries.length : 0;
    const filters = buildCollectionFilters(collectionId, sessionAgg);
    const collState = store?.collections?.loadCollectionState?.(collectionId) || {};
    const savedFilterSet = new Set(
      (Array.isArray(collState?.savedTableSearches) ? collState.savedTableSearches : [])
        .map((q) => normalizeSearchQuery(q))
        .filter(Boolean),
    );

    const progressSignature = (() => {
      const p = progressSummary || makeProgressSummary(collectionId);
      return [
        p.progressRecordCount,
        p.seenCount,
        p.stateCounts.null,
        p.stateCounts.focus,
        p.stateCounts.learned,
        p.signatureHash >>> 0,
      ].join('|');
    })();

    const prev = cacheByCollection.get(collectionId);
    const canReuse =
      !!prev &&
      prev.entryCount === entryCount &&
      prev.progressSignature === progressSignature &&
      prev.filtersSignature === filters.join('\n');

    let derived = null;
    if (canReuse) {
      derived = prev.derived;
    } else {
      derived = computeFilterStatsForCollection(collection, filters, progressSummary || makeProgressSummary(collectionId));
      cacheByCollection.set(collectionId, {
        entryCount,
        progressSignature,
        filtersSignature: filters.join('\n'),
        derived,
      });
    }

    const directByFilter = sessionAgg?.directByFilter || new Map();
    const appTotals = sessionAgg?.appTotals || new Map();
    const relationGraph = derived.relationGraph;

    function getDirectDurationMs(filterKey) {
      return Math.max(0, Math.round(Number(directByFilter.get(filterKey)?.durationMs) || 0));
    }

    function getDirectSessionCount(filterKey) {
      return Math.max(0, Math.round(Number(directByFilter.get(filterKey)?.sessionCount) || 0));
    }

    const studyTimeByFilter = [];
    const studyTimeByFilterKey = {};
    for (const filterKey of filters) {
      const stats = derived.filterStats.get(filterKey) || {
        filterKey,
        totalEntries: 0,
        seenCount: 0,
        notSeenCount: 0,
        timesSeenTotal: 0,
        stateCounts: makeStateCounts(),
      };
      const directDurationMs = getDirectDurationMs(filterKey);
      const directSessionCount = getDirectSessionCount(filterKey);

      let rolledDownDurationMs = directDurationMs;
      let rolledDownSessionCount = directSessionCount;
      for (const childKey of (relationGraph.descendantsMemo.get(filterKey) || [])) {
        rolledDownDurationMs += getDirectDurationMs(childKey);
        rolledDownSessionCount += getDirectSessionCount(childKey);
      }

      let rolledUpDurationMs = directDurationMs;
      let rolledUpSessionCount = directSessionCount;
      for (const parentKey of (relationGraph.ancestorsMemo.get(filterKey) || [])) {
        rolledUpDurationMs += getDirectDurationMs(parentKey);
        rolledUpSessionCount += getDirectSessionCount(parentKey);
      }

      const directRec = directByFilter.get(filterKey) || null;
      const appsCount = directRec?.apps instanceof Map ? directRec.apps.size : 0;
      const lastSessionIso = directRec?.lastEndIso || null;
      const parents = Array.from(relationGraph.parents.get(filterKey) || []);
      const children = Array.from(relationGraph.children.get(filterKey) || []);
      const clauseParts = derived.clauseSetByFilter.get(filterKey) || [];

      const row = {
        filterKey,
        filterLabel: makeFilterLabel(filterKey),
        clauseParts,
        totalEntries: Math.max(0, Math.round(Number(stats.totalEntries) || 0)),
        seenCount: Math.max(0, Math.round(Number(stats.seenCount) || 0)),
        notSeenCount: Math.max(0, Math.round(Number(stats.notSeenCount) || 0)),
        timesSeenTotal: Math.max(0, Math.round(Number(stats.timesSeenTotal) || 0)),
        stateNullCount: Math.max(0, Math.round(Number(stats.stateCounts?.null) || 0)),
        stateFocusCount: Math.max(0, Math.round(Number(stats.stateCounts?.focus) || 0)),
        stateLearnedCount: Math.max(0, Math.round(Number(stats.stateCounts?.learned) || 0)),
        learnedPct: (Math.max(0, Math.round(Number(stats.totalEntries) || 0)) > 0)
          ? ((Math.max(0, Math.round(Number(stats.stateCounts?.learned) || 0)) / Math.max(1, Math.round(Number(stats.totalEntries) || 0))) * 100)
          : 0,
        directDurationMs,
        directSessionCount,
        rolledDownDurationMs,
        rolledDownSessionCount,
        rolledUpDurationMs,
        rolledUpSessionCount,
        lastSessionIso,
        parentCount: parents.length,
        childCount: children.length,
        appsCount,
        isSavedFilter: filterKey ? savedFilterSet.has(filterKey) : false,
        parents: parents.map((k) => ({ filterKey: k, filterLabel: makeFilterLabel(k) })),
        children: children.map((k) => ({ filterKey: k, filterLabel: makeFilterLabel(k) })),
      };

      studyTimeByFilter.push(row);
      studyTimeByFilterKey[filterKey] = row;
    }

    studyTimeByFilter.sort((a, b) => {
      if (b.rolledDownDurationMs !== a.rolledDownDurationMs) return b.rolledDownDurationMs - a.rolledDownDurationMs;
      if (b.directDurationMs !== a.directDurationMs) return b.directDurationMs - a.directDurationMs;
      return a.filterLabel.localeCompare(b.filterLabel);
    });

    const groupByAppId = Array.from(appTotals.entries())
      .map(([appId, durationMs]) => ({ appId, durationMs: Math.max(0, Math.round(Number(durationMs) || 0)) }))
      .sort((a, b) => b.durationMs - a.durationMs);

    const studyTimeByDate = buildStudyTimeByDate({
      byDay: sessionAgg?.byDay,
      filterMap: studyTimeByFilterKey,
    });
    const studyTimeByDateSummary = buildStudyTimeByDateSummary({ collectionId, studyTimeByDate });
    const recommendations = buildWordLearningRecommendations({
      collection,
      getEntryKey: (entry) => String(store?.collections?.getEntryStudyKey?.(entry) || '').trim(),
      getProgressRecord: (entryKey) => {
        if (!entryKey) return null;
        try {
          if (typeof store?.kanjiProgress?.getKanjiProgressRecord === 'function') {
            return store.kanjiProgress.getKanjiProgressRecord(entryKey, { collectionKey: collectionId }) || null;
          }
        } catch {}
        return null;
      },
    });

    const topFilter = studyTimeByFilterKey[''] || studyTimeByFilter[0] || null;
    const collectionSummary = {
      entryCount,
      progressRecordCount: Math.max(0, Math.round(Number(progressSummary?.progressRecordCount) || 0)),
      seenCount: topFilter ? topFilter.seenCount : 0,
      notSeenCount: topFilter ? topFilter.notSeenCount : entryCount,
      stateCounts: topFilter
        ? {
            null: topFilter.stateNullCount,
            focus: topFilter.stateFocusCount,
            learned: topFilter.stateLearnedCount,
          }
        : makeStateCounts(),
      totalStudyDurationMs: Math.max(0, Math.round(Number(sessionAgg?.totalDurationMs) || 0)),
      totalStudySessions: Math.max(0, Math.round(Number(sessionAgg?.totalSessions) || 0)),
      lastSessionIso: String(sessionAgg?.lastEndIso || '') || null,
      filterCount: studyTimeByFilter.length,
    };

    const generatedAtIso = nowIso();
    const queries = {
      collectionSummary: {
        data: ['study_progress', 'study_time_sessions'],
        where: { collectionId, appId: STUDY_STATS_APP_ID },
      },
      studyTimeByFilter: {
        data: 'study_time_sessions',
        where: { collectionId, appId: STUDY_STATS_APP_ID },
        groupBy: ['heldTableSearch'],
      },
      groupByAppId: {
        data: 'study_time_sessions',
        where: { collectionId },
        groupBy: ['appId'],
      },
      studyTimeByDate: {
        data: 'study_time_sessions',
        where: { collectionId, appId: STUDY_STATS_APP_ID },
        groupBy: ['dayStamp', 'heldTableSearch'],
      },
      studyTimeByDateSummary: {
        data: 'study_time_sessions',
        where: { collectionId, appId: STUDY_STATS_APP_ID },
        groupBy: ['dayStamp'],
        windowDays: studyTimeByDateSummary.windowDays,
      },
    };
    const reportResults = {
      collectionSummary: makeReportResult({
        reportId: 'collectionSummary',
        builder: 'inline:buildCollectionSummary',
        collectionId,
        generatedAtIso,
        inputs: {
          entryCount,
          progressRecordCount: Math.max(0, Math.round(Number(progressSummary?.progressRecordCount) || 0)),
          totalStudySessions: Math.max(0, Math.round(Number(sessionAgg?.totalSessions) || 0)),
          trackedFilterCount: studyTimeByFilter.length,
        },
        query: queries.collectionSummary,
        output: collectionSummary,
      }),
      studyTimeByFilter: makeReportResult({
        reportId: 'studyTimeByFilter',
        builder: 'inline:buildStudyTimeByFilter',
        collectionId,
        generatedAtIso,
        inputs: {
          filterUniverseCount: filters.length,
          savedFilterCount: savedFilterSet.size,
          appCount: appTotals.size,
        },
        query: queries.studyTimeByFilter,
        output: studyTimeByFilter,
      }),
      groupByAppId: makeReportResult({
        reportId: 'groupByAppId',
        builder: 'inline:buildGroupByAppId',
        collectionId,
        generatedAtIso,
        inputs: {
          distinctAppCount: appTotals.size,
        },
        query: queries.groupByAppId,
        output: groupByAppId,
      }),
      studyTimeByDate: makeReportResult({
        reportId: 'studyTimeByDate',
        builder: 'src/reports/studyManager/buildStudyTimeByDate.js',
        collectionId,
        generatedAtIso,
        inputs: {
          dayCount: sessionAgg?.byDay instanceof Map ? sessionAgg.byDay.size : 0,
          filterLookupCount: Object.keys(studyTimeByFilterKey).length,
        },
        query: queries.studyTimeByDate,
        output: studyTimeByDate,
      }),
      studyTimeByDateSummary: makeReportResult({
        reportId: 'studyTimeByDateSummary',
        builder: 'src/reports/studyManager/buildStudyTimeByDateSummary.js',
        collectionId,
        generatedAtIso,
        inputs: {
          sourceDayCount: studyTimeByDate.length,
          windowDays: studyTimeByDateSummary.windowDays,
        },
        query: queries.studyTimeByDateSummary,
        output: studyTimeByDateSummary,
      }),
      recommendations: makeReportResult({
        reportId: 'recommendations',
        builder: 'src/reports/studyManager/buildWordLearningRecommendations.js',
        collectionId,
        generatedAtIso,
        inputs: {
          category: String(collection?.metadata?.category || '').trim(),
          entryCount,
        },
        query: null,
        output: recommendations,
      }),
    };

    return {
      collectionId,
      collectionName,
      queries,
      reportResults,
      collectionSummary,
      studyTimeByFilter,
      studyTimeByFilterKey,
      groupByAppId,
      studyTimeByDate,
      studyTimeByDateSummary,
      recommendations,
      updatedAtIso: generatedAtIso,
    };
  }

  async function recompute(reason = 'recompute', { collectionIds = null } = {}) {
    if (!store) return;
    if (isComputing) {
      pendingReason = reason || 'pending';
      mergePendingCollectionIds(collectionIds);
      syncSnapshotMeta({
        state: 'queued',
        rerunRequested: true,
        pendingPromise: true,
        lastScheduledAt: nowIso(),
        lastScheduledReason: String(reason || 'pending'),
        lastRunRequestedAt: nowIso(),
      });
      emit();
      return;
    }
    const targetIds = normalizeCollectionIds(collectionIds || pendingCollectionIds, { fallbackToActive: true });
    pendingCollectionIds = null;
    if (!targetIds.length) return;
    isComputing = true;
    try { console.log('[studyManager] run:start', { reason, collectionIds: targetIds.slice() }); } catch (e) {}
    syncSnapshotMeta({
      state: 'running',
      isRunning: true,
      pendingPromise: true,
      rerunRequested: false,
      lastRunReason: String(reason || 'recompute'),
      lastRunRequestedAt: managerMeta.lastRunRequestedAt || nowIso(),
      lastRunStartedAt: nowIso(),
      runCount: Math.max(0, Math.round(Number(managerMeta.runCount) || 0)) + 1,
      lastTargetCollectionCount: targetIds.length,
    });
    snapshot = { ...snapshot, isComputing: true, reason: String(reason || 'recompute') };
    emit();

    try {
      processSessionsIncremental();
      const progressByCollection = buildProgressByCollection();
      const collections = listAvailableCollections();
      const availableRefs = buildAvailableCollectionRefs(collections);
      const byId = new Map(collections.map((coll) => [String(coll?.key || '').trim(), coll]));
      const reportMap = { ...((snapshot?.collections && typeof snapshot.collections === 'object') ? snapshot.collections : {}) };
      for (const existingId of Object.keys(reportMap)) {
        if (!byId.has(existingId)) delete reportMap[existingId];
      }
      for (const key of targetIds) {
        const coll = byId.get(key);
        if (!coll) continue;
        const progressSummary = progressByCollection.get(key) || makeProgressSummary(key);
        const sessionAgg = sessionByCollection.get(key) || makeSessionAggregate(key);
        const report = buildCollectionReport(coll, progressSummary, sessionAgg);
        reportMap[key] = report;
      }
      const reports = sortReports(Object.values(reportMap));

      snapshot = {
        ...snapshot,
        ready: true,
        isComputing: false,
        updatedAtIso: nowIso(),
        reason: String(reason || ''),
        availableCollections: availableRefs,
        collections: reportMap,
      };
      syncSnapshotMeta({
        state: 'ready',
        isRunning: false,
        pendingPromise: false,
        lastRunFinishedAt: nowIso(),
        lastRunStatus: 'ready',
        lastCollectionCount: collections.length,
        lastReadyCollectionCount: reports.length,
      });
      emit();
      try {
        console.log('[studyManager] run:finish', {
          reason,
          collectionIds: targetIds.slice(),
          totalAvailableCollections: collections.length,
          cachedReports: reports.length,
          status: 'ready',
        });
      } catch (e) {}
    } catch (error) {
      syncSnapshotMeta({
        state: 'error',
        isRunning: false,
        pendingPromise: false,
        lastRunFinishedAt: nowIso(),
        lastRunStatus: 'error',
        lastCollectionCount: Array.isArray(store?.collections?.getCollections?.()) ? store.collections.getCollections().length : 0,
      });
      snapshot = {
        ...snapshot,
        isComputing: false,
        reason: String(reason || 'recompute'),
      };
      emit();
      try {
        console.log('[studyManager] run:finish', {
          reason,
          collectionIds: targetIds.slice(),
          status: 'error',
          error: error?.message || String(error),
        });
      } catch (e) {}
      throw error;
    } finally {
      isComputing = false;
      if (pendingReason) {
        const nextReason = pendingReason;
        pendingReason = null;
        syncSnapshotMeta({
          state: 'queued',
          rerunRequested: true,
          pendingPromise: true,
        });
        requestRefresh(nextReason, {
          delayMs: 150,
          collectionIds: Array.isArray(pendingCollectionIds) ? pendingCollectionIds.slice() : null,
        });
      } else if (managerMeta.state !== 'error') {
        syncSnapshotMeta({
          isRunning: false,
          pendingPromise: false,
          rerunRequested: false,
        });
      }
    }
  }

  function requestRefresh(reason = 'refresh', { delayMs = 350, collectionIds = null } = {}) {
    if (!store) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    const targetIds = normalizeCollectionIds(collectionIds, { fallbackToActive: true });
    pendingCollectionIds = targetIds.slice();
    syncSnapshotMeta({
      state: isComputing ? 'queued' : 'scheduled',
      lastScheduledAt: nowIso(),
      lastScheduledReason: String(reason || 'refresh'),
      lastRunRequestedAt: nowIso(),
      pendingPromise: true,
      rerunRequested: !!isComputing,
      lastTargetCollectionCount: targetIds.length,
    });
    emit();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      recompute(reason, { collectionIds: targetIds });
    }, Math.max(0, Math.round(Number(delayMs) || 0)));
  }

  function init({ store: appStore, pollIntervalMs = 20_000 } = {}) {
    if (!appStore) throw new Error('studyManagerController.init requires store');
    store = appStore;
    pollMs = Math.max(5_000, Math.round(Number(pollIntervalMs) || 20_000));
    if (initialized) return;
    initialized = true;

    requestRefresh('init', {
      delayMs: 0,
      collectionIds: [store?.collections?.getActiveCollectionId?.()],
    });
  }

  function dispose() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (typeof unsubStore === 'function') unsubStore();
    unsubStore = null;
    initialized = false;
  }

  return {
    init,
    dispose,
    getSnapshot,
    subscribe,
    requestRefresh,
    ensureCollections: (collectionIds, opts = {}) => requestRefresh('ensureCollections', { delayMs: 0, collectionIds, ...(opts || {}) }),
  };
})();

export default studyManagerController;




