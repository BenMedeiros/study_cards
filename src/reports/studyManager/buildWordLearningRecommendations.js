import { buildGroupedLearningRecommendations } from './buildGroupedLearningRecommendations.js';

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

function buildRecommendationRoute(collectionId, fieldKey, token) {
  const coll = encodeURIComponent(String(collectionId || '').trim());
  const field = String(fieldKey || '').trim();
  const value = String(token || '').trim();
  if (!coll || !field || !value) return '';
  const filterKey = `{${field}:%${value}%}`;
  return '/data?collection=' + coll + '&heldTableSearch=' + encodeURIComponent(filterKey);
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
    extractGroups(entry) {
      return extractKanjiCharacters(entry?.kanji);
    },
    buildRoute({ collectionId, key }) {
      return buildRecommendationRoute(collectionId, primaryField, key);
    },
    title: 'Kanji Coverage',
  };
}

export function buildWordLearningRecommendations({
  collection,
  getEntryKey = () => '',
  getProgressRecord = () => null,
  reportConfig = null,
} = {}) {
  const metadataConfig = (collection?.metadata?.studyManagerRecommendations && typeof collection.metadata.studyManagerRecommendations === 'object')
    ? collection.metadata.studyManagerRecommendations
    : null;
  let config = (reportConfig && typeof reportConfig === 'object')
    ? reportConfig
    : metadataConfig;
  if (config && typeof config === 'object' && typeof config.extractGroups !== 'function' && typeof config.extractTokens === 'function') {
    config = { ...config, extractGroups: (...args) => config.extractTokens(...args) };
  }

  return buildGroupedLearningRecommendations({
    collection,
    getEntryKey,
    getProgressRecord,
    reportConfig: config || makeJapaneseWordConfig({
      collection,
      primaryField: 'kanji',
    }),
  });
}

export default buildWordLearningRecommendations;
