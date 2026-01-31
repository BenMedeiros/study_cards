#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const argv = process.argv.slice(2);
const opts = { root: path.resolve(process.cwd(), 'collections'), only: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') opts.root = path.resolve(process.cwd(), argv[++i]);
  else if (a === '--only') opts.only = argv[++i];
  else if (a === '--help' || a === '-h') { console.log('Usage: node validate_collections.js [--root <collections>] [--only <subpath>]'); process.exit(0); }
}

async function findNearestMetadata(startDir, rootDir) {
  let cur = startDir;
  while (true) {
    const candidate = path.join(cur, '_metadata.json');
    try {
      await fs.access(candidate);
      return candidate;
    } catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur || path.relative(rootDir, parent).startsWith('..')) return null;
      cur = parent;
    }
  }
}

async function walk(dir, cb) {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, cb);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) await cb(p);
  }
}

function loadAllowedFieldsFromMetadata(metadataObj) {
  if (!metadataObj || !Array.isArray(metadataObj.fields)) return new Set();
  return new Set(metadataObj.fields.map(f => f.key).filter(Boolean));
}

async function validateFile(filePath, rootDir) {
  const rel = path.relative(process.cwd(), filePath);
  let txt;
  try { txt = await fs.readFile(filePath, 'utf8'); } catch (e) { return { file: rel, error: `read error: ${e.message}` }; }
  let doc;
  try { doc = JSON.parse(txt); } catch (e) { return { file: rel, error: `json parse error: ${e.message}` }; }

  if (!Array.isArray(doc.entries)) return { file: rel, note: 'no entries' };

  const mdPath = await findNearestMetadata(path.dirname(filePath), rootDir);
  let metadata = null;
  if (mdPath) {
    try { metadata = JSON.parse(await fs.readFile(mdPath, 'utf8')); } catch (e) { /* ignore */ }
  }

  const allowed = loadAllowedFieldsFromMetadata(metadata);
  if (allowed.size === 0) return { file: rel, note: 'no metadata', mdPath: mdPath ? path.relative(process.cwd(), mdPath) : null };

  const warningsMap = new Map();
  for (let i = 0; i < doc.entries.length; i++) {
    const entry = doc.entries[i];
    if (!entry || typeof entry !== 'object') continue;
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) {
        if (!warningsMap.has(key)) warningsMap.set(key, new Set());
        warningsMap.get(key).add(i);
      }
    }
  }

  const warnings = {};
  for (const [k, s] of warningsMap.entries()) warnings[k] = Array.from(s).sort((a, b) => a - b);

  return { file: rel, mdPath: mdPath ? path.relative(process.cwd(), mdPath) : null, warnings };
}

async function main() {
  const root = opts.root;
  const only = opts.only ? path.join(root, opts.only) : null;
  const results = [];
  try {
    const target = only || root;
    await walk(target, async (p) => {
      // skip top-level collections index
      if (path.basename(p).toLowerCase() === 'index.json') return;
      results.push(await validateFile(p, root));
    });
  } catch (e) {
    console.error('Error walking collections:', e.message || e);
    process.exit(1);
  }

  let totalFiles = 0, totalWarnings = 0, filesWithNoMetadata = 0;
  function compressRanges(indices) {
    if (!indices.length) return '';
    const ranges = [];
    let start = indices[0], end = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const v = indices[i];
      if (v === end + 1) end = v;
      else { ranges.push(start === end ? String(start) : `${start}-${end}`); start = end = v; }
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    return ranges.join(',');
  }

  for (const r of results) {
    if (r.error) console.log(`ERROR: ${r.file}  | ${r.error}`);
    else if (r.note === 'no entries') continue;
    else if (r.note === 'no metadata') { console.log(`WARN: ${r.file}  | no _metadata.json found (looked at ${r.mdPath || 'n/a'})`); filesWithNoMetadata++; }
    else if (r.warnings && Object.keys(r.warnings).length) {
      const keys = Object.keys(r.warnings);
      totalFiles++;
      const fileWarningCount = keys.reduce((s, k) => s + r.warnings[k].length, 0);
      totalWarnings += fileWarningCount;
      console.log(`\n${r.file}  \n(metadata: ${r.mdPath})`);
      for (const k of keys) {
        const indices = r.warnings[k];
        if (indices.length > 6) {
          console.log(`  - '${k}': ${indices.length} entries (${compressRanges([indices[0], indices[indices.length-1]])})`);
        } else {
          console.log(`  - '${k}': entries ${compressRanges(indices)}`);
        }
      }
    }
  }

  console.log(`\nSummary: scanned ${results.length} file(s), files with warnings ${totalFiles}, total warnings ${totalWarnings}, files missing metadata ${filesWithNoMetadata}`);
  if (totalWarnings > 0) process.exitCode = 2;
}

if (require.main === module) main();
