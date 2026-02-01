const fs = require('fs');
const path = require('path');

// Heuristic assigner for `orthography` field.
// Usage: node assign_orthography.js [--replace] [--quiet]

const repoRoot = path.resolve(__dirname, '..');
const root = path.join(repoRoot, 'collections', 'japanese');
const replace = process.argv.includes('--replace');
const quiet = process.argv.includes('--quiet');

// Load overrides map (key -> orthography). Keys may be kanji, reading, or meaning.
const overridesPath = path.join(__dirname, 'orthography_overrides.json');
let overrides = {};
if (fs.existsSync(overridesPath)) {
  try { overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8')); } catch (e) { overrides = {}; }
}

function detectOrthography(s) {
  if (!s || typeof s !== 'string') return null;
  const hasKatakana = /\p{Script=Katakana}/u.test(s);
  const hasHiragana = /\p{Script=Hiragana}/u.test(s);
  const hasHan = /\p{Script=Han}/u.test(s);

  // Prefer `kanji` when any Han characters are present (most entries with
  // kanji + okurigana should be classified as `kanji`).
  if (hasHan) return 'kanji';
  // If no Han, decide between kana types. If both kana scripts appear,
  // mark as `either` (stylistic choice between hiragana/katakana).
  if (hasKatakana && hasHiragana) return 'either';
  if (hasKatakana) return 'katakana';
  if (hasHiragana) return 'hiragana';
  return null;
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && name.endsWith('.json')) out.push(p);
  }
  return out;
}

function processFile(p) {
  const raw = fs.readFileSync(p, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { path: p, error: 'invalid-json' }; }
  if (!Array.isArray(j.entries)) return { path: p, skipped: true };

  const changes = [];
  for (let i = 0; i < j.entries.length; i++) {
    const e = j.entries[i];
    if (!e || typeof e !== 'object') continue;
    // Determine override match (by kanji string, reading, or meaning).
    let matched = null;
    const checkValues = [];
    if (e.kanji) checkValues.push(Array.isArray(e.kanji) ? e.kanji.join(' ') : e.kanji);
    if (e.reading) checkValues.push(e.reading);
    if (e.meaning) checkValues.push(e.meaning);
    for (const v of checkValues) {
      if (!v) continue;
      const key = v.trim();
      if (overrides[key]) { matched = overrides[key]; break; }
    }

    // If no override, only set orthography when the value clearly contains Katakana.
    const combined = checkValues.join(' ');
    const hasKatakana = /\p{Script=Katakana}/u.test(combined);

    if (matched || hasKatakana) {
      const orth = matched || 'katakana';
      changes.push({ index: i, orthography: orth });
      if (replace) e.orthography = orth;
    } else {
      // Remove orthography if present and not katakana/override
      if ('orthography' in e) {
        changes.push({ index: i, orthography: null });
        if (replace) delete e.orthography;
      }
    }
  }

  if (replace && changes.length) fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
  return { path: p, changes };
}

function main() {
  const files = walk(root);
  const report = [];
  for (const f of files) {
    const r = processFile(f);
    report.push(r);
  }

  const toUpdate = report.filter(r => r.changes && r.changes.length);
  if (!quiet) {
    console.log('Scanned', files.length, 'files. Files with potential updates:', toUpdate.length);
    for (const r of toUpdate) {
      console.log('-', path.relative(repoRoot, r.path), ':', r.changes.length, 'entries');
    }
  }

  return { totalFiles: files.length, toUpdate };
}

if (require.main === module) {
  main();
}

module.exports = { detectOrthography, processFile, walk };
