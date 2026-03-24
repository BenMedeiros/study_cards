function normalizeState(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'focus' || s === 'learned') return s;
  return 'null';
}

function hasSeenProgress(rec) {
  const timesSeen = Math.max(0, Math.round(Number(rec?.timesSeen) || 0));
  const timeMs = Math.max(0, Math.round(Number(rec?.timeMs) || 0));
  return !!rec?.seen || timesSeen > 0 || timeMs > 0;
}

function resolveMinimumCountOptions(input) {
  const raw = Array.isArray(input) ? input : [5, 10, 15];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const n = Math.max(1, Math.round(Number(value) || 0));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out.length ? out : [5, 10, 15];
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

function normalizeGroupItem(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    const value = String(raw).trim();
    if (!value) return null;
    return { key: value, label: value };
  }
  if (typeof raw !== 'object') return null;

  const key = String(raw.key ?? raw.id ?? raw.value ?? raw.label ?? '').trim();
  if (!key) return null;
  const label = String(raw.label ?? raw.text ?? raw.value ?? raw.id ?? key).trim() || key;
  const route = String(raw.route ?? '').trim();
  return { ...raw, key, label, route };
}

function sortRecommendationItems(items, sortKey) {
  const rows = Array.isArray(items) ? items.slice() : [];
  rows.sort((a, b) => {
    if (sortKey === 'remainingCountDesc') {
      if (b.remainingCount !== a.remainingCount) return b.remainingCount - a.remainingCount;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      if (b.focusCount !== a.focusCount) return b.focusCount - a.focusCount;
    } else {
      if (b.focusCount !== a.focusCount) return b.focusCount - a.focusCount;
      if (b.remainingCount !== a.remainingCount) return b.remainingCount - a.remainingCount;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    }
    return String(a.label || a.token || '').localeCompare(String(b.label || b.token || ''));
  });
  return rows;
}

export function buildGroupedLearningRecommendations({
  collection,
  getEntryKey = () => '',
  getProgressRecord = () => null,
  reportConfig = null,
} = {}) {
  const collectionId = String(collection?.key || '').trim();
  if (!collectionId) return null;

  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  if (!entries.length) return null;

  const primaryField = detectWordField(collection);
  if (!primaryField) return null;

  const config = (reportConfig && typeof reportConfig === 'object') ? reportConfig : null;
  if (!config || typeof config.extractGroups !== 'function') return null;

  const groupBuckets = new Map();
  let sourceEntryCount = 0;
  let groupedEntryCount = 0;

  for (const entry of entries) {
    const label = getEntryLabel(entry, primaryField);
    if (!label) continue;
    sourceEntryCount += 1;

    const extractedGroups = config.extractGroups(entry, { collection, primaryField, label });
    const groups = Array.isArray(extractedGroups)
      ? extractedGroups.map(normalizeGroupItem).filter(Boolean)
      : [];
    if (!groups.length) continue;
    groupedEntryCount += 1;

    const uniqueGroups = [];
    const groupKeys = new Set();
    for (const group of groups) {
      if (groupKeys.has(group.key)) continue;
      groupKeys.add(group.key);
      uniqueGroups.push(group);
    }

    const entryKey = String(getEntryKey(entry) || '').trim();
    const rec = entryKey ? getProgressRecord(entryKey) : null;
    const state = rec ? normalizeState(rec.state) : 'null';
    const seen = hasSeenProgress(rec);

    const wordInfo = {
      label,
      reading: entry?.reading != null ? String(entry.reading).trim() : '',
      meaning: entry?.meaning != null ? String(entry.meaning).trim() : '',
      type: entry?.type != null ? String(entry.type).trim() : '',
      state,
      seen,
    };

    for (const group of uniqueGroups) {
      if (!groupBuckets.has(group.key)) {
        groupBuckets.set(group.key, {
          key: group.key,
          label: group.label,
          route: String(group.route || '').trim(),
          words: [],
        });
      }
      const bucket = groupBuckets.get(group.key);
      if (!bucket.label && group.label) bucket.label = group.label;
      if (!bucket.route && group.route) bucket.route = String(group.route).trim();
      bucket.words.push(wordInfo);
    }
  }

  const minimumEntryCountOptions = resolveMinimumCountOptions(config.minimumEntryCountOptions);
  const defaultMinimumEntryCount = minimumEntryCountOptions.includes(Math.max(1, Math.round(Number(config.defaultMinimumEntryCount) || 0)))
    ? Math.max(1, Math.round(Number(config.defaultMinimumEntryCount) || 0))
    : minimumEntryCountOptions[0];
  const sortOptions = Array.isArray(config.sortOptions) && config.sortOptions.length
    ? config.sortOptions.map((item) => ({ key: String(item?.key || '').trim(), label: String(item?.label || item?.key || '').trim() })).filter((item) => item.key)
    : [{ key: 'focusCountDesc', label: 'Focus' }];
  const defaultSortKey = sortOptions.some((item) => item.key === String(config.defaultSortKey || '').trim())
    ? String(config.defaultSortKey || '').trim()
    : sortOptions[0].key;

  const items = Array.from(groupBuckets.values()).map((bucket) => {
    let seenCount = 0;
    let focusCount = 0;
    let learnedCount = 0;
    for (const word of bucket.words) {
      if (word.seen) seenCount += 1;
      if (word.state === 'focus') focusCount += 1;
      if (word.state === 'learned') learnedCount += 1;
    }
    const totalCount = bucket.words.length;
    const remainingCount = Math.max(0, totalCount - focusCount - learnedCount);
    const words = bucket.words
      .slice()
      .sort((a, b) => {
        const stateOrder = { focus: 0, null: 1, learned: 2 };
        const byState = (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9);
        if (byState !== 0) return byState;
        return String(a.label || '').localeCompare(String(b.label || ''));
      })
      .map((word) => ({
        label: word.label,
        reading: word.reading,
        meaning: word.meaning,
        type: word.type,
        state: word.state,
        seen: word.seen,
      }));

    return {
      key: bucket.key,
      token: bucket.label,
      label: bucket.label,
      totalCount,
      seenCount,
      focusCount,
      learnedCount,
      remainingCount,
      route: typeof config.buildRoute === 'function'
        ? String(config.buildRoute({ collectionId, key: bucket.key, label: bucket.label, group: bucket, primaryField, collection }) || bucket.route || '').trim()
        : bucket.route,
      wordsRoute: typeof config.buildWordsRoute === 'function'
        ? String(config.buildWordsRoute({ collectionId, key: bucket.key, label: bucket.label, group: bucket, primaryField, collection }) || '').trim()
        : '',
      words,
      sampleWords: words.slice(0, 5),
    };
  });

  const eligibleItemCount = items.filter((item) => item.totalCount >= defaultMinimumEntryCount).length;
  const sortedItems = sortRecommendationItems(items, defaultSortKey);

  return {
    summary: {
      sourceEntryCount,
      groupedEntryCount,
      itemCount: items.length,
      eligibleItemCount,
      primaryField,
      tokenLabel: String(config.tokenLabel || 'Token'),
      title: String(config.title || ''),
    },
    config: {
      id: String(config.id || '').trim() || 'recommendations',
      title: String(config.title || '').trim() || 'Recommendations',
      primaryField,
      tokenLabel: String(config.tokenLabel || 'Token'),
      minimumEntryCountOptions,
      defaultMinimumEntryCount,
      sortOptions,
      defaultSortKey,
    },
    items: sortedItems,
  };
}

export default buildGroupedLearningRecommendations;
