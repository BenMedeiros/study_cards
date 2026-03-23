export function buildStudyTimeByDateSummary({ collectionId, studyTimeByDate, windowDays = 7 } = {}) {
  const days = Array.isArray(studyTimeByDate) ? studyTimeByDate : [];
  const normalizedWindowDays = Math.max(1, Math.round(Number(windowDays) || 7));
  const recentDays = days.slice(0, normalizedWindowDays);
  return {
    collectionId: String(collectionId || '').trim(),
    totalDays: days.length,
    windowDays: normalizedWindowDays,
    totalDurationMs: recentDays.reduce((sum, day) => sum + Math.max(0, Math.round(Number(day?.totalDurationMs) || 0)), 0),
    totalSessions: recentDays.reduce((sum, day) => sum + Math.max(0, Math.round(Number(day?.sessionCount) || 0)), 0),
    activeDays: recentDays.filter((day) => Math.max(0, Math.round(Number(day?.totalDurationMs) || 0)) > 0).length,
  };
}

export default buildStudyTimeByDateSummary;
