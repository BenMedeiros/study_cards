import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCollectionRecordMap,
  groupRevisionsByCollection,
  normalizeRevisionSet,
  resolveCollectionAtRevision,
  selectRevisionHead,
} from '../src/utils/common/collectionRevisions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = fs.existsSync(path.join(process.cwd(), 'collections'))
  ? process.cwd()
  : path.resolve(__dirname, '..');
const collectionsRoot = path.join(repoRoot, 'collections');
const revisionsRoot = path.join(repoRoot, 'collection_updates', 'revisions');
const processedRoot = path.join(revisionsRoot, 'processed');

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function findRevisionFiles(rootDir) {
  const files = [];

  function walk(dirPath) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === path.resolve(processedRoot)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      files.push(fullPath);
    }
  }

  if (!fs.existsSync(rootDir)) return [];
  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function planProcessedMoves(filePaths) {
  return filePaths.map((filePath) => {
    const relative = path.relative(revisionsRoot, filePath);
    const destination = path.join(processedRoot, relative);
    return { filePath, destination };
  });
}

function assertMovePlanAvailable(movePlan) {
  for (const item of movePlan) {
    if (fs.existsSync(item.destination)) {
      throw new Error(`Processed revision already exists: ${toRepoRelative(item.destination)}`);
    }
  }
}

function executeMovePlan(movePlan) {
  const moved = [];
  for (const item of movePlan) {
    fs.mkdirSync(path.dirname(item.destination), { recursive: true });
    fs.renameSync(item.filePath, item.destination);
    moved.push(toRepoRelative(item.destination));
  }
  return moved;
}

function loadBaseCollectionRecord(collectionKey) {
  const filePath = path.join(collectionsRoot, collectionKey);
  if (!fs.existsSync(filePath)) return null;
  return {
    key: collectionKey,
    path: collectionKey,
    filePath,
    collection: readJson(filePath),
  };
}

async function main() {
  const revisionFiles = findRevisionFiles(revisionsRoot);
  if (!revisionFiles.length) {
    console.log('No revision files found in collection_updates/revisions/.');
    return;
  }

  const rawRevisionRows = [];
  const parseErrors = [];

  for (const filePath of revisionFiles) {
    try {
      rawRevisionRows.push({
        ...readJson(filePath),
        sourceFilePath: filePath,
        sourcePath: toRepoRelative(filePath),
      });
    } catch (error) {
      parseErrors.push({
        filePath: toRepoRelative(filePath),
        message: error?.message || String(error),
      });
    }
  }

  const revisions = normalizeRevisionSet(rawRevisionRows);
  const grouped = groupRevisionsByCollection(revisions);
  const baseRecords = [];
  const baseLoadErrors = new Map();

  for (const collectionKey of grouped.keys()) {
    try {
      const baseRecord = loadBaseCollectionRecord(collectionKey);
      if (baseRecord) baseRecords.push(baseRecord);
    } catch (error) {
      baseLoadErrors.set(collectionKey, error?.message || String(error));
    }
  }

  const baseRecordMap = buildCollectionRecordMap(baseRecords);
  const successes = [];
  const failures = [];

  for (const [collectionKey, collectionRevisions] of grouped.entries()) {
    try {
      if (baseLoadErrors.has(collectionKey)) {
        throw new Error(`Failed to load base collection: ${baseLoadErrors.get(collectionKey)}`);
      }

      const baseRecord = baseRecordMap.get(collectionKey) || null;
      const headRevisionId = selectRevisionHead({
        revisions: collectionRevisions,
        collectionKey,
        onMultipleLeaves: 'error',
      });
      const mergedCollection = resolveCollectionAtRevision({
        collectionKey,
        revisionId: headRevisionId,
        baseCollection: baseRecord?.collection || null,
        revisions: collectionRevisions,
        fallbackToEmpty: false,
        strictParents: true,
        annotateRevision: false,
      });

      const outputFilePath = baseRecord?.filePath || path.join(collectionsRoot, collectionKey);
      const movePlan = planProcessedMoves(
        collectionRevisions
          .map((record) => record.sourceFilePath)
          .filter((filePath) => typeof filePath === 'string' && filePath.trim())
      );

      assertMovePlanAvailable(movePlan);
      writeJson(outputFilePath, mergedCollection);
      const movedFiles = executeMovePlan(movePlan);

      successes.push({
        collectionKey,
        outputPath: toRepoRelative(outputFilePath),
        headRevisionId,
        revisionCount: collectionRevisions.length,
        movedFiles,
      });
    } catch (error) {
      failures.push({
        collectionKey,
        revisionIds: collectionRevisions.map((record) => record.id),
        message: error?.message || String(error),
      });
    }
  }

  for (const item of successes) {
    console.log(`Applied ${item.revisionCount} revisions to ${item.outputPath} (head ${item.headRevisionId})`);
    for (const movedPath of item.movedFiles) {
      console.log(`  moved -> ${movedPath}`);
    }
  }

  if (parseErrors.length) {
    console.log('Parse errors:');
    for (const error of parseErrors) {
      console.log(`  ${error.filePath}: ${error.message}`);
    }
  }

  if (failures.length) {
    console.log('Failed collections:');
    for (const failure of failures) {
      console.log(`  ${failure.collectionKey}: ${failure.message}`);
    }
  }

  console.log(`Revision files scanned: ${revisionFiles.length}`);
  console.log(`Collections updated: ${successes.length}`);
  console.log(`Collections failed: ${failures.length}`);

  if (parseErrors.length || failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});