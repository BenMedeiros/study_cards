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

function evaluateWhen(when, entry, defaults) {
  if (!when || !when.field) return false;
  const v = entry.hasOwnProperty(when.field) ? entry[when.field] : (defaults ? defaults[when.field] : undefined);
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

  let scanned = 0, updated = 0, enumIssues = 0, removedDefaults = 0, removedConditional = 0;
  let liftedTotal = 0;
  const liftedDetails = [];

  for (const fp of jsonFiles) {
    scanned++;
    let data;
    try { data = await readJson(fp); } catch (e) { console.log(`[skip] ${path.relative(process.cwd(), fp)} — read error: ${e.message}`); continue; }

      // determine where defaults live so we can update them when we lift common values
      let defaultsObj = null;
      let defaultsLocation = null; // 'defaults' or 'root.defaults'
      if (data.defaults) { defaultsObj = data.defaults; defaultsLocation = 'defaults'; }
      else if (data.root && data.root.defaults) { defaultsObj = data.root.defaults; defaultsLocation = 'root.defaults'; }
      else { defaultsObj = {}; defaultsLocation = 'defaults'; }
      const defaults = defaultsObj;
    const shape = findEntriesShape(data);
    if (!shape.entries) { console.log(`[skip] ${path.relative(process.cwd(), fp)} — no entries array found`); continue; }

    let changed = false;

    for (const ent of shape.entries) {
      // remove fields equal to defaults
      for (const k of Object.keys(defaults)) {
        if (ent.hasOwnProperty(k) && String(ent[k]) === String(defaults[k])) {
          delete ent[k];
          removedDefaults++;
          changed = true;
          console.log(`[clean] removed defaulted field '${k}' from ${path.relative(process.cwd(), fp)}`);
        }
      }

      // validate enums
      for (const [key, allowed] of enumMap.entries()) {
        if (ent.hasOwnProperty(key) && !allowed.has(String(ent[key]))) {
          enumIssues++;
          console.log(`[enum] invalid value for '${key}' in ${path.relative(process.cwd(), fp)}: '${ent[key]}' not in [${Array.from(allowed).join(', ')}]`);
        }
      }

      // enforce conditional fields
      for (const cond of conditionalFields) {
        const ok = evaluateWhen(cond.when, ent, defaults);
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

    // Lift common fields to defaults: if every entry has the same primitive value for a key
    // Track candidate keys with value set and occurrence count
    const candidateKeys = new Map();
    const totalEntries = shape.entries.length;
    for (const ent of shape.entries) {
      for (const k of Object.keys(ent)) {
        const v = ent[k];
        if (v === undefined || v === null) continue;
        if (typeof v === 'object') continue;
        if (k === 'kanji' || k === 'reading' || k === 'meaning') continue;
        if (!candidateKeys.has(k)) candidateKeys.set(k, { values: new Set(), count: 0 });
        const rec = candidateKeys.get(k);
        rec.values.add(String(v));
        rec.count += 1;
      }
    }

    const liftedKeys = [];
    for (const [k, { values, count }] of candidateKeys.entries()) {
      // Only lift when every entry has the key present (count === totalEntries)
      if (count === totalEntries && values.size === 1) {
        const val = Array.from(values)[0];
        if (!defaults.hasOwnProperty(k)) {
          // promote to defaults
          if (defaultsLocation === 'defaults') data.defaults = data.defaults || {}, data.defaults[k] = val;
          else if (defaultsLocation === 'root.defaults') data.root = data.root || {}, data.root.defaults = data.root.defaults || {}, data.root.defaults[k] = val;
          else data.defaults = data.defaults || {}, data.defaults[k] = val;

          // remove from entries
          for (const ent of shape.entries) {
            if (ent.hasOwnProperty(k)) delete ent[k];
          }
          liftedKeys.push({ key: k, value: val });
          changed = true;
          console.log(`[lift] promoted common field '${k}'='${val}' to defaults in ${path.relative(process.cwd(), fp)}`);
        }
      } else if (values.size === 1 && count < totalEntries) {
        // skip lifting because not all entries had the key
        console.log(`[lift-skip] key '${k}' has same value='${Array.from(values)[0]}' but present in ${count}/${totalEntries} entries; not lifted for ${path.relative(process.cwd(), fp)}`);
      }
    }
    if (liftedKeys.length) {
      liftedTotal += liftedKeys.length;
      liftedDetails.push({ file: path.relative(process.cwd(), fp), keys: liftedKeys });
      console.log(`[lift] promoted ${liftedKeys.length} field(s) in ${path.relative(process.cwd(), fp)}`);
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
  console.log(`  removed defaulted fields: ${removedDefaults}`);
  console.log(`  removed conditional fields: ${removedConditional}`);
  console.log(`  lifted default: ${liftedTotal}`);
  if (liftedDetails.length) {
    console.log('\nLifted defaults:');
    for (const d of liftedDetails) {
      const parts = d.keys.map(kv => `${kv.key}='${kv.value}'`).join(', ');
      console.log(`  ${d.file}: ${parts}`);
    }
  }
}

if (require.main === module) {
  validateWordsDir().catch(err => { console.error(err); process.exitCode = 2; });
}

module.exports = { validateWordsDir };
