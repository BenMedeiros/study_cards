import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMissingRelatedCollectionData } from '../src/utils/common/collectionValidations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function main() {
  const collectionFiles = findCollectionFiles(collectionsRoot);
  const collectionsByRelativePath = new Map();
  const parseErrors = [];

  for (const filePath of collectionFiles) {
    try {
      const relativePath = path.relative(collectionsRoot, filePath).replace(/\\/g, '/');
      collectionsByRelativePath.set(relativePath, {
        key: relativePath,
        path: relativePath,
        filePath,
        collection: readJson(filePath)
      });
    } catch (error) {
      parseErrors.push({
        filePath: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
        message: error.message
      });
    }
  }

  const report = validateMissingRelatedCollectionData(collectionsByRelativePath);

  const output = {
    ...report,
    repoRoot,
    outputPath: path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
    parseErrors,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`);
  console.log(`Scanned collections: ${output.scannedCollections}`);
  console.log(`Collections with relations: ${output.collectionsWithRelations}`);
  console.log(`Relations checked: ${output.relationCount}`);
  console.log(`Relations with missing data: ${output.missingRelationCount}`);
  console.log(`Total unique missing refs: ${output.missingRefTotal}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});