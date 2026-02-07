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
- Per-file defaults (legacy): if a source file contains `defaults` (or `root.defaults`),
  they are flattened into each entry and removed.
- Type-aggregation: if the total number of entries for a first-key group
  (e.g. a single `type` across all orthographies) is <= `CONFIG.grouping.maxMixedEntries`,
  the script writes a single type-level file (no `mixed` suffix).

Note: this script no longer writes `defaults` to output files.

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

function flattenDefaultsInPlace(data) {
  if (!data || typeof data !== 'object') return;
  const shape = findEntriesShape(data);
  if (!Array.isArray(shape.entries)) return;

  let defaults = null;
  if (data.defaults && typeof data.defaults === 'object' && !Array.isArray(data.defaults)) {
    defaults = data.defaults;
  } else if (data.root && data.root.defaults && typeof data.root.defaults === 'object' && !Array.isArray(data.root.defaults)) {
    defaults = data.root.defaults;
  }

  if (!defaults || !Object.keys(defaults).length) return;

  for (const ent of shape.entries) {
    if (!ent || typeof ent !== 'object' || Array.isArray(ent)) continue;
    for (const [k, v] of Object.entries(defaults)) {
      if (ent[k] === undefined) ent[k] = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, 'defaults')) delete data.defaults;
  if (data.root && Object.prototype.hasOwnProperty.call(data.root, 'defaults')) delete data.root.defaults;
}

function safeName(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '_');
}

async function reorganize() {
  const wordsDir = path.resolve(__dirname, '..', 'collections', 'japanese', 'words');
  const outputDir = path.join(wordsDir, CONFIG.behavior.outputDirName || 'output');
  const rel = p => path.relative(process.cwd(), p);

  const files = await fs.readdir(wordsDir, { withFileTypes: true });
  const jsonFiles = files
    .filter(f => f.isFile() && f.name.endsWith('.json') && !f.name.startsWith('_'))
    .map(f => path.join(wordsDir, f.name));

  // collect all entries
  const allEntries = [];
  const sourceFiles = [];
  const seenKanjiByType = new Map(); // type -> Set(kanji)

  for (const fp of jsonFiles) {
    // skip files in output folder (there shouldn't be any here) but keep safe
    if (fp.includes(path.sep + (CONFIG.behavior.outputDirName || 'output') + path.sep)) continue;
    // skip files that start with '_' (internal/hidden files)
    if (path.basename(fp).startsWith('_')) continue;
    const data = await readJson(fp);
    sourceFiles.push(fp);

    // Legacy support: flatten per-file defaults into each entry and remove defaults.
    try {
      flattenDefaultsInPlace(data);
    } catch (e) {
      console.warn(`[flatten] failed for ${rel(fp)}: ${e && e.message ? e.message : e}`);
    }

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
      allEntries.push({ entry: copy, source: fp });
    }
  }

  // Group by configured keys
  const groups = new Map(); // key -> { key, values: [...], entries: [] }
  for (const { entry } of allEntries) {
    const key = makeGroupKeyFromEntry(entry);
    if (!groups.has(key)) {
      const values = CONFIG.grouping.groupByKeys.map(k => {
        const v = entry[k];
        return v === undefined || v === null ? undefined : String(v);
      });
      groups.set(key, { key, values, entries: [] });
    }
    const g = groups.get(key);
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
    groupsByType.get(typeKey).push({ type: typeVal, orthography: orthVal, entries: g.entries });
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
      count: g.entries.length
    })).sort((a, b) => a.count - b.count);

    // If the entire first-key group fits under the maxMixedEntries threshold,
    // write a single file for the first-key (e.g. type) and skip subdividing.
    const maxMixed = CONFIG.grouping.maxMixedEntries || 40;
    const totalForType = groupsSorted.reduce((s, g) => s + g.count, 0);
    if (totalForType > 0 && totalForType <= maxMixed) {
      // combine all entries
      const combinedEntries = [];
      const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;

      for (const g of groupsSorted) {
        for (const e of g.entries) combinedEntries.push(Object.assign({}, e));
      }

      const parts = [];
      if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
      const fileName = (parts.length ? parts.join('__') : 'ungrouped') + '.json';
      const dest = path.join(wordsDir, fileName);

      const entriesToWrite = combinedEntries.map(e => Object.assign({}, e));

      const namePart = `${typeVal ?? 'no-type'}`;
      const totalCount = entriesToWrite.length;
      const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''} — total ${totalCount}.`;
      const outJson = {
        metadata: {
          name: `Japanese ${namePart}`,
          description: desc,
          version: 1
        },
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

    // write remaining homogeneous groups
    for (const g of remaining) {
      const parts = [];
      const typeVal = (typeKey === '__NO_TYPE__') ? undefined : typeKey;
      if (typeVal !== undefined) parts.push(safeName(typeVal) || 'type');
      if (g.orthography !== undefined && g.orthography !== null) parts.push(safeName(g.orthography) || 'orth');
      const fileName = (parts.length ? parts.join('__') : 'ungrouped') + '.json';
      const dest = path.join(wordsDir, fileName);

      const entriesToWrite = g.entries.map(e => Object.assign({}, e));

      const namePart = `${typeVal ?? 'no-type'}` + (g.orthography ? ` (${g.orthography})` : '');
      const totalCount = entriesToWrite.length;
      const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''}${g.orthography ? " and orthography='"+g.orthography+"'" : ''} — total ${totalCount}.`;
      const outJson = {
        metadata: {
          name: `Japanese ${namePart}`,
          description: desc,
          version: 1
        },
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

        const entriesToWrite = m.entries.map(e => Object.assign({}, e));

        const totalCount = entriesToWrite.length;
        const namePart = `${typeVal ?? 'no-type'}` + (m.orthography ? ` (${m.orthography})` : '');
        const desc = `Grouped entries${typeVal ? " for type='"+typeVal+"'" : ''}${m.orthography ? " and orthography='"+m.orthography+"'" : ''} — total ${totalCount}.`;
        const outJson = {
          metadata: {
            name: `Japanese ${namePart}`,
            description: desc,
            version: 1
          },
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

      const mixedEntriesNormalized = mixedEntries.map(e => Object.assign({}, e));

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

  console.log('\nReorganization complete.\n');
}

if (require.main === module) {
  reorganize().catch(err => {
    console.error(err);
    process.exitCode = 2;
  });
}
