const fs = require('fs');
const path = require('path');

const repoRoot = fs.existsSync(path.join(process.cwd(), 'collections'))
  ? process.cwd()
  : path.resolve(__dirname, '..');
const collectionsRoot = path.join(repoRoot, 'collections');
const scriptRoot = fs.existsSync(path.join(repoRoot, 'scripts'))
  ? path.join(repoRoot, 'scripts')
  : __dirname;
const outputPath = path.join(scriptRoot, 'report_duplicated_keys_output.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCollectionFiles(rootDir) {
  const files = [];

  function walk(dirPath) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      if (entry.name === '_index.json') continue;
      files.push(fullPath);
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function getCollectionLabel(collection, fallbackPath) {
  return collection?.metadata?.name || path.relative(collectionsRoot, fallbackPath);
}

function getEntryLabel(entry, entryKey) {
  const parts = [];
  if (entry?.title) parts.push(entry.title);
  if (entryKey && entry?.[entryKey] !== undefined && entry?.[entryKey] !== null) {
    parts.push(String(entry[entryKey]));
  } else if (entry?.ja) parts.push(entry.ja);
  else if (entry?.kanji) parts.push(entry.kanji);
  else if (entry?.pattern) parts.push(entry.pattern);
  else if (entry?.englishName) parts.push(entry.englishName);
  else if (entry?.language) parts.push(entry.language);
  return parts.join(' | ') || '(unlabeled entry)';
}

function truncate(text, max = 100) {
  if (typeof text !== 'string') return String(text);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
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

function inspectCollection(collection, filePath) {
  const metadata = collection?.metadata || {};
  const entries = Array.isArray(collection?.entries) ? collection.entries : [];
  const entryKey = metadata.entry_key;
  const schema = Array.isArray(metadata.schema) ? metadata.schema : [];
  const schemaKeys = new Set(schema.map((field) => field?.key).filter(Boolean));
  const invalidEntries = [];
  const seenValues = new Map();

  const hasEntryKey = typeof entryKey === 'string' && entryKey.trim().length > 0;
  const normalizedEntryKey = hasEntryKey ? entryKey.trim() : null;
  const schemaHasEntryKey = normalizedEntryKey ? schemaKeys.has(normalizedEntryKey) : false;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const value = normalizedEntryKey ? entry?.[normalizedEntryKey] : undefined;

    if (!isValidEntryKeyValue(value)) {
      invalidEntries.push({
        index,
        label: truncate(getEntryLabel(entry, normalizedEntryKey)),
        reason: normalizedEntryKey
          ? `Missing or invalid \`${normalizedEntryKey}\` value`
          : 'Collection metadata.entry_key is missing or invalid'
      });
      continue;
    }

    const comparableValue = formatKeyValue(value);
    if (!seenValues.has(comparableValue)) {
      seenValues.set(comparableValue, []);
    }
    seenValues.get(comparableValue).push({
      index,
      label: truncate(getEntryLabel(entry, normalizedEntryKey))
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
    collectionName: getCollectionLabel(collection, filePath),
    collectionPath: `collections/${path.relative(collectionsRoot, filePath).replace(/\\/g, '/')}`,
    entryKey: normalizedEntryKey,
    entryCount: entries.length,
    hasValidEntryKeyMetadata: hasEntryKey,
    schemaHasEntryKey,
    invalidEntryCount: invalidEntries.length,
    duplicateValueCount: duplicates.length,
    duplicateEntryCount: duplicates.reduce((sum, item) => sum + item.count, 0),
    invalidEntries,
    duplicates
  };
}

function main() {
  const collectionFiles = findCollectionFiles(collectionsRoot);
  const parseErrors = [];
  const reports_clean = [];
  const reports_review = [];

  let collectionsWithProblems = 0;
  let collectionsWithInvalidEntryKey = 0;
  let collectionsWithSchemaMismatch = 0;
  let totalInvalidEntries = 0;
  let totalDuplicateValues = 0;
  let totalDuplicateEntries = 0;

  for (const filePath of collectionFiles) {
    try {
      const report = inspectCollection(readJson(filePath), filePath);

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
      if (report.hasValidEntryKeyMetadata && !report.schemaHasEntryKey) {
        collectionsWithSchemaMismatch += 1;
      }
      totalInvalidEntries += report.invalidEntryCount;
      totalDuplicateValues += report.duplicateValueCount;
      totalDuplicateEntries += report.duplicateEntryCount;
    } catch (error) {
      parseErrors.push({
        filePath: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
        message: error.message
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    outputPath: path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
    scannedCollections: collectionFiles.length,
    collectionsWithProblems,
    collectionsWithInvalidEntryKey,
    collectionsWithSchemaMismatch,
    totalInvalidEntries,
    totalDuplicateValues,
    totalDuplicateEntries,
    parseErrors,
    reports_clean,
    reports_review
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`);
  console.log(`Scanned collections: ${collectionFiles.length}`);
  console.log(`Collections with problems: ${collectionsWithProblems}`);
  console.log(`Collections with invalid metadata.entry_key: ${collectionsWithInvalidEntryKey}`);
  console.log(`Collections with schema mismatch: ${collectionsWithSchemaMismatch}`);
  console.log(`Invalid entries: ${totalInvalidEntries}`);
  console.log(`Duplicate values: ${totalDuplicateValues}`);
  console.log(`Duplicate entries: ${totalDuplicateEntries}`);
}

main();
