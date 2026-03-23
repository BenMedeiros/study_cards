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

export function buildStudyTimeByDate({ byDay, filterMap, dayLimit = 14, nowMs = Date.now(), makeFilterLabel = (key) => key || '(no filter)' } = {}) {
  const { todayStamp, yesterdayStamp } = getTodayYesterdayStamps(nowMs);

  return Array.from(byDay instanceof Map ? byDay.values() : [])
    .sort((a, b) => String(b.dayStamp).localeCompare(String(a.dayStamp)))
    .slice(0, Math.max(1, Math.round(Number(dayLimit) || 14)))
    .map((day) => ({
      dayStamp: day.dayStamp || dayStampFromIso(''),
      dayLabel: formatDayLabel(day.dayStamp, { todayStamp, yesterdayStamp }),
      totalDurationMs: day.totalDurationMs,
      sessionCount: day.sessionCount,
      filterCount: day.filterSummaries instanceof Map ? day.filterSummaries.size : 0,
      filterSummaries: Array.from(day.filterSummaries instanceof Map ? day.filterSummaries.values() : [])
        .sort((a, b) => {
          if (b.durationMs !== a.durationMs) return b.durationMs - a.durationMs;
          return String(a.filterKey || '').localeCompare(String(b.filterKey || ''));
        })
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
}

export default buildStudyTimeByDate;
