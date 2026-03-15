/**
 * Shared import feedback helpers.
 *
 * Builds a review-oriented feedback object from a base collection, normalized import
 * input, computed preview result, and optional schema validation output.
 */

import { detectCollectionArrayKey, inferEntryKeyField } from './collectionDiff.mjs';

function safeClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function jsonEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a).filter((key) => typeof a[key] !== 'undefined').sort();
    const bKeys = Object.keys(b).filter((key) => typeof b[key] !== 'undefined').sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
    }
    for (const key of aKeys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return a === b;
}

function isEmptyRelated(value) {
  try {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') {
      for (const item of Object.values(value)) {
        if (Array.isArray(item) && item.length) return false;
        if (item && typeof item === 'object') {
          if (Object.keys(item).length) return false;
        } else if (item != null) {
          return false;
        }
      }
      return true;
    }
  } catch {}
  return false;
}

function diffEntryFields(before, after) {
  const left = before && typeof before === 'object' ? before : {};
  const right = after && typeof after === 'object' ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const out = [];
  for (const key of keys) {
    if (key === 'relatedCollections') {
      if (isEmptyRelated(left[key]) && isEmptyRelated(right[key])) continue;
      if (!jsonEqual(left[key], right[key])) out.push(key);
      continue;
    }
    if (!jsonEqual(left[key], right[key])) out.push(key);
  }
  out.sort();
  return out;
}

function pickFields(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const key of keys) {
    if (typeof obj[key] !== 'undefined') out[key] = obj[key];
  }
  return out;
}

function pickEntrySummary(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const bits = [];
  if (typeof e.kanji === 'string' && e.kanji.trim()) bits.push(e.kanji.trim());
  if (typeof e.reading === 'string' && e.reading.trim()) bits.push(`(${e.reading.trim()})`);
  if (typeof e.ja === 'string' && e.ja.trim()) bits.push(e.ja.trim().slice(0, 24));
  if (typeof e.meaning === 'string' && e.meaning.trim()) bits.push(`- ${e.meaning.trim().slice(0, 40)}`);
  if (!bits.length && typeof e.name === 'string' && e.name.trim()) bits.push(e.name.trim().slice(0, 40));
  return bits.join(' ');
}

function buildEntryMap(entries, entryKeyField) {
  const map = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const key = entryKeyField && entry[entryKeyField] != null ? String(entry[entryKeyField]).trim() : '';
    if (!key || map.has(key)) continue;
    map.set(key, entry);
  }
  return map;
}

function buildValidationMaps(entryValidation) {
  const errorsById = new Map();
  const errorsByIndex = new Map();
  const errors = Array.isArray(entryValidation?.entryErrors) ? entryValidation.entryErrors : [];
  for (const item of errors) {
    if (!item) continue;
    const rawId = typeof item.id !== 'undefined' && item.id !== null ? String(item.id) : '';
    const message = item.message || String(item.message || '');
    if (!rawId) continue;
    if (rawId[0] === '#') {
      const index = parseInt(rawId.slice(1), 10);
      if (!Number.isNaN(index)) {
        const bucket = errorsByIndex.get(index) || [];
        bucket.push(message);
        errorsByIndex.set(index, bucket);
      }
      continue;
    }
    const bucket = errorsById.get(rawId) || [];
    bucket.push(message);
    errorsById.set(rawId, bucket);
    const trimmed = rawId.trim();
    if (trimmed && trimmed !== rawId) errorsById.set(trimmed, bucket);
  }
  return { errorsById, errorsByIndex };
}

function buildImportDuplicateSet(entries, entryKeyField) {
  const counts = new Map();
  const duplicates = new Set();
  if (!entryKeyField) return duplicates;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const key = entry[entryKeyField] != null ? String(entry[entryKeyField]).trim() : '';
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts.entries()) {
    if (count > 1) duplicates.add(key);
  }
  return duplicates;
}

function normalizeMessages({ previewWarnings, entryValidation } = {}) {
  const warnings = [];
  const seen = new Set();
  const sources = [
    ...(Array.isArray(previewWarnings) ? previewWarnings : []),
    ...(Array.isArray(entryValidation?.warnings) ? entryValidation.warnings : []),
  ];
  for (const item of sources) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    warnings.push(text);
  }
  return { warnings };
}

