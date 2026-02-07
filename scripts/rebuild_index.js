/**
 * Rebuilds the top-level collections index used by the app.
 *
 * Walks `collections/**.json`, builds `collections/index.json` with:
 * - `folderMetadata`: map of top-level folder -> its `_metadata.json` path
 * - `collections`: list of collection files with name/description/entry counts
 *
 * If multiple collections in the same folder share the same `metadata.name`, this
 * script disambiguates them by rewriting `metadata.name` in-place.
 *
 * Usage: `node scripts/rebuild_index.js`
 */
const fs = require('fs').promises;
const path = require('path');

const collectionsDir = path.resolve(__dirname, '..', 'collections');

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
  const collectionsFiles = [];

  for (const f of files) {
    const rel = path.relative(collectionsDir, f);
    const parts = rel.split(path.sep);
    const posixRel = parts.join('/');
    const base = path.basename(f);
    if (base === '_metadata.json') {
      // map the folder (relative to collections/) -> its metadata path
      // e.g. "japanese/grammar" -> "japanese/grammar/_metadata.json"
      const dir = parts.slice(0, -1).join('/') || '.';
      folderMetadata[dir] = posixRel;
      continue;
    }
    // skip the generated top-level index.json so it doesn't appear in collections
    if (posixRel === 'index.json') continue;
    // skip any special/hidden JSON files that start with '_' (tooling/metadata files)
    // except for per-folder collection sets which the app needs to discover.
    if (base.startsWith('_') && base !== '_collectionSets.json') continue;
    collectionsFiles.push(posixRel);
  }

  // Read each collection's metadata.name/description/entries and build display names
  const entries = [];
  for (const posixRel of collectionsFiles) {
    const full = path.join(collectionsDir, posixRel.split('/').join(path.sep));
    const parts = posixRel.split('/');
    const parent = parts.slice(0, -1).join('/') || '.';
    const baseNameNoExt = path.basename(posixRel, '.json');
    let metaName = null;
    let description = null;
    let entryCount = null;
    let parsedJson = null;
    try {
      const txt = await fs.readFile(full, 'utf8');
      const json = JSON.parse(txt);
      parsedJson = json;
      if (json && json.metadata && typeof json.metadata.name === 'string') {
        metaName = json.metadata.name.trim();
      }
      if (json && json.metadata && typeof json.metadata.description === 'string') {
        description = json.metadata.description.trim();
      }
      if (json && Array.isArray(json.entries)) {
        entryCount = json.entries.length;
      }
    } catch (e) {
      // ignore parse/read errors and fall back to filename
    }
    entries.push({ path: posixRel, parent, baseNameNoExt, metaName, description, entryCount, parsedJson, full });
  }

  // Warn if a folder contains JSON collection files but does not have a _metadata.json
  // Ignore any folder path that contains a segment beginning with '_' (these are special/tooling folders)
  const parentsWithCollections = new Set(entries.map(e => e.parent));
  function hasUnderscoreSegment(p) {
    if (!p || p === '.') return false;
    return p.split('/').some(seg => seg.startsWith('_'));
  }
  for (const parent of parentsWithCollections) {
    if (hasUnderscoreSegment(parent)) continue;
    if (!folderMetadata[parent]) {
      console.warn(`Warning: folder "${parent}" contains JSON files but is missing _metadata.json`);
    }
  }

  // Determine duplicates within each immediate folder and create display names
  const nameCountsByParent = {};
  for (const e of entries) {
    const key = e.parent;
    const nameKey = e.metaName || e.baseNameNoExt;
    nameCountsByParent[key] = nameCountsByParent[key] || {};
    nameCountsByParent[key][nameKey] = (nameCountsByParent[key][nameKey] || 0) + 1;
  }

  const collectionsWithNames = [];
  for (const e of entries) {
    const base = e.metaName || e.baseNameNoExt;
    const count = (nameCountsByParent[e.parent] && nameCountsByParent[e.parent][base]) || 0;
    const displayName = count > 1 ? `${base} (${e.baseNameNoExt})` : base;
    // If an existing metadata.name must be disambiguated, update the file and log it
    if (count > 1 && e.metaName && e.parsedJson) {
      console.log(`Disambiguating metadata.name for ${e.path}: "${e.metaName}" -> "${displayName}"`);
      try {
        const json = e.parsedJson;
        if (json && json.metadata && json.metadata.name === e.metaName) {
          json.metadata.name = displayName;
          await fs.writeFile(e.full, JSON.stringify(json, null, 2), 'utf8');
          console.log(`Wrote updated metadata.name to ${e.path}`);
        } else {
          console.log(`Skipped writing ${e.path}: metadata.name changed since read`);
        }
      } catch (err) {
        console.error(`Failed to update ${e.path}:`, err);
      }
    }
    // Build lightweight collection record for index
    collectionsWithNames.push({
      path: e.path,
      name: displayName,
      description: e.description || null,
      entries: (typeof e.entryCount === 'number') ? e.entryCount : null
    });
  }

  // Sort by path for deterministic output
  collectionsWithNames.sort((a, b) => a.path.localeCompare(b.path));

  const out = { folderMetadata, collections: collectionsWithNames };
  const outPath = path.join(collectionsDir, 'index.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Rebuilt ${outPath} (${collectionsFiles.length} entries)`);
}

if (require.main === module) rebuildIndex().catch(err => {
  console.error('Error rebuilding index:', err);
  process.exitCode = 1;
});

module.exports = { rebuildIndex };
