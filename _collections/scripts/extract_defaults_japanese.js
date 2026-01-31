const fs = require('fs');
const path = require('path');

const japaneseDir = path.join(__dirname, '..', '..', 'collections', 'japanese');

function walkDir(dir, cb) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walkDir(p, cb);
    else if (it.isFile() && it.name.endsWith('.json')) cb(p);
  }
}

function extractDefaultsFromFile(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch (e) { return { filePath: rel, error: `read error: ${e.message}` }; }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return { filePath: rel, error: `json parse error: ${e.message}` }; }

  if (!Array.isArray(doc.entries)) return { filePath: rel, note: 'no entries' }; // nothing to do

  const entries = doc.entries;
  const candidateKeys = new Set();
  // collect all keys present in any entry
  for (const e of entries) Object.keys(e).forEach(k => candidateKeys.add(k));

  const defaults = Object.assign({}, doc.defaults || {});
  const extracted = {};
  const skipped = [];

  for (const key of candidateKeys) {
    // ignore keys that are objects/arrays across entries to avoid complex merges
    let firstVal = undefined;
    let allSame = true;
    for (const e of entries) {
      const v = Object.prototype.hasOwnProperty.call(e, key) ? e[key] : undefined;
      if (firstVal === undefined) firstVal = v;
      else {
        // treat undefined vs missing as same only if both undefined
        if (JSON.stringify(v) !== JSON.stringify(firstVal)) { allSame = false; break; }
      }
    }
    // require that the common value is not undefined (i.e., field present at least once)
    if (allSame && firstVal !== undefined) {
      // only extract primitive values (string/number/boolean/null)
      const t = typeof firstVal;
      const isPrimitive = firstVal === null || t === 'string' || t === 'number' || t === 'boolean';
      if (!isPrimitive) { skipped.push(key); continue; }

      // if defaults already has a different value, skip extraction for this key
      if (Object.prototype.hasOwnProperty.call(defaults, key) && JSON.stringify(defaults[key]) !== JSON.stringify(firstVal)) {
        skipped.push(key);
        continue;
      }

      // set default and remove key from entries
      defaults[key] = firstVal;
      extracted[key] = firstVal;
      for (const e of entries) {
        if (Object.prototype.hasOwnProperty.call(e, key)) delete e[key];
      }
    }
  }

  if (Object.keys(extracted).length === 0) return { filePath: rel, note: 'no extraction', skipped };

  doc.defaults = defaults;
  try {
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    return { filePath: rel, updated: true, extracted: Object.keys(extracted), skipped };
  } catch (e) {
    return { filePath: rel, error: `write error: ${e.message}` };
  }
}

function main() {
  if (!fs.existsSync(japaneseDir)) { console.error('japanese directory not found:', japaneseDir); process.exit(1); }
  const results = [];
  walkDir(japaneseDir, (p) => { const r = extractDefaultsFromFile(p); if (r) results.push(r); });

  // prepare report
  const updated = results.filter(r => r.updated);
  const errors = results.filter(r => r.error);
  const noEntries = results.filter(r => r.note === 'no entries' || r.note === 'no extraction');

  if (updated.length > 0) {
    const maxPath = Math.max(...updated.map(u => u.filePath.length));
    console.log('\nUpdated files:');
    for (const u of updated) {
      const pad = ' '.repeat(Math.max(1, maxPath - u.filePath.length));
      const keys = u.extracted.join(', ');
      console.log(`  ${u.filePath}${pad}  | ${u.extracted.length} key(s): ${keys}`);
    }
  }

  if (noEntries.length > 0) {
    console.log('\nSkipped (no extraction):');
    for (const s of noEntries) console.log(`  ${s.filePath}  ${s.skipped && s.skipped.length ? `| skipped keys: ${s.skipped.join(', ')}` : ''}`);
  }

  if (errors.length > 0) {
    console.log('\nErrors:');
    for (const e of errors) console.log(`  ${e.filePath}  | ${e.error}`);
  }

  const totalFiles = results.length;
  const totalUpdatedKeys = updated.reduce((sum, u) => sum + (u.extracted ? u.extracted.length : 0), 0);
  console.log(`\nSummary: scanned ${totalFiles} file(s), updated ${updated.length}, skipped ${noEntries.length}, errors ${errors.length}, total keys extracted ${totalUpdatedKeys}`);
}

if (require.main === module) main();
