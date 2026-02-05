import { nowIso } from '../utils/helpers.js';

export function createStudyTimeManager({ uiState, persistence, emitter, studyTimeKey = 'study_time' }) {
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
    const start = String(startIso || '').trim();
    const end = String(endIso || '').trim();
    rec.sessions.push({
      appId: a,
      collectionId: c,
      startIso: start || nowIso(),
      endIso: end || nowIso(),
      durationMs: d,
    });

    const MAX_SESSIONS = 2000;
    if (rec.sessions.length > MAX_SESSIONS) {
      rec.sessions.splice(0, rec.sessions.length - MAX_SESSIONS);
    }

    persistence.markDirty({ kvKey: studyTimeKey });
    persistence.scheduleFlush();
    emitter.emit();
  }

  function getStudyTimeRecord() {
    return ensureStudyTimeRecord();
  }

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
    ensureStudyTimeRecord,
    recordAppCollectionStudySession,
    getStudyTimeRecord,
    getRecentStudySessions,
    getCollectionStudyStats,
    getAllCollectionsStudyStats,
    sumSessionDurations,
  };
}
