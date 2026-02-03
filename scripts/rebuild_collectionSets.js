/**
 * Rebuilds collections/japanese/_collectionSets.json auto-generated sets.
 *
 * Preserves all existing manual sets and only upserts the managed auto sets.
 *
 * Currently managed auto sets:
 * - Unique Pokemon types from collections/pokemon/pokemon_starters.json entries[].type[]
 * - Unique Pokemon name roots from collections/pokemon/pokemon_starters.json entries[].japaneseNameRoots[]
 *
 * Usage: node scripts/rebuild_collectionSets.js
 */

const fs = require('fs').promises;
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const COLLECTION_SETS_PATH = path.join(repoRoot, 'collections', 'japanese', '_collectionSets.json');
const POKEMON_STARTERS_PATH = path.join(repoRoot, 'collections', 'pokemon', 'pokemon_starters.json');
const JAPANESE_COLLECTIONS_ROOT = path.join(repoRoot, 'collections', 'japanese');

function uniqueSortedStrings(values) {
  const set = new Set();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    set.add(trimmed);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(txt);
  } catch (err) {
    const rel = path.relative(repoRoot, filePath);
    throw new Error(`Failed to parse JSON: ${rel}: ${err.message}`);
  }
}

async function writeJson(filePath, obj) {
  const txt = stringifyJsonWithWrappedKanjiArrays(obj) + '\n';
  await fs.writeFile(filePath, txt, 'utf8');
}

const INDENT = '  ';
const MAX_KANJI_LINE_LENGTH = 110;

function stringifyJsonWithWrappedKanjiArrays(value) {
  return formatJsonValue(value, 0, undefined);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeKanjiValue(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

async function listJsonFilesRecursively(rootDir) {
  const out = [];

  async function walk(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!d.isFile()) continue;
      if (path.extname(d.name).toLowerCase() !== '.json') continue;
      if (d.name.startsWith('_')) continue;
      out.push(full);
    }
  }

  await walk(rootDir);
  return out;
}

async function collectDefinedKanjiFromJapaneseCollections() {
  const files = await listJsonFilesRecursively(JAPANESE_COLLECTIONS_ROOT);
  const defined = new Set();

  for (const filePath of files) {
    const json = await readJson(filePath);
    const entries = getArray(json, 'entries');
    if (entries.length === 0) continue;

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const k = entry.kanji;
      if (typeof k === 'string') {
        const norm = normalizeKanjiValue(k);
        if (norm) defined.add(norm);
        continue;
      }
      if (Array.isArray(k)) {
        for (const kv of k) {
          const norm = normalizeKanjiValue(kv);
          if (norm) defined.add(norm);
        }
      }
    }
  }

  return defined;
}

function withMissingKanjiDefinition(setObj, missingValues) {
  if (missingValues.length === 0) {
    if (!setObj || typeof setObj !== 'object') return setObj;
    if (!Object.prototype.hasOwnProperty.call(setObj, 'missing_kanji_definition')) return setObj;
    const next = { ...setObj };
    delete next.missing_kanji_definition;
    return next;
  }

  return {
    ...setObj,
    missing_kanji_definition: missingValues
  };
}

function annotateSetsWithMissingKanjiDefinitions(sets, definedKanji) {
  return sets.map((setObj) => {
    if (!setObj || typeof setObj !== 'object') return setObj;
    // If this set uses `kanjiFilter[]` skip missing-kanji checks (can't statically enumerate values).
    if (Array.isArray(setObj.kanjiFilter) && setObj.kanjiFilter.length) return withMissingKanjiDefinition(setObj, []);

    const values = Array.isArray(setObj.kanji) ? setObj.kanji : [];
    const missing = [];
    const seen = new Set();

    for (const v of values) {
      const norm = normalizeKanjiValue(v);
      if (!norm) continue;
      if (definedKanji.has(norm)) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      missing.push(norm);
    }

    missing.sort((a, b) => a.localeCompare(b, 'ja'));
    return withMissingKanjiDefinition(setObj, missing);
  });
}

function formatWrappedStringArray(arr, indentLevel) {
  if (arr.length === 0) return '[]';

  const innerIndent = INDENT.repeat(indentLevel + 1);
  const closingIndent = INDENT.repeat(indentLevel);

  const lines = [];
  let current = '';

  for (let i = 0; i < arr.length; i++) {
    const token = JSON.stringify(arr[i]);
    const withComma = token + (i < arr.length - 1 ? ',' : '');

    if (!current) {
      current = withComma;
      continue;
    }

    if ((current + withComma).length <= MAX_KANJI_LINE_LENGTH) {
      current += withComma;
    } else {
      lines.push(current);
      current = withComma;
    }
  }

  if (current) lines.push(current);

  return `[` +
    `\n${innerIndent}` +
    lines.join(`\n${innerIndent}`) +
    `\n${closingIndent}]`;
}

function formatJsonArray(arr, indentLevel) {
  if (arr.length === 0) return '[]';

  const innerIndent = INDENT.repeat(indentLevel + 1);
  const closingIndent = INDENT.repeat(indentLevel);
  const parts = arr.map(v => formatJsonValue(v, indentLevel + 1, undefined));

  return `[` +
    `\n${innerIndent}` +
    parts.join(`,\n${innerIndent}`) +
    `\n${closingIndent}]`;
}

