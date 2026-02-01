const fs = require('fs');
const path = require('path');

// Usage: node merge_godan_endings.js [--replace]
// Scans collections/japanese/verbs/godan-verb/* and merges any JSON files
// in each subfolder into a single JSON file in the parent folder.

const repoRoot = path.resolve(__dirname, '..');
const godanDir = path.join(repoRoot, 'collections', 'japanese', 'verbs', 'godan-verb');
const replaceFlag = process.argv.includes('--replace');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function mergeFilesForEnding(endingDir) {
  const files = fs.readdirSync(endingDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;

  const merged = {
    metadata: {
      name: null,
      level: null,
      version: 1,
      kanji: [],
      kanjiCount: 0
    },
    defaults: { type: 'godan-verb' },
    entries: []
  };

  files.forEach(f => {
    const p = path.join(endingDir, f);
    let j;
    try {
      j = readJson(p);
    } catch (err) {
      console.error('Skipping invalid JSON', p);
      return;
    }

    // Merge metadata. Prefer sensible fields from any file.
    if (!merged.metadata.name && j.metadata && j.metadata.name) merged.metadata.name = j.metadata.name.replace(/\s*\(.*\)$/,'') + ` (${path.basename(endingDir)})`;
    if (!merged.metadata.level && j.metadata && j.metadata.level) merged.metadata.level = j.metadata.level;
    if (j.metadata && Array.isArray(j.metadata.kanji)) merged.metadata.kanji = merged.metadata.kanji.concat(j.metadata.kanji);
    if (j.metadata && typeof j.metadata.kanjiCount === 'number') merged.metadata.kanjiCount += j.metadata.kanjiCount || 0;

    // Merge defaults
    if (j.defaults) merged.defaults = Object.assign({}, merged.defaults, j.defaults);

    // Merge entries
    if (Array.isArray(j.entries)) merged.entries = merged.entries.concat(j.entries.filter(e => e && Object.keys(e).length));
  });

  merged.metadata.kanji = uniq(merged.metadata.kanji);
  merged.metadata.kanjiCount = merged.metadata.kanji.length;
  if (!merged.metadata.name) merged.metadata.name = `Japanese N5 Godan Verbs (-${path.basename(endingDir)})`;
  if (!merged.metadata.level) merged.metadata.level = 'N5';
  merged.defaults.ending = path.basename(endingDir);

  return merged;
}

function main() {
  if (!fs.existsSync(godanDir)) {
    console.error('godan-verb directory not found:', godanDir);
    process.exit(1);
  }

  const endings = fs.readdirSync(godanDir).filter(name => fs.statSync(path.join(godanDir, name)).isDirectory());

  endings.forEach(ending => {
    const endingDir = path.join(godanDir, ending);
    const merged = mergeFilesForEnding(endingDir);
    if (!merged) return;

    const outName = `godan_verbs_${ending}.json`;
    const outPath = path.join(godanDir, outName);
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
    console.log('Wrote', outPath);

    if (replaceFlag) {
      // Remove original files
      const files = fs.readdirSync(endingDir).filter(f => f.endsWith('.json'));
      files.forEach(f => fs.unlinkSync(path.join(endingDir, f)));
      // Optionally remove empty directory
      const remaining = fs.readdirSync(endingDir);
      if (remaining.length === 0) fs.rmdirSync(endingDir);
      console.log('Removed originals in', endingDir);
    }
  });
}

main();
