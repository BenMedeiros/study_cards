#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..');

function errorMsg(file, msg) {
  return `${file}: ${msg}`;
}

function isString(v) { return typeof v === 'string'; }

function validateFragment(fragment, location, errs) {
  if (!fragment || typeof fragment !== 'object') {
    errs.push(`${location}: fragment is not an object`);
    return;
  }
  if (!isString(fragment.ja)) errs.push(`${location}: missing or invalid 'ja'`);
  if (!isString(fragment.en)) errs.push(`${location}: missing or invalid 'en'`);
  if ('pattern' in fragment && fragment.pattern !== null && !isString(fragment.pattern)) {
    errs.push(`${location}: 'pattern' must be string or null`);
  }
  if (!Array.isArray(fragment.words)) errs.push(`${location}: missing or invalid 'words' array`);
  else {
    fragment.words.forEach((w, i) => { if (!isString(w)) errs.push(`${location}.words[${i}] is not a string`); });
  }
  if (Array.isArray(fragment.ja_fragments)) {
    fragment.ja_fragments.forEach((f, i) => validateFragment(f, `${location}.ja_fragments[${i}]`, errs));
  }
}

function validateFile(obj, file, errs) {
  if (!obj || typeof obj !== 'object') { errs.push(errorMsg(file, 'root is not an object')); return; }
  if (!isString(obj.generationPrompt)) errs.push(errorMsg(file, "missing or invalid 'generationPrompt'"));
  if (!Array.isArray(obj.sentences)) { errs.push(errorMsg(file, "missing or invalid 'sentences' array")); return; }
  obj.sentences.forEach((s, i) => {
    const loc = `${file}.sentences[${i}]`;
    if (!s || typeof s !== 'object') { errs.push(errorMsg(file, `${loc} is not an object`)); return; }
    if (!Array.isArray(s.ja_fragments)) errs.push(errorMsg(file, `${loc} missing 'ja_fragments' array`));
    else if (s.ja_fragments.length < 2) errs.push(errorMsg(file, `${loc} 'ja_fragments' must contain at least 2 fragments`));
    if (!isString(s.ja)) errs.push(errorMsg(file, `${loc} missing or invalid 'ja'`));
    if (!isString(s.en)) errs.push(errorMsg(file, `${loc} missing or invalid 'en'`));
    if ('pattern' in s && s.pattern !== null && !isString(s.pattern)) errs.push(errorMsg(file, `${loc} 'pattern' must be string or null`));
    if (!Array.isArray(s.words)) errs.push(errorMsg(file, `${loc} missing or invalid 'words' array`));
    else s.words.forEach((w, j) => { if (!isString(w)) errs.push(errorMsg(file, `${loc}.words[${j}] is not a string`)); });
    if (Array.isArray(s.ja_fragments)) s.ja_fragments.forEach((f, j) => validateFragment(f, `${loc}.ja_fragments[${j}]`, errs));
  });
}

function inlineWordsJson(obj) {
  const placeholders = {};
  let id = 0;

  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = Array.isArray(node) ? [] : {};
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (k === 'words' && Array.isArray(v) && v.every(x => typeof x === 'string')) {
          const ph = `__INLINE_ARRAY_${Date.now()}_${id++}__`;
          placeholders[ph] = JSON.stringify(v);
          out[k] = ph;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  }

  const copied = walk(obj);
  let json = JSON.stringify(copied, null, 2);
  // Replace quoted placeholders with their inline array representation
  for (const ph of Object.keys(placeholders)) {
    const quoted = `"${ph}"`;
    json = json.split(quoted).join(placeholders[ph]);
  }
  return json + '\n';
}

// Find the first sentence across files that is missing `ja_fragments`.
function findFirstMissingJaFragments(files) {
  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try { raw = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { continue; }
    if (!Array.isArray(obj.sentences)) continue;
    for (let i = 0; i < obj.sentences.length; i++) {
      const s = obj.sentences[i];
      if (!s || typeof s !== 'object') continue;
      if (!Array.isArray(s.ja_fragments)) {
        return { file: f, index: i, sentence: s };
      }
    }
  }
  return null;
}

