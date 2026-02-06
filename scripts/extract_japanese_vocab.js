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

async function collectJapaneseSentenceRefs(rootDir, refsSet) {
  await walk(rootDir, async (filePath) => {
    let txt;
    try { txt = await fs.readFile(filePath, 'utf8'); } catch (e) { return; }
    let doc;
    try { doc = JSON.parse(txt); } catch (e) { return; }

    // Accept top-level `sentences` array (or legacy `entries` used as sentences)
    const sentences = Array.isArray(doc.sentences) ? doc.sentences
      : (Array.isArray(doc.entries) && filePath.includes(path.sep + 'examples' + path.sep) ? doc.entries : null);
    if (!Array.isArray(sentences)) return;

    for (const s of sentences) {
      if (!s || !Array.isArray(s.chunks)) continue;
      for (const c of s.chunks) {
        if (!c || c.refs == null) continue;
        if (typeof c.refs === 'string') refsSet.add(c.refs);
        else if (Array.isArray(c.refs)) {
          for (const r of c.refs) if (typeof r === 'string') refsSet.add(r);
        }
      }
    }
  });
}

async function main() {
  const labelsSet = new Set();
  const entriesKanjiSet = new Set();
  const sentenceRefsSet = new Set();
  const pokemonTypesSet = new Set();
  const pokemonRootsSet = new Set();

  // Collect explicit `entries[].kanji` only (no general token extraction)
  // Restrict to `collections/japanese/words` as requested
  await collectJapaneseEntriesKanji(path.join(japaneseDir, 'words'), entriesKanjiSet);

  // Also collect jp_label from all _metadata.json files across collections
  await collectMetadataLabels(collectionsDir, labelsSet);

  // Collect Pokemon entry fields
  await collectPokemonFields(pokemonDir, pokemonTypesSet, pokemonRootsSet);

  // Collect sentence refs from collections/japanese/**.json (sentences[].chunks[].refs[])
  await collectJapaneseSentenceRefs(japaneseDir, sentenceRefsSet);

  const jp_labels = Array.from(labelsSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const entriesKanji = Array.from(entriesKanjiSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const pokemon_types = Array.from(pokemonTypesSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const pokemon_roots = Array.from(pokemonRootsSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const sentence_refs = Array.from(sentenceRefsSet).sort((a,b)=>a.localeCompare(b,'ja'));

  // ensure output dir
  await fs.mkdir(outDir, { recursive: true });
  // Build output with one object per search pattern.
  // Use placeholders so `unique_words` arrays serialize on a single line.
  const placeholders = {
    japanese_entries_kanji: '__JAPANESE_ENTRIES_KANJI__',
    jp_labels: '__JP_LABELS__',
    pokemon_types: '__POKEMON_TYPES__',
    pokemon_roots: '__POKEMON_ROOTS__',
    japanese_sentence_refs: '__JAPANESE_SENTENCE_REFS__'
  };

  const out = {
    generatedAt: new Date().toISOString(),
    searchPatterns: [
      {
        name: 'japanese_entries_kanji',
        description: 'Unique values from collections/japanese/words/*.json entries[].kanji.',
        sources: ['collections/japanese/words'],
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
      ,
      {
        name: 'japanese_sentence_refs',
        description: 'Unique values from collections/japanese/**.json sentences[].chunks[].refs[].',
        sources: ['collections/japanese/examples'],
        unique_words_count: sentence_refs.length,
        unique_words: placeholders.japanese_sentence_refs
      }
    ]
  };

  // Annotate missing kanji definitions: any unique words (other than the
  // primary `japanese_entries_kanji`) that are not present in the
  // `japanese_entries_kanji` list will get `missing_kanji_definition`.
  const definedKanjiSet = new Set(entriesKanji.map(s => (typeof s === 'string' ? s.trim() : s)));

  function computeMissingForArray(arr) {
    if (!Array.isArray(arr)) return [];
    const missing = [];
    const seen = new Set();
    for (const v of arr) {
      if (typeof v !== 'string') continue;
      const norm = v.trim();
      if (!norm) continue;
      if (definedKanjiSet.has(norm)) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      missing.push(norm);
    }
    missing.sort((a, b) => a.localeCompare(b, 'ja'));
    return missing;
  }

  // Map our in-memory arrays so we can compute missing values without
  // parsing the placeholders later.
  const patternArrays = {
    japanese_entries_kanji: entriesKanji,
    jp_labels: jp_labels,
    pokemon_types: pokemon_types,
    pokemon_roots: pokemon_roots,
    japanese_sentence_refs: sentence_refs
  };

  for (const p of out.searchPatterns) {
    if (!p || typeof p.name !== 'string') continue;
    if (p.name === 'japanese_entries_kanji') continue;
    const arr = patternArrays[p.name];
    const missing = computeMissingForArray(arr);
    if (missing.length) {
      p.missing_kanji_definition_count = missing.length;
      p.missing_kanji_definition = missing;
    }
  }

  let txtOut = JSON.stringify(out, null, 2);
  const repl = new Map();
  repl.set(JSON.stringify(placeholders.japanese_entries_kanji), JSON.stringify(entriesKanji));
  repl.set(JSON.stringify(placeholders.jp_labels), JSON.stringify(jp_labels));
  repl.set(JSON.stringify(placeholders.pokemon_types), JSON.stringify(pokemon_types));
  repl.set(JSON.stringify(placeholders.pokemon_roots), JSON.stringify(pokemon_roots));
  repl.set(JSON.stringify(placeholders.japanese_sentence_refs), JSON.stringify(sentence_refs));

  for (const [k, v] of repl.entries()) txtOut = txtOut.replace(k, v);
  if (!txtOut.endsWith('\n')) txtOut += '\n';
  await fs.writeFile(outPath, txtOut, 'utf8');
  const shortOutPath = path.basename(scriptsDir) + '/' + path.basename(outPath);
  console.log(`Wrote ${shortOutPath}`);
  console.log('Counts:');
  console.log(`  japanese_entries_kanji: ${entriesKanji.length}`);
  console.log(`  jp_labels: ${jp_labels.length}`);
  console.log(`  pokemon_types: ${pokemon_types.length}`);
  console.log(`  pokemon_roots: ${pokemon_roots.length}`);
  console.log(`  japanese_sentence_refs: ${sentence_refs.length}`);
}

if (require.main === module) main().catch(err=>{ console.error(err); process.exit(1); });