export function buildImportFeedback({
  collectionKey = '',
  baseCollection = null,
  input = null,
  previewResult = null,
  entryValidation = null,
  patchPayloadDetected = false,
} = {}) {
  const preview = previewResult && typeof previewResult === 'object' ? previewResult : {};
  const patch = preview.patch && typeof preview.patch === 'object' ? preview.patch : {};
  const diffs = preview.diffs && typeof preview.diffs === 'object' ? preview.diffs : {};
  const merged = preview.merged && typeof preview.merged === 'object' ? preview.merged : null;
  const base = baseCollection && typeof baseCollection === 'object' ? baseCollection : {};

  const arrayKey = String(diffs.arrayKey || patch.targetArrayKey || detectCollectionArrayKey(base).key || detectCollectionArrayKey(input).key || 'entries');
  const baseEntries = Array.isArray(base?.[arrayKey]) ? base[arrayKey] : [];
  const mergedEntries = Array.isArray(merged?.[arrayKey]) ? merged[arrayKey] : [];
  const inputEntries = Array.isArray(input?.[arrayKey]) ? input[arrayKey] : (Array.isArray(input) ? input : []);
  const entryKeyField = String(diffs.entryKeyField || patch.entryKeyField || inferEntryKeyField({ collection: base, arrayKey, entries: baseEntries }) || '').trim();

  const baseMap = buildEntryMap(baseEntries, entryKeyField);
  const mergedMap = buildEntryMap(mergedEntries, entryKeyField);
  const minimalMap = buildEntryMap(Array.isArray(patch?.entries?.upsertMinimal) ? patch.entries.upsertMinimal : [], entryKeyField);
  const removeKeys = Array.isArray(patch?.entries?.removeKeys) ? patch.entries.removeKeys.map((value) => String(value)) : [];

  const { errorsById, errorsByIndex } = buildValidationMaps(entryValidation);
  const duplicateImportKeys = buildImportDuplicateSet(inputEntries, entryKeyField);

  const edited = [];
  const added = [];
  const unchanged = [];
  const invalid = [];
  const removals = [];

  for (const [index, incoming] of inputEntries.entries()) {
    if (!incoming || typeof incoming !== 'object') {
      invalid.push({
        key: `#${index}`,
        summary: '',
        entry: safeClone(incoming) || incoming,
        reasons: ['Entry must be an object.'],
      });
      continue;
    }

    const key = entryKeyField && incoming[entryKeyField] != null ? String(incoming[entryKeyField]).trim() : '';
    const summary = pickEntrySummary(incoming);

    if (key && duplicateImportKeys.has(key)) {
      invalid.push({
        key,
        summary,
        entry: safeClone(incoming) || incoming,
        reasons: ['dupkey in import'],
      });
      continue;
    }

    let reasons = [];
    if (key && errorsById.has(key)) reasons = errorsById.get(key) || [];
    if (!reasons.length && errorsByIndex.has(index)) reasons = errorsByIndex.get(index) || [];
    if (!reasons.length && entryKeyField && !key) reasons = [`missing '${entryKeyField}'`];
    if (reasons.length) {
      invalid.push({
        key: key || `#${index}`,
        summary,
        entry: safeClone(incoming) || incoming,
        reasons: reasons.slice(),
      });
      continue;
    }

    let before = null;
    let after = incoming;
    let isNew = true;

    if (entryKeyField) {
      before = key ? (baseMap.get(key) || null) : null;
      after = key ? (mergedMap.get(key) || incoming) : incoming;
      isNew = !before;
    } else {
      before = baseEntries.find((entry) => deepEqual(entry, incoming)) || null;
      isNew = !before;
    }

    const changedFields = before ? diffEntryFields(before, after) : [];
    if (before && (deepEqual(before, after) || !changedFields.length)) {
      unchanged.push({
        key: key || `#${index}`,
        summary,
        entry: safeClone(after) || after,
      });
      continue;
    }

    const minimalAfter = key && minimalMap.has(key)
      ? minimalMap.get(key)
      : (!isNew && changedFields.length ? pickFields(after, changedFields) : (isNew ? (safeClone(incoming) || incoming) : null));

    const item = {
      key: key || `#${index}`,
      summary,
      before: before ? (safeClone(before) || before) : null,
      after: safeClone(after) || after,
      changedFields: changedFields.slice(),
      minimalBefore: before && changedFields.length ? pickFields(before, changedFields) : null,
      minimalAfter: minimalAfter ? (safeClone(minimalAfter) || minimalAfter) : null,
    };
    if (isNew) added.push(item);
    else edited.push(item);
  }

  for (const key of removeKeys) {
    removals.push({
      key,
      before: baseMap.get(key) ? (safeClone(baseMap.get(key)) || baseMap.get(key)) : null,
    });
  }

  edited.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ja'));
  added.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ja'));
  unchanged.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ja'));
  invalid.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ja'));
  removals.sort((a, b) => String(a.key).localeCompare(String(b.key), 'ja'));

  const messages = normalizeMessages({ previewWarnings: preview.warnings, entryValidation });

  return {
    collectionKey: String(collectionKey || '').trim() || null,
    patchPayloadDetected: !!patchPayloadDetected,
    arrayKey,
    entryKeyField: entryKeyField || null,
    messages,
    summary: {
      edited: edited.length,
      added: added.length,
      unchanged: unchanged.length,
      invalid: invalid.length,
      removals: removals.length,
      metadataChanges: Number(diffs.metadataChanges || 0),
      schemaChanges: Number(diffs.schemaChanges || 0),
    },
    edited,
    added,
    unchanged,
    invalid,
    removals,
    validation: safeClone(entryValidation) || { entryErrors: [], entryWarnings: [], warnings: [] },
  };
}

export default {
  buildImportFeedback,
};