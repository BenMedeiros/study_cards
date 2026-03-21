import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDuplicatedKeys } from '../../src/utils/common/collectionValidations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = fs.existsSync(path.join(process.cwd(), 'collections'))
  ? process.cwd()
  : path.resolve(__dirname, '..', '..');
const collectionsRoot = path.join(repoRoot, 'collections');
const scriptRoot = fs.existsSync(path.join(repoRoot, 'scripts'))
  ? path.join(repoRoot, 'scripts')
  : __dirname;
const outputDir = path.join(scriptRoot, 'outputs');
const outputPath = path.join(outputDir, 'report_duplicated_keys_output.json');

function buildRunTiming(startedAt, finishedAt = new Date()) {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
  };
}

function formatDuration(timing) {
  return `${timing.durationMs}ms (${timing.durationSeconds.toFixed(3)}s)`;
}

function detectCollectionArrayKey(collection) {
  const coll = collection && typeof collection === 'object' ? collection : null;
  if (!coll) return null;

  const candidates = ['entries', 'sentences', 'paragraphs', 'items', 'cards'];
  for (const key of candidates) {
    if (Array.isArray(coll[key])) return key;
  }

  for (const [key, value] of Object.entries(coll)) {
    if (key === 'metadata' || key === 'schema') continue;
    if (Array.isArray(value)) return key;
  }

  return null;
}

function buildArrayElementLineNumbers(jsonText, targetKey) {
  if (typeof jsonText !== 'string' || !targetKey) return [];

  let index = 0;
  let line = 1;
  let capturedLines = [];

  function isWhitespace(char) {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
  }

  function advanceChar() {
    if (jsonText[index] === '\r' && jsonText[index + 1] === '\n') {
      index += 2;
      line += 1;
      return;
    }
    if (jsonText[index] === '\n' || jsonText[index] === '\r') line += 1;
    index += 1;
  }

  function skipWhitespace() {
    while (index < jsonText.length && isWhitespace(jsonText[index])) advanceChar();
  }

  function parseString() {
    if (jsonText[index] !== '"') throw new Error(`Expected string at offset ${index}`);
    index += 1;
    let value = '';

    while (index < jsonText.length) {
      const char = jsonText[index];
      if (char === '"') {
        index += 1;
        return value;
      }
      if (char === '\\') {
        const nextChar = jsonText[index + 1];
        if (nextChar === 'u') {
          value += jsonText.slice(index, index + 6);
          index += 6;
        } else {
          value += char + (nextChar || '');
          index += 2;
        }
        continue;
      }
      value += char;
      index += 1;
    }

    throw new Error('Unterminated string literal');
  }

  function parsePrimitive() {
    while (index < jsonText.length) {
      const char = jsonText[index];
      if (isWhitespace(char) || char === ',' || char === ']' || char === '}') return;
      index += 1;
    }
  }

  function parseValue({ captureElements = false } = {}, depth = 0) {
    skipWhitespace();
    const char = jsonText[index];
    if (char === '{') return parseObject(depth);
    if (char === '[') return parseArray({ captureElements }, depth);
    if (char === '"') {
      parseString();
      return null;
    }
    parsePrimitive();
    return null;
  }

  function parseObject(depth = 0) {
    if (jsonText[index] !== '{') throw new Error(`Expected object at offset ${index}`);
    index += 1;
    skipWhitespace();
    if (jsonText[index] === '}') {
      index += 1;
      return null;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      const key = parseString();
      skipWhitespace();
      if (jsonText[index] !== ':') throw new Error(`Expected ':' at offset ${index}`);
      index += 1;
      const shouldCapture = depth === 0 && key === targetKey;
      const maybeLines = parseValue({ captureElements: shouldCapture }, depth + 1);
      if (shouldCapture && Array.isArray(maybeLines)) capturedLines = maybeLines;
      skipWhitespace();
      if (jsonText[index] === ',') {
        index += 1;
        continue;
      }
      if (jsonText[index] === '}') {
        index += 1;
        return null;
      }
      throw new Error(`Expected ',' or '}' at offset ${index}`);
    }

    throw new Error('Unterminated object literal');
  }

  function parseArray({ captureElements = false } = {}, depth = 0) {
    if (jsonText[index] !== '[') throw new Error(`Expected array at offset ${index}`);
    index += 1;
    skipWhitespace();
    const lines = [];
    if (jsonText[index] === ']') {
      index += 1;
      return captureElements ? lines : null;
    }

    while (index < jsonText.length) {
      skipWhitespace();
      if (captureElements) lines.push(line);
      parseValue({}, depth + 1);
      skipWhitespace();
      if (jsonText[index] === ',') {
        index += 1;
        continue;
      }
      if (jsonText[index] === ']') {
        index += 1;
        return captureElements ? lines : null;
      }
      throw new Error(`Expected ',' or ']' at offset ${index}`);
    }

    throw new Error('Unterminated array literal');
  }

  try {
    parseValue({}, 0);
  } catch {
    return [];
  }

  return capturedLines;
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

async function main(startedAt = new Date()) {
  const collectionFiles = findCollectionFiles(collectionsRoot);
  const parseErrors = [];
  const collections = new Map();

  for (const filePath of collectionFiles) {
    try {
      const relativePath = path.relative(collectionsRoot, filePath).replace(/\\/g, '/');
      const rawText = fs.readFileSync(filePath, 'utf8');
      const collection = JSON.parse(rawText);
      const arrayKey = detectCollectionArrayKey(collection);
      collections.set(relativePath, {
        key: relativePath,
        path: relativePath,
        collection,
        entryLineNumbers: buildArrayElementLineNumbers(rawText, arrayKey)
      });
    } catch (error) {
      parseErrors.push({
        filePath: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
        message: error.message
      });
    }
  }

  const report = validateDuplicatedKeys(collections);

  const output = {
    ...report,
    repoRoot,
    outputPath: path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
    parseErrors,
    runTiming: buildRunTiming(startedAt),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`);
  console.log(`Scanned collections: ${output.scannedCollections}`);
  console.log(`Collections with problems: ${output.collectionsWithProblems}`);
  console.log(`Collections with invalid metadata.entry_key: ${output.collectionsWithInvalidEntryKey}`);
  console.log(`Collections with schema mismatch: ${output.collectionsWithSchemaMismatch}`);
  console.log(`Invalid entries: ${output.totalInvalidEntries}`);
  console.log(`Duplicate values: ${output.totalDuplicateValues}`);
  console.log(`Duplicate entries: ${output.totalDuplicateEntries}`);
  console.log(`Run duration: ${formatDuration(output.runTiming)}`);
}

const startedAt = new Date();
main(startedAt).catch((error) => {
  const timing = buildRunTiming(startedAt);
  console.error(error);
  console.error(`Run duration before failure: ${formatDuration(timing)}`);
  process.exitCode = 1;
});
