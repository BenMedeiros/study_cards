import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCollection } from '../src/utils/common/validation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = fs.existsSync(path.join(process.cwd(), 'collections'))
  ? process.cwd()
  : path.resolve(__dirname, '..');
const collectionsRoot = path.join(repoRoot, 'collections');
const scriptRoot = fs.existsSync(path.join(repoRoot, 'scripts'))
  ? path.join(repoRoot, 'scripts')
  : __dirname;
const outputPath = path.join(scriptRoot, 'report_collection_contract_output.json');

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
      if (entry.name.startsWith('_')) continue;
      files.push(fullPath);
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeIssueList(list = []) {
  return Array.isArray(list) ? list.map((message) => ({ message })) : [];
}

async function main() {
  const collectionFiles = findCollectionFiles(collectionsRoot);
  const parseErrors = [];
  const clean = [];
  const review = [];

  for (const filePath of collectionFiles) {
    try {
      const relativePath = path.relative(collectionsRoot, filePath).replace(/\\/g, '/');
      const collection = readJson(filePath);
      const result = await validateCollection(collection, {});
      const report = {
        collectionPath: `collections/${relativePath}`,
        valid: !!result.valid,
        arrayKey: result.arrayKey,
        entryKeyField: result.entryKeyField,
        collectionErrors: normalizeIssueList(result.collectionValidation?.errors),
        collectionWarnings: normalizeIssueList(result.collectionValidation?.warnings),
        schemaErrors: normalizeIssueList(result.schemaValidation?.errors),
        schemaWarnings: normalizeIssueList(result.schemaValidation?.warnings),
        entryErrorCount: Array.isArray(result.entriesValidation?.entryErrors) ? result.entriesValidation.entryErrors.length : 0,
        entryWarningCount: Array.isArray(result.entriesValidation?.entryWarnings) ? result.entriesValidation.entryWarnings.length : 0,
        duplicateCount: Array.isArray(result.entriesValidation?.duplicates) ? result.entriesValidation.duplicates.length : 0,
      };

      const hasProblems = report.collectionErrors.length > 0 || report.schemaErrors.length > 0 || report.entryErrorCount > 0;
      if (hasProblems) review.push(report);
      else clean.push(report);
    } catch (error) {
      parseErrors.push({
        filePath: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
        message: error.message,
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    outputPath: path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
    scannedCollections: collectionFiles.length,
    collectionsWithProblems: review.length,
    parseErrors,
    reports_clean: clean,
    reports_review: review,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${output.outputPath}`);
  console.log(`Scanned collections: ${output.scannedCollections}`);
  console.log(`Collections with problems: ${output.collectionsWithProblems}`);
  console.log(`Parse errors: ${output.parseErrors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

