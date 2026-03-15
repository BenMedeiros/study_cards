/**
 * Shared collection import parsing helpers.
 *
 * Works on raw import strings and parsed JSON objects, not on browser UI state.
 * Handles loose JSON parsing, patch payload unwrapping, and normalization into an
 * input shape suitable for collection diff computation.
 */

import { detectCollectionArrayKey } from './collectionDiff.mjs';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCollectionKeyRef(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^\.\//, '');
  s = s.replace(/^collections\//, '');
  return s;
}

export function scrubRawText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  const firstBrace = Math.min(
    ...['{', '['].map((ch) => {
      const i = s.indexOf(ch);
      return i === -1 ? Infinity : i;
    })
  );
  if (firstBrace === Infinity) return s;
  s = s.slice(firstBrace);
  const lastBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (lastBrace !== -1) s = s.slice(0, lastBrace + 1);
  return s.trim();
}

export function fixAdjacentObjects(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/}\s*{/g, '},{').replace(/\]\s*\[/g, '],[');
}

export function extractTopLevelObjects(text) {
  const out = [];
  if (!text || typeof text !== 'string') return out;
  const len = text.length;
  let i = 0;
  while (i < len) {
    while (i < len && text[i] !== '{' && text[i] !== '[') i += 1;
    if (i >= len) break;
    const startChar = text[i];
    const endChar = startChar === '{' ? '}' : ']';
    let depth = 0;
    let j = i;
    for (; j < len; j += 1) {
      const ch = text[j];
      if (ch === startChar) depth += 1;
      else if (ch === endChar) depth -= 1;
      else if (ch === '"') {
        j += 1;
        while (j < len && text[j] !== '"') {
          if (text[j] === '\\') j += 2;
          else j += 1;
        }
      }
      if (depth === 0) break;
    }
    if (depth === 0) {
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      break;
    }
  }
  return out;
}

export function tryParseJsonLoose(raw) {
  if (raw == null) return null;
  let s = String(raw);
  try { return JSON.parse(s); } catch {}

  s = scrubRawText(s);
  s = fixAdjacentObjects(s);
  try { return JSON.parse(s); } catch {}

  const objs = extractTopLevelObjects(s).map((x) => x.trim()).filter(Boolean);
  if (objs.length === 1) {
    try { return JSON.parse(objs[0]); } catch {}
  }
  if (objs.length > 1) {
    try { return JSON.parse(`[${objs.join(',')}]`); } catch {}
  }

  const cleaned = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(cleaned); } catch {}

  return null;
}

export function hasRelatedCollections(value) {
  try {
    if (!value) return false;
    if (Array.isArray(value)) return value.some(hasRelatedCollections);
    if (typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'relatedCollections')) {
        const rel = value.relatedCollections;
        if (rel && typeof rel === 'object') {
          for (const item of Object.values(rel)) {
            if (Array.isArray(item) && item.length) return true;
          }
          return true;
        }
      }
      for (const nested of Object.values(value)) {
        if (hasRelatedCollections(nested)) return true;
      }
    }
  } catch {}
  return false;
}

export function unwrapPatchPayload({ parsed, collectionKey = '', defaultArrayKey = 'entries' } = {}) {
  const root = isObject(parsed) ? parsed : null;
  const candidate = isObject(root?.patch) ? root.patch : root;
  const detectedTarget = normalizeCollectionKeyRef(
    root?.collectionKey || root?.targetCollectionKey || root?.collection || root?.path ||
    candidate?.collectionKey || candidate?.targetCollectionKey || candidate?.collection || candidate?.path
  );

  const looksLikePatchPayload = !!(
    candidate &&
    typeof candidate === 'object' &&
    candidate.entries &&
    typeof candidate.entries === 'object' &&
    (
      Array.isArray(candidate.entries.upsert) ||
      Array.isArray(candidate.entries.upsertMinimal) ||
      Array.isArray(candidate.entries.removeKeys)
    ) &&
    (
      typeof candidate.targetArrayKey === 'string' ||
      typeof candidate.entryKeyField === 'string'
    )
  );

  if (!looksLikePatchPayload) {
    return {
      parsed,
      patchPayloadDetected: false,
      patchTargetCollectionKey: detectedTarget,
    };
  }

  const activeCollectionKey = normalizeCollectionKeyRef(collectionKey);
  if (detectedTarget && activeCollectionKey && detectedTarget !== activeCollectionKey) {
    throw new Error(`Patch payload target mismatch: ${detectedTarget} (patch) vs ${activeCollectionKey} (active).`);
  }

  const arrayKey = (typeof candidate.targetArrayKey === 'string' && candidate.targetArrayKey.trim())
    ? candidate.targetArrayKey.trim()
    : String(defaultArrayKey || 'entries');
  const upsert = Array.isArray(candidate?.entries?.upsert) ? candidate.entries.upsert : [];

  return {
    parsed: { [arrayKey]: upsert },
    patchPayloadDetected: true,
    patchTargetCollectionKey: detectedTarget,
  };
}

