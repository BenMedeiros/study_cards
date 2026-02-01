#!/usr/bin/env node
/**
 * Builds explicit, de-duplicated word lists used for study.
 *
 * This script intentionally does NOT do any general token extraction. It only collects:
 * - `collections/japanese/…/*.json` (recursive): `entries[].kanji`
 * - `collections/…/_metadata.json` (recursive): `fields[].jp_label`
 * - `collections/pokemon/…/*.json` (recursive): `entries[].type` and `entries[].japaneseNameRoots`
 *
 * Output:
 * - Writes `scripts/extract_japanese_vocab_output.json` as an array of `searchPatterns`, where
 *   each pattern has `name`, `description`, `sources`, `unique_words_count`, and `unique_words`.
 *
 * Usage: `node scripts/extract_japanese_vocab.js`
 */
const fs = require('fs').promises;
const path = require('path');

const scriptsDir = path.resolve(__dirname);
const japaneseDir = path.join(scriptsDir, '..', 'collections', 'japanese');
const pokemonDir = path.join(scriptsDir, '..', 'collections', 'pokemon');
const collectionsDir = path.join(scriptsDir, '..', 'collections');
const outDir = scriptsDir;
const outPath = path.join(outDir, 'extract_japanese_vocab_output.json');

async function walk(dir, cb) {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, cb);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) await cb(p);
  }
}

async function collectJapaneseEntriesKanji(rootDir, entriesKanjiSet) {
  await walk(rootDir, async (filePath) => {
    let txt;
    try { txt = await fs.readFile(filePath, 'utf8'); } catch (e) { return; }
    let doc;
    try { doc = JSON.parse(txt); } catch (e) { return; }

    if (!doc || !Array.isArray(doc.entries)) return;
    for (const e of doc.entries) {
      if (e && typeof e.kanji === 'string' && e.kanji.trim() !== '') entriesKanjiSet.add(e.kanji);
    }
  });
}

async function collectMetadataLabels(rootDir, labelsSet) {
  await walk(rootDir, async (p) => {
    if (path.basename(p) !== '_metadata.json') return;
    let txt; try { txt = await fs.readFile(p, 'utf8'); } catch (e) { return; }
    let doc; try { doc = JSON.parse(txt); } catch (e) { return; }
    if (Array.isArray(doc.fields)) {
      for (const f of doc.fields) {
        if (f && typeof f.jp_label === 'string') {
          labelsSet.add(f.jp_label);
        }
      }
    }
  });
}

async function collectPokemonFields(rootDir, pokemonTypesSet, pokemonRootsSet) {
  await walk(rootDir, async (p) => {
    let txt;
    try { txt = await fs.readFile(p, 'utf8'); } catch (e) { return; }
    let doc;
    try { doc = JSON.parse(txt); } catch (e) { return; }

    if (!doc || !Array.isArray(doc.entries)) return;
    for (const e of doc.entries) {
      if (!e || typeof e !== 'object') continue;

      const { type, japaneseNameRoots } = e;

      if (typeof type === 'string') pokemonTypesSet.add(type);
      else if (Array.isArray(type)) {
        for (const t of type) if (typeof t === 'string') pokemonTypesSet.add(t);
      }

      if (typeof japaneseNameRoots === 'string') pokemonRootsSet.add(japaneseNameRoots);
      else if (Array.isArray(japaneseNameRoots)) {
        for (const r of japaneseNameRoots) if (typeof r === 'string') pokemonRootsSet.add(r);
      }
    }
  });
}

async function main() {
  const labelsSet = new Set();
  const entriesKanjiSet = new Set();
  const pokemonTypesSet = new Set();
  const pokemonRootsSet = new Set();

  // Collect explicit `entries[].kanji` only (no general token extraction)
  await collectJapaneseEntriesKanji(japaneseDir, entriesKanjiSet);

  // Also collect jp_label from all _metadata.json files across collections
  await collectMetadataLabels(collectionsDir, labelsSet);

  // Collect Pokemon entry fields
  await collectPokemonFields(pokemonDir, pokemonTypesSet, pokemonRootsSet);

  const jp_labels = Array.from(labelsSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const entriesKanji = Array.from(entriesKanjiSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const pokemon_types = Array.from(pokemonTypesSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const pokemon_roots = Array.from(pokemonRootsSet).sort((a,b)=>a.localeCompare(b,'ja'));

  // ensure output dir
  await fs.mkdir(outDir, { recursive: true });
  // Build output with one object per search pattern.
  // Use placeholders so `unique_words` arrays serialize on a single line.
  const placeholders = {
    japanese_entries_kanji: '__JAPANESE_ENTRIES_KANJI__',
    jp_labels: '__JP_LABELS__',
    pokemon_types: '__POKEMON_TYPES__',
    pokemon_roots: '__POKEMON_ROOTS__'
  };

  const out = {
    generatedAt: new Date().toISOString(),
    searchPatterns: [
      {
        name: 'japanese_entries_kanji',
        description: 'Unique values from collections/japanese/**.json entries[].kanji.',
        sources: ['collections/japanese'],
        unique_words_count: entriesKanji.length,
        unique_words: placeholders.japanese_entries_kanji
      },
      {
        name: 'jp_labels',
        description: 'Unique values from collections/**/_metadata.json fields[].jp_label.',
        sources: ['collections'],
        unique_words_count: jp_labels.length,
        unique_words: placeholders.jp_labels
      },
      {
        name: 'pokemon_types',
        description: 'Unique values from collections/pokemon/**.json entries[].type (string or array).',
        sources: ['collections/pokemon'],
        unique_words_count: pokemon_types.length,
        unique_words: placeholders.pokemon_types
      },
      {
        name: 'pokemon_roots',
        description: 'Unique values from collections/pokemon/**.json entries[].japaneseNameRoots (string or array).',
        sources: ['collections/pokemon'],
        unique_words_count: pokemon_roots.length,
        unique_words: placeholders.pokemon_roots
      }
    ]
  };

  let txtOut = JSON.stringify(out, null, 2);
  const repl = new Map();
  repl.set(JSON.stringify(placeholders.japanese_entries_kanji), JSON.stringify(entriesKanji));
  repl.set(JSON.stringify(placeholders.jp_labels), JSON.stringify(jp_labels));
  repl.set(JSON.stringify(placeholders.pokemon_types), JSON.stringify(pokemon_types));
  repl.set(JSON.stringify(placeholders.pokemon_roots), JSON.stringify(pokemon_roots));

  for (const [k, v] of repl.entries()) txtOut = txtOut.replace(k, v);
  if (!txtOut.endsWith('\n')) txtOut += '\n';
  await fs.writeFile(outPath, txtOut, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`Counts: japanese_entries_kanji=${entriesKanji.length}, jp_labels=${jp_labels.length}, pokemon_types=${pokemon_types.length}, pokemon_roots=${pokemon_roots.length}`);
}

if (require.main === module) main().catch(err=>{ console.error(err); process.exit(1); });
