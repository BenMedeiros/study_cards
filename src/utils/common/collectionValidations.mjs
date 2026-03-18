/**
 * Shared collection validation/report helpers.
 *
 * Works on parsed collection objects or maps/lists of parsed collection objects,
 * not on raw JSON text. These validations inspect collection structure and relation
 * references before any runtime related-collection object pointers are required.
 */

import {
  extractCollectionRecords,
  extractPathValues,
  normalizeCollectionBlob,
  normalizeRelatedCollectionsConfig,
  resolveRelatedCollectionPath,
} from './collectionParser.mjs';

function truncate(text, max = 100) {
  if (typeof text !== 'string') return String(text);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function getCollectionLabel(collection, fallbackPath) {
  return collection?.metadata?.name || fallbackPath || '(unknown collection)';
}

function getEntryLabel(entry, entryKey) {
  const parts = [];
  if (entry?.title) parts.push(entry.title);
  if (entryKey && entry?.[entryKey] !== undefined && entry?.[entryKey] !== null) parts.push(String(entry[entryKey]));
  else if (entry?.ja) parts.push(entry.ja);
  else if (entry?.kanji) parts.push(entry.kanji);
  else if (entry?.pattern) parts.push(entry.pattern);
  else if (entry?.englishName) parts.push(entry.englishName);
  else if (entry?.language) parts.push(entry.language);
  return parts.join(' | ') || '(unlabeled entry)';
}

function isValidEntryKeyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return false;
}

function formatKeyValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function normalizeCollectionRecord(value, fallbackKey = '') {
  const raw = value && typeof value === 'object' ? value : null;
  const collection = raw && raw.collection && typeof raw.collection === 'object'
    ? raw.collection
    : (raw && raw.data && typeof raw.data === 'object' ? raw.data : raw);
  if (!collection || typeof collection !== 'object') return null;
  const key = String(raw?.key || raw?.path || raw?.collectionKey || fallbackKey || '').trim();
  const path = String(raw?.path || raw?.key || raw?.collectionPath || key || fallbackKey || '').trim();
  return {
    key: key || path,
    path: path || key,
    collection: normalizeCollectionBlob(collection),
  };
}

export function normalizeCollectionSet(collections) {
  const out = [];

  if (collections instanceof Map) {
    for (const [key, value] of collections.entries()) {
      const record = normalizeCollectionRecord(value, key);
      if (record) out.push(record);
    }
  } else if (Array.isArray(collections)) {
    for (let index = 0; index < collections.length; index += 1) {
      const record = normalizeCollectionRecord(collections[index], String(index));
      if (record) out.push(record);
    }
  } else if (collections && typeof collections === 'object') {
    for (const [key, value] of Object.entries(collections)) {
      const record = normalizeCollectionRecord(value, key);
      if (record) out.push(record);
    }
  }

  out.sort((a, b) => String(a.path || a.key).localeCompare(String(b.path || b.key), 'ja'));
  return out;
}

function buildCollectionRecordMap(records) {
  const map = new Map();
  for (const record of records) {
    const keys = [record?.path, record?.key].filter(Boolean);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, record);
    }
  }
  return map;
}

