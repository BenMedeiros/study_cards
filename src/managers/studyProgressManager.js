export function createStudyProgressManager({
  uiState,
  persistence,
  emitter,
  studyProgressKey = 'study_progress',
  studyTimeKey = 'study_time',
} = {}) {
  const KNOWN_APP_IDS = ['flashcardsView', 'kanjiStudyCardView', 'qaCardsView'];
  let trackerSeq = 0;
  let activeTrackerStatus = {
    trackerId: null,
    trackerOrder: 0,
    active: false,
    appId: '',
    collectionKey: '',
    entryKey: '',
    studyId: '',
    elapsedMs: 0,
    isRunning: false,
    statusWallMs: 0,
    startedAtMs: null,
    creditedThisViewMs: 0,
    lastCommitAtMs: 0,
    lastCommitDeltaMs: 0,
    lastCommitReason: '',
  };

  function normalizeValue(v) { return String(v ?? '').trim(); }
  function normalizeCollectionKey(v, fallback = '') { return normalizeValue(v || fallback); }
  function normalizeEntryKey(v) { return normalizeValue(v); }
  function normalizeAppId(v, fallback = 'kanjiStudyCardView') {
    const s = normalizeValue(v || fallback);
    return s || 'kanjiStudyCardView';
  }

  function makeStudyId(collectionKey, entryKey) {
    const c = normalizeCollectionKey(collectionKey);
    const e = normalizeEntryKey(entryKey);
    if (!c || !e) return '';
    return `${c}|${e}`;
  }

  function getActiveCardProgressStatus() {
    return cloneObject(activeTrackerStatus);
  }

  function setActiveCardProgressStatus(next) {
    activeTrackerStatus = {
      ...cloneObject(activeTrackerStatus),
      ...cloneObject(next),
    };
  }

  function splitStudyId(id) {
    const s = normalizeValue(id);
    const i = s.indexOf('|');
    if (i <= 0 || i >= s.length - 1) return { collectionKey: '', entryKey: '' };
    return { collectionKey: s.slice(0, i), entryKey: s.slice(i + 1) };
  }

  function ensureStudyProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[studyProgressKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) uiState.kv[studyProgressKey] = {};
    return uiState.kv[studyProgressKey];
  }

  function _unsafeGetMap() { return ensureStudyProgressMap(); }

  function cloneObject(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...v } : {};
  }

  function ensureAppStats(rec, appId) {
    const out = cloneObject(rec);
    out.apps = cloneObject(out.apps);
    const app = normalizeAppId(appId);
    const prev = cloneObject(out.apps[app]);
    out.apps[app] = {
      timesSeen: Math.max(0, Math.round(Number(prev.timesSeen) || 0)),
      lastSeenIso: normalizeValue(prev.lastSeenIso) || null,
      timeMs: Math.max(0, Math.round(Number(prev.timeMs) || 0)),
    };
    return out;
  }

  function recalcAggregate(rec) {
    const out = cloneObject(rec);
    out.apps = cloneObject(out.apps);
    let timesSeen = 0;
    let timeMs = 0;
    let lastSeenIso = null;

    for (const app of Object.keys(out.apps)) {
      const st = cloneObject(out.apps[app]);
      const ts = Math.max(0, Math.round(Number(st.timesSeen) || 0));
      const tm = Math.max(0, Math.round(Number(st.timeMs) || 0));
      const ls = normalizeValue(st.lastSeenIso) || null;
      timesSeen += ts;
      timeMs += tm;
      if (ls && (!lastSeenIso || ls > lastSeenIso)) lastSeenIso = ls;
      out.apps[app] = { timesSeen: ts, lastSeenIso: ls, timeMs: tm };
    }

    out.timesSeen = timesSeen;
    out.timeMs = timeMs;
    out.lastSeenIso = lastSeenIso;
    out.seen = !!out.seen || timesSeen > 0 || timeMs > 0;
    if (out.lastStudiedIso) delete out.lastStudiedIso;
    return out;
  }

  function getBaseRecord(entryKey, { collectionKey = 'japanese.words' } = {}) {
    const c = normalizeCollectionKey(collectionKey, 'japanese.words');
    const e = normalizeEntryKey(entryKey);
    const id = makeStudyId(c, e);
    if (!id) return { id: '', record: null, collectionKey: '', entryKey: '' };
    const map = ensureStudyProgressMap();
    const raw = map[id];
    const rec = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
    if (!rec) return { id, record: null, collectionKey: c, entryKey: e };
    return { id, record: recalcAggregate(rec), collectionKey: c, entryKey: e };
  }

  function setBaseRecord(entryKey, patch, { collectionKey = 'japanese.words', appId = 'kanjiStudyCardView', immediate = false, silent = false, notify } = {}) {
    const c = normalizeCollectionKey(collectionKey, 'japanese.words');
    const e = normalizeEntryKey(entryKey);
    const id = makeStudyId(c, e);
    if (!id) return null;

    const map = ensureStudyProgressMap();
    const prev = getBaseRecord(e, { collectionKey: c }).record || {};
    const patchObj = cloneObject(patch);
    const next = recalcAggregate({ ...prev, ...patchObj });
    map[id] = next;

    persistence.markDirty({ kvKey: studyProgressKey });
    persistence.scheduleFlush({ immediate: !!immediate });

    const shouldNotify = (notify ?? !silent) !== false;
    if (shouldNotify) emitter.emit();
    return next;
  }

  function getStudyMetricsForRecord(rec, { appIds = null } = {}) {
    const src = cloneObject(rec);
    const apps = cloneObject(src.apps);
    const requested = Array.isArray(appIds) && appIds.length
      ? appIds.map(normalizeAppId).filter(Boolean)
      : Object.keys(apps);

    let timesSeen = 0;
    let timeMs = 0;
    let lastSeenIso = null;
    for (const app of requested) {
      const st = cloneObject(apps[app]);
      const ts = Math.max(0, Math.round(Number(st.timesSeen) || 0));
      const tm = Math.max(0, Math.round(Number(st.timeMs) || 0));
      const ls = normalizeValue(st.lastSeenIso) || null;
      timesSeen += ts;
      timeMs += tm;
      if (ls && (!lastSeenIso || ls > lastSeenIso)) lastSeenIso = ls;
    }

    return {
      seen: timesSeen > 0 || timeMs > 0 || !!src.seen,
      timesSeen,
      timeMs,
      lastSeenIso,
    };
  }

  // Kanji helpers
  function normalizeKanjiValue(v) { return normalizeValue(v); }

  function getKanjiProgressRecord(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
    return getBaseRecord(k, { collectionKey }).record;
  }

  function setKanjiProgressRecord(v, patch, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
    return setBaseRecord(k, patch, { ...opts, collectionKey, appId: 'kanjiStudyCardView' });
  }

  function getKanjiState(v, opts = {}) {
    const rec = getKanjiProgressRecord(v, opts);
    const s = rec?.state;
    return (typeof s === 'string' && s.trim()) ? s.trim() : null;
  }

  function setKanjiState(v, nextState, opts = {}) {
    const state = (typeof nextState === 'string' && nextState.trim()) ? nextState.trim() : null;
    return setKanjiProgressRecord(v, { state }, opts);
  }

  function isKanjiLearned(v, opts = {}) { return getKanjiState(v, opts) === 'learned'; }
  function isKanjiFocus(v, opts = {}) { return getKanjiState(v, opts) === 'focus'; }

  function toggleKanjiLearned(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k, opts);
    const next = (cur === 'learned') ? null : 'learned';
    setKanjiState(k, next, opts);
    return getKanjiState(k, opts) === 'learned';
  }

  function toggleKanjiFocus(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k, opts);
    const next = (cur === 'focus') ? null : 'focus';
    setKanjiState(k, next, opts);
    return getKanjiState(k, opts) === 'focus';
  }

  function recordSeen(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
    const appId = normalizeAppId(opts.appId, 'kanjiStudyCardView');
    const base = getBaseRecord(k, { collectionKey }).record || {};
    const next = ensureAppStats(base, appId);
    const nowIso = new Date().toISOString();
    const prev = cloneObject(next.apps[appId]);
    next.apps[appId] = {
      timesSeen: Math.max(0, Math.round(Number(prev.timesSeen) || 0)) + 1,
      timeMs: Math.max(0, Math.round(Number(prev.timeMs) || 0)),
      lastSeenIso: nowIso,
    };
    return setBaseRecord(k, next, { ...opts, collectionKey, appId, notify: (opts.notify ?? (opts.silent === false)) });
  }

  function addStudyTimeMs(v, deltaMs, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const d = Math.round(Number(deltaMs));
    if (!Number.isFinite(d) || d <= 0) return getKanjiProgressRecord(k, opts);
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
    const appId = normalizeAppId(opts.appId, 'kanjiStudyCardView');
    const base = getBaseRecord(k, { collectionKey }).record || {};
    const next = ensureAppStats(base, appId);
    const nowIso = new Date().toISOString();
    const prev = cloneObject(next.apps[appId]);
    next.apps[appId] = {
      timesSeen: Math.max(0, Math.round(Number(prev.timesSeen) || 0)),
      timeMs: Math.max(0, Math.round(Number(prev.timeMs) || 0)) + d,
      lastSeenIso: nowIso,
    };
    return setBaseRecord(k, next, { ...opts, collectionKey, appId, notify: (opts.notify ?? (opts.silent === false)) });
  }

  function createCardProgressTracker({
    appId = 'kanjiStudyCardView',
    getEntryKey = () => '',
    getCollectionKey = () => 'japanese.words',
    maxCreditPerCardMs = 10_000,
    minViewToCountMs = 200,
    canRunTimer = null,
  } = {}) {
    const trackerOrder = ++trackerSeq;
    const trackerId = `tracker-${trackerOrder}`;
    const timing = {
      key: null,
      startedAtMs: null,
      creditedThisViewMs: 0,
      seenMarkedThisView: false,
    };

    function nowTick() {
      try {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
          return performance.now();
        }
      } catch {}
      return Date.now();
    }

    function defaultCanRunTimer() {
      try {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
        if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
        return true;
      } catch {
        return false;
      }
    }

    function canRun() {
      try {
        if (typeof canRunTimer === 'function') return !!canRunTimer();
      } catch {}
      return defaultCanRunTimer();
    }

    function resolveEntryKey() {
      try { return normalizeEntryKey(getEntryKey?.()); } catch { return ''; }
    }

    function resolveCollectionKey() {
      try { return normalizeCollectionKey(getCollectionKey?.(), 'japanese.words'); } catch { return 'japanese.words'; }
    }

    function currentStudyId() {
      const key = normalizeEntryKey(timing.key);
      if (!key) return '';
      return makeStudyId(resolveCollectionKey(), key);
    }

    function currentElapsedMs() {
      const running = (timing.startedAtMs == null) ? 0 : Math.max(0, Math.round(nowTick() - timing.startedAtMs));
      return Math.max(0, Math.round(timing.creditedThisViewMs + running));
    }

    function publishTrackerStatus(extra = {}) {
      const currentOrder = Math.max(0, Math.round(Number(activeTrackerStatus?.trackerOrder) || 0));
      if (currentOrder > trackerOrder) return;
      const key = normalizeEntryKey(timing.key);
      const collectionKey = key ? resolveCollectionKey() : '';
      const studyId = (key && collectionKey) ? makeStudyId(collectionKey, key) : '';
      const active = !!key;
      setActiveCardProgressStatus({
        ...extra,
        trackerId,
        trackerOrder,
        active,
        appId: active ? normalizeAppId(appId, 'kanjiStudyCardView') : '',
        collectionKey,
        entryKey: key,
        studyId,
        elapsedMs: active ? currentElapsedMs() : 0,
        isRunning: active ? (timing.startedAtMs != null) : false,
        statusWallMs: Date.now(),
        startedAtMs: active ? timing.startedAtMs : null,
        creditedThisViewMs: active ? Math.max(0, Math.round(timing.creditedThisViewMs || 0)) : 0,
      });
    }

    function flush({ immediate = false } = {}) {
      const key = timing.key;
      if (!key) return;
      if (timing.startedAtMs == null) return;

      const elapsed = Math.max(0, Math.round(nowTick() - timing.startedAtMs));
      const totalViewedThisViewMs = timing.creditedThisViewMs + elapsed;
      const collectionKey = resolveCollectionKey();
      let didRecordSeen = false;
      let didAddTime = false;

      if (!timing.seenMarkedThisView && totalViewedThisViewMs >= minViewToCountMs) {
        timing.seenMarkedThisView = true;
        try {
          recordSeen(key, { collectionKey, appId, silent: true, immediate });
          didRecordSeen = true;
        } catch {}
      }

      if (totalViewedThisViewMs < minViewToCountMs) {
        timing.startedAtMs = null;
        publishTrackerStatus();
        return;
      }

      const remaining = Math.max(0, maxCreditPerCardMs - timing.creditedThisViewMs);
      const add = Math.round(Math.min(elapsed, remaining));
      timing.startedAtMs = null;
      if (add <= 0) {
        if (didRecordSeen) {
          publishTrackerStatus({
            lastCommitAtMs: Date.now(),
            lastCommitDeltaMs: 0,
            lastCommitReason: 'seen',
          });
        } else {
          publishTrackerStatus();
        }
        return;
      }

      timing.creditedThisViewMs += add;
      try {
        addStudyTimeMs(key, add, { collectionKey, appId, silent: true, immediate });
        didAddTime = true;
      } catch {}

      if (didRecordSeen || didAddTime) {
        publishTrackerStatus({
          lastCommitAtMs: Date.now(),
          lastCommitDeltaMs: didAddTime ? add : 0,
          lastCommitReason: didRecordSeen && didAddTime ? 'seen+time' : (didAddTime ? 'time' : 'seen'),
        });
      } else {
        publishTrackerStatus();
      }
    }

    function maybeResume() {
      if (!timing.key) return;
      if (timing.startedAtMs != null) return;
      if (timing.creditedThisViewMs >= maxCreditPerCardMs) return;
      if (!canRun()) return;
      timing.startedAtMs = nowTick();
      publishTrackerStatus();
    }

    function beginForKey(nextKey) {
      const key = normalizeEntryKey(nextKey);
      flush();
      timing.key = key || null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      publishTrackerStatus();
      if (timing.key) maybeResume();
    }

    function syncToCurrent() {
      const current = resolveEntryKey();
      if (!current) {
        flush();
        timing.key = null;
        timing.startedAtMs = null;
        timing.creditedThisViewMs = 0;
        timing.seenMarkedThisView = false;
        publishTrackerStatus({
          active: false,
          appId: '',
          collectionKey: '',
          entryKey: '',
          studyId: '',
          elapsedMs: 0,
        });
        return;
      }
      if (timing.key !== current) {
        beginForKey(current);
      } else if (!canRun()) {
        flush();
      } else {
        maybeResume();
        publishTrackerStatus();
      }
    }

    function onVisibilityChange() {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') maybeResume();
        else flush({ immediate: true });
      } catch {
        flush({ immediate: true });
      }
    }
    function onWindowBlur() { flush({ immediate: true }); }
    function onWindowFocus() { maybeResume(); }

    try { document.addEventListener('visibilitychange', onVisibilityChange); } catch {}
    try { window.addEventListener('blur', onWindowBlur); } catch {}
    try { window.addEventListener('focus', onWindowFocus); } catch {}

    function teardown() {
      try { flush({ immediate: true }); } catch {}
      try { document.removeEventListener('visibilitychange', onVisibilityChange); } catch {}
      try { window.removeEventListener('blur', onWindowBlur); } catch {}
      try { window.removeEventListener('focus', onWindowFocus); } catch {}
      timing.key = null;
      timing.startedAtMs = null;
      timing.creditedThisViewMs = 0;
      timing.seenMarkedThisView = false;
      const currentTrackerId = normalizeValue(activeTrackerStatus?.trackerId);
      if (currentTrackerId && currentTrackerId !== trackerId) return;
      setActiveCardProgressStatus({
        trackerId,
        trackerOrder,
        active: false,
        appId: '',
        collectionKey: '',
        entryKey: '',
        studyId: '',
        elapsedMs: 0,
        isRunning: false,
        statusWallMs: Date.now(),
        startedAtMs: null,
        creditedThisViewMs: 0,
      });
    }

    return {
      syncToCurrent,
      flush,
      maybeResume,
      beginForKey,
      teardown,
    };
  }

  function getFocusKanjiValues(limit = 24, opts = {}) {
    const n = Math.max(0, Math.min(200, Math.round(Number(limit) || 0)));
    if (!n) return [];
    const coll = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
    const map = ensureStudyProgressMap();
    const out = [];
    for (const [id, r] of Object.entries(map)) {
      if (!r || typeof r !== 'object') continue;
      const parts = splitStudyId(id);
      if (parts.collectionKey !== coll) continue;
      if (r.state === 'focus') out.push(parts.entryKey);
      if (out.length >= n) break;
    }
    return out;
  }

  function clearLearnedKanji(opts = {}) {
    try {
      const coll = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
      const map = ensureStudyProgressMap();
      let changed = false;
      for (const [id, rec] of Object.entries(map)) {
        if (!rec || typeof rec !== 'object') continue;
        const parts = splitStudyId(id);
        if (parts.collectionKey !== coll) continue;
        if (rec.state === 'learned') {
          map[id] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;
      persistence.markDirty({ kvKey: studyProgressKey });
      persistence.scheduleFlush({ immediate: true });
      emitter.emit();
    } catch {
      // ignore
    }
  }

  function clearLearnedKanjiForValues(values, opts = {}) {
    try {
      if (!Array.isArray(values) || values.length === 0) return;
      const coll = normalizeCollectionKey(opts.collectionKey, 'japanese.words');
      const toClear = new Set(values.map(normalizeKanjiValue).filter(Boolean));
      if (toClear.size === 0) return;

      const map = ensureStudyProgressMap();
      let changed = false;
      for (const value of toClear) {
        const id = makeStudyId(coll, value);
        const rec = map[id];
        if (rec && typeof rec === 'object' && rec.state === 'learned') {
          map[id] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;

      persistence.markDirty({ kvKey: studyProgressKey });
      persistence.scheduleFlush({ immediate: true });
      emitter.emit();
    } catch {
      // ignore
    }
  }

  // Grammar API (backed by unified records)
  function normalizeGrammarKey(v) { return normalizeValue(v); }

  function getGrammarProgressRecord(v, opts = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'grammar');
    const rec = getBaseRecord(k, { collectionKey }).record;
    if (!rec) return null;
    const st = getStudyMetricsForRecord(rec, { appIds: KNOWN_APP_IDS });
    return {
      ...rec,
      timesSeen: st.timesSeen,
      timeMs: st.timeMs,
      lastSeenIso: st.lastSeenIso,
    };
  }

  function setGrammarProgressRecord(v, patch, opts = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const collectionKey = normalizeCollectionKey(opts.collectionKey, 'grammar');
    return setBaseRecord(k, patch, { ...opts, collectionKey, appId: 'qaCardsView' });
  }

  function getGrammarState(v, opts = {}) {
    const rec = getGrammarProgressRecord(v, opts);
    const s = rec?.state;
    return (typeof s === 'string' && s.trim()) ? s.trim() : null;
  }

  function setGrammarState(v, nextState, opts = {}) {
    const state = (typeof nextState === 'string' && nextState.trim()) ? nextState.trim() : null;
    return setGrammarProgressRecord(v, { state }, opts);
  }

  function isGrammarLearned(v, opts = {}) { return getGrammarState(v, opts) === 'learned'; }
  function isGrammarFocus(v, opts = {}) { return getGrammarState(v, opts) === 'focus'; }

  function toggleGrammarLearned(v, opts = {}) {
    const cur = getGrammarState(v, opts);
    const next = (cur === 'learned') ? null : 'learned';
    return setGrammarState(v, next, { ...opts, immediate: true });
  }

  function toggleGrammarFocus(v, opts = {}) {
    const cur = getGrammarState(v, opts);
    const next = (cur === 'focus') ? null : 'focus';
    return setGrammarState(v, next, { ...opts, immediate: true });
  }

  function recordSeenForGrammar(v, { silent = true, immediate = false, collectionKey = 'grammar' } = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const base = getBaseRecord(k, { collectionKey }).record || {};
    const appId = 'qaCardsView';
    const next = ensureAppStats(base, appId);
    const nowIso = new Date().toISOString();
    const prev = cloneObject(next.apps[appId]);
    next.apps[appId] = {
      timesSeen: Math.max(0, Math.round(Number(prev.timesSeen) || 0)) + 1,
      timeMs: Math.max(0, Math.round(Number(prev.timeMs) || 0)),
      lastSeenIso: nowIso,
    };
    return setBaseRecord(k, next, { collectionKey, silent, immediate });
  }

  function addStudyTimeMsForGrammar(v, addMs, { silent = true, immediate = false, collectionKey = 'grammar' } = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const add = (typeof addMs === 'number' && Number.isFinite(addMs)) ? Math.max(0, Math.round(addMs)) : 0;
    if (!add) return getGrammarProgressRecord(k, { collectionKey });
    const base = getBaseRecord(k, { collectionKey }).record || {};
    const appId = 'qaCardsView';
    const next = ensureAppStats(base, appId);
    const nowIso = new Date().toISOString();
    const prev = cloneObject(next.apps[appId]);
    next.apps[appId] = {
      timesSeen: Math.max(0, Math.round(Number(prev.timesSeen) || 0)),
      timeMs: Math.max(0, Math.round(Number(prev.timeMs) || 0)) + add,
      lastSeenIso: nowIso,
    };
    return setBaseRecord(k, next, { collectionKey, silent, immediate });
  }

  function clearLearnedGrammar(opts = {}) {
    const coll = normalizeCollectionKey(opts.collectionKey, 'grammar');
    const map = ensureStudyProgressMap();
    let changed = false;
    for (const [id, rec] of Object.entries(map)) {
      if (!rec || typeof rec !== 'object') continue;
      const parts = splitStudyId(id);
      if (parts.collectionKey !== coll) continue;
      if (rec.state === 'learned') {
        map[id] = { ...rec, state: null };
        changed = true;
      }
    }
    if (!changed) return;
    persistence.markDirty({ kvKey: studyProgressKey });
    persistence.scheduleFlush({ immediate: true });
    emitter.emit();
  }

  function clearLearnedGrammarForKeys(keys, opts = {}) {
    try {
      const arr = Array.isArray(keys) ? keys : [];
      if (!arr.length) return;
      const coll = normalizeCollectionKey(opts.collectionKey, 'grammar');
      const toClear = new Set(arr.map(normalizeGrammarKey).filter(Boolean));
      if (!toClear.size) return;

      const map = ensureStudyProgressMap();
      let changed = false;
      for (const k of toClear) {
        const id = makeStudyId(coll, k);
        const rec = map[id];
        if (rec && typeof rec === 'object' && rec.state === 'learned') {
          map[id] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;

      persistence.markDirty({ kvKey: studyProgressKey });
      persistence.scheduleFlush({ immediate: true });
      emitter.emit();
    } catch {
      // ignore
    }
  }

  // Study time methods (merged here rather than thin wrapper)
  function ensureStudyTimeRecord() {
    uiState.kv = uiState.kv || {};
    let v = uiState.kv[studyTimeKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      v = { version: 1, sessions: [] };
      uiState.kv[studyTimeKey] = v;
      return v;
    }
    if (typeof v.version !== 'number') v.version = 1;
    if (!Array.isArray(v.sessions)) v.sessions = [];
    return v;
  }

  function recordAppCollectionStudySession({ appId, collectionId, startIso, endIso, durationMs } = {}) {
    const a = String(appId || '').trim();
    const c = String(collectionId || '').trim();
    if (!a || !c) return;
    const d = Math.round(Number(durationMs));
    if (!Number.isFinite(d) || d <= 0) return;

    const rec = ensureStudyTimeRecord();
    const start = String(startIso || '').trim() || new Date().toISOString();
    const end = String(endIso || '').trim() || new Date().toISOString();
    const session = { appId: a, collectionId: c, startIso: start, endIso: end, durationMs: d };

    // Accept optional filter info if provided and persist it with the session
    try {
      const held = String(arguments[0]?.heldTableSearch || '').trim();
      const sf = String(arguments[0]?.studyFilter || '').trim();
      if (held) session.heldTableSearch = held;
      if (sf) session.studyFilter = sf;
    } catch (e) {}

    rec.sessions.push(session);
    const MAX_SESSIONS = 2000;
    if (rec.sessions.length > MAX_SESSIONS) rec.sessions.splice(0, rec.sessions.length - MAX_SESSIONS);

    try { persistence.appendStudySession(session); } catch {}
    emitter.emit();
  }

  function getStudyTimeRecord() { return ensureStudyTimeRecord(); }

  function sumSessionDurations({ windowMs, collectionId = null } = {}) {
    const win = Math.round(Number(windowMs));
    const hasWindow = Number.isFinite(win) && win > 0;
    const c = collectionId ? String(collectionId).trim() : null;
    const now = Date.now();
    const cutoff = hasWindow ? (now - win) : null;

    const rec = ensureStudyTimeRecord();
    let total = 0;
    for (let i = rec.sessions.length - 1; i >= 0; i--) {
      const s = rec.sessions[i];
      if (!s || typeof s !== 'object') continue;
      if (c && s.collectionId !== c) continue;
      if (hasWindow) {
        const end = new Date(String(s.endIso || '')).getTime();
        if (!Number.isFinite(end) || Number.isNaN(end)) continue;
        if (end < cutoff) break;
      }
      const d = Math.round(Number(s.durationMs));
      if (Number.isFinite(d) && d > 0) total += d;
    }
    return total;
  }

  function getCollectionStudyStats(collectionId) {
    const id = String(collectionId || '').trim();
    if (!id) return null;
    const rec = ensureStudyTimeRecord();
    let totalMs = 0;
    let lastEndIso = null;
    let lastDurationMs = null;
    for (let i = rec.sessions.length - 1; i >= 0; i--) {
      const s = rec.sessions[i];
      if (!s || typeof s !== 'object') continue;
      if (s.collectionId !== id) continue;
      const d = Math.round(Number(s.durationMs));
      if (Number.isFinite(d) && d > 0) totalMs += d;
      if (!lastEndIso) lastEndIso = s.endIso || null;
      if (!lastDurationMs && Number.isFinite(d)) lastDurationMs = d;
    }

    const last24h = sumSessionDurations({ windowMs: 24 * 60 * 60 * 1000, collectionId: id });
    const last48h = sumSessionDurations({ windowMs: 48 * 60 * 60 * 1000, collectionId: id });
    const last72h = sumSessionDurations({ windowMs: 72 * 60 * 60 * 1000, collectionId: id });
    const last7d = sumSessionDurations({ windowMs: 7 * 24 * 60 * 60 * 1000, collectionId: id });

    return {
      collectionId: id,
      totalMs: Math.max(0, Number(totalMs) || 0),
      lastEndIso: lastEndIso || null,
      lastDurationMs: Number.isFinite(Number(lastDurationMs)) ? Math.round(Number(lastDurationMs)) : null,
      last24h,
      last48h,
      last72h,
      last7d,
    };
  }

  function getAllCollectionsStudyStats() {
    const rec = ensureStudyTimeRecord();
    const out = [];
    const seen = new Set();
    for (let i = rec.sessions.length - 1; i >= 0; i--) {
      const s = rec.sessions[i];
      if (!s || typeof s !== 'object') continue;
      const id = String(s.collectionId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const st = getCollectionStudyStats(id);
      if (st) out.push(st);
    }
    return out;
  }

  function getRecentStudySessions(limit = 10) {
    const n = Math.max(0, Math.min(100, Math.round(Number(limit) || 0)));
    const rec = ensureStudyTimeRecord();
    if (!n) return [];
    return rec.sessions.slice(-n).reverse();
  }

  return {
    // Generic progress map
    ensureStudyProgressMap,

    // Kanji API
    normalizeKanjiValue,
    _unsafeGetMap,
    getKanjiProgressRecord,
    setKanjiProgressRecord,
    getKanjiState,
    setKanjiState,
    isKanjiLearned,
    isKanjiFocus,
    toggleKanjiLearned,
    toggleKanjiFocus,
    clearLearnedKanji,
    clearLearnedKanjiForValues,
    recordSeen,
    addStudyTimeMs,
    createCardProgressTracker,
    getActiveCardProgressStatus,
    getFocusKanjiValues,

    // Grammar API
    normalizeGrammarKey,
    getGrammarProgressRecord,
    setGrammarProgressRecord,
    getGrammarState,
    setGrammarState,
    isGrammarLearned,
    isGrammarFocus,
    toggleGrammarLearned,
    toggleGrammarFocus,
    clearLearnedGrammar,
    clearLearnedGrammarForKeys,
    recordSeenForGrammar,
    addStudyTimeMsForGrammar,

    // Study time
    ensureStudyTimeRecord,
    recordAppCollectionStudySession,
    getStudyTimeRecord,
    getRecentStudySessions,
    getCollectionStudyStats,
    getAllCollectionsStudyStats,
    sumSessionDurations,
  };
}
