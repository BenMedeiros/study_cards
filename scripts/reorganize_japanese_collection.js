const fs = require('fs').promises;
// NOTE: configuration lives in this script (no external config file).
const path = require('path');

// Configuration (edit here to change grouping behavior)
// grouping.groupByKeys: ordered list of entry properties used to form groups.
//   e.g. ['type','orthography'] groups by type__orthography.
// grouping.maxMixedEntries: when building a "mixed" group, include smallest
//   groups until this threshold would be exceeded.
// behavior.outputDirName: name of the temporary output dir inside words/
// behavior.deleteOriginalFiles: whether to delete original source files
const DEFAULT_CONFIG = {
  grouping: {
    groupByKeys: ['type', 'orthography'],
    maxMixedEntries: 40,
    mixSmallestFirst: true
  },
  behavior: {
    outputDirName: 'output',
    deleteOriginalFiles: true
  }
};

const CONFIG = DEFAULT_CONFIG;

/*
Overview - reorganize_japanese_collection.js

This script reads JSON files from collections/japanese/words, groups entries
by the ordered keys in `CONFIG.grouping.groupByKeys` (default ['type','orthography']),
and writes consolidated files back into the same directory.

Key behaviors:
- Per-file defaults: when reading source files, per-file `defaults` are collected
  and merged into group-level defaults. Consistent defaults (same key/value
  across all sources in a group) are preserved and written to output files.
- Lifting defaults: primitive fields that appear with the same value across
  every entry in a source file are promoted into that file's defaults (in-memory)
  before grouping. For enum fields (discovered from _metadata.json), the most
  common value will be promoted when it is a strict majority (> floor(n/2)).
  This reduces redundancy even for "mixed" files.
- Type-aggregation: if the total number of entries for a first-key group
  (e.g. a single `type` across all orthographies) is <= `CONFIG.grouping.maxMixedEntries`,
  the script writes a single type-level file (no `mixed` suffix) and includes
  any common defaults.
- Mixed-group defaults: when creating mixed output files, the script computes
  the intersection of subgroup defaults and promotes those into the mixed file's
  `defaults` object; matching fields are removed from entries for compactness.

Note: this script performs in-memory lifting and grouping and writes new files
into the `words` directory. It preserves versioning by comparing normalized
entries and bumping `metadata.version` when content changes.
*/

// Helper to produce a deterministic group key and a friendly label
function makeGroupKeyFromEntry(entry) {
  const parts = CONFIG.grouping.groupByKeys.map(k => {
    const v = entry[k];
    return v === undefined || v === null ? '' : String(v);
  });
  return parts.join('::::');
}

function makeGroupLabelFromKey(key) {
  const parts = key.split('::::');
  return CONFIG.grouping.groupByKeys.map((k, i) => `${k}='${parts[i] || ''}'`).join(', ');
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return JSON.parse(txt);
}

// Determine where entries live in a data blob and return shape info
function findEntriesShape(data) {
  if (Array.isArray(data)) return { container: 'array', entries: data };
  if (Array.isArray(data.entries)) return { container: 'entries', entries: data.entries };
  if (data.root && Array.isArray(data.root.entries)) return { container: 'root.entries', entries: data.root.entries };
  const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
  if (arrKey) return { container: arrKey, entries: data[arrKey], arrKey };
  return { container: null, entries: null };
}

