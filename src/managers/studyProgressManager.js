export function createStudyProgressManager({ uiState, persistence, emitter, kanjiProgressKey = 'kanji_progress', grammarProgressKey = 'grammar_progress', studyTimeKey = 'study_time' } = {}) {
  // Generic normalizer
  function normalizeValue(v) {
    return String(v ?? '').trim();
  }

  // Backwards-compatible maps: keep legacy kv keys for now so persistence.flush() works.
  function ensureKanjiProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[kanjiProgressKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) uiState.kv[kanjiProgressKey] = {};
    return uiState.kv[kanjiProgressKey];
  }

  function ensureGrammarProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[grammarProgressKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) uiState.kv[grammarProgressKey] = {};
    return uiState.kv[grammarProgressKey];
  }

  // Kanji (japanese.words) helpers
  function normalizeKanjiValue(v) { return normalizeValue(v); }
  function _unsafeGetMap() { return ensureKanjiProgressMap(); }

  function getKanjiProgressRecord(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const map = ensureKanjiProgressMap();
    const rec = map[k];
    return (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : null;
  }

  function setKanjiProgressRecord(v, patch, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return null;
    const map = ensureKanjiProgressMap();
    const prev = getKanjiProgressRecord(k) || {};
    const patchObj = (patch && typeof patch === 'object') ? patch : {};
    map[k] = { ...prev, ...patchObj };

    persistence.markDirty({ kvKey: kanjiProgressKey });
    persistence.scheduleFlush({ immediate: !!opts.immediate });

    const notify = (opts.notify ?? !opts.silent) !== false;
    if (notify) emitter.emit();

    return map[k];
  }

  function getKanjiState(v) {
    const rec = getKanjiProgressRecord(v);
    const s = rec?.state;
    return (typeof s === 'string' && s.trim()) ? s.trim() : null;
  }

  function setKanjiState(v, nextState, opts = {}) {
    const state = (typeof nextState === 'string' && nextState.trim()) ? nextState.trim() : null;
    return setKanjiProgressRecord(v, { state }, opts);
  }

  function isKanjiLearned(v) { return getKanjiState(v) === 'learned'; }
  function isKanjiFocus(v) { return getKanjiState(v) === 'focus'; }

  function toggleKanjiLearned(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k);
    const next = (cur === 'learned') ? null : 'learned';
    setKanjiState(k, next);
    return getKanjiState(k) === 'learned';
  }

  function toggleKanjiFocus(v) {
    const k = normalizeKanjiValue(v);
    if (!k) return false;
    const cur = getKanjiState(k);
    const next = (cur === 'focus') ? null : 'focus';
    setKanjiState(k, next);
    return getKanjiState(k) === 'focus';
  }

  function recordKanjiSeenInKanjiStudyCard(v, opts = {}) {
    const k = normalizeKanjiValue(v);
    if (!k) return;
    const prev = getKanjiProgressRecord(k) || {};
    const prevTimes = Number.isFinite(Number(prev.timesSeenInKanjiStudyCard)) ? Number(prev.timesSeenInKanjiStudyCard) : 0;
    setKanjiProgressRecord(k, { seen: true, timesSeenInKanjiStudyCard: prevTimes + 1 }, { ...opts, notify: (opts.notify ?? (opts.silent === false)) });
  }

  function addTimeMsStudiedInKanjiStudyCard(v, deltaMs, opts = {}) {
    const k = normalizeKanjiValue(v);
    const d = Math.round(Number(deltaMs));
    if (!k) return;
    if (!Number.isFinite(d) || d <= 0) return;
    const prev = getKanjiProgressRecord(k) || {};
    const prevTime = Number.isFinite(Number(prev.timeMsStudiedInKanjiStudyCard)) ? Math.round(Number(prev.timeMsStudiedInKanjiStudyCard)) : 0;
    setKanjiProgressRecord(k, { timeMsStudiedInKanjiStudyCard: Math.max(0, prevTime + d) }, { ...opts, notify: (opts.notify ?? (opts.silent === false)) });
  }

  function getFocusKanjiValues(limit = 24) {
    const n = Math.max(0, Math.min(200, Math.round(Number(limit) || 0)));
    if (!n) return [];
    const map = ensureKanjiProgressMap();
    const out = [];
    for (const [k, r] of Object.entries(map)) {
      if (!r || typeof r !== 'object') continue;
      if (r.state === 'focus') out.push(k);
      if (out.length >= n) break;
    }
    return out;
  }

  function clearLearnedKanji() {
    try {
      const map = ensureKanjiProgressMap();
      let changed = false;
      for (const [k, rec] of Object.entries(map)) {
        if (!rec || typeof rec !== 'object') continue;
        if (rec.state === 'learned') {
          map[k] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;
      persistence.markDirty({ kvKey: kanjiProgressKey });
      persistence.scheduleFlush({ immediate: true });
      emitter.emit();
    } catch {
      // ignore
    }
  }

  function clearLearnedKanjiForValues(values) {
    try {
      if (!Array.isArray(values) || values.length === 0) return;
      const toClear = new Set(values.map(normalizeKanjiValue).filter(Boolean));
      if (toClear.size === 0) return;

      const map = ensureKanjiProgressMap();
      let changed = false;
      for (const v of toClear) {
        const rec = map[v];
        if (rec && typeof rec === 'object' && rec.state === 'learned') {
          map[v] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;

      persistence.markDirty({ kvKey: kanjiProgressKey });
      persistence.scheduleFlush({ immediate: true });
      emitter.emit();
    } catch {
      // ignore
    }
  }

  // Grammar helpers (mirror grammarProgressManager API)
  function normalizeGrammarKey(v) { return normalizeValue(v); }

  function getGrammarProgressRecord(v) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const map = ensureGrammarProgressMap();
    const rec = map[k];
    return (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : null;
  }

  function setGrammarProgressRecord(v, patch, opts = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const map = ensureGrammarProgressMap();
    const prev = getGrammarProgressRecord(k) || {};
    const patchObj = (patch && typeof patch === 'object') ? patch : {};
    map[k] = { ...prev, ...patchObj };

    persistence.markDirty({ kvKey: grammarProgressKey });
    persistence.scheduleFlush({ immediate: !!opts.immediate });

    const notify = (opts.notify ?? !opts.silent) !== false;
    if (notify) emitter.emit();

    return map[k];
  }

  function getGrammarState(v) {
    const rec = getGrammarProgressRecord(v);
    const s = rec?.state;
    return (typeof s === 'string' && s.trim()) ? s.trim() : null;
  }

  function setGrammarState(v, nextState, opts = {}) {
    const state = (typeof nextState === 'string' && nextState.trim()) ? nextState.trim() : null;
    return setGrammarProgressRecord(v, { state }, opts);
  }

  function isGrammarLearned(v) { return getGrammarState(v) === 'learned'; }
  function isGrammarFocus(v) { return getGrammarState(v) === 'focus'; }

  function toggleGrammarLearned(v) {
    const cur = getGrammarState(v);
    const next = (cur === 'learned') ? null : 'learned';
    return setGrammarState(v, next, { immediate: true });
  }

  function toggleGrammarFocus(v) {
    const cur = getGrammarState(v);
    const next = (cur === 'focus') ? null : 'focus';
    return setGrammarState(v, next, { immediate: true });
  }

  function recordGrammarSeenInGrammarStudyCard(v, { silent = true, immediate = false } = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const prev = getGrammarProgressRecord(k) || {};
    const timesSeen = (typeof prev.timesSeen === 'number' && Number.isFinite(prev.timesSeen)) ? prev.timesSeen : 0;
    const next = { ...prev, timesSeen: timesSeen + 1, lastSeenIso: new Date().toISOString() };
    return setGrammarProgressRecord(k, next, { silent, immediate });
  }

  function addTimeMsStudiedInGrammarStudyCard(v, addMs, { silent = true, immediate = false } = {}) {
    const k = normalizeGrammarKey(v);
    if (!k) return null;
    const add = (typeof addMs === 'number' && Number.isFinite(addMs)) ? Math.max(0, Math.round(addMs)) : 0;
    if (!add) return getGrammarProgressRecord(k);
    const prev = getGrammarProgressRecord(k) || {};
    const timeMs = (typeof prev.timeMs === 'number' && Number.isFinite(prev.timeMs)) ? prev.timeMs : 0;
    const next = { ...prev, timeMs: timeMs + add, lastStudiedIso: new Date().toISOString() };
    return setGrammarProgressRecord(k, next, { silent, immediate });
  }

  function clearLearnedGrammar() {
    const map = ensureGrammarProgressMap();
    for (const k of Object.keys(map)) {
      if (map[k]?.state === 'learned') map[k] = { ...(map[k] || {}), state: null };
    }
    persistence.markDirty({ kvKey: grammarProgressKey });
    persistence.scheduleFlush({ immediate: true });
    emitter.emit();
  }

  function clearLearnedGrammarForKeys(keys) {
    try {
      const arr = Array.isArray(keys) ? keys : [];
      if (!arr.length) return;
      const toClear = new Set(arr.map(normalizeGrammarKey).filter(Boolean));
      if (!toClear.size) return;

      const map = ensureGrammarProgressMap();
      let changed = false;
      for (const k of toClear) {
        const rec = map[k];
        if (rec && typeof rec === 'object' && rec.state === 'learned') {
          map[k] = { ...rec, state: null };
          changed = true;
        }
      }
      if (!changed) return;

      persistence.markDirty({ kvKey: grammarProgressKey });
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
    // Kanji API (compat)
    normalizeKanjiValue,
    _unsafeGetMap,
    ensureKanjiProgressMap,
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
    recordKanjiSeenInKanjiStudyCard,
    addTimeMsStudiedInKanjiStudyCard,
    getFocusKanjiValues,

    // Grammar API (compat)
    normalizeGrammarKey,
    ensureGrammarProgressMap,
    _unsafeGetGrammarMap: ensureGrammarProgressMap,
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
    recordGrammarSeenInGrammarStudyCard,
    addTimeMsStudiedInGrammarStudyCard,

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