function inspectCollectionForDuplicatedKeys(record) {
  const collection = normalizeCollectionBlob(record?.collection);
  const metadata = collection?.metadata || {};
  const entries = extractCollectionRecords(collection);
  const entryKey = typeof metadata.entry_key === 'string' && metadata.entry_key.trim()
    ? metadata.entry_key.trim()
    : null;
  const schema = Array.isArray(metadata.schema) ? metadata.schema : [];
  const schemaKeys = new Set(schema.map((field) => field?.key).filter(Boolean));
  const invalidEntries = [];
  const seenValues = new Map();

  const hasEntryKey = !!entryKey;
  const schemaHasEntryKey = entryKey ? schemaKeys.has(entryKey) : false;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const value = entryKey ? entry?.[entryKey] : undefined;

    if (!isValidEntryKeyValue(value)) {
      invalidEntries.push({
        index,
        label: truncate(getEntryLabel(entry, entryKey)),
        reason: entryKey
          ? `Missing or invalid \`${entryKey}\` value`
          : 'Collection metadata.entry_key is missing or invalid'
      });
      continue;
    }

    const comparableValue = formatKeyValue(value);
    if (!seenValues.has(comparableValue)) seenValues.set(comparableValue, []);
    seenValues.get(comparableValue).push({
      index,
      label: truncate(getEntryLabel(entry, entryKey))
    });
  }

  const duplicates = [...seenValues.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([value, matches]) => ({
      value,
      count: matches.length,
      entries: matches
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ja'));

  return {
    collectionName: getCollectionLabel(collection, record?.path || record?.key || ''),
    collectionPath: `collections/${record?.path || record?.key || ''}`,
    entryKey,
    entryCount: entries.length,
    hasValidEntryKeyMetadata: hasEntryKey,
    schemaHasEntryKey,
    invalidEntryCount: invalidEntries.length,
    duplicateValueCount: duplicates.length,
    duplicateEntryCount: duplicates.reduce((sum, item) => sum + item.count, 0),
    invalidEntries,
    duplicates,
  };
}

function buildKnownValueSet(collection, key) {
  if (!key) return new Set();
  return new Set(
    extractCollectionRecords(collection)
      .map((entry) => entry?.[key])
      .filter((value) => typeof value === 'string' && value.trim())
  );
}

function collectMissingRefs(sourceCollection, relatedCollection, relation) {
  const sourceKey = relation.this_key || sourceCollection.metadata?.entry_key;
  const knownValues = buildKnownValueSet(sourceCollection, sourceKey);
  const missing = new Set();

  for (const entry of extractCollectionRecords(relatedCollection)) {
    const refs = extractPathValues(entry, relation.foreign_key);

    for (const ref of refs) {
      if (typeof ref !== 'string' || !ref.trim()) continue;
      if (knownValues.has(ref)) continue;
      missing.add(ref);
    }
  }

  return [...missing].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function validateDuplicatedKeys(collections) {
  const records = normalizeCollectionSet(collections);
  const reports_clean = [];
  const reports_review = [];

  let collectionsWithProblems = 0;
  let collectionsWithInvalidEntryKey = 0;
  let collectionsWithSchemaMismatch = 0;
  let totalInvalidEntries = 0;
  let totalDuplicateValues = 0;
  let totalDuplicateEntries = 0;

  for (const record of records) {
    const report = inspectCollectionForDuplicatedKeys(record);
    const hasProblem =
      !report.hasValidEntryKeyMetadata ||
      !report.schemaHasEntryKey ||
      report.invalidEntryCount > 0 ||
      report.duplicateValueCount > 0;

    if (hasProblem) {
      reports_review.push(report);
      collectionsWithProblems += 1;
    } else {
      reports_clean.push(report);
    }

    if (!report.hasValidEntryKeyMetadata) collectionsWithInvalidEntryKey += 1;
    if (report.hasValidEntryKeyMetadata && !report.schemaHasEntryKey) collectionsWithSchemaMismatch += 1;
    totalInvalidEntries += report.invalidEntryCount;
    totalDuplicateValues += report.duplicateValueCount;
    totalDuplicateEntries += report.duplicateEntryCount;
  }

  return {
    generatedAt: new Date().toISOString(),
    scannedCollections: records.length,
    collectionsWithProblems,
    collectionsWithInvalidEntryKey,
    collectionsWithSchemaMismatch,
    totalInvalidEntries,
    totalDuplicateValues,
    totalDuplicateEntries,
    reports_clean,
    reports_review,
  };
}

export function validateMissingRelatedCollectionData(collections) {
  const records = normalizeCollectionSet(collections);
  const recordsByKey = buildCollectionRecordMap(records);

  let relationCount = 0;
  let collectionsWithRelations = 0;
  let missingRelationCount = 0;
  let missingRefTotal = 0;
  const reports = [];

  for (const record of records) {
    const sourceCollection = normalizeCollectionBlob(record.collection);
    const relations = normalizeRelatedCollectionsConfig(sourceCollection?.metadata?.relatedCollections);
    if (!relations.length) continue;

    collectionsWithRelations += 1;
    relationCount += relations.length;

    const sourcePath = record?.path || record?.key || '';
    const sourceReport = {
      sourceName: getCollectionLabel(sourceCollection, sourcePath),
      sourcePath: `collections/${sourcePath}`,
      relations: []
    };

    for (const relation of relations) {
      const relatedPath = resolveRelatedCollectionPath(sourcePath, relation.path);
      const relatedRecord = recordsByKey.get(relatedPath);
      const relationReport = {
        name: relation.name || relatedPath,
        thisKey: relation.this_key || sourceCollection.metadata?.entry_key || null,
        foreignKey: relation.foreign_key || null,
        relatedPath: `collections/${relatedPath}`,
        missing: []
      };

      if (!relatedRecord) {
        relationReport.error = 'Unable to load related collection';
        missingRelationCount += 1;
        sourceReport.relations.push(relationReport);
        continue;
      }

      const relatedCollection = normalizeCollectionBlob(relatedRecord.collection);
      const missing = collectMissingRefs(sourceCollection, relatedCollection, relation);
      relationReport.missing = missing;
      if (missing.length > 0) {
        missingRelationCount += 1;
        missingRefTotal += missing.length;
      }
      sourceReport.relations.push(relationReport);
    }

    reports.push(sourceReport);
  }

  return {
    generatedAt: new Date().toISOString(),
    scannedCollections: records.length,
    collectionsWithRelations,
    relationCount,
    missingRelationCount,
    missingRefTotal,
    reports,
  };
}

export default {
  normalizeCollectionSet,
  validateDuplicatedKeys,
  validateMissingRelatedCollectionData,
};
