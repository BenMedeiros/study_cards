const fs = require('fs').promises;
const path = require('path');

const collectionsDir = path.resolve(__dirname, '..', '..', 'collections');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = await walk(full);
      files.push(...sub);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

async function rebuildIndex() {
  const files = await walk(collectionsDir);
  const folderMetadata = {};
  const collections = [];

  for (const f of files) {
    const rel = path.relative(collectionsDir, f);
    const parts = rel.split(path.sep);
    const posixRel = parts.join('/');
    const base = path.basename(f);
    if (base === '_metadata.json') {
      // map top-level folder name -> its metadata path
      const top = parts[0] || '.';
      folderMetadata[top] = posixRel;
      continue;
    }
    collections.push(posixRel);
  }

  collections.sort();

  const out = { folderMetadata, collections };
  const outPath = path.join(collectionsDir, 'index.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Rebuilt ${outPath} (${collections.length} entries)`);
}

if (require.main === module) rebuildIndex().catch(err => {
  console.error('Error rebuilding index:', err);
  process.exitCode = 1;
});

module.exports = { rebuildIndex };