// Seed scripts/fragments_payload.json with the first sentence missing
// `ja_fragments` and include the prompt markdown text under `generationPrompt`.
// Only does this when the payload file is effectively empty (missing, empty,
// or contains `{}`/`null`/`undefined`). Returns true if it wrote the file.
function seedFragmentsPayloadIfEmpty() {
  const payloadPath = path.join(__dirname, 'fragments_payload.json');
  let content = null;
  if (fs.existsSync(payloadPath)) {
    try { content = fs.readFileSync(payloadPath, 'utf8'); } catch (e) { content = null; }
  }

  const trimmed = content ? content.trim() : '';
  const isEmpty = !trimmed || trimmed === '{}' || trimmed === 'null' || trimmed === 'undefined';

  if (!isEmpty) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Array.isArray(parsed.sentences) && parsed.sentences.length > 0) return false;
      if (parsed && Object.keys(parsed).length !== 0) return false;
      // else fall through to seed
    } catch (e) {
      // invalid JSON: treat as empty and overwrite
    }
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const found = findFirstMissingJaFragments(files);
  if (!found) return false;

  let prompt = '';
  const promptPath = path.join(__dirname, 'prompt_fragment_splitting.md');
  try { prompt = fs.readFileSync(promptPath, 'utf8'); } catch (e) { prompt = ''; }

  const payloadObj = { generationPrompt: prompt, sentences: [found.sentence] };
  try {
    fs.writeFileSync(payloadPath, JSON.stringify(payloadObj, null, 2) + '\n', 'utf8');
    console.log(`Seeded fragments payload with ${found.file}[${found.index}] -> ${payloadPath}`);
    return true;
  } catch (e) {
    console.error('Failed to write fragments payload:', e.message);
    return false;
  }
}

function run() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const summary = { checked: 0, updated: 0, errors: 0 };
  const allErrs = [];
  const jaMap = new Map(); // map: ja string -> [{file, index}]

  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try { raw = fs.readFileSync(full, 'utf8'); }
    catch (e) { console.error(`Failed to read ${f}:`, e.message); continue; }
    let obj;
    try { obj = JSON.parse(raw); }
    catch (e) { console.error(`${f}: JSON parse error: ${e.message}`); summary.errors++; allErrs.push(`${f}: parse error ${e.message}`); continue; }

    // record ja for duplicate detection across files
    if (Array.isArray(obj.sentences)) {
      obj.sentences.forEach((s, i) => {
        if (s && typeof s.ja === 'string') {
          const arr = jaMap.get(s.ja) || [];
          arr.push({ file: f, index: i });
          jaMap.set(s.ja, arr);
        }
      });
    }

    const errs = [];
    validateFile(obj, f, errs);
    summary.checked++;
    if (errs.length) {
      summary.errors += errs.length;
      allErrs.push(...errs);

      // Group errors by message and collect sentence indices when present
      const groups = new Map();
      const others = [];
      for (const e of errs) {
        const idxMatch = e.match(/sentences\[(\d+)\]/);
        const idx = idxMatch ? idxMatch[1] : null;
        // get message text after the closing bracket or after the file name
        let msg = e.replace(/^.*\] ?/, '');
        msg = msg.replace(/^.*?: ?/, '');
        if (idx) {
          const key = msg;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(idx);
        } else {
          others.push(msg);
        }
      }

      console.error(f);
      for (const [msg, indices] of groups.entries()) {
        console.error(' -', `{validation} ${msg}`);
        console.error('  --sentences', indices.join(','));
      }
      for (const o of others) console.error(' -', `{validation} ${o}`);

      continue;
    }

    const out = inlineWordsJson(obj);
    if (out !== raw) {
      fs.writeFileSync(full, out, 'utf8');
      summary.updated++;
      console.log(`Reformatted ${f}`);
    } else {
      console.log(`No changes for ${f}`);
    }
  }

  console.log('---');
  console.log(`Checked: ${summary.checked}, Updated: ${summary.updated}, Validation errors: ${summary.errors}`);

  // Emit warnings for duplicate `ja` across files
  for (const [jaText, occ] of jaMap.entries()) {
    if (occ.length > 1) {
      const locations = occ.map(o => `${o.file}[${o.index}]`).join(',');
      console.warn('Duplicate sentence `ja` across files:');
      console.warn(' -', jaText);
      console.warn('  --locations', locations);
    }
  }

  // If fragments payload is empty, seed it with the first sentence missing ja_fragments
  try {
    const seeded = seedFragmentsPayloadIfEmpty();
    if (seeded) console.log('Fragments payload seeded.');
  } catch (e) {
    console.error('Error while attempting to seed fragments payload:', e && e.message ? e.message : e);
  }
}

if (require.main === module) run();
