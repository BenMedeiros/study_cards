#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const scriptsDir = path.resolve(__dirname);
const japaneseDir = path.join(scriptsDir, '..', '..', 'collections', 'japanese');
const collectionsDir = path.join(scriptsDir, '..', '..', 'collections');
const outDir = path.join(scriptsDir, '..', 'aggregates');
const outPath = path.join(outDir, 'japanese_word_lists.json');

const JP_TOKEN_RE = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}ー]+/gu;
const HAN_RE = /\p{sc=Han}/u;

async function walk(dir, cb) {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, cb);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) await cb(p);
  }
}

function extractTokensFromString(s) {
  const tokens = [];
  if (!s || typeof s !== 'string') return tokens;
  for (const m of s.matchAll(JP_TOKEN_RE)) tokens.push(m[0]);
  return tokens;
}

async function collectFromJson(filePath, wordsSet, kanjiSet, standaloneSet, entriesKanjiSet) {
  let txt;
  try { txt = await fs.readFile(filePath, 'utf8'); } catch (e) { return; }
  let doc;
  try { doc = JSON.parse(txt); } catch (e) { return; }

  // Traverse doc to find any string values containing Japanese tokens
  function walkObj(obj) {
    if (!obj) return;
    if (typeof obj === 'string') {
      const toks = extractTokensFromString(obj);
      for (const t of toks) {
        wordsSet.add(t);
        for (const ch of [...t]) if (HAN_RE.test(ch)) kanjiSet.add(ch);
        if ([...t].length === 1 && HAN_RE.test(t)) standaloneSet.add(t);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const it of obj) walkObj(it);
      return;
    }
    if (typeof obj === 'object') {
      for (const v of Object.values(obj)) walkObj(v);
    }
  }

  walkObj(doc);

  // collect top-level entries[].kanji specifically
  if (Array.isArray(doc.entries)) {
    for (const e of doc.entries) {
      if (e && typeof e.kanji === 'string') {
        entriesKanjiSet.add(e.kanji);
        if (typeof collectFromJson.entriesMap === 'object') {
          const rel = path.relative(process.cwd(), filePath);
          let s = collectFromJson.entriesMap.get(e.kanji);
          if (!s) { s = new Set(); collectFromJson.entriesMap.set(e.kanji, s); }
          s.add(rel);
        }
      }
    }
  }
}

async function collectMetadataLabels(rootDir, wordsSet, kanjiSet, labelsSet, standaloneSet) {
  await walk(rootDir, async (p) => {
    if (path.basename(p) !== '_metadata.json') return;
    let txt; try { txt = await fs.readFile(p, 'utf8'); } catch (e) { return; }
    let doc; try { doc = JSON.parse(txt); } catch (e) { return; }
    if (Array.isArray(doc.fields)) {
      for (const f of doc.fields) {
        if (f && typeof f.jp_label === 'string') {
          labelsSet.add(f.jp_label);
          const toks = extractTokensFromString(f.jp_label);
          for (const t of toks) { wordsSet.add(t); for (const ch of [...t]) if (HAN_RE.test(ch)) kanjiSet.add(ch); if ([...t].length === 1 && HAN_RE.test(t)) standaloneSet.add(t); }
        }
      }
    }
  });
}