// Lift primitive fields common to every entry into the defaults section in-memory.
// For enum keys, lift the most-common value when it is a strict majority.
// Returns an object { changed: bool, liftedKeys: [{key,value}] }
function liftCommonFields(data, fp, enumMap) {
  const shape = findEntriesShape(data);
  if (!shape.entries) return { changed: false, liftedKeys: [] };

  // determine where defaults live
  let defaultsObj = null;
  let defaultsLocation = null; // 'defaults' or 'root.defaults'
  if (data.defaults) { defaultsObj = data.defaults; defaultsLocation = 'defaults'; }
  else if (data.root && data.root.defaults) { defaultsObj = data.root.defaults; defaultsLocation = 'root.defaults'; }
  else { defaultsObj = {}; defaultsLocation = 'defaults'; }

  const candidateKeys = new Map();
  const totalEntries = shape.entries.length;
  for (const ent of shape.entries) {
    for (const k of Object.keys(ent)) {
      const v = ent[k];
      if (v === undefined || v === null) continue;
      if (typeof v === 'object') continue;
      if (k === 'kanji' || k === 'reading' || k === 'meaning') continue;
      if (!candidateKeys.has(k)) candidateKeys.set(k, { freq: new Map(), count: 0 });
      const rec = candidateKeys.get(k);
      const sv = String(v);
      rec.freq.set(sv, (rec.freq.get(sv) || 0) + 1);
      rec.count += 1;
    }
  }

  const liftedKeys = [];
  for (const [k, rec] of candidateKeys.entries()) {
    const values = Array.from(rec.freq.keys());
    const count = rec.count;
    // Non-enum: prefer to lift when either unanimous or when a strict majority
    // of all entries share the same primitive value. This allows defaults to
    // flip over time as new records arrive.
    if (!enumMap || !enumMap.has(k)) {
      // determine most common value and its count
      let best = null; let bestCount = 0;
      for (const [val, c] of rec.freq.entries()) { if (c > bestCount) { best = val; bestCount = c; } }
      const unanimous = (count === totalEntries && values.length === 1);
      const majority = (best !== null && bestCount > Math.floor(totalEntries / 2));
      if (unanimous || majority) {
        const val = unanimous ? values[0] : best;
        const shouldSetDefault = !defaultsObj.hasOwnProperty(k) || String(defaultsObj[k]) !== String(val);
        if (shouldSetDefault) {
          if (defaultsLocation === 'defaults') data.defaults = data.defaults || {}, data.defaults[k] = val;
          else if (defaultsLocation === 'root.defaults') data.root = data.root || {}, data.root.defaults = data.root.defaults || {}, data.root.defaults[k] = val;
          else data.defaults = data.defaults || {}, data.defaults[k] = val;
          for (const ent of shape.entries) { if (ent.hasOwnProperty(k) && String(ent[k]) === String(val)) delete ent[k]; }
          liftedKeys.push({ key: k, value: val });
        }
      }
    } else {
      // Enum key: lift the most common value if it's a strict majority
      let best = null; let bestCount = 0;
      for (const [val, c] of rec.freq.entries()) { if (c > bestCount) { best = val; bestCount = c; } }
      if (best !== null && bestCount > Math.floor(totalEntries / 2)) {
        // For enum keys, promote the majority value. If a default exists but
        // disagrees with the majority, replace it so entries reflect the majority.
        const shouldSetEnumDefault = !defaultsObj.hasOwnProperty(k) || String(defaultsObj[k]) !== String(best);
        if (shouldSetEnumDefault) {
          if (defaultsLocation === 'defaults') data.defaults = data.defaults || {}, data.defaults[k] = best;
          else if (defaultsLocation === 'root.defaults') data.root = data.root || {}, data.root.defaults = data.root.defaults || {}, data.root.defaults[k] = best;
          else data.defaults = data.defaults || {}, data.defaults[k] = best;
          for (const ent of shape.entries) { if (ent.hasOwnProperty(k) && String(ent[k]) === String(best)) delete ent[k]; }
          liftedKeys.push({ key: k, value: best });
        }
      } else {
        // no majority
        // leave as-is
      }
    }
  }

  if (liftedKeys.length) {
    console.log(`[lift] promoted ${liftedKeys.length} field(s) in ${path.relative(process.cwd(), fp)}`);
    for (const lk of liftedKeys) console.log(`  ${lk.key}='${lk.value}'`);
    return { changed: true, liftedKeys };
  }
  return { changed: false, liftedKeys: [] };
}

