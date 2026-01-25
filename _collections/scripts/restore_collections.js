const fs = require('fs').promises;
const path = require('path');

const aggregatedDir = path.resolve(__dirname, '..'); // _collections
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
    if (exists && !overwrite) {
      return { skipped: true, reason: 'exists' };
    }
    await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
    return { written: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function restoreAggregated(aggregatedPath, options) {
  const name = path.basename(aggregatedPath, '.json');
  const targetBase = path.join(collectionsDir, name);
  const txt = await fs.readFile(aggregatedPath, 'utf8');
  const parsed = JSON.parse(txt);

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

  await recurse(parsed, targetBase);
  return actions;
}

function usage() {
  console.log('Usage: node restore_collections.js [--input <aggregated.json>] [--dry-run] [--overwrite]');
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
