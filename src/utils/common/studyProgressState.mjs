function normalizeValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeWholeNumber(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function cloneObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : {};
}

export function normalizePersistedStudyState(value) {
  const normalized = normalizeValue(value);
  return (normalized === 'seen' || normalized === 'focus' || normalized === 'learned') ? normalized : null;
}

export function normalizeStudyViewState(value) {
  return normalizePersistedStudyState(value) || 'null';
}

export function hasLegacySeenSignal(record) {
  const rec = cloneObject(record);
  if (rec.seen === true) return true;
  if (normalizeWholeNumber(rec.timesSeen) > 0) return true;
  if (normalizeWholeNumber(rec.timeMs) > 0) return true;
  if (normalizeValue(rec.lastSeenIso)) return true;

  const apps = cloneObject(rec.apps);
  for (const appStats of Object.values(apps)) {
    const stats = cloneObject(appStats);
    if (normalizeWholeNumber(stats.timesSeen) > 0) return true;
    if (normalizeWholeNumber(stats.timeMs) > 0) return true;
    if (normalizeValue(stats.lastSeenIso)) return true;
  }

  return false;
}

export function resolveStudyRecordState(record) {
  const normalizedState = normalizePersistedStudyState(record?.state);
  if (normalizedState) return normalizedState;
  return hasLegacySeenSignal(record) ? 'seen' : null;
}

export function isStudyRecordSeen(record) {
  return resolveStudyRecordState(record) !== null;
}
