#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const scriptsDir = path.resolve(__dirname);
const japaneseDir = path.join(scriptsDir, '..', '..', 'collections', 'japanese');

async function listJsonFiles(dir) {
  const out = [];
  async function walk(d) {
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function processFile(filePath) {
  if (path.basename(filePath) === '_metadata.json') return { file: filePath, skipped: true };
  let txt;
  try { txt = await fs.readFile(filePath, 'utf8'); } catch (e) { return { file: filePath, error: `read: ${e.message}` }; }
  let doc;
  try { doc = JSON.parse(txt); } catch (e) { return { file: filePath, error: `parse: ${e.message}` }; }

  const set = new Set();
  if (Array.isArray(doc.entries)) {
    for (const e of doc.entries) {
      if (e && typeof e.kanji === 'string' && e.kanji.trim() !== '') set.add(e.kanji);
    }
  }

  if (!doc.metadata || typeof doc.metadata !== 'object') doc.metadata = {};
  const arr = Array.from(set).sort((a,b)=>a.localeCompare(b,'ja'));
  doc.metadata.kanji = arr;
  doc.metadata.kanjiCount = arr.length;

  try {
    // Write JSON but keep metadata.kanji as a single-line array.
    const placeholder = '__KANJI_ARRAY_PLACEHOLDER__';
    const docCopy = JSON.parse(JSON.stringify(doc));
    // replace the array with a placeholder string so it is quoted in the pretty JSON
    docCopy.metadata = Object.assign({}, docCopy.metadata);
    docCopy.metadata.kanji = placeholder;
    let txtOut = JSON.stringify(docCopy, null, 2);
    const kanjiArrayStr = JSON.stringify(arr);
    // replace the quoted placeholder with the unquoted array
    txtOut = txtOut.replace(JSON.stringify(placeholder), kanjiArrayStr);
    // ensure trailing newline
    if (!txtOut.endsWith('\n')) txtOut += '\n';
    await fs.writeFile(filePath, txtOut, 'utf8');
    return { file: filePath, written: true, count: arr.length };
  } catch (e) {
    return { file: filePath, error: `write: ${e.message}` };
  }
}

async function main() {
  try {
    const files = await listJsonFiles(japaneseDir);
    const results = [];
    for (const f of files) results.push(await processFile(f));

    console.log('\nResults:');
    for (const r of results) {
      if (r.error) console.log(`- ${r.file}: ERROR ${r.error}`);
      else if (r.skipped) console.log(`- ${r.file}: skipped (_metadata.json)`);
      else console.log(`- ${r.file}: updated, entriesKanji=${r.count}`);
    }
  } catch (e) {
    console.error('Failed:', e.message || e);
    process.exit(1);
  }
}

if (require.main === module) main();
