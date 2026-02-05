export function createProgressManager({ uiState, persistence, emitter, kanjiProgressKey = 'kanji_progress' }) {
  function normalizeKanjiValue(v) {
    return String(v ?? '').trim();
  }

  function ensureKanjiProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[kanjiProgressKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      uiState.kv[kanjiProgressKey] = {};
    }
    return uiState.kv[kanjiProgressKey];
  }

  // Internal use only (e.g., collection-set filters). Returns the live backing map.
  function _unsafeGetMap() {
    return ensureKanjiProgressMap();
  }


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

  function isKanjiLearned(v) {
    return getKanjiState(v) === 'learned';
  }

  function isKanjiFocus(v) {
    return getKanjiState(v) === 'focus';
  }

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
    setKanjiProgressRecord(k, {
      seen: true,
      timesSeenInKanjiStudyCard: prevTimes + 1,
    }, { ...opts, notify: (opts.notify ?? (opts.silent === false)) });
  }

  function addTimeMsStudiedInKanjiStudyCard(v, deltaMs, opts = {}) {
    const k = normalizeKanjiValue(v);
    const d = Math.round(Number(deltaMs));
    if (!k) return;
    if (!Number.isFinite(d) || d <= 0) return;
    const prev = getKanjiProgressRecord(k) || {};
    const prevTime = Number.isFinite(Number(prev.timeMsStudiedInKanjiStudyCard)) ? Math.round(Number(prev.timeMsStudiedInKanjiStudyCard)) : 0;
    setKanjiProgressRecord(k, {
      timeMsStudiedInKanjiStudyCard: Math.max(0, prevTime + d),
    }, { ...opts, notify: (opts.notify ?? (opts.silent === false)) });
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

  return {
    normalizeKanjiValue,
    _unsafeGetMap,
    ensureKanjiProgressMap,
    getKanjiProgressRecord,
    setKanjiProgressRecord,
    isKanjiLearned,
    isKanjiFocus,
    toggleKanjiLearned,
    toggleKanjiFocus,
    clearLearnedKanji,
    clearLearnedKanjiForValues,
    recordKanjiSeenInKanjiStudyCard,
    addTimeMsStudiedInKanjiStudyCard,
    getFocusKanjiValues,
  };
}
