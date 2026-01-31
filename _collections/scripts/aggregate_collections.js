const fs = require('fs').promises;
const path = require('path');

// `collections` is at the repository root; compute its path from this script's location
const collectionsDir = path.resolve(__dirname, '..', '..', 'collections');
// write aggregated outputs into the _collections/aggregates folder
const outDir = path.resolve(__dirname, '..', 'aggregates');

async function isDirectory(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch (e) {
    return false;
  }
}

async function walkJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = await walkJsonFiles(full);
      files.push(...sub);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function setNested(root, relParts, value) {
  let cur = root;
  for (let i = 0; i < relParts.length - 1; i++) {
    const p = relParts[i];
    if (!(p in cur)) cur[p] = {};
    cur = cur[p];
  }
  cur[relParts[relParts.length - 1]] = value;
}

async function aggregateCollection(collectionPath, collectionName) {
  const files = await walkJsonFiles(collectionPath);
  const root = {};
  for (const f of files) {
    const rel = path.relative(collectionPath, f);
    const parts = rel.split(path.sep).map((p, i, arr) => {
      if (i === arr.length - 1) return path.basename(p, '.json');
      return p;
    });
    try {
      const txt = await fs.readFile(f, 'utf8');
      const parsed = JSON.parse(txt);
      setNested(root, parts, parsed);
    } catch (err) {
      console.warn(`Skipping ${f}: ${err.message}`);
    }
  }
  // Wrap folder contents into a `collections` property and expose top-level _metadata if present
  const wrapped = {};
  if (root.hasOwnProperty('_metadata')) {
    wrapped._metadata = root._metadata;
    delete root._metadata;
  }
  wrapped.collections = root;

  const outPath = path.join(outDir, `${collectionName}.json`);
  await fs.writeFile(outPath, JSON.stringify(wrapped, null, 2), 'utf8');
  return outPath;
}

async function main() {
  try {
    // ensure output directory exists
    await fs.mkdir(outDir, { recursive: true });
    const entries = await fs.readdir(collectionsDir, { withFileTypes: true });
    const collections = [];
    for (const ent of entries) {
      const full = path.join(collectionsDir, ent.name);
      if (ent.isDirectory()) {
        collections.push({ name: ent.name, path: full });
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
        const name = path.basename(ent.name, '.json');
        collections.push({ name, path: collectionsDir });
      }
    }

    const results = [];
    for (const c of collections) {
      const out = await aggregateCollection(c.path, c.name);
      results.push(out);
      console.log(`Wrote ${out}`);
    }

    const indexPath = path.join(outDir, 'index.json');
    await fs.writeFile(indexPath, JSON.stringify({ generated: results }, null, 2), 'utf8');
    console.log(`Wrote ${indexPath}`);
    console.log('\nTo restore a single collection (dry-run):');
    console.log('  node _collections/scripts/restore_collections.js --input _collections/aggregates/<collection>.json --dry-run');
    console.log('\nTo restore and overwrite existing files:');
    console.log('  node _collections/scripts/restore_collections.js --input _collections/aggregates/<collection>.json --overwrite');
  } catch (err) {
    console.error('Error aggregating collections:', err);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { aggregateCollection, walkJsonFiles };
