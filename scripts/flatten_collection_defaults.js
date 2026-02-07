/**
 * Flatten per-file defaults into each entry and remove the defaults object.
 *
 * Supports legacy locations:
 * - top-level `defaults`
 * - `root.defaults`
 *
 * Applies defaults shallowly: for each entry, fills only missing keys
 * (i.e. `entry[k] === undefined`).
 *
 * Usage:
 *   node scripts/flatten_collection_defaults.js --dry-run
 *   node scripts/flatten_collection_defaults.js --write
 */

const fs = require('fs').promises;
const path = require('path');

const collectionsDir = path.resolve(__dirname, '..', 'collections');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const dryRun = args.has('--dry-run') || (!args.has('--write') && !args.has('-w'));
  const write = args.has('--write') || args.has('-w');
  const verbose = args.has('--verbose') || args.has('-v');
  return { dryRun, write, verbose };
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

async function readJsonFile(fp) {
  const txt = await fs.readFile(fp, 'utf8');
  return JSON.parse(txt);
}

function findEntriesShape(data) {
  if (Array.isArray(data)) return { container: 'array', entries: data };
  if (data && Array.isArray(data.entries)) return { container: 'entries', entries: data.entries };
  if (data && data.root && Array.isArray(data.root.entries)) return { container: 'root.entries', entries: data.root.entries };
  return { container: null, entries: null };
}

function getDefaultsLocation(data) {
  if (data && data.defaults && typeof data.defaults === 'object' && !Array.isArray(data.defaults)) {
    return { location: 'defaults', defaults: data.defaults };
  }
  if (data && data.root && data.root.defaults && typeof data.root.defaults === 'object' && !Array.isArray(data.root.defaults)) {
    return { location: 'root.defaults', defaults: data.root.defaults };
  }
  return { location: null, defaults: null };
}

function shallowCloneJsonValue(v) {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice();
  return { ...v };
}

function applyDefaultsToEntries(entries, defaults) {
  if (!defaults || typeof defaults !== 'object') return { applied: 0, touchedEntries: 0 };
  const keys = Object.keys(defaults);
  if (!keys.length) return { applied: 0, touchedEntries: 0 };

  let applied = 0;
  let touchedEntries = 0;
  for (const ent of entries) {
    if (!ent || typeof ent !== 'object' || Array.isArray(ent)) continue;
    let touched = false;
    for (const k of keys) {
      if (typeof ent[k] === 'undefined') {
        ent[k] = shallowCloneJsonValue(defaults[k]);
        applied++;
        touched = true;
      }
    }
    if (touched) touchedEntries++;
  }
  return { applied, touchedEntries };
}

function removeDefaultsFromData(data, location) {
  if (!location) return false;
  if (location === 'defaults') {
    if (Object.prototype.hasOwnProperty.call(data, 'defaults')) {
      delete data.defaults;
      return true;
    }
    return false;
  }
  if (location === 'root.defaults') {
    if (data.root && Object.prototype.hasOwnProperty.call(data.root, 'defaults')) {
      delete data.root.defaults;
      return true;
    }
    return false;
  }
  return false;
}

function shouldSkipCollectionFile(relPosix) {
  const base = path.posix.basename(relPosix);
  if (relPosix === 'index.json') return true;
  if (base === '_metadata.json') return true;
  if (base === '_collectionSets.json') return true;
  if (base.startsWith('_')) return true;
  return false;
}

async function flattenAll({ dryRun, write, verbose }) {
  const files = await walk(collectionsDir);

  let scanned = 0;
  let changed = 0;
  let skipped = 0;
  let defaultsFiles = 0;
  let totalApplied = 0;

  for (const fp of files) {
    const rel = path.relative(collectionsDir, fp).split(path.sep).join('/');
    if (shouldSkipCollectionFile(rel)) {
      skipped++;
      continue;
    }

    scanned++;

    let data;
    try {
      data = await readJsonFile(fp);
    } catch (e) {
      console.warn(`[skip] ${rel} — parse/read error: ${e.message}`);
      skipped++;
      continue;
    }

    const { location, defaults } = getDefaultsLocation(data);
    if (!location || !defaults || !Object.keys(defaults).length) {
      continue;
    }

    const shape = findEntriesShape(data);
    if (!Array.isArray(shape.entries)) {
      if (verbose) console.warn(`[skip] ${rel} — has ${location} but no entries array`);
      continue;
    }

    defaultsFiles++;

    const beforeTxt = JSON.stringify(data);
    const { applied, touchedEntries } = applyDefaultsToEntries(shape.entries, defaults);
    const removed = removeDefaultsFromData(data, location);
    const afterTxt = JSON.stringify(data);

    totalApplied += applied;

    if (verbose) {
      console.log(`[flatten] ${rel} — ${location} keys=${Object.keys(defaults).length}, touchedEntries=${touchedEntries}, appliedFields=${applied}, removedDefaults=${removed}`);
    }

    if (beforeTxt !== afterTxt) {
      changed++;
      if (write && !dryRun) {
        await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
      }
    }
  }

  console.log('\nFlatten defaults summary:');
  console.log(`  scanned: ${scanned}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  files with defaults: ${defaultsFiles}`);
  console.log(`  changed: ${changed}`);
  console.log(`  total applied fields: ${totalApplied}`);
  console.log(`  mode: ${dryRun ? 'dry-run' : 'write'}`);

  if (dryRun) {
    console.log("\nTip: run again with `--write` to apply changes.");
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  flattenAll(opts).catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
}

module.exports = { flattenAll };
