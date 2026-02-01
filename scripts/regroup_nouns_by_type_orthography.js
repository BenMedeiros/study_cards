const fs = require('fs');
const path = require('path');

// Regroups collections/japanese/nouns/*.json into new files grouped by:
//   - effective `type`
//   - effective `orthography` (katakana only, plus hardcoded overrides)
//
// Notes:
// - Applies per-file `defaults` to each entry before grouping.
// - If an entry lacks `type`, we default it to "noun" for noun-list files.
// - `orthography` is only set when:
//     (a) the entry contains Katakana, OR
//     (b) it matches scripts/orthography_overrides.json
//   Otherwise orthography is left unspecified.
//
// Usage:
//   node scripts/regroup_nouns_by_type_orthography.js [--out <dir>] [--dry-run]
//
// Default output directory:
//   collections/japanese/nouns/_grouped

const repoRoot = path.resolve(__dirname, '..');
const nounsDir = path.join(repoRoot, 'collections', 'japanese', 'nouns');

const outFlagIndex = process.argv.indexOf('--out');
const outDir = outFlagIndex >= 0 && process.argv[outFlagIndex + 1]
  ? path.resolve(repoRoot, process.argv[outFlagIndex + 1])
  : path.join(nounsDir, '_grouped');

const dryRun = process.argv.includes('--dry-run');

const overridesPath = path.join(__dirname, 'orthography_overrides.json');
let orthographyOverrides = {};
if (fs.existsSync(overridesPath)) {
  try {
    orthographyOverrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8')) || {};
  } catch {
    orthographyOverrides = {};
  }
}

function hasKatakana(text) {
  return /\p{Script=Katakana}/u.test(text);
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortDeep(value[key]);
  }
  return out;
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function sanitizePart(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function inferFileDefaultType(fileName, defaultsObj) {
  if (defaultsObj && typeof defaultsObj.type === 'string') return defaultsObj.type;

  // These files are noun lists by construction.
  if (
    fileName.startsWith('200_nouns_') ||
    fileName.startsWith('nouns_') ||
    fileName.startsWith('100_katakana_')
  ) {
    return 'noun';
  }

  // Others may contain mixed types; don't force.
  return null;
}

function getOverride(entry) {
  const candidates = [];
  if (entry.kanji) candidates.push(entry.kanji);
  if (entry.reading) candidates.push(entry.reading);
  if (entry.meaning) candidates.push(entry.meaning);
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const key = c.trim();
    if (orthographyOverrides[key]) return orthographyOverrides[key];
  }
  return null;
}

function computeOrthography(effectiveEntry) {
  // Preserve explicit orthography if it's katakana or matches an override.
  const override = getOverride(effectiveEntry);
  if (override) return override;

  const combined = [effectiveEntry.kanji, effectiveEntry.reading]
    .filter(Boolean)
    .join(' ');
  if (combined && hasKatakana(combined)) return 'katakana';
  return null;
}

function listInputFiles() {
  const names = fs.readdirSync(nounsDir);
  return names
    .filter(n => n.endsWith('.json'))
    .filter(n => !n.startsWith('_'))
    .map(n => path.join(nounsDir, n));
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function computeGroupDefaults(entries) {
  if (entries.length === 0) return {};

  // Consider all keys except the core identity fields.
  const excluded = new Set(['kanji', 'reading', 'meaning']);
  const allKeys = new Set();
  for (const e of entries) {
    for (const k of Object.keys(e)) {
      if (!excluded.has(k)) allKeys.add(k);
    }
  }

  const defaults = {};
  for (const key of Array.from(allKeys)) {
    const first = entries[0][key];
    let allSame = true;
    for (let i = 1; i < entries.length; i++) {
      if (!deepEqual(first, entries[i][key])) {
        allSame = false;
        break;
      }
    }
    if (allSame && first !== undefined) defaults[key] = first;
  }

  return defaults;
}

function stripDefaults(entries, defaults) {
  return entries.map(e => {
    const out = { ...e };
    for (const [k, v] of Object.entries(defaults)) {
      if (k in out && deepEqual(out[k], v)) delete out[k];
    }
    return out;
  });
}

function main() {
  const files = listInputFiles();

  const groups = new Map();
  const groupSources = new Map();

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const json = loadJson(filePath);
    const defaults = json.defaults && typeof json.defaults === 'object' ? json.defaults : {};
    const entries = Array.isArray(json.entries) ? json.entries : [];
    const fileDefaultType = inferFileDefaultType(fileName, defaults);

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (Object.keys(entry).length === 0) continue;

      const effective = { ...defaults, ...entry };

      // Ensure type exists for noun-list files.
      if (!effective.type && fileDefaultType) effective.type = fileDefaultType;

      // Enforce orthography rules (katakana only + overrides).
      const orth = computeOrthography(effective);
      if (orth) effective.orthography = orth;
      else delete effective.orthography;

      const typeKey = effective.type || 'unknown';
      const orthKey = effective.orthography || 'unspecified';
      const groupKey = `${typeKey}::${orthKey}`;

      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(effective);

      if (!groupSources.has(groupKey)) groupSources.set(groupKey, new Set());
      groupSources.get(groupKey).add(path.relative(repoRoot, filePath).replace(/\\/g, '/'));
    }
  }

  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const [groupKey, entries] of groups.entries()) {
    const [typeKey, orthKey] = groupKey.split('::');
    const defaults = computeGroupDefaults(entries);
    const stripped = stripDefaults(entries, defaults);

    const kanjiList = Array.from(new Set(entries.map(e => e.kanji).filter(Boolean)));
    const hasOrthography = orthKey !== 'unspecified';
    const outJson = {
      metadata: {
        name: hasOrthography ? `Japanese (${typeKey}) (${orthKey})` : `Japanese (${typeKey})`,
        description: hasOrthography
          ? `Auto-grouped entries from collections/japanese/nouns by type='${typeKey}' and orthography='${orthKey}'.`
          : `Auto-grouped entries from collections/japanese/nouns by type='${typeKey}'.`,
        version: 1,
        sources: Array.from(groupSources.get(groupKey) || []).sort(),
        kanji: kanjiList,
        kanjiCount: kanjiList.length
      },
      defaults,
      entries: stripped
    };

    // Naming convention: if orthography is unspecified, omit it from the filename.
    const outFileName = hasOrthography
      ? `${sanitizePart(typeKey)}__${sanitizePart(orthKey)}.json`
      : `${sanitizePart(typeKey)}.json`;
    const outPath = path.join(outDir, outFileName);

    if (!dryRun) {
      fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2) + '\n', 'utf8');
    }
    written.push(path.relative(repoRoot, outPath).replace(/\\/g, '/'));
  }

  written.sort();
  console.log(`Input files: ${files.length}`);
  console.log(`Groups: ${groups.size}`);
  console.log(`Output dir: ${path.relative(repoRoot, outDir).replace(/\\/g, '/')}`);
  console.log('Wrote:');
  for (const p of written) console.log(`- ${p}`);
}

main();
