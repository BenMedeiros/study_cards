const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TAGGING_MAPPINGS = [
  {
    sourceFile: 'collections/pokemon/pokemon.json',
    field: 'type',
    targetFile: 'collections/japanese/words/combined_words.json',
    targetMatchField: 'kanji',
    tag: 'pokemon-type',
  },
  {
    sourceFile: 'collections/pokemon/pokemon.json',
    field: 'japaneseNameRoots',
    targetFile: 'collections/japanese/words/combined_words.json',
    targetMatchField: 'kanji',
    tag: 'pokemon-name-root',
  }
];

function readJson(relativePath) {
  const abs = path.resolve(ROOT, relativePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const json = JSON.parse(raw);
  return { abs, json };
}

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function valuesFromEntryField(entry, field) {
  const raw = entry?.[field];
  if (Array.isArray(raw)) {
    return raw.map(normalizeString).filter(Boolean);
  }
  const single = normalizeString(raw);
  return single ? [single] : [];
}

function ensureTag(entry, tag) {
  const existing = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === 'string') : [];
  if (existing.includes(tag)) return false;
  entry.tags = [...existing, tag];
  return true;
}

function applyMapping(mapping) {
  const { json: sourceJson } = readJson(mapping.sourceFile);
  const { abs: targetAbs, json: targetJson } = readJson(mapping.targetFile);

  if (!Array.isArray(sourceJson.entries)) {
    throw new Error(`Expected entries[] in source file: ${mapping.sourceFile}`);
  }
  if (!Array.isArray(targetJson.entries)) {
    throw new Error(`Expected entries[] in target file: ${mapping.targetFile}`);
  }

  const targetIndex = new Map();
  for (const targetEntry of targetJson.entries) {
    const key = normalizeString(targetEntry[mapping.targetMatchField]);
    if (!key) continue;
    if (!targetIndex.has(key)) targetIndex.set(key, []);
    targetIndex.get(key).push(targetEntry);
  }

  const missingValues = new Set();
  const matchedValues = new Set();
  let taggedEntries = 0;

  for (const sourceEntry of sourceJson.entries) {
    const values = valuesFromEntryField(sourceEntry, mapping.field);
    for (const value of values) {
      const targetEntries = targetIndex.get(value);
      if (!targetEntries || targetEntries.length === 0) {
        missingValues.add(value);
        continue;
      }
      matchedValues.add(value);
      for (const targetEntry of targetEntries) {
        if (ensureTag(targetEntry, mapping.tag)) {
          taggedEntries += 1;
        }
      }
    }
  }

  fs.writeFileSync(targetAbs, JSON.stringify(targetJson, null, 2) + '\n', 'utf8');

  return {
    mapping,
    sourceUniqueValues: new Set(
      sourceJson.entries.flatMap((entry) => valuesFromEntryField(entry, mapping.field))
    ).size,
    matchedValueCount: matchedValues.size,
    missingValueCount: missingValues.size,
    missingValues: Array.from(missingValues).sort(),
    taggedEntries,
  };
}

function main() {
  const summaries = TAGGING_MAPPINGS.map(applyMapping);

  for (const s of summaries) {
    console.log(`Mapping: ${s.mapping.sourceFile} :: ${s.mapping.field} -> ${s.mapping.targetFile}`);
    console.log(`Tag applied: ${s.mapping.tag}`);
    console.log(`Unique source values: ${s.sourceUniqueValues}`);
    console.log(`Matched values in target: ${s.matchedValueCount}`);
    console.log(`Missing values in target: ${s.missingValueCount}`);
    if (s.missingValues.length) {
      console.log(`Missing list: ${s.missingValues.join(', ')}`);
    }
    console.log(`Entries newly tagged: ${s.taggedEntries}`);
    console.log('---');
  }
}

main();
