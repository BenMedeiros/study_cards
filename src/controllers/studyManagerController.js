import { cleanSearchQuery, splitTopLevel } from '../utils/browser/tableSearch.js';

const STUDY_STATES = ['null', 'focus', 'learned'];
const MAX_RECENT_SESSIONS_PER_COLLECTION = 1000;

function nowIso() {
  return new Date().toISOString();
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
  return ordered.join(',');
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
    recentSessions: [],
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

  let sessionCursor = 0;
  const sessionByCollection = new Map();
  const cacheByCollection = new Map();
  const subs = new Set();

  let snapshot = {
    ready: false,
    isComputing: false,
    updatedAtIso: null,
    reason: '',
    collections: [],
    collectionMap: {},
  };

  function emit() {
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

  function ingestSession(session) {
    const s = session && typeof session === 'object' ? session : null;
    if (!s) return;
    const collectionId = String(s.collectionId || '').trim();
    if (!collectionId) return;
    const durationMs = Math.max(0, Math.round(Number(s.durationMs) || 0));
    if (!durationMs) return;

    const agg = getOrCreateSessionAggregate(collectionId);
    if (!agg) return;

    const filterKey = normalizeSearchQuery(s.heldTableSearch || '');
    const appId = String(s.appId || '').trim() || 'unknown';
    const studyFilter = normalizeStudyFilterString(s.studyFilter || '');
    const startIso = String(s.startIso || '').trim() || null;
    const endIso = String(s.endIso || '').trim() || null;

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

    agg.appTotals.set(appId, (agg.appTotals.get(appId) || 0) + durationMs);
    agg.recentSessions.push({
      startIso,
      endIso,
      appId,
      collectionId,
      durationMs,
      heldTableSearch: filterKey,
      studyFilter,
    });
    if (agg.recentSessions.length > MAX_RECENT_SESSIONS_PER_COLLECTION) {
      agg.recentSessions.splice(0, agg.recentSessions.length - MAX_RECENT_SESSIONS_PER_COLLECTION);
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
    const category = String(collection?.metadata?.category || '').trim();
    const isGrammar = category === 'japanese.grammar' || category.endsWith('.grammar') || category.includes('.grammar.');

    function getEntryKey(entry) {
      if (isGrammar) {
        const v = entry?.pattern;
        return (typeof v === 'string') ? v.trim() : '';
      }
      return String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
    }

    function getProgressRecord(entryKey) {
      if (!entryKey) return null;
      try {
        if (isGrammar && typeof store?.grammarProgress?.getGrammarProgressRecord === 'function') {
          return store.grammarProgress.getGrammarProgressRecord(entryKey, { collectionKey }) || null;
        }
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

  function getTodayYesterdayStamps(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
    const stamp = (x) => {
      const y = x.getFullYear();
      const m = String(x.getMonth() + 1).padStart(2, '0');
      const day = String(x.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    };
    return { todayStamp: stamp(today), yesterdayStamp: stamp(yesterday) };
  }

  function formatDayLabel(dayStamp, { todayStamp = '', yesterdayStamp = '' } = {}) {
    const stamp = String(dayStamp || '').trim();
    if (!stamp) return '';
    if (stamp === todayStamp) return 'Today';
    if (stamp === yesterdayStamp) return 'Yesterday';
    const d = new Date(stamp + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return stamp;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function buildDailyFilterActivity({ collectionId, recentSessions, filterMap, dayLimit = 14 }) {
    const sessions = Array.isArray(recentSessions) ? recentSessions : [];
    const { todayStamp, yesterdayStamp } = getTodayYesterdayStamps();
    const byDay = new Map();

    for (const sess of sessions) {
      const dayStamp = dayStampFromIso(sess?.endIso || sess?.startIso || '');
      if (!dayStamp) continue;
      const durationMs = Math.max(0, Math.round(Number(sess?.durationMs) || 0));
      if (!byDay.has(dayStamp)) {
        byDay.set(dayStamp, {
          dayStamp,
          totalDurationMs: 0,
          sessionCount: 0,
          byFilter: new Map(),
        });
      }
      const day = byDay.get(dayStamp);
      day.totalDurationMs += durationMs;
      day.sessionCount += 1;
      const filterKey = normalizeSearchQuery(sess?.heldTableSearch || '');
      const current = day.byFilter.get(filterKey) || { filterKey, durationMs: 0, sessionCount: 0 };
      current.durationMs += durationMs;
      current.sessionCount += 1;
      day.byFilter.set(filterKey, current);
    }

    const days = Array.from(byDay.values())
      .sort((a, b) => String(b.dayStamp).localeCompare(String(a.dayStamp)))
      .slice(0, Math.max(1, Math.round(Number(dayLimit) || 14)))
      .map((day) => ({
        dayStamp: day.dayStamp,
        dayLabel: formatDayLabel(day.dayStamp, { todayStamp, yesterdayStamp }),
        totalDurationMs: day.totalDurationMs,
        sessionCount: day.sessionCount,
        filterCount: day.byFilter.size,
        topFilters: Array.from(day.byFilter.values())
          .sort((a, b) => {
            if (b.durationMs !== a.durationMs) return b.durationMs - a.durationMs;
            return String(a.filterKey || '').localeCompare(String(b.filterKey || ''));
          })
          .slice(0, 4)
          .map((item) => {
            const row = filterMap?.[item.filterKey] || null;
            return {
              filterKey: item.filterKey,
              filterLabel: row?.filterLabel || makeFilterLabel(item.filterKey),
              durationMs: Math.max(0, Math.round(Number(item.durationMs) || 0)),
              sessionCount: Math.max(0, Math.round(Number(item.sessionCount) || 0)),
            };
          }),
      }));

    const last7Days = days.slice(0, 7);
    return {
      collectionId: String(collectionId || '').trim(),
      summary: {
        dayCount: days.length,
        totalDurationMs: last7Days.reduce((sum, day) => sum + Math.max(0, Math.round(Number(day.totalDurationMs) || 0)), 0),
        totalSessions: last7Days.reduce((sum, day) => sum + Math.max(0, Math.round(Number(day.sessionCount) || 0)), 0),
        activeDays: last7Days.filter((day) => Math.max(0, Math.round(Number(day.totalDurationMs) || 0)) > 0).length,
      },
      days,
    };
  }

  function extractKanjiCharacters(value) {
    const matches = Array.from(String(value || '').matchAll(/[㐀-䶿一-鿿豈-﫿]/g)).map((m) => String(m[0] || ''));
    const out = [];
    const seen = new Set();
    for (const char of matches) {
      if (!char || seen.has(char)) continue;
      seen.add(char);
      out.push(char);
    }
    return out;
  }

  function detectWordField(collection) {
    const fields = Array.isArray(collection?.metadata?.fields) ? collection.metadata.fields : [];
    const fieldKeys = fields.map((field) => String(field?.key || '').trim()).filter(Boolean);
    const candidates = ['kanji', 'word', 'text', 'term', 'title', 'name', 'pattern'];
    for (const key of candidates) {
      if (fieldKeys.includes(key)) return key;
    }
    return '';
  }

  function getEntryLabel(entry, primaryField = '') {
    if (primaryField && entry && typeof entry === 'object') {
      const direct = entry[primaryField];
      if (direct != null && String(direct).trim()) return String(direct).trim();
    }
    if (entry && typeof entry === 'object') {
      for (const key of ['kanji', 'word', 'text', 'term', 'title', 'name', 'pattern', 'id']) {
        const value = entry[key];
        if (value != null && String(value).trim()) return String(value).trim();
      }
    }
    return '';
  }

  function buildRecommendationRoute(collectionId, fieldKey, token) {
    const coll = encodeURIComponent(String(collectionId || '').trim());
    const field = String(fieldKey || '').trim();
    const value = String(token || '').trim();
    if (!coll || !field || !value) return '';
    const filterKey = `{${field}:%${value}%}`;
    return '/data?collection=' + coll + '&heldTableSearch=' + encodeURIComponent(filterKey);
  }

  function buildWordLearningRecommendations({ collection }) {
    const collectionId = String(collection?.key || '').trim();
    if (!collectionId) return null;

    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    if (!entries.length) return null;

    const category = String(collection?.metadata?.category || '').trim();
    const isGrammar = category === 'japanese.grammar' || category.endsWith('.grammar') || category.includes('.grammar.');
    if (isGrammar) return null;

    const primaryField = detectWordField(collection);
    if (!primaryField) return null;

    function getEntryKey(entry) {
      return String(store?.collections?.getEntryStudyKey?.(entry) || '').trim();
    }

    function getProgressRecord(entryKey) {
      if (!entryKey) return null;
      try {
        if (typeof store?.kanjiProgress?.getKanjiProgressRecord === 'function') {
          return store.kanjiProgress.getKanjiProgressRecord(entryKey, { collectionKey: collectionId }) || null;
        }
      } catch {}
      return null;
    }

    const learnedInfos = [];
    const candidateInfos = [];
    const knownKanji = new Set();

    for (const entry of entries) {
      const label = getEntryLabel(entry, primaryField);
      if (!label) continue;
      const chars = extractKanjiCharacters(entry?.kanji ?? label);
      if (!chars.length) continue;
      const entryKey = getEntryKey(entry);
      const rec = getProgressRecord(entryKey);
      const state = rec ? normalizeState(rec.state) : 'null';
      const learned = state === 'learned';
      const info = { entry, label, entryKey, chars, state };
      if (learned) {
        learnedInfos.push(info);
        for (const char of chars) knownKanji.add(char);
      } else {
        candidateInfos.push(info);
      }
    }

    if (!knownKanji.size) return null;

    const easyWords = [];
    const bucketMap = new Map();

    for (const info of candidateInfos) {
      const knownChars = info.chars.filter((char) => knownKanji.has(char));
      if (!knownChars.length) continue;
      const unknownChars = info.chars.filter((char) => !knownKanji.has(char));
      if (unknownChars.length > 2) continue;
      const overlapRatio = knownChars.length / Math.max(1, info.chars.length);
      if (overlapRatio < 0.5) continue;

      easyWords.push({
        label: info.label,
        knownChars,
        unknownChars,
        overlapRatio,
        totalKanji: info.chars.length,
      });

      const perWordSeen = new Set();
      for (const char of knownChars) {
        if (!char || perWordSeen.has(char)) continue;
        perWordSeen.add(char);
        const bucket = bucketMap.get(char) || {
          kanjiChar: char,
          totalWords: 0,
          fullyKnownWords: 0,
          oneNewKanjiWords: 0,
          sampleWords: [],
        };
        bucket.totalWords += 1;
        if (unknownChars.length === 0) bucket.fullyKnownWords += 1;
        if (unknownChars.length === 1) bucket.oneNewKanjiWords += 1;
        bucket.sampleWords.push({ label: info.label, unknownCount: unknownChars.length, overlapRatio });
        bucketMap.set(char, bucket);
      }
    }

    const topFilters = Array.from(bucketMap.values())
      .map((bucket) => ({
        ...bucket,
        sampleWords: bucket.sampleWords
          .sort((a, b) => {
            if (a.unknownCount !== b.unknownCount) return a.unknownCount - b.unknownCount;
            if (b.overlapRatio !== a.overlapRatio) return b.overlapRatio - a.overlapRatio;
            return String(a.label || '').localeCompare(String(b.label || ''));
          })
          .slice(0, 5)
          .map((item) => String(item.label || '')),
        route: buildRecommendationRoute(collectionId, primaryField, bucket.kanjiChar),
      }))
      .sort((a, b) => {
        if (b.fullyKnownWords !== a.fullyKnownWords) return b.fullyKnownWords - a.fullyKnownWords;
        if (b.totalWords !== a.totalWords) return b.totalWords - a.totalWords;
        if (b.oneNewKanjiWords !== a.oneNewKanjiWords) return b.oneNewKanjiWords - a.oneNewKanjiWords;
        return String(a.kanjiChar || '').localeCompare(String(b.kanjiChar || ''));
      })
      .slice(0, 8);

    const rankedWords = easyWords
      .sort((a, b) => {
        if (a.unknownChars.length !== b.unknownChars.length) return a.unknownChars.length - b.unknownChars.length;
        if (b.overlapRatio !== a.overlapRatio) return b.overlapRatio - a.overlapRatio;
        if (a.totalKanji !== b.totalKanji) return a.totalKanji - b.totalKanji;
        return String(a.label || '').localeCompare(String(b.label || ''));
      })
      .slice(0, 10)
      .map((item) => ({
        label: item.label,
        knownChars: item.knownChars.slice(),
        unknownChars: item.unknownChars.slice(),
      }));

    return {
      summary: {
        learnedWordCount: learnedInfos.length,
        knownUniqueKanjiCount: knownKanji.size,
        candidateWordCount: easyWords.length,
        fullyKnownCandidateCount: easyWords.filter((item) => item.unknownChars.length === 0).length,
        oneNewKanjiCandidateCount: easyWords.filter((item) => item.unknownChars.length === 1).length,
        primaryField,
      },
      topFilters,
      easyWords: rankedWords,
    };
  }

  function makeFilterLabel(key) {
    return key ? key : '(no filter)';
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

    const filterRows = [];
    const filterMap = {};
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

      filterRows.push(row);
      filterMap[filterKey] = row;
    }

    filterRows.sort((a, b) => {
      if (b.rolledDownDurationMs !== a.rolledDownDurationMs) return b.rolledDownDurationMs - a.rolledDownDurationMs;
      if (b.directDurationMs !== a.directDurationMs) return b.directDurationMs - a.directDurationMs;
      return a.filterLabel.localeCompare(b.filterLabel);
    });

    const recentSessions = (Array.isArray(sessionAgg?.recentSessions) ? sessionAgg.recentSessions.slice() : [])
      .sort((a, b) => String(b.endIso || '').localeCompare(String(a.endIso || '')));

    const appRows = Array.from(appTotals.entries())
      .map(([appId, durationMs]) => ({ appId, durationMs: Math.max(0, Math.round(Number(durationMs) || 0)) }))
      .sort((a, b) => b.durationMs - a.durationMs);

    const dailyActivity = buildDailyFilterActivity({
      collectionId,
      recentSessions,
      filterMap,
    });
    const recommendations = buildWordLearningRecommendations({
      collection,
    });

    const topFilter = filterMap[''] || filterRows[0] || null;
    const summary = {
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
      filterCount: filterRows.length,
    };

    return {
      collectionId,
      collectionName,
      summary,
      filterRows,
      filterMap,
      appRows,
      recentSessions,
      dailyActivity,
      recommendations,
      updatedAtIso: nowIso(),
    };
  }

  async function recompute(reason = 'recompute') {
    if (!store) return;
    if (isComputing) {
      pendingReason = reason || 'pending';
      return;
    }
    isComputing = true;
    snapshot = { ...snapshot, isComputing: true, reason: String(reason || 'recompute') };
    emit();

    try {
      processSessionsIncremental();
      const progressByCollection = buildProgressByCollection();
      const collections = store?.collections?.getCollections?.() || [];
      const reports = [];
      const reportMap = {};
      for (const coll of collections) {
        const key = String(coll?.key || '').trim();
        if (!key) continue;
        const progressSummary = progressByCollection.get(key) || makeProgressSummary(key);
        const sessionAgg = sessionByCollection.get(key) || makeSessionAggregate(key);
        const report = buildCollectionReport(coll, progressSummary, sessionAgg);
        reports.push(report);
        reportMap[key] = report;
      }
      reports.sort((a, b) => {
        const ta = a?.summary?.lastSessionIso ? new Date(a.summary.lastSessionIso).getTime() : 0;
        const tb = b?.summary?.lastSessionIso ? new Date(b.summary.lastSessionIso).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return String(a.collectionName || '').localeCompare(String(b.collectionName || ''));
      });

      snapshot = {
        ready: true,
        isComputing: false,
        updatedAtIso: nowIso(),
        reason: String(reason || ''),
        collections: reports,
        collectionMap: reportMap,
      };
      emit();
    } finally {
      isComputing = false;
      if (pendingReason) {
        const nextReason = pendingReason;
        pendingReason = null;
        requestRefresh(nextReason, { delayMs: 150 });
      }
    }
  }

  function requestRefresh(reason = 'refresh', { delayMs = 350 } = {}) {
    if (!store) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      recompute(reason);
    }, Math.max(0, Math.round(Number(delayMs) || 0)));
  }

  function init({ store: appStore, pollIntervalMs = 20_000 } = {}) {
    if (!appStore) throw new Error('studyManagerController.init requires store');
    store = appStore;
    pollMs = Math.max(5_000, Math.round(Number(pollIntervalMs) || 20_000));
    if (initialized) return;
    initialized = true;

    try {
      unsubStore = store.subscribe(() => requestRefresh('store.emit', { delayMs: 450 }));
    } catch {}

    pollTimer = setInterval(() => {
      requestRefresh('poll', { delayMs: 0 });
    }, pollMs);

    requestRefresh('init', { delayMs: 0 });
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
  };
})();

export default studyManagerController;




