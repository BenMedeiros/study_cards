import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePatchFromInput, detectCollectionArrayKey } from '../src/utils/common/collectionDiff.mjs';
import { buildImportFeedback } from '../src/utils/common/collectionImportFeedback.mjs';
import { parseCollectionImportInput } from '../src/utils/common/collectionImport.mjs';
import { validateEntriesAgainstSchema } from '../src/utils/common/validation.mjs';
import {
  createPatchRevisionRecord,
  createRevisionId,
  currentTimestampIso,
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
const dataImportRoot = path.join(repoRoot, 'collection_updates', 'dataImport');
const revisionsRoot = path.join(repoRoot, 'collection_updates', 'revisions');
const revisionsProcessedRoot = path.join(revisionsRoot, 'processed');

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function findJsonFiles(rootDir, { skipDir = null, skipDirectoryNames = [] } = {}) {
  const files = [];
  const skipNames = new Set((Array.isArray(skipDirectoryNames) ? skipDirectoryNames : []).map((name) => String(name || '').trim()).filter(Boolean));

  function walk(dirPath) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (skipDir && path.resolve(fullPath) === path.resolve(skipDir)) continue;
        if (skipNames.has(String(entry.name || '').trim())) continue;
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

function inferCollectionKeyFromImportFolder(filePath) {
  const relDir = path.relative(dataImportRoot, path.dirname(filePath)).replace(/\\/g, '/');
  if (!relDir || relDir === '.') return '';
  const parts = relDir.split('/').filter(Boolean);
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  if (last === 'processed' || last === 'error') parts.pop();
  if (!parts.length) return '';
  const tail = parts[parts.length - 1];
  parts[parts.length - 1] = tail.endsWith('.json') ? tail : `${tail}.json`;
  return parts.join('/');
}

function collectionStemFromKey(collectionKey) {
  return String(collectionKey || '')
    .replace(/\.json$/i, '')
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function importStemFromFileName(fileName) {
  const baseName = path.basename(fileName, '.json');
  return String(baseName).split('.')[0];
}

function findCollectionFiles(rootDir) {
  return findJsonFiles(rootDir)
    .filter((filePath) => path.basename(filePath) !== '_index.json')
    .map((filePath) => {
      const collectionKey = path.relative(rootDir, filePath).replace(/\\/g, '/');
      return {
        key: collectionKey,
        filePath,
        stem: collectionStemFromKey(collectionKey),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function inferCollectionKeyFromImportFile(filePath, collectionFiles) {
  const stem = importStemFromFileName(filePath);
  const matches = collectionFiles.filter((item) => item.stem === stem);
  if (matches.length === 1) return matches[0].key;
  if (matches.length > 1) {
    throw new Error(`Ambiguous collection match for import file ${path.basename(filePath)}: ${matches.map((item) => item.key).join(', ')}`);
  }
  return '';
}

function buildRevisionFileName(revision) {
  const collectionPart = collectionStemFromKey(revision?.collectionKey || 'collection');
  const kind = String(revision?.kind || 'diff').trim() || 'diff';
  const id = String(revision?.id || 'revision').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${collectionPart}.${kind}.${id}.json`;
}

function summarizeMeaningfulChanges(diffs) {
  const summary = {
    metadataChanges: Number(diffs?.metadataChanges || 0),
    schemaChanges: Number(diffs?.schemaChanges || 0),
    newEntries: Number(diffs?.newEntries || 0),
    editedEntries: Number(diffs?.editedEntries || 0),
    entriesRemove: Number(diffs?.entriesRemove || 0),
  };
  summary.total = summary.metadataChanges + summary.schemaChanges + summary.newEntries + summary.editedEntries + summary.entriesRemove;
  return summary;
}

function buildImportStatusPath(filePath, statusFolderName) {
  const dirPath = path.dirname(filePath);
  const baseName = path.basename(filePath);
  return path.join(dirPath, statusFolderName, baseName);
}

function moveImportFile(filePath, destinationPath, { label = 'processed' } = {}) {
  const destination = destinationPath;
  if (fs.existsSync(destination)) {
    throw new Error(`${label} import file already exists: ${toRepoRelative(destination)}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(filePath, destination);
  return destination;
}

function buildFeedbackFilePath(processedImportPath) {
  if (/\.json$/i.test(processedImportPath)) {
    return processedImportPath.replace(/\.json$/i, '.feedback.json');
  }
  return `${processedImportPath}.feedback.json`;
}

function loadPendingRevisions() {
  const revisionFiles = findJsonFiles(revisionsRoot, { skipDir: revisionsProcessedRoot });
  const rows = [];
  for (const filePath of revisionFiles) {
    rows.push({
      ...readJson(filePath),
      sourceFilePath: filePath,
      sourcePath: toRepoRelative(filePath),
    });
  }
  return normalizeRevisionSet(rows);
}

async function main() {
  const importFiles = findJsonFiles(dataImportRoot, { skipDirectoryNames: ['processed', 'error'] });
  if (!importFiles.length) {
    console.log('No import files found in collection_updates/dataImport/.');
    return;
  }

  const importFilePath = importFiles[0];
  const collectionFiles = findCollectionFiles(collectionsRoot);
  let inferredCollectionKey = inferCollectionKeyFromImportFolder(importFilePath) || inferCollectionKeyFromImportFile(importFilePath, collectionFiles);
  let baseRecord = inferredCollectionKey
    ? collectionFiles.find((item) => item.key === inferredCollectionKey) || null
    : null;
  let baseCollection = baseRecord ? readJson(baseRecord.filePath) : null;
  const defaultArrayKey = detectCollectionArrayKey(baseCollection || {}).key || 'entries';

  const parsedImport = parseCollectionImportInput({
    rawInput: readText(importFilePath),
    collectionKey: inferredCollectionKey,
    defaultArrayKey,
    allowFullCollection: true,
  });

  if (!inferredCollectionKey && parsedImport.patchTargetCollectionKey) {
    inferredCollectionKey = parsedImport.patchTargetCollectionKey;
    baseRecord = collectionFiles.find((item) => item.key === inferredCollectionKey) || null;
    baseCollection = baseRecord ? readJson(baseRecord.filePath) : null;
  }

  if (!inferredCollectionKey) {
    throw new Error(`Unable to infer collection key from import file: ${path.basename(importFilePath)}`);
  }
  if (!baseRecord || !baseCollection) {
    throw new Error(`Base collection not found for ${inferredCollectionKey}`);
  }

  const pendingRevisions = loadPendingRevisions()
    .filter((record) => record.collectionKey === inferredCollectionKey);
  let baseForDiff = baseCollection;
  let parentId = null;
  if (pendingRevisions.length) {
    parentId = selectRevisionHead({
      revisions: pendingRevisions,
      collectionKey: inferredCollectionKey,
      onMultipleLeaves: 'error',
    });
    baseForDiff = resolveCollectionAtRevision({
      collectionKey: inferredCollectionKey,
      revisionId: parentId,
      baseCollection,
      revisions: pendingRevisions,
      fallbackToEmpty: false,
      strictParents: true,
      annotateRevision: false,
    });
  }

  const preview = computePatchFromInput({
    baseCollection: baseForDiff,
    input: parsedImport.input,
    treatFullAsReplace: false,
  });
  const schemaForValidation = Array.isArray(baseForDiff?.metadata?.schema)
    ? baseForDiff.metadata.schema
    : (Array.isArray(baseForDiff?.schema) ? baseForDiff.schema : null);
  const importArrayKey = detectCollectionArrayKey(parsedImport.input || {}).key || preview?.diffs?.arrayKey || 'entries';
  const importEntries = Array.isArray(parsedImport?.input?.[importArrayKey]) ? parsedImport.input[importArrayKey] : [];
  const entryValidation = schemaForValidation && importEntries.length
    ? validateEntriesAgainstSchema(importEntries, schemaForValidation, {
      entryKeyField: preview?.diffs?.entryKeyField || preview?.patch?.entryKeyField || '',
    })
    : { entryErrors: [], entryWarnings: [], warnings: [] };
  const feedback = buildImportFeedback({
    collectionKey: inferredCollectionKey,
    baseCollection: baseForDiff,
    input: parsedImport.input,
    previewResult: preview,
    entryValidation,
    patchPayloadDetected: parsedImport.patchPayloadDetected,
  });
  const changeSummary = summarizeMeaningfulChanges(preview?.diffs);
  if (changeSummary.total <= 0) {
    throw new Error(`No meaningful changes detected for ${inferredCollectionKey}`);
  }

  const hasInvalid = Array.isArray(feedback?.invalid) && feedback.invalid.length > 0;
  const plannedImportDestinationPath = buildImportStatusPath(importFilePath, hasInvalid ? 'error' : 'processed');
  const feedbackFilePath = buildFeedbackFilePath(plannedImportDestinationPath);

  if (fs.existsSync(plannedImportDestinationPath)) {
    throw new Error(`${hasInvalid ? 'Error' : 'Processed'} import file already exists: ${toRepoRelative(plannedImportDestinationPath)}`);
  }
  if (fs.existsSync(feedbackFilePath)) {
    throw new Error(`Feedback output already exists: ${toRepoRelative(feedbackFilePath)}`);
  }

  if (hasInvalid) {
    const errorImportPath = moveImportFile(importFilePath, plannedImportDestinationPath, { label: 'error' });
    writeJson(feedbackFilePath, feedback);
    console.log(`Rejected import: ${toRepoRelative(importFilePath)}`);
    console.log(`Collection: ${inferredCollectionKey}`);
    console.log(`Import moved: ${toRepoRelative(errorImportPath)}`);
    console.log(`Feedback written: ${toRepoRelative(feedbackFilePath)}`);
    console.log(`Invalid entries: ${feedback.invalid.length}`);
    process.exitCode = 1;
    return;
  }

  const revision = createPatchRevisionRecord({
    collectionKey: inferredCollectionKey,
    patch: preview.patch,
    parentId,
    id: createRevisionId(),
    createdAt: currentTimestampIso(),
    label: path.basename(importFilePath),
  });
  const revisionFilePath = path.join(revisionsRoot, buildRevisionFileName(revision));
  if (fs.existsSync(revisionFilePath)) {
    throw new Error(`Revision output already exists: ${toRepoRelative(revisionFilePath)}`);
  }

  writeJson(revisionFilePath, revision);
  const processedImportPath = moveImportFile(importFilePath, plannedImportDestinationPath, { label: 'processed' });
  writeJson(feedbackFilePath, feedback);

  console.log(`Processed import: ${toRepoRelative(importFilePath)}`);
  console.log(`Collection: ${inferredCollectionKey}`);
  console.log(`Revision written: ${toRepoRelative(revisionFilePath)}`);
  console.log(`Import moved: ${toRepoRelative(processedImportPath)}`);
  console.log(`Feedback written: ${toRepoRelative(feedbackFilePath)}`);
  console.log(`Parent revision: ${parentId || '(base collection)'}`);
  console.log(`Changes: metadata=${changeSummary.metadataChanges}, schema=${changeSummary.schemaChanges}, new=${changeSummary.newEntries}, edited=${changeSummary.editedEntries}, removed=${changeSummary.entriesRemove}`);
  if (Array.isArray(feedback?.messages?.warnings) && feedback.messages.warnings.length) {
    console.log('Warnings:');
    for (const warning of feedback.messages.warnings) console.log(`  ${warning}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});