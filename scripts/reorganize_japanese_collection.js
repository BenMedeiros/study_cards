const fs = require('fs').promises;
const path = require('path');

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

function applyDefaultsToEntry(entry, defaults) {
  if (!defaults) return entry;
  for (const [k, v] of Object.entries(defaults)) {
    if (entry[k] === undefined) entry[k] = v;
  }
  return entry;
}

function safeName(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '_');
}

async function reorganize() {
  const nounsDir = path.resolve(__dirname, '..', 'collections', 'japanese', 'nouns');
  const outputDir = path.join(nounsDir, 'output');
  const rel = p => path.relative(process.cwd(), p);

  const files = await fs.readdir(nounsDir, { withFileTypes: true });
  const jsonFiles = files
    .filter(f => f.isFile() && f.name.endsWith('.json'))
    .map(f => path.join(nounsDir, f.name));

  // collect all entries
  const allEntries = [];
  const sourceFiles = [];

  for (const fp of jsonFiles) {
    // skip files in output folder (there shouldn't be any here) but keep safe
    if (fp.includes(path.sep + 'output' + path.sep)) continue;
    const data = await readJson(fp);
    sourceFiles.push(fp);

    let defaults = data.defaults || data.root && data.root.defaults || {};

    // find entries: common shapes
    let entries = [];
    if (Array.isArray(data)) {
      entries = data;
    } else if (Array.isArray(data.entries)) {
      entries = data.entries;
    } else if (Array.isArray(data.root && data.root.entries)) {
      entries = data.root.entries;
    } else {
      // attempt to find any top-level array properties
      const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
      if (arrKey) entries = data[arrKey];
    }

    if (!Array.isArray(entries)) {
      console.warn(`[skip] ${rel(fp)} — no entries array found`);
      continue;
    }

    for (const ent of entries) {
      const copy = Object.assign({}, ent); // shallow copy
      applyDefaultsToEntry(copy, defaults);
      allEntries.push({ entry: copy, source: fp });
    }
  }

  // Group by type and orthography
  const groups = new Map(); // key -> { type, orthography, entries: [] }
  for (const { entry } of allEntries) {
    const type = (entry.type === undefined || entry.type === null) ? undefined : String(entry.type);
    const orth = (entry.orthography === undefined || entry.orthography === null) ? undefined : String(entry.orthography);
    const key = `${type ?? ''}::::${orth ?? ''}`;
    if (!groups.has(key)) groups.set(key, { type, orthography: orth, entries: [] });
    groups.get(key).entries.push(Object.assign({}, entry));
  }

  // Ensure output dir
  await fs.mkdir(outputDir, { recursive: true });

  // Organize groups by type to allow making a single "mixed" group per type
  const groupsByType = new Map(); // typeKey -> [{ type, orthography, entries }]
  for (const [k, g] of groups.entries()) {
    const typeKey = g.type === undefined || g.type === null ? '__NO_TYPE__' : String(g.type);
    if (!groupsByType.has(typeKey)) groupsByType.set(typeKey, []);
    groupsByType.get(typeKey).push(g);
  }

  const outputs = [];

  for (const [typeKey, orthGroups] of groupsByType.entries()) {
    // compute counts and sort by size (smallest first)
    const groupsSorted = orthGroups.map(g => ({
      orthography: g.orthography,
      entries: g.entries,
      count: g.entries.length
    })).sort((a, b) => a.count - b.count);

    // build at most one mixed group by taking smallest groups until adding next would exceed 40
    const mixed = [];
    let mixedCount = 0;
    for (const g of groupsSorted) {
      if (mixedCount + g.count <= 40) {
        mixed.push(g);
        mixedCount += g.count;
      } else {
        break;
      }
    }

    // remove mixed groups from the list of groups to write individually
    const mixedSet = new Set(mixed.map(m => m.orthography === undefined ? '__U__' : String(m.orthography)));
    const remaining = groupsSorted.filter(g => !mixedSet.has(g.orthography === undefined ? '__U__' : String(g.orthography)));

    // write remaining homogeneous groups (have defaults for type and orthography)
    for (const g of remaining) {
      const parts = [];
      const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;
      if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
      if (g.orthography !== undefined && g.orthography !== null) parts.push(safeName(g.orthography) || 'orth');
      const fileName = (parts.length ? parts.join('__') : 'ungrouped') + '.json';
      const outPath = path.join(outputDir, fileName);

      const defaults = {};
      if (typeVal !== undefined) defaults.type = typeVal;
      if (g.orthography !== undefined && g.orthography !== null) defaults.orthography = g.orthography;

      const entriesToWrite = g.entries.map(e => {
        const copy = Object.assign({}, e);
        for (const k of Object.keys(defaults)) {
          if (copy[k] !== undefined && String(copy[k]) === String(defaults[k])) delete copy[k];
        }
        return copy;
      });

      const namePart = `${typeVal ?? 'no-type'}` + (g.orthography ? ` (${g.orthography})` : '');
      const totalCount = entriesToWrite.length;
      const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''}${g.orthography ? " and orthography='"+g.orthography+"'" : ''} — total ${totalCount}.`;
      const outJson = {
        metadata: {
          name: `Japanese ${namePart}`,
          description: desc,
          version: 1
        },
        defaults: defaults,
        entries: entriesToWrite
      };

      await fs.writeFile(outPath, JSON.stringify(outJson, null, 2), 'utf8');
      outputs.push(outPath);
      console.log(`[write] ${rel(outPath)} — ${entriesToWrite.length} entries\n`);
    }

    // write a single mixed group if any were collected
    if (mixed.length > 0) {
      // If mixed only contains a single orthography, treat it as a homogeneous group
      if (mixed.length === 1) {
        const m = mixed[0];
        const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;
        const parts = [];
        if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
        if (m.orthography !== undefined && m.orthography !== null) parts.push(safeName(m.orthography) || 'orth');
        const fileName = (parts.length ? parts.join('__') : 'ungrouped') + '.json';
        const outPath = path.join(outputDir, fileName);

        const defaults = {};
        if (typeVal !== undefined) defaults.type = typeVal;
        if (m.orthography !== undefined && m.orthography !== null) defaults.orthography = m.orthography;

        const entriesToWrite = m.entries.map(e => {
          const copy = Object.assign({}, e);
          for (const k of Object.keys(defaults)) {
            if (copy[k] !== undefined && String(copy[k]) === String(defaults[k])) delete copy[k];
          }
          return copy;
        });

        const totalCount = entriesToWrite.length;
        const namePart = `${typeVal ?? 'no-type'}` + (m.orthography ? ` (${m.orthography})` : '');
        const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''}${m.orthography ? " and orthography='"+m.orthography+"'" : ''} — total ${totalCount}.`;
        const outJson = {
          metadata: {
            name: `Japanese ${namePart}`,
            description: desc,
            version: 1
          },
          defaults: defaults,
          entries: entriesToWrite
        };

        await fs.writeFile(outPath, JSON.stringify(outJson, null, 2), 'utf8');
        outputs.push(outPath);
        console.log(`[write][homogeneous] ${rel(outPath)} — ${entriesToWrite.length} entries\n`);
        // done with mixed handling for this type
        continue;
      }
      const mixedEntries = [];
      for (const m of mixed) {
        for (const e of m.entries) {
          mixedEntries.push(Object.assign({}, e));
        }
      }

      const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;
      const parts = [];
      if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
      parts.push('mixed');
      const fileName = parts.join('__') + '.json';
      const outPath = path.join(outputDir, fileName);

        // For mixed group: include defaults.type when available (but not orthography).
        const defaultsForMixed = {};
        if (typeVal !== undefined) defaultsForMixed.type = typeVal;

        // Remove the type property from entries when it matches the default to keep files compact
        const mixedEntriesNormalized = mixedEntries.map(e => {
          const copy = Object.assign({}, e);
          if (defaultsForMixed.type !== undefined && copy.type !== undefined && String(copy.type) === String(defaultsForMixed.type)) {
            delete copy.type;
          }
          return copy;
        });

        // build per-orthography counts for description
        const orthoCounts = new Map();
        for (const m of mixed) {
          const label = m.orthography === undefined || m.orthography === null ? 'none' : String(m.orthography);
          orthoCounts.set(label, (orthoCounts.get(label) || 0) + m.count);
        }
        const totalCount = mixedEntriesNormalized.length;
        const perOrthoParts = Array.from(orthoCounts.entries()).map(([k, v]) => `${k}: ${v}`);
        const desc = `Mixed orthography group for type='${typeVal ?? 'undefined'}' — total ${totalCount}` + (perOrthoParts.length ? ` (${perOrthoParts.join(', ')})` : '') + '.';

        const outJson = {
          metadata: {
            name: `Japanese ${typeVal ?? 'no-type'} (mixed)`,
            description: desc,
            version: 1
          },
          defaults: Object.keys(defaultsForMixed).length ? defaultsForMixed : undefined,
          entries: mixedEntriesNormalized
        };

      await fs.writeFile(outPath, JSON.stringify(outJson, null, 2), 'utf8');
      outputs.push(outPath);
      console.log(`[write][mixed] ${rel(outPath)} — ${mixedEntriesNormalized.length} entries\n`);
    }
  }

  const inputCount = allEntries.length;
  const outputCount = outputs.reduce((sum, p) => {
    const txt = require('fs').readFileSync(p, 'utf8');
    const parsed = JSON.parse(txt);
    return sum + (Array.isArray(parsed.entries) ? parsed.entries.length : 0);
  }, 0);
  console.log(`\nSummary: input=${inputCount}, output=${outputCount}\n`);

  if (inputCount !== outputCount) {
    console.error(`[ERROR] total entries mismatch: input=${inputCount} != output=${outputCount}. Aborting.`);
    process.exitCode = 1;
    return;
  }

  // delete original input files (only those we read)
  for (const fp of sourceFiles) {
    await fs.unlink(fp);
    console.log(`[delete] ${rel(fp)}`);
  }

  // move outputs into nounsDir (overwrite if existing)
  for (const outP of outputs) {
    const base = path.basename(outP);
    const dest = path.join(nounsDir, base);
    try {
      // remove destination if exists
      await fs.unlink(dest).catch(() => {});
      await fs.rename(outP, dest);
      console.log(`[move] ${rel(outP)} -> ${rel(dest)}`);
    } catch (err) {
      console.error(`[error] Failed moving ${rel(outP)} -> ${rel(dest)}: ${err && err.message ? err.message : err}`);
      throw err;
    }
  }

  // optionally remove output dir if empty
  try {
    const remaining = await fs.readdir(outputDir);
    if (remaining.length === 0) await fs.rmdir(outputDir);
  } catch(e){}

  console.log('\nReorganization complete.\n');
}

if (require.main === module) {
  reorganize().catch(err => {
    console.error(err);
    process.exitCode = 2;
  });
}