function buildEnumMap(meta) {
  const enumMap = new Set();
  if (!meta) return enumMap;
  for (const f of meta.fields || []) {
    if (f.type === 'enum' && f.key) enumMap.add(f.key);
  }
  for (const c of meta.conditionalFields || []) {
    for (const f of c.fields || []) if (f.type === 'enum' && f.key) enumMap.add(f.key);
  }
  return enumMap;
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
  const wordsDir = path.resolve(__dirname, '..', 'collections', 'japanese', 'words');
  const outputDir = path.join(wordsDir, CONFIG.behavior.outputDirName || 'output');
  const rel = p => path.relative(process.cwd(), p);

  // load words metadata to determine enum fields that can be lifted partially
  const metaPath = path.join(wordsDir, '_metadata.json');
  let meta = null;
  try { meta = await readJson(metaPath); } catch (e) { /* ignore */ }
  const enumMap = buildEnumMap(meta || {});

  const files = await fs.readdir(wordsDir, { withFileTypes: true });
  const jsonFiles = files
    .filter(f => f.isFile() && f.name.endsWith('.json') && !f.name.startsWith('_'))
    .map(f => path.join(wordsDir, f.name));

  // collect all entries
  const allEntries = [];
  const sourceFiles = [];
  const seenKanjiByType = new Map(); // type -> Set(kanji)
  let liftedTotal = 0;
  const liftedDetails = [];

  for (const fp of jsonFiles) {
    // skip files in output folder (there shouldn't be any here) but keep safe
    if (fp.includes(path.sep + (CONFIG.behavior.outputDirName || 'output') + path.sep)) continue;
    // skip files that start with '_' (internal/hidden files)
    if (path.basename(fp).startsWith('_')) continue;
    const data = await readJson(fp);
    sourceFiles.push(fp);

    // Lift common primitive fields into defaults (in-memory) so grouping benefits
    try {
      const liftRes = liftCommonFields(data, fp, enumMap);
      if (liftRes.changed && liftRes.liftedKeys && liftRes.liftedKeys.length) {
        liftedTotal += liftRes.liftedKeys.length;
        liftedDetails.push({ file: rel(fp), keys: liftRes.liftedKeys });
      }
    } catch (e) {
      console.warn(`[lift] failed for ${rel(fp)}: ${e && e.message ? e.message : e}`);
    }

    let defaults = data.defaults || (data.root && data.root.defaults) || {};

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
      // warn on duplicate kanji for the same type
      try {
        const t = copy.type === undefined || copy.type === null ? '__NO_TYPE__' : String(copy.type);
        const k = copy.kanji === undefined || copy.kanji === null ? null : String(copy.kanji);
        if (k) {
          if (!seenKanjiByType.has(t)) seenKanjiByType.set(t, new Set());
          const s = seenKanjiByType.get(t);
          if (s.has(k)) {
            console.warn(`[dup] duplicate kanji '${k}' for type='${t}' — source ${rel(fp)} ` + (copy.orthography ? `(orth='${copy.orthography}')` : ''));
          } else {
            s.add(k);
          }
        }
      } catch(e) {}
      // attach the source file's defaults (shallow) so grouping can preserve them
      allEntries.push({ entry: copy, source: fp, defaults: Object.assign({}, defaults) });
    }
  }

  // Group by configured keys
  const groups = new Map(); // key -> { key, values: [...], entries: [] }
  for (const { entry, defaults: entryDefaults } of allEntries) {
    const key = makeGroupKeyFromEntry(entry);
    if (!groups.has(key)) {
      const values = CONFIG.grouping.groupByKeys.map(k => {
        const v = entry[k];
        return v === undefined || v === null ? undefined : String(v);
      });
      groups.set(key, { key, values, entries: [], defaults: entryDefaults ? Object.assign({}, entryDefaults) : {} });
    }
    const g = groups.get(key);
    // merge defaults: keep only keys that are consistent across sources
    if (entryDefaults) {
      for (const dk of Object.keys(g.defaults || {})) {
        if (!entryDefaults.hasOwnProperty(dk) || String(entryDefaults[dk]) !== String(g.defaults[dk])) {
          delete g.defaults[dk];
        }
      }
      // add any defaults from this source that g.defaults doesn't have yet
      for (const dk of Object.keys(entryDefaults)) {
        if (!g.defaults.hasOwnProperty(dk)) g.defaults[dk] = entryDefaults[dk];
      }
    }
    g.entries.push(Object.assign({}, entry));
  }

  // Log summary of groups formed
  console.log(`\n[groups] Formed ${groups.size} groups by ${CONFIG.grouping.groupByKeys.join('__')}`);
  for (const [k, g] of groups.entries()) {
    const label = CONFIG.grouping.groupByKeys.map((kk, i) => `${kk}='${g.values[i] ?? ''}'`).join(', ');
    console.log(`  ${label} — ${g.entries.length}`);
  }

  // Ensure output dir
  await fs.mkdir(outputDir, { recursive: true });

  // Organize groups by type to allow making a single "mixed" group per type
  // Map configured grouping keys into `.type` and `.orthography` fields so
  // downstream logic can remain largely unchanged.
  const groupsByType = new Map(); // typeKey -> [{ type, orthography, entries }]
  for (const [k, g] of groups.entries()) {
    const valueMap = {};
    CONFIG.grouping.groupByKeys.forEach((kk, i) => {
      valueMap[kk] = g.values[i];
    });
    const typeVal = valueMap.type === undefined || valueMap.type === null ? undefined : valueMap.type;
    const orthVal = valueMap.orthography === undefined || valueMap.orthography === null ? undefined : valueMap.orthography;
    const typeKey = typeVal === undefined ? '__NO_TYPE__' : String(typeVal);
    if (!groupsByType.has(typeKey)) groupsByType.set(typeKey, []);
    groupsByType.get(typeKey).push({ type: typeVal, orthography: orthVal, entries: g.entries, defaults: g.defaults || {} });
  }

  const outputs = [];
  const wrote = [];
  const preserved = [];
  const deleted = [];
  const bumped = [];

  for (const [typeKey, orthGroups] of groupsByType.entries()) {
    // compute counts and sort by size (smallest first)
    const groupsSorted = orthGroups.map(g => ({
      orthography: g.orthography,
      entries: g.entries,
      count: g.entries.length,
      defaults: g.defaults || {}
    })).sort((a, b) => a.count - b.count);

    // If the entire first-key group fits under the maxMixedEntries threshold,
    // write a single file for the first-key (e.g. type) and skip subdividing.
    const maxMixed = CONFIG.grouping.maxMixedEntries || 40;
    const totalForType = groupsSorted.reduce((s, g) => s + g.count, 0);
    if (totalForType > 0 && totalForType <= maxMixed) {
      // combine all entries and compute intersection of defaults across subgroups
      const combinedEntries = [];
      const defaultsList = groupsSorted.map(g => g.defaults || {});
      const commonDefaults = {};
      if (defaultsList.length) {
        const first = defaultsList[0];
        for (const k of Object.keys(first)) {
          let ok = true;
          for (let i = 1; i < defaultsList.length; i++) {
            if (!defaultsList[i].hasOwnProperty(k) || String(defaultsList[i][k]) !== String(first[k])) { ok = false; break; }
          }
          if (ok) commonDefaults[k] = first[k];
        }
      }
      const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;
      if (typeVal !== undefined) commonDefaults.type = typeVal;

      for (const g of groupsSorted) {
        for (const e of g.entries) combinedEntries.push(Object.assign({}, e));
      }

      const parts = [];
      if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
      const fileName = (parts.length ? parts.join('__') : 'ungrouped') + '.json';
      const dest = path.join(wordsDir, fileName);

      const entriesToWrite = combinedEntries.map(e => {
        const copy = Object.assign({}, e);
        for (const k of Object.keys(commonDefaults)) {
          if (copy.hasOwnProperty(k) && String(copy[k]) === String(commonDefaults[k])) delete copy[k];
        }
        return copy;
      });

      const namePart = `${typeVal ?? 'no-type'}`;
      const totalCount = entriesToWrite.length;
      const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''} — total ${totalCount}.`;
      const outJson = {
        metadata: {
          name: `Japanese ${namePart}`,
          description: desc,
          version: 1
        },
        defaults: Object.keys(commonDefaults).length ? commonDefaults : undefined,
        entries: entriesToWrite
      };

      try {
        const destTxt = await require('fs').promises.readFile(dest, 'utf8');
        const destParsed = JSON.parse(destTxt);
        const destEntries = Array.isArray(destParsed.entries) ? destParsed.entries : [];
        const outEntries = Array.isArray(outJson.entries) ? outJson.entries : [];
        const normalize = arr => arr.map(e => JSON.stringify(e)).sort().join('\n');
        if (normalize(destEntries) !== normalize(outEntries)) {
          const destVer = destParsed.metadata && typeof destParsed.metadata.version === 'number' ? destParsed.metadata.version : undefined;
          const newVer = destVer !== undefined ? destVer + 1 : (typeof outJson.metadata.version === 'number' ? outJson.metadata.version + 1 : 2);
          outJson.metadata.version = newVer;
          bumped.push({ path: rel(dest), from: destParsed.metadata && destParsed.metadata.version, to: newVer, fromCount: destEntries.length, toCount: outEntries.length });
        } else {
          if (destParsed.metadata && typeof destParsed.metadata.version === 'number') {
            outJson.metadata = outJson.metadata || {};
            outJson.metadata.version = destParsed.metadata.version;
          }
        }
      } catch (e) {
        if (!outJson.metadata || typeof outJson.metadata.version !== 'number') outJson.metadata = outJson.metadata || {}, outJson.metadata.version = 1;
      }

      await require('fs').promises.writeFile(dest, JSON.stringify(outJson, null, 2), 'utf8');
      outputs.push(dest);
      wrote.push({ path: rel(dest), count: entriesToWrite.length, tag: 'write[type-aggregate]' });
      // done handling this typeKey
      continue;
    }
    // build at most one mixed group by taking smallest groups until adding next would exceed 40
    const mixed = [];
    let mixedCount = 0;
    // collect smallest groups first (if configured) until threshold reached
    for (const g of groupsSorted) {
      if (mixedCount + g.count <= (CONFIG.grouping.maxMixedEntries || 40)) {
        mixed.push(g);
        mixedCount += g.count;
      } else {
        break;
      }
    }

    // Log which groups were chosen for mixing for this type
    if (mixed.length > 0) {
      const mixedSummary = mixed.map(m => `${m.orthography === undefined || m.orthography === null ? 'none' : m.orthography} (${m.count})`).join(' | ');
      console.log(`[grouping] type='${typeKey}' -> mixed groups: ${mixedSummary}`);
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
      const dest = path.join(wordsDir, fileName);

      // start with any group-level defaults discovered when grouping
      const defaults = Object.assign({}, g.defaults || {});
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
        defaults: Object.keys(defaults).length ? defaults : undefined,
        entries: entriesToWrite
      };

      // If destination exists, compare normalized entries and bump version if changed
      try {
        const destTxt = await require('fs').promises.readFile(dest, 'utf8');
        const destParsed = JSON.parse(destTxt);
        const destEntries = Array.isArray(destParsed.entries) ? destParsed.entries : [];
        const outEntries = Array.isArray(outJson.entries) ? outJson.entries : [];
        const normalize = arr => arr.map(e => JSON.stringify(e)).sort().join('\n');
        if (normalize(destEntries) !== normalize(outEntries)) {
          const destVer = destParsed.metadata && typeof destParsed.metadata.version === 'number' ? destParsed.metadata.version : undefined;
          const newVer = destVer !== undefined ? destVer + 1 : (typeof outJson.metadata.version === 'number' ? outJson.metadata.version + 1 : 2);
          outJson.metadata.version = newVer;
          bumped.push({ path: rel(dest), from: destParsed.metadata && destParsed.metadata.version, to: newVer, fromCount: destEntries.length, toCount: outEntries.length });
        } else {
          // no change: preserve destination version if present
          if (destParsed.metadata && typeof destParsed.metadata.version === 'number') {
            outJson.metadata = outJson.metadata || {};
            outJson.metadata.version = destParsed.metadata.version;
          }
        }
      } catch (e) {
        // dest doesn't exist or couldn't be read — treat as new file
        if (!outJson.metadata || typeof outJson.metadata.version !== 'number') outJson.metadata = outJson.metadata || {}, outJson.metadata.version = 1;
      }

      await require('fs').promises.writeFile(dest, JSON.stringify(outJson, null, 2), 'utf8');
      outputs.push(dest);
      wrote.push({ path: rel(dest), count: entriesToWrite.length, tag: 'write' });
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
        const dest = path.join(wordsDir, fileName);

        const defaults = Object.assign({}, m.defaults || {});
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

        try {
          const destTxt = await require('fs').promises.readFile(dest, 'utf8');
          const destParsed = JSON.parse(destTxt);
          const destEntries = Array.isArray(destParsed.entries) ? destParsed.entries : [];
          const outEntries = Array.isArray(outJson.entries) ? outJson.entries : [];
          const normalize = arr => arr.map(e => JSON.stringify(e)).sort().join('\n');
            if (normalize(destEntries) !== normalize(outEntries)) {
              const destVer = destParsed.metadata && typeof destParsed.metadata.version === 'number' ? destParsed.metadata.version : undefined;
              const newVer = destVer !== undefined ? destVer + 1 : (typeof outJson.metadata.version === 'number' ? outJson.metadata.version + 1 : 2);
              outJson.metadata.version = newVer;
              bumped.push({ path: rel(dest), from: destParsed.metadata && destParsed.metadata.version, to: newVer, fromCount: destEntries.length, toCount: outEntries.length });
            } else {
              if (destParsed.metadata && typeof destParsed.metadata.version === 'number') {
                outJson.metadata = outJson.metadata || {};
                outJson.metadata.version = destParsed.metadata.version;
              }
            }
        } catch (e) {
          if (!outJson.metadata || typeof outJson.metadata.version !== 'number') outJson.metadata = outJson.metadata || {}, outJson.metadata.version = 1;
        }

        await require('fs').promises.writeFile(dest, JSON.stringify(outJson, null, 2), 'utf8');
        outputs.push(dest);
        wrote.push({ path: rel(dest), count: entriesToWrite.length, tag: 'write[homogeneous]' });
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
      const dest = path.join(wordsDir, fileName);

          // For mixed group: compute intersection of per-subgroup defaults and include defaults.type when available.
          // Compute common defaults across mixed subgroups
          const subgroupDefaults = mixed.map(m => m.defaults || {});
          const commonDefaults = {};
          if (subgroupDefaults.length) {
            const first = subgroupDefaults[0];
            for (const k of Object.keys(first)) {
              let ok = true;
              for (let i = 1; i < subgroupDefaults.length; i++) {
                if (!subgroupDefaults[i].hasOwnProperty(k) || String(subgroupDefaults[i][k]) !== String(first[k])) { ok = false; break; }
              }
              if (ok) commonDefaults[k] = first[k];
            }
          }
          if (typeVal !== undefined) commonDefaults.type = typeVal;

          // Remove the defaults from entries when they match the common defaults to keep files compact
          const mixedEntriesNormalized = mixedEntries.map(e => {
            const copy = Object.assign({}, e);
            for (const dk of Object.keys(commonDefaults)) {
              if (copy.hasOwnProperty(dk) && String(copy[dk]) === String(commonDefaults[dk])) delete copy[dk];
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
          defaults: Object.keys(commonDefaults).length ? commonDefaults : undefined,
          entries: mixedEntriesNormalized
        };

      try {
        const destTxt = await require('fs').promises.readFile(dest, 'utf8');
        const destParsed = JSON.parse(destTxt);
        const destEntries = Array.isArray(destParsed.entries) ? destParsed.entries : [];
        const outEntries = Array.isArray(outJson.entries) ? outJson.entries : [];
        const normalize = arr => arr.map(e => JSON.stringify(e)).sort().join('\n');
        if (normalize(destEntries) !== normalize(outEntries)) {
          const destVer = destParsed.metadata && typeof destParsed.metadata.version === 'number' ? destParsed.metadata.version : undefined;
          const newVer = destVer !== undefined ? destVer + 1 : (typeof outJson.metadata.version === 'number' ? outJson.metadata.version + 1 : 2);
          outJson.metadata.version = newVer;
          bumped.push({ path: rel(dest), from: destParsed.metadata && destParsed.metadata.version, to: newVer, fromCount: destEntries.length, toCount: outEntries.length });
        } else {
          if (destParsed.metadata && typeof destParsed.metadata.version === 'number') {
            outJson.metadata = outJson.metadata || {};
            outJson.metadata.version = destParsed.metadata.version;
          }
        }
      } catch (e) {
        if (!outJson.metadata || typeof outJson.metadata.version !== 'number') outJson.metadata = outJson.metadata || {}, outJson.metadata.version = 1;
      }

      await require('fs').promises.writeFile(dest, JSON.stringify(outJson, null, 2), 'utf8');
      outputs.push(dest);
      wrote.push({ path: rel(dest), count: mixedEntriesNormalized.length, tag: 'write[mixed]' });
    }
  }

  const inputCount = allEntries.length;
  const outputCount = outputs.reduce((sum, p) => {
    const txt = require('fs').readFileSync(p, 'utf8');
    const parsed = JSON.parse(txt);
    return sum + (Array.isArray(parsed.entries) ? parsed.entries.length : 0);
  }, 0);
  // Summary counts (input/output) — validated above

  if (inputCount !== outputCount) {
    console.error(`[ERROR] total entries mismatch: input=${inputCount} != output=${outputCount}. Aborting.`);
    process.exitCode = 1;
    return;
  }

  // delete original input files (only those we read)
  const outputsSet = new Set(outputs.map(p => path.resolve(p)));
  for (const fp of sourceFiles) {
    const abs = path.resolve(fp);
    if (outputsSet.has(abs)) {
      preserved.push(rel(fp));
      continue;
    }
    try {
      await fs.unlink(fp);
      deleted.push(rel(fp));
    } catch (e) {
      console.warn(`[warn] Failed deleting ${rel(fp)}: ${e && e.message ? e.message : e}`);
    }
  }

  // outputs were written directly into `wordsDir`; no move required
  // (outputs array contains destination paths)

  // optionally remove output dir if empty
  try {
    const remaining = await fs.readdir(outputDir);
    if (remaining.length === 0) await fs.rmdir(outputDir);
  } catch(e){}

  // Concise summary logging
  const totalWritten = wrote.length;
  const totalWrittenEntries = wrote.reduce((s, w) => s + (w.count || 0), 0);
  if (totalWritten) {
    console.log(`\n[write] ${totalWritten} files — total ${totalWrittenEntries} entries`);
    for (const w of wrote) console.log(`  ${w.tag} ${w.path} — ${w.count}`);
  }

  if (bumped.length) {
    console.log(`\n[version] ${bumped.length} file(s) bumped`);
    for (const b of bumped) console.log(`  ${b.path} ${b.from ?? '-'} -> ${b.to} (${b.fromCount} -> ${b.toCount})`);
  }

  if (preserved.length) {
    console.log(`\n[preserved] ${preserved.length} file(s)`);
    const show = preserved.slice(0, 50);
    for (const p of show) console.log(`  ${p}`);
    if (preserved.length > show.length) console.log(`  ... and ${preserved.length - show.length} more`);
  }

  if (deleted.length) {
    console.log(`\n[deleted] ${deleted.length} file(s)`);
    for (const d of deleted) console.log(`  ${d}`);
  }

  if (liftedTotal) {
    console.log(`\n[lifted] promoted ${liftedTotal} field(s)`);
    for (const d of liftedDetails) {
      const parts = d.keys.map(kv => `${kv.key}='${kv.value}'`).join(', ');
      console.log(`  ${d.file}: ${parts}`);
    }
  }

  console.log('\nReorganization complete.\n');
}

if (require.main === module) {
  reorganize().catch(err => {
    console.error(err);
    process.exitCode = 2;
  });
}