async function main() {
  const wordsSet = new Set();
  const kanjiSet = new Set();
  const standaloneSet = new Set();
  const labelsSet = new Set();
  const entriesKanjiSet = new Set();

  // Collect from all japanese files
  await walk(japaneseDir, async (p) => {
    await collectFromJson(p, wordsSet, kanjiSet, standaloneSet, entriesKanjiSet);
  });

  // Also collect jp_label from all _metadata.json files across collections
  await collectMetadataLabels(collectionsDir, wordsSet, kanjiSet, labelsSet, standaloneSet);

  const jp_labels = Array.from(labelsSet).sort((a,b)=>a.localeCompare(b,'ja'));
  const entriesKanji = Array.from(entriesKanjiSet).sort((a,b)=>a.localeCompare(b,'ja'));

  // map token -> set of files (from collectFromJson.entriesMap)
  const entriesMap = collectFromJson.entriesMap || new Map();

  // combined kanji chars from entriesKanji and jp_labels
  const combinedChars = new Set();
  function addCharsFromTokens(tokens) {
    for (const t of tokens) for (const ch of [...t]) if (HAN_RE.test(ch)) combinedChars.add(ch);
  }
  addCharsFromTokens(entriesKanji);
  addCharsFromTokens(jp_labels);
  const combinedKanjiChars = Array.from(combinedChars).sort((a,b)=>a.localeCompare(b,'ja'));

  // standalone kanji: chars that also appear as a standalone token in entriesKanji or jp_labels
  const standaloneSetCombined = new Set();
  const entriesSet = new Set(entriesKanji);
  const labelsSetVals = new Set(jp_labels);
  for (const ch of combinedKanjiChars) {
    if (entriesSet.has(ch) || labelsSetVals.has(ch)) standaloneSetCombined.add(ch);
  }
  const standaloneKanjiInFiles = Array.from(standaloneSetCombined).sort((a,b)=>a.localeCompare(b,'ja'));

  // kanji that are not standalone (appear in combined but not as standalone tokens)
  const standaloneSetLookup = new Set(standaloneKanjiInFiles);
  const kanjiNotStandalone = combinedKanjiChars.filter(ch => !standaloneSetLookup.has(ch));

  // duplicated entriesKanji across files
  const duplicatedKanji = [];
  for (const [token, files] of entriesMap.entries()) if (files.size > 1) duplicatedKanji.push(token);
  duplicatedKanji.sort((a,b)=>a.localeCompare(b,'ja'));

  // token->set of tokens that contain each kanji char
  const charToTokens = new Map();
  const allTokens = entriesKanji.concat(jp_labels);
  for (const tok of allTokens) {
    for (const ch of [...tok]) if (HAN_RE.test(ch)) {
      if (!charToTokens.has(ch)) charToTokens.set(ch, new Set());
      charToTokens.get(ch).add(tok);
    }
  }

  const kanjiNotInOtherKanjiWords = [];
  const kanjiInOnlyOneOtherWord = [];
  for (const [ch, toks] of charToTokens.entries()) {
    const count = toks.size;
    if (count === 1) kanjiNotInOtherKanjiWords.push(ch);
    else if (count === 2) kanjiInOnlyOneOtherWord.push(ch);
  }
  kanjiNotInOtherKanjiWords.sort((a,b)=>a.localeCompare(b,'ja'));
  kanjiInOnlyOneOtherWord.sort((a,b)=>a.localeCompare(b,'ja'));

  // ensure output dir
  await fs.mkdir(outDir, { recursive: true });
  // Prepare output object, but insert placeholders for arrays to force single-line arrays in output
  const placeholders = {
    entriesKanji: '__ENTRIES_KANJI__',
    jp_labels: '__JP_LABELS__',
    combinedKanjiChars: '__COMBINED_KANJI__',
    standaloneKanjiInFiles: '__STANDALONE_KANJI__',
    kanjiNotStandalone: '__KANJI_NOT_STANDALONE__',
    duplicatedKanji: '__DUPLICATED_KANJI__',
    kanjiNotInOtherKanjiWords: '__KANJI_NOT_IN_OTHER__',
    kanjiInOnlyOneOtherWord: '__KANJI_IN_ONE_OTHER__'
  };

  const out = {
    generatedAt: new Date().toISOString(),
    counts: {
      uniqueEntriesKanji: entriesKanji.length,
      uniqueJpLabels: jp_labels.length,
      uniqueCombinedKanjiChars: combinedKanjiChars.length,
      uniqueStandaloneKanjiInFiles: standaloneKanjiInFiles.length,
      uniqueKanjiNotStandalone: kanjiNotStandalone.length,
      duplicatedKanji: duplicatedKanji.length,
      kanjiNotInOtherKanjiWords: kanjiNotInOtherKanjiWords.length,
      kanjiInOnlyOneOtherWord: kanjiInOnlyOneOtherWord.length
    },
    entriesKanji: placeholders.entriesKanji,
    jp_labels: placeholders.jp_labels,
    combinedKanjiChars: placeholders.combinedKanjiChars,
    standaloneKanjiInFiles: placeholders.standaloneKanjiInFiles,
    kanjiNotStandalone: placeholders.kanjiNotStandalone,
    duplicatedKanji: placeholders.duplicatedKanji,
    kanjiNotInOtherKanjiWords: placeholders.kanjiNotInOtherKanjiWords,
    kanjiInOnlyOneOtherWord: placeholders.kanjiInOnlyOneOtherWord
  };

  let txtOut = JSON.stringify(out, null, 2);
  const repl = new Map();
  repl.set(JSON.stringify(placeholders.entriesKanji), JSON.stringify(entriesKanji));
  repl.set(JSON.stringify(placeholders.jp_labels), JSON.stringify(jp_labels));
  repl.set(JSON.stringify(placeholders.combinedKanjiChars), JSON.stringify(combinedKanjiChars));
  repl.set(JSON.stringify(placeholders.standaloneKanjiInFiles), JSON.stringify(standaloneKanjiInFiles));
  repl.set(JSON.stringify(placeholders.kanjiNotStandalone), JSON.stringify(kanjiNotStandalone));
  repl.set(JSON.stringify(placeholders.duplicatedKanji), JSON.stringify(duplicatedKanji));
  repl.set(JSON.stringify(placeholders.kanjiNotInOtherKanjiWords), JSON.stringify(kanjiNotInOtherKanjiWords));
  repl.set(JSON.stringify(placeholders.kanjiInOnlyOneOtherWord), JSON.stringify(kanjiInOnlyOneOtherWord));

  for (const [k, v] of repl.entries()) txtOut = txtOut.replace(k, v);
  if (!txtOut.endsWith('\n')) txtOut += '\n';
  await fs.writeFile(outPath, txtOut, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`Found uniqueEntriesKanji: ${entriesKanji.length}, uniqueJpLabels: ${jp_labels.length}, uniqueCombinedKanjiChars: ${combinedKanjiChars.length}, uniqueStandaloneKanjiInFiles: ${standaloneKanjiInFiles.length}`);
}

if (require.main === module) main().catch(err=>{ console.error(err); process.exit(1); });
