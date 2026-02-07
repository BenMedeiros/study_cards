const fs = require('fs').promises;
const path = require('path');

async function readJson(p) {
  const txt = await fs.readFile(p, 'utf8');
  return JSON.parse(txt);
}

function buildEnumMap(meta) {
  const enumMap = new Map();
  if (!meta) return { enumMap, conditionalFields: [] };
  for (const f of meta.fields || []) {
    if (f.type === 'enum' && f.values) enumMap.set(f.key, new Set(Object.keys(f.values)));
  }
  for (const c of meta.conditionalFields || []) {
    for (const f of c.fields || []) {
      if (f.type === 'enum' && f.values) enumMap.set(f.key, new Set(Object.keys(f.values)));
    }
  }
  return { enumMap, conditionalFields: meta.conditionalFields || [] };
}

function evaluateWhen(when, entry) {
  if (!when || !when.field) return false;
  const v = entry && Object.prototype.hasOwnProperty.call(entry, when.field) ? entry[when.field] : undefined;
  if (when.in && Array.isArray(when.in)) return when.in.includes(v);
  return false;
}

function findEntriesShape(data) {
  if (Array.isArray(data)) return { container: 'array', entries: data };
  if (Array.isArray(data.entries)) return { container: 'entries', entries: data.entries };
  if (data.root && Array.isArray(data.root.entries)) return { container: 'root.entries', entries: data.root.entries };
  // fallback: first top-level array
  const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
  if (arrKey) return { container: arrKey, entries: data[arrKey], arrKey };
  return { container: null, entries: null };
}

async function validateWordsDir() {
  const wordsDir = path.resolve(__dirname, '..', 'collections', 'japanese', 'words');
  const metaPath = path.join(wordsDir, '_metadata.json');

  let meta = null;
  try { meta = await readJson(metaPath); }
  catch (e) { console.log(`[warn] failed to read metadata ${metaPath}: ${e.message}`); }

  const { enumMap, conditionalFields } = buildEnumMap(meta || {});

  const files = await fs.readdir(wordsDir, { withFileTypes: true });
  const jsonFiles = files.filter(f => f.isFile() && f.name.endsWith('.json') && f.name !== '_metadata.json').map(f => path.join(wordsDir, f.name));

  let scanned = 0, updated = 0, enumIssues = 0, removedConditional = 0;

  for (const fp of jsonFiles) {
    scanned++;
    let data;
    try { data = await readJson(fp); } catch (e) { console.log(`[skip] ${path.relative(process.cwd(), fp)} — read error: ${e.message}`); continue; }
    const shape = findEntriesShape(data);
    if (!shape.entries) { console.log(`[skip] ${path.relative(process.cwd(), fp)} — no entries array found`); continue; }

    let changed = false;

    for (const ent of shape.entries) {
      // validate enums
      for (const [key, allowed] of enumMap.entries()) {
        if (ent.hasOwnProperty(key) && !allowed.has(String(ent[key]))) {
          enumIssues++;
          console.warn(`WARN [enum] invalid value for '${key}' in ${path.relative(process.cwd(), fp)}: '${ent[key]}' not in [${Array.from(allowed).join(', ')}]`);
        }
      }

      // enforce conditional fields
      for (const cond of conditionalFields) {
        const ok = evaluateWhen(cond.when, ent);
        for (const f of cond.fields || []) {
          if (!ok && ent.hasOwnProperty(f.key)) {
            delete ent[f.key];
            removedConditional++;
            changed = true;
            console.log(`[cond] removed '${f.key}' from ${path.relative(process.cwd(), fp)} because condition not met (when ${JSON.stringify(cond.when)})`);
          }
        }
      }
    }

    if (changed) {
      // write back preserving structure
      try {
        if (shape.container === 'array') {
          await fs.writeFile(fp, JSON.stringify(shape.entries, null, 2), 'utf8');
        } else if (shape.container === 'entries') {
          data.entries = shape.entries;
          await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
        } else if (shape.container === 'root.entries') {
          data.root.entries = shape.entries;
          await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
        } else if (shape.container && shape.arrKey) {
          data[shape.arrKey] = shape.entries;
          await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
        }
        updated++;
        console.log(`[write] updated ${path.relative(process.cwd(), fp)}`);
      } catch (e) {
        console.log(`[error] failed writing ${path.relative(process.cwd(), fp)}: ${e.message}`);
      }
    }
  }

  console.log('\nSummary:');
  console.log(`  scanned: ${scanned}`);
  console.log(`  updated: ${updated}`);
  console.log(`  enum issues: ${enumIssues}`);
  console.log(`  removed conditional fields: ${removedConditional}`);
}

if (require.main === module) {
  validateWordsDir().catch(err => { console.error(err); process.exitCode = 2; });
}

module.exports = { validateWordsDir };
