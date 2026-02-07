export function createGrammarProgressManager({ uiState, persistence, emitter, grammarProgressKey = 'grammar_progress' }) {
  function normalizeGrammarKey(v) {
    return String(v ?? '').trim();
  }

  function ensureGrammarProgressMap() {
    uiState.kv = uiState.kv || {};
    const v = uiState.kv[grammarProgressKey];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      uiState.kv[grammarProgressKey] = {};
    }
    return uiState.kv[grammarProgressKey];
  }

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

  function isGrammarLearned(v) {
    return getGrammarState(v) === 'learned';
  }

  function isGrammarFocus(v) {
    return getGrammarState(v) === 'focus';
  }

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
      if (map[k]?.state === 'learned') {
        map[k] = { ...(map[k] || {}), state: null };
      }
    }
    persistence.markDirty({ kvKey: grammarProgressKey });
    persistence.scheduleFlush({ immediate: true });
    emitter.emit();
  }

  function _unsafeGetMap() {
    return ensureGrammarProgressMap();
  }

  return {
    normalizeGrammarKey,
    ensureGrammarProgressMap,
    _unsafeGetMap,

    getGrammarProgressRecord,
    setGrammarProgressRecord,

    getGrammarState,
    setGrammarState,

    isGrammarLearned,
    isGrammarFocus,
    toggleGrammarLearned,
    toggleGrammarFocus,

    recordGrammarSeenInGrammarStudyCard,
    addTimeMsStudiedInGrammarStudyCard,

    clearLearnedGrammar,
  };
}
