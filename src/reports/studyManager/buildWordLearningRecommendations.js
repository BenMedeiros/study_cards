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

function makeJapaneseWordConfig({ collection, primaryField }) {
  const category = String(collection?.metadata?.category || '').trim();
  const isGrammar = category === 'japanese.grammar' || category.endsWith('.grammar') || category.includes('.grammar.');
  if (isGrammar || primaryField !== 'kanji') return null;

  return {
    id: 'kanjiCoverage',
    tokenLabel: 'Kanji',
    primaryField,
    minimumEntryCountOptions: [5, 10, 15],
    defaultMinimumEntryCount: 5,
    defaultSortKey: 'focusCountDesc',
    sortOptions: [
      { key: 'focusCountDesc', label: 'Focus' },
      { key: 'remainingCountDesc', label: 'Remaining' },
    ],
    extractTokens(entry) {
      return extractKanjiCharacters(entry?.kanji);
    },
    buildRoute({ collectionId, token }) {
      return buildRecommendationRoute(collectionId, primaryField, token);
    },
  };
}

function resolveRecommendationConfig({ collection, primaryField, reportConfig }) {
  const metadataConfig = (collection?.metadata?.studyManagerRecommendations && typeof collection.metadata.studyManagerRecommendations === 'object')
    ? collection.metadata.studyManagerRecommendations
    : null;
  const src = (reportConfig && typeof reportConfig === 'object') ? reportConfig : metadataConfig;
  if (src) {
    return {
      ...src,
      minimumEntryCountOptions: resolveMinimumCountOptions(src.minimumEntryCountOptions),
    };
  }
  return makeJapaneseWordConfig({ collection, primaryField });
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
    return String(a.token || '').localeCompare(String(b.token || ''));
  });
  return rows;
}

export function buildWordLearningRecommendations({
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

  const config = resolveRecommendationConfig({ collection, primaryField, reportConfig });
  if (!config || typeof config.extractTokens !== 'function') return null;

  const tokenBuckets = new Map();
  let sourceEntryCount = 0;
  let tokenizedEntryCount = 0;

  for (const entry of entries) {
    const label = getEntryLabel(entry, primaryField);
    if (!label) continue;
    sourceEntryCount += 1;

    const extractedTokens = config.extractTokens(entry, { collection, primaryField, label });
    const tokens = Array.isArray(extractedTokens) ? extractedTokens : [];
    const uniqueTokens = Array.from(new Set(tokens.map((token) => String(token || '').trim()).filter(Boolean)));
    if (!uniqueTokens.length) continue;
    tokenizedEntryCount += 1;

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

    for (const token of uniqueTokens) {
      if (!tokenBuckets.has(token)) tokenBuckets.set(token, { token, words: [] });
      tokenBuckets.get(token).words.push(wordInfo);
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

  const items = Array.from(tokenBuckets.values()).map((bucket) => {
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
    const samples = bucket.words
      .slice()
      .sort((a, b) => {
        const stateOrder = { focus: 0, null: 1, learned: 2 };
        const byState = (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9);
        if (byState !== 0) return byState;
        return String(a.label || '').localeCompare(String(b.label || ''));
      })
      .slice(0, 5)
      .map((word) => ({
        label: word.label,
        reading: word.reading,
        meaning: word.meaning,
        type: word.type,
        state: word.state,
        seen: word.seen,
      }));

    return {
      token: bucket.token,
      totalCount,
      seenCount,
      focusCount,
      learnedCount,
      remainingCount,
      route: typeof config.buildRoute === 'function'
        ? String(config.buildRoute({ collectionId, token: bucket.token, primaryField, collection }) || '').trim()
        : '',
      sampleWords: samples,
    };
  });

  const eligibleItemCount = items.filter((item) => item.totalCount >= defaultMinimumEntryCount).length;
  const sortedItems = sortRecommendationItems(items, defaultSortKey);

  return {
    summary: {
      sourceEntryCount,
      tokenizedEntryCount,
      itemCount: items.length,
      eligibleItemCount,
      primaryField,
      tokenLabel: String(config.tokenLabel || 'Token'),
    },
    config: {
      id: String(config.id || '').trim() || 'recommendations',
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

export default buildWordLearningRecommendations;