function formatJsonObject(obj, indentLevel) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';

  const innerIndent = INDENT.repeat(indentLevel + 1);
  const closingIndent = INDENT.repeat(indentLevel);

  const parts = keys.map((k) => {
    const v = obj[k];
    const formatted = formatJsonValue(v, indentLevel + 1, k);
    return `${JSON.stringify(k)}: ${formatted}`;
  });

  return `{` +
    `\n${innerIndent}` +
    parts.join(`,\n${innerIndent}`) +
    `\n${closingIndent}}`;
}

function formatJsonValue(value, indentLevel, parentKey) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (
      parentKey === 'kanji' &&
      value.every(v => typeof v === 'string')
    ) {
      return formatWrappedStringArray(value, indentLevel);
    }
    return formatJsonArray(value, indentLevel);
  }

  if (isPlainObject(value)) return formatJsonObject(value, indentLevel);

  // Fallback (should be rare in JSON data)
  return JSON.stringify(value);
}

function getArray(obj, key) {
  const v = obj && obj[key];
  return Array.isArray(v) ? v : [];
}

async function buildAutoSets() {
  const pokemon = await readJson(POKEMON_STARTERS_PATH);
  const entries = getArray(pokemon, 'entries');

  const allTypes = [];
  const allRoots = [];

  for (const entry of entries) {
    for (const t of getArray(entry, 'type')) allTypes.push(t);
    for (const r of getArray(entry, 'japaneseNameRoots')) allRoots.push(r);
  }

  const pokemonTypes = uniqueSortedStrings(allTypes);
  const pokemonNameRoots = uniqueSortedStrings(allRoots);

  const relPokemonPath = path.relative(repoRoot, POKEMON_STARTERS_PATH).split(path.sep).join('/');

  return [
    {
      id: 'auto__pokemon_types',
      label: 'Pokémon Types (auto)',
      description: `Auto-generated from ${relPokemonPath} unique entries.type values.`,
      kanji: pokemonTypes,
      autoGenerated: true,
      source: {
        collection: relPokemonPath,
        field: 'entries[].type[]'
      }
    },
    {
      id: 'auto__pokemon_japaneseNameRoots',
      label: 'Pokémon Name Roots (auto)',
      description: `Auto-generated from ${relPokemonPath} unique entries.japaneseNameRoots values.`,
      kanji: pokemonNameRoots,
      autoGenerated: true,
      source: {
        collection: relPokemonPath,
        field: 'entries[].japaneseNameRoots[]'
      }
    }
  ];
}

function upsertSets(existingSets, setsToUpsert) {
  const byId = new Map();
  for (let i = 0; i < existingSets.length; i++) {
    const s = existingSets[i];
    if (s && typeof s.id === 'string') byId.set(s.id, i);
  }

  const out = existingSets.slice();
  for (const newSet of setsToUpsert) {
    const idx = byId.get(newSet.id);
    if (typeof idx === 'number') {
      out[idx] = newSet;
    } else {
      out.push(newSet);
    }
  }
  return out;
}

async function rebuildCollectionSets() {
  const collectionSets = await readJson(COLLECTION_SETS_PATH);
  const sets = getArray(collectionSets, 'sets');

  const autoSets = await buildAutoSets();
  const nextSets = upsertSets(sets, autoSets);

  // Validate: warn if any set defines both `kanji` and `kanjiFilter`
  for (const s of nextSets) {
    if (!s || typeof s !== 'object') continue;
    const hasKanji = Array.isArray(s.kanji) && s.kanji.length > 0;
    const hasFilter = Array.isArray(s.kanjiFilter) && s.kanjiFilter.length > 0;
    if (hasKanji && hasFilter) {
      const sid = typeof s.id === 'string' ? s.id : '(unknown id)';
      console.warn(`Warning: collection set ${sid} contains both 'kanji' and 'kanjiFilter'. 'kanjiFilter' will be used; consider removing 'kanji'.`);
    }
  }

  // Convert legacy `kanji` arrays into a single `kanjiFilter` using the `.in[...]` syntax
  // so callers can use only `kanjiFilter` going forward.
  for (const s of nextSets) {
    if (!s || typeof s !== 'object') continue;
    const hasKanji = Array.isArray(s.kanji) && s.kanji.length > 0;
    const hasFilter = Array.isArray(s.kanjiFilter) && s.kanjiFilter.length > 0;
    if (hasKanji && !hasFilter) {
      // Build comma-separated list, preserving original strings
      const parts = s.kanji.map(v => String(v || '').trim()).filter(Boolean);
      if (parts.length) {
        // Escape any ']' by replacing with '\]'
        const escaped = parts.map(p => p.replace(/\]/g, '\\]')).join(',');
        s.kanjiFilter = [`kanji.in[${escaped}]`];
        delete s.kanji;
      } else {
        delete s.kanji;
      }
    }
    // If both exist, we previously warned; prefer existing kanjiFilter and drop kanji
    if (hasKanji && hasFilter) {
      delete s.kanji;
    }
  }

  const definedKanji = await collectDefinedKanjiFromJapaneseCollections();
  const validatedSets = annotateSetsWithMissingKanjiDefinitions(nextSets, definedKanji);

  const next = {
    ...collectionSets,
    sets: validatedSets
  };

  await writeJson(COLLECTION_SETS_PATH, next);

  const relOut = path.relative(repoRoot, COLLECTION_SETS_PATH).split(path.sep).join('/');
  console.log(`Rebuilt ${relOut}: upserted ${autoSets.length} auto-generated set(s)`);
}

if (require.main === module) {
  rebuildCollectionSets().catch(err => {
    console.error('Error rebuilding collectionSets:', err);
    process.exitCode = 1;
  });
}

module.exports = { rebuildCollectionSets };
