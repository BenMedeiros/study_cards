const fs = require('fs');
const path = require('path');

const repoRoot = fs.existsSync(path.join(process.cwd(), 'collections'))
  ? process.cwd()
  : path.resolve(__dirname, '..');
const collectionsRoot = path.join(repoRoot, 'collections');
const scriptRoot = fs.existsSync(path.join(repoRoot, 'scripts'))
  ? path.join(repoRoot, 'scripts')
  : __dirname;
const outputPath = path.join(scriptRoot, 'report_missing_related_collection_data_output.json');

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

function tokenizePath(pathExpression) {
  return String(pathExpression || '').split('.').filter(Boolean);
}

function unwrapToken(token) {
  const isArray = token.endsWith('[]');
  return {
    key: isArray ? token.slice(0, -2) : token,
    isArray
  };
}

function extractValues(root, pathExpression) {
  const tokens = tokenizePath(pathExpression).map(unwrapToken);
  let current = [root];

  for (const token of tokens) {
    const next = [];
    for (const value of current) {
      if (value == null || typeof value !== 'object') continue;
      const child = value[token.key];
      if (token.isArray) {
        if (Array.isArray(child)) next.push(...child);
      } else if (child !== undefined) {
        next.push(child);
      }
    }
    current = next;
  }

  return current.filter((value) => value !== undefined && value !== null);
}

function getCollectionLabel(collection, fallbackPath) {
  return collection?.metadata?.name || path.relative(collectionsRoot, fallbackPath);
}

function getEntryLabel(entry, entryKey) {
  const parts = [];
  if (entry?.title) parts.push(entry.title);
  if (entryKey && entry?.[entryKey]) parts.push(entry[entryKey]);
  else if (entry?.ja) parts.push(entry.ja);
  else if (entry?.kanji) parts.push(entry.kanji);
  else if (entry?.pattern) parts.push(entry.pattern);
  return parts.join(' | ') || '(unlabeled entry)';
}

function truncate(text, max = 100) {
  if (typeof text !== 'string') return String(text);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function buildKnownValueSet(collection, key) {
  if (!key) return new Set();
  return new Set(
    (collection.entries || [])
      .map((entry) => entry?.[key])
      .filter((value) => typeof value === 'string' && value.trim())
  );
}

function collectMissingRefs(sourceCollection, relatedCollection, relation) {
  const sourceKey = relation.this_key || sourceCollection.metadata?.entry_key;
  const knownValues = buildKnownValueSet(sourceCollection, sourceKey);
  const relatedEntryKey = relatedCollection.metadata?.entry_key || 'ja';
  const missing = new Map();

  for (const entry of relatedCollection.entries || []) {
    const refs = extractValues(entry, relation.foreign_key);
    const entryLabel = getEntryLabel(entry, relatedEntryKey);

    for (const ref of refs) {
      if (typeof ref !== 'string' || !ref.trim()) continue;
      if (knownValues.has(ref)) continue;

      if (!missing.has(ref)) {
        missing.set(ref, {
          count: 0,
          samples: []
        });
      }

      const record = missing.get(ref);
      record.count += 1;
      if (record.samples.length < 3) {
        record.samples.push(truncate(entryLabel));
      }
    }
  }

  return [...missing.entries()]
    .map(([ref, info]) => ({ ref, ...info }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref, 'ja'));
}

function main() {
  const collectionFiles = findCollectionFiles(collectionsRoot);
  const collectionsByRelativePath = new Map();
  const parseErrors = [];

  for (const filePath of collectionFiles) {
    try {
      collectionsByRelativePath.set(path.relative(collectionsRoot, filePath).replace(/\\/g, '/'), {
        filePath,
        data: readJson(filePath)
      });
    } catch (error) {
      parseErrors.push({
        filePath: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
        message: error.message
      });
    }
  }

  let relationCount = 0;
  let collectionsWithRelations = 0;
  let missingRelationCount = 0;
  let missingRefTotal = 0;
  const reports = [];

  for (const [relativePath, record] of collectionsByRelativePath.entries()) {
    const sourceCollection = record.data;
    const relations = sourceCollection?.metadata?.relatedCollections;
    if (!Array.isArray(relations) || relations.length === 0) continue;

    collectionsWithRelations += 1;
    relationCount += relations.length;

    const sourceReport = {
      sourceName: getCollectionLabel(sourceCollection, record.filePath),
      sourcePath: `collections/${relativePath}`,
      relations: []
    };

    for (const relation of relations) {
      const relatedPath = String(relation.path || '').replace(/\\/g, '/');
      const relatedRecord = collectionsByRelativePath.get(relatedPath);
      const relationReport = {
        name: relation.name || relatedPath,
        thisKey: relation.this_key || sourceCollection.metadata?.entry_key || null,
        foreignKey: relation.foreign_key || null,
        relatedPath: `collections/${relatedPath}`,
        missingCount: 0,
        missing: []
      };

      if (!relatedRecord) {
        relationReport.error = 'Unable to load related collection';
        missingRelationCount += 1;
        sourceReport.relations.push(relationReport);
        continue;
      }

      const missing = collectMissingRefs(sourceCollection, relatedRecord.data, relation);
      relationReport.missingCount = missing.length;
      relationReport.missing = missing;
      if (missing.length > 0) {
        missingRelationCount += 1;
        missingRefTotal += missing.length;
      }
      sourceReport.relations.push(relationReport);
    }

    reports.push(sourceReport);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    outputPath: path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
    scannedCollections: collectionFiles.length,
    collectionsWithRelations,
    relationCount,
    missingRelationCount,
    missingRefTotal,
    parseErrors,
    reports
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`);
  console.log(`Scanned collections: ${collectionFiles.length}`);
  console.log(`Collections with relations: ${collectionsWithRelations}`);
  console.log(`Relations checked: ${relationCount}`);
  console.log(`Relations with missing data: ${missingRelationCount}`);
  console.log(`Total unique missing refs: ${missingRefTotal}`);
}

main();