export function unwrapImportFeedbackPayload({ parsed, defaultArrayKey = 'entries' } = {}) {
  const arrayKey = String(defaultArrayKey || 'entries').trim() || 'entries';

  if (Array.isArray(parsed)) {
    const extracted = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        if (item.after && typeof item.after === 'object' && !Array.isArray(item.after)) return item.after;
        if (item.entry && typeof item.entry === 'object' && !Array.isArray(item.entry)) return item.entry;
        return null;
      })
      .filter(Boolean);
    if (extracted.length) {
      return { parsed: { [arrayKey]: extracted }, importFeedbackDetected: true };
    }
    return { parsed, importFeedbackDetected: false };
  }

  if (!isObject(parsed)) {
    return { parsed, importFeedbackDetected: false };
  }

  const feedbackBuckets = ['added', 'edited', 'new', 'unchanged'];
  const extracted = [];
  for (const bucket of feedbackBuckets) {
    const list = Array.isArray(parsed[bucket]) ? parsed[bucket] : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      if (item.after && typeof item.after === 'object' && !Array.isArray(item.after)) extracted.push(item.after);
      else if (item.entry && typeof item.entry === 'object' && !Array.isArray(item.entry)) extracted.push(item.entry);
    }
  }
  if (extracted.length) {
    return { parsed: { [arrayKey]: extracted }, importFeedbackDetected: true };
  }

  return { parsed, importFeedbackDetected: false };
}

export function normalizeImportJson({ parsed, defaultArrayKey = 'entries', allowFullCollection = false } = {}) {
  const arrayKeyFallback = String(defaultArrayKey || 'entries').trim() || 'entries';
  if (Array.isArray(parsed)) return { [arrayKeyFallback]: parsed };
  if (!isObject(parsed)) return parsed;

  const copy = { ...parsed };
  const hasMetadata = Object.prototype.hasOwnProperty.call(copy, 'metadata');
  const hasSchema = Object.prototype.hasOwnProperty.call(copy, 'schema');
  const entryKeys = ['entries', 'entry', 'sentences', 'paragraphs', 'items', 'cards'];
  const explicitEntryKey = entryKeys.find((key) => Object.prototype.hasOwnProperty.call(copy, key)) || null;
  const detectedEntryKey = explicitEntryKey || detectCollectionArrayKey(copy).key || null;

  if (detectedEntryKey) {
    const normalizedKey = detectedEntryKey === 'entry' ? arrayKeyFallback : detectedEntryKey;
    const currentValue = copy[detectedEntryKey];
    if (Array.isArray(currentValue)) copy[normalizedKey] = currentValue;
    else if (currentValue && typeof currentValue === 'object') copy[normalizedKey] = [currentValue];
    if (normalizedKey !== detectedEntryKey) delete copy[detectedEntryKey];

    if (!allowFullCollection) {
      delete copy.metadata;
      delete copy.schema;
    }
    return copy;
  }

  if (hasMetadata || hasSchema) {
    if (allowFullCollection) return copy;
    throw new Error('Import only supports entries now. Metadata and schema changes must be made in the codebase.');
  }

  return { [arrayKeyFallback]: [copy] };
}

export function parseCollectionImportInput({
  rawInput,
  collectionKey = '',
  defaultArrayKey = 'entries',
  allowFullCollection = false,
} = {}) {
  const parsed = tryParseJsonLoose(rawInput);
  if (parsed == null) throw new Error('Invalid JSON: unable to parse input after cleanup.');

  const unwrapped = unwrapPatchPayload({ parsed, collectionKey, defaultArrayKey });
  const feedbackUnwrapped = unwrapImportFeedbackPayload({ parsed: unwrapped.parsed, defaultArrayKey });
  if (hasRelatedCollections(feedbackUnwrapped.parsed)) {
    throw new Error('Import contains relatedCollections — not supported yet (TODO).');
  }

  return {
    parsed: feedbackUnwrapped.parsed,
    input: normalizeImportJson({
      parsed: feedbackUnwrapped.parsed,
      defaultArrayKey,
      allowFullCollection,
    }),
    patchPayloadDetected: !!unwrapped.patchPayloadDetected,
    patchTargetCollectionKey: unwrapped.patchTargetCollectionKey || '',
    importFeedbackDetected: !!feedbackUnwrapped.importFeedbackDetected,
  };
}

export default {
  normalizeCollectionKeyRef,
  scrubRawText,
  fixAdjacentObjects,
  extractTopLevelObjects,
  tryParseJsonLoose,
  hasRelatedCollections,
  unwrapPatchPayload,
  unwrapImportFeedbackPayload,
  normalizeImportJson,
  parseCollectionImportInput,
};