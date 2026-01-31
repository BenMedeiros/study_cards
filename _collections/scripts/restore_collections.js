const fs = require('fs').promises;
const path = require('path');

const aggregatedDir = path.resolve(__dirname, '..', 'aggregates'); // _collections/aggregates
const collectionsDir = path.resolve(__dirname, '..', '..', 'collections');

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function isFileNode(val) {
  if (!isPlainObject(val)) return true; // array or primitive -> file
  // if any child is not a plain object (array/primitive/null), treat as file
  return Object.values(val).some(child => !isPlainObject(child));
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFileIfAllowed(filePath, content, overwrite) {
  try {
    const exists = await fs.stat(filePath).then(() => true).catch(() => false);
    // If the file exists and overwrite not requested, normally skip.
    // However, we want to ensure `_metadata.json` is kept up-to-date: if the
    // contents differ, rewrite it even without `--overwrite` so metadata is
    // rebuilt when changed in the aggregated file.
    if (exists) {
      if (!overwrite && path.basename(filePath) !== '_metadata.json') {
        return { skipped: true, reason: 'exists' };
      }
      // Read existing content to compare
      try {
        const existingTxt = await fs.readFile(filePath, 'utf8');
        let existing;
        try { existing = JSON.parse(existingTxt); } catch (e) { existing = existingTxt; }
        if (deepEqual(existing, content)) return { skipped: true, reason: 'identical' };
        // If different and either overwrite is true or it's _metadata.json, fallthrough to write
      } catch (e) {
        // Couldn't read/parse existing file; proceed to write
      }
    }
    await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
    return { written: true };
  } catch (err) {
    return { error: err.message };
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

async function restoreAggregated(aggregatedPath, options) {
  const name = path.basename(aggregatedPath, '.json');
  const targetBase = path.join(collectionsDir, name);
  const txt = await fs.readFile(aggregatedPath, 'utf8');
  const parsed = JSON.parse(txt);

  // Support aggregator's wrapper: { collections: { ... }, _metadata?: ... }
  const source = parsed.collections && isPlainObject(parsed.collections) ? parsed.collections : parsed;

  const actions = [];

  async function recurse(obj, curPath) {
    await ensureDir(curPath);
    for (const [key, val] of Object.entries(obj)) {
      if (isFileNode(val)) {
        const filePath = path.join(curPath, `${key}.json`);
        if (options.dryRun) {
          actions.push({ action: 'write', path: filePath });
        } else {
          const res = await writeFileIfAllowed(filePath, val, options.overwrite);
          actions.push(Object.assign({ action: 'write', path: filePath }, res));
        }
      } else {
        const dirPath = path.join(curPath, key);
        if (options.dryRun) {
          actions.push({ action: 'mkdir', path: dirPath });
        } else {
          await ensureDir(dirPath);
          actions.push({ action: 'mkdir', path: dirPath });
        }
        await recurse(val, path.join(curPath, key));
      }
    }
  }
  // If there is top-level _metadata, write it to targetBase/_metadata.json
  // Ensure target directory exists so metadata can be written on first run
  await ensureDir(targetBase);
  if (parsed && parsed._metadata !== undefined) {
    const metaPath = path.join(targetBase, '_metadata.json');
    if (options.dryRun) {
      actions.push({ action: 'write', path: metaPath });
    } else {
      const res = await writeFileIfAllowed(metaPath, parsed._metadata, options.overwrite);
      actions.push(Object.assign({ action: 'write', path: metaPath }, res));
    }
  }

  await recurse(source, targetBase);
  return actions;
}

function usage() {
  console.log('Usage: node restore_collections.js [--input <aggregates/<aggregated>.json>] [--dry-run] [--overwrite]');
}

async function main() {
  const argv = process.argv.slice(2);
  const options = { dryRun: false, overwrite: false, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') options.dryRun = true;
    else if (a === '--overwrite') options.overwrite = true;
    else if (a === '--input') options.input = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); return; }
    else { console.warn('Unknown arg', a); usage(); return; }
  }

  try {
    const targets = [];
    if (options.input) {
      targets.push(path.resolve(options.input));
    } else {
      const entries = await fs.readdir(aggregatedDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
          if (ent.name === 'index.json') continue;
          targets.push(path.join(aggregatedDir, ent.name));
        }
      }
    }

    const allActions = [];
    for (const t of targets) {
      console.log(`Restoring ${t} -> collections/`);
      const acts = await restoreAggregated(t, options);
      allActions.push({ file: t, actions: acts });
    }

    console.log('Done. Actions:');
    for (const group of allActions) {
      console.log(`- ${group.file}: ${group.actions.length} steps`);
    }
    if (options.dryRun) console.log('Dry run; no files written.');
  } catch (err) {
    console.error('Error restoring collections:', err.message || err);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { restoreAggregated, isFileNode };
