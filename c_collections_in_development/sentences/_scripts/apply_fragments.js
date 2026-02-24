#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const scriptsDir = __dirname;
const dir = path.resolve(__dirname, '..');

function readPayload(argFile) {
  if (argFile) return { payload: JSON.parse(fs.readFileSync(argFile, 'utf8')), sourceName: path.basename(argFile), sourcePath: path.resolve(argFile) };
  const defaultPath = path.join(scriptsDir, 'fragments_payload.json');
  if (fs.existsSync(defaultPath)) {
    return { payload: JSON.parse(fs.readFileSync(defaultPath, 'utf8')), sourceName: path.basename(defaultPath), sourcePath: defaultPath };
  }
  // fallback to stdin (may block if no input provided)
  const stdin = fs.readFileSync(0, 'utf8');
  return { payload: JSON.parse(stdin || '{}'), sourceName: null, sourcePath: null };
}

function eqString(a, b) { return String(a || '') === String(b || ''); }
function eqArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eqString(a[i], b[i])) return false;
  return true;
}

// Token-based chunk diff: split on whitespace, keep common prefix/suffix tokens,
// and show the differing middle tokens. Avoid partial-word diffs.
function charDiff(a, b, ctx = 5) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return a;

  const ta = a.trim().split(/\s+/).filter(Boolean);
  const tb = b.trim().split(/\s+/).filter(Boolean);
  const n = ta.length, m = tb.length;

  // find longest common contiguous token substring between ta and tb (DP)
  let maxLen = 0, ai = 0, bj = 0;
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ta[i - 1] === tb[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > maxLen) { maxLen = dp[i][j]; ai = i; bj = j; }
      }
    }
  }

  if (maxLen === 0) {
    // no common contiguous chunk: fall back to showing start and end tokens
    const leftA = ta.slice(0, ctx).join(' ');
    const leftB = tb.slice(0, ctx).join(' ');
    return `[${leftA} -> ${leftB}] ...`;
  }

  const aStart = ai - maxLen;
  const bStart = bj - maxLen;
  const common = ta.slice(aStart, aStart + maxLen).join(' ');

  const leftA = ta.slice(0, aStart).join(' ');
  const leftB = tb.slice(0, bStart).join(' ');
  const rightA = ta.slice(aStart + maxLen).join(' ');
  const rightB = tb.slice(bStart + maxLen).join(' ');

  const leftShownA = leftA ? (leftA.split(/\s+/).slice(-ctx).join(' ')) : '';
  const leftShownB = leftB ? (leftB.split(/\s+/).slice(-ctx).join(' ')) : '';
  const rightShownA = rightA ? (rightA.split(/\s+/).slice(0, ctx).join(' ')) : '';
  const rightShownB = rightB ? (rightB.split(/\s+/).slice(0, ctx).join(' ')) : '';

  const leftDiff = (leftShownA || '') === (leftShownB || '') ? leftShownA : `${leftShownA} -> ${leftShownB}`;
  const rightDiff = (rightShownA || '') === (rightShownB || '') ? rightShownA : `${rightShownA} -> ${rightShownB}`;

  const parts = [];
  if (leftDiff) parts.push(`${leftDiff}`);
  parts.push(`[${leftA.split(/\s+/).slice(-ctx).join(' ')}${leftA && leftShownA ? '' : ''} -> ${leftB.split(/\s+/).slice(-ctx).join(' ')}]`);
  parts.push(common);
  if (rightDiff) parts.push(rightDiff);

  // Simplify: show left differences bracket then common chunk
  const leftSegment = (leftA || leftB) ? `[${leftShownA || ''} -> ${leftShownB || ''}]` : '';
  const rightSegment = (rightShownA || rightShownB) ? `[${rightShownA || ''} -> ${rightShownB || ''}]` : '';

  const out = `${leftSegment} ${common} ${rightSegment}`.replace(/\s+/g, ' ').trim();
  return out;
}

function arrayDiff(a, b) {
  a = Array.isArray(a) ? a : [];
  b = Array.isArray(b) ? b : [];
  const removed = a.filter(x => !b.includes(x));
  const added = b.filter(x => !a.includes(x));
  return { added, removed };
}

function inlineWordsJson(obj) {
  const placeholders = {};
  let id = 0;
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
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
  for (const ph of Object.keys(placeholders)) {
    const quoted = `"${ph}"`;
    json = json.split(quoted).join(placeholders[ph]);
  }
  return json + '\n';
}

function findSentenceByJa(files, jaText) {
  const matches = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try { raw = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { continue; }
    if (!Array.isArray(obj.sentences)) continue;
    obj.sentences.forEach((s, i) => { if (s && s.ja === jaText) matches.push({ file: f, index: i, obj, raw }); });
  }
  return matches;
}

// Token LCS-based diff: find longest common subsequence of tokens, then
// produce all differing token chunks between matched tokens.
function tokenDiffChunks(a, b) {
  a = String(a || '').trim(); b = String(b || '').trim();
  const ta = a ? a.split(/\s+/) : [];
  const tb = b ? b.split(/\s+/) : [];
  const n = ta.length, m = tb.length;
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ta[i - 1] === tb[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // backtrack to get LCS token positions
  let i = n, j = m;
  const matches = [];
  while (i > 0 && j > 0) {
    if (ta[i - 1] === tb[j - 1]) {
      matches.push({ ai: i - 1, bj: j - 1, token: ta[i - 1] });
      i--; j--; 
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  matches.reverse();

  const chunks = [];
  let prevA = -1, prevB = -1;
  for (const mmatch of matches) {
    const aStart = prevA + 1;
    const aEnd = mmatch.ai - 1;
    const bStart = prevB + 1;
    const bEnd = mmatch.bj - 1;
    if (aStart <= aEnd || bStart <= bEnd) {
      const aDiff = ta.slice(aStart, aEnd + 1).join(' ');
      const bDiff = tb.slice(bStart, bEnd + 1).join(' ');
      if (aDiff || bDiff) chunks.push({ a: aDiff, b: bDiff });
    }
    prevA = mmatch.ai;
    prevB = mmatch.bj;
  }
  // tail
  if (prevA + 1 <= n - 1 || prevB + 1 <= m - 1) {
    const aDiff = ta.slice(prevA + 1).join(' ');
    const bDiff = tb.slice(prevB + 1).join(' ');
    if (aDiff || bDiff) chunks.push({ a: aDiff, b: bDiff });
  }

  return chunks; // array of {a: '...', b: '...'} where a/b may be empty strings
}

function main() {
  // parse args: allow flags like --force and an optional payload filename
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const payloadArg = argv.find(a => !a.startsWith('-'));

  let payload;
  let payloadSourceName;
  let payloadSourcePath;
  try {
    const res = readPayload(payloadArg);
    payload = res.payload;
    payloadSourceName = res.sourceName;
    payloadSourcePath = res.sourcePath;
  } catch (e) {
    console.error('Failed to read payload:', e.message);
    process.exit(2);
  }

  if (!payload || !Array.isArray(payload.sentences) || payload.sentences.length === 0) {
    console.error('Payload must contain a sentences array');
    process.exit(2);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== payloadSourceName);

  for (const sent of payload.sentences) {
    const jaText = sent.ja;
    const matches = findSentenceByJa(files, jaText);
    if (matches.length === 0) {
      console.error(`Not found: sentence with exact 'ja' not located: ${jaText}`);
      continue;
    }
    if (matches.length > 1) {
      console.error('Ambiguous: sentence `ja` found in multiple locations, aborting.');
      matches.forEach(m => console.error(' -', `${m.file}[${m.index}]`));
      process.exit(3);
    }

    const m = matches[0];
    const sentence = m.obj.sentences[m.index];

    // compare en/pattern/words and produce per-field chunked diffs
    const diffs = [];
    if (!eqString(sentence.en, sent.en)) {
      const chunks = tokenDiffChunks(sentence.en || '', sent.en || '');
      diffs.push({ field: 'en', current: sentence.en, payload: sent.en, chunks });
    }
    if (!eqString(sentence.pattern, sent.pattern)) {
      const chunks = tokenDiffChunks(sentence.pattern || '', sent.pattern || '');
      diffs.push({ field: 'pattern', current: sentence.pattern, payload: sent.pattern, chunks });
    }
    if (!eqArray(sentence.words, sent.words)) {
      const arrDiff = arrayDiff(sentence.words, sent.words);
      diffs.push({ field: 'words', current: sentence.words, payload: sent.words, arrDiff });
    }

    // also check for existing ja_fragments validation
    const validations = [];
    if (Array.isArray(sentence.ja_fragments) && sentence.ja_fragments.length > 0) {
      validations.push({ type: 'existing_ja_fragments', length: sentence.ja_fragments.length });
    }

    if (diffs.length || validations.length) {
      if (diffs.length) {
        console.error('Mismatch detected: other fields changed for the matched sentence.');
        console.error('Location:', `${m.file}[${m.index}]`);
        for (const d of diffs) {
          console.error(` - Field: ${d.field}`);
          if (d.field === 'words') {
            console.error(`   current words: ${JSON.stringify(d.current)}`);
            console.error(`   payload  words: ${JSON.stringify(d.payload)}`);
            if (d.arrDiff.added.length) console.error(`   added: ${d.arrDiff.added.join(',')}`);
            if (d.arrDiff.removed.length) console.error(`   removed: ${d.arrDiff.removed.join(',')}`);
            console.error('');
            continue;
          }

          console.error(`   current: ${d.current}`);
          console.error(`   payload: ${d.payload}`);
          console.error('');

          // Print each differing chunk in its own bracketed line, separated by blank lines
          if (Array.isArray(d.chunks) && d.chunks.length) {
            for (const c of d.chunks) {
              const left = c.a || '';
              const right = c.b || '';
              console.error(`   [${left} -> ${right}]`);
              console.error('');
            }
          }
        }
      }

      if (validations.length) {
        for (const v of validations) {
          if (v.type === 'existing_ja_fragments') {
            console.error('Validation: target sentence already has `ja_fragments`.');
            console.error('Location:', `${m.file}[${m.index}]`);
            console.error('Existing `ja_fragments` length:', v.length);
            console.error('');
          }
        }
      }

      if (!force) {
        console.error('No update performed. Run with --force to apply changes despite mismatches and validations.');
        process.exit(4);
      }

      console.warn('Forcing update despite mismatches/validations (--force). Proceeding to apply payload values and/or overwrite fragments.');

      // When forcing, prefer payload values for differing fields (en/pattern/words)
      for (const d of diffs) {
        if (d.field === 'en') {
          sentence.en = d.payload;
          console.log(`Overwrote field 'en' at ${m.file}[${m.index}] with payload value.`);
        } else if (d.field === 'pattern') {
          sentence.pattern = d.payload;
          console.log(`Overwrote field 'pattern' at ${m.file}[${m.index}] with payload value.`);
        } else if (d.field === 'words') {
          sentence.words = Array.isArray(d.payload) ? d.payload : sentence.words;
          console.log(`Overwrote field 'words' at ${m.file}[${m.index}] with payload value.`);
        }
      }

      // If validations include existing ja_fragments, warn about overwrite
      if (validations.some(v => v.type === 'existing_ja_fragments')) {
        console.warn('Overwriting existing `ja_fragments` because --force was provided.');
      }
    }

    // validate existing ja_fragments
    if (Array.isArray(sentence.ja_fragments) && sentence.ja_fragments.length > 0) {
      console.error('Validation: target sentence already has `ja_fragments`.');
      console.error('Location:', `${m.file}[${m.index}]`);
      console.error('Existing `ja_fragments` length:', sentence.ja_fragments.length);
      if (!force) {
        console.error('No update performed. Use --force to overwrite existing `ja_fragments`.');
        continue;
      }
      console.warn('Overwriting existing `ja_fragments` because --force was provided.');
    }

    // ok — update ja_fragments
    sentence.ja_fragments = sent.ja_fragments;

    // write back formatted
    const out = inlineWordsJson(m.obj);
    fs.writeFileSync(path.join(dir, m.file), out, 'utf8');
    console.log('Updated', m.file, 'sentence index', m.index);
  }

  // Clear payload file if it was read from disk
  if (payloadSourcePath) {
    try {
      fs.writeFileSync(payloadSourcePath, '{}\n', 'utf8');
      console.log('Cleared payload file:', payloadSourcePath);
    } catch (e) {
      console.error('Failed to clear payload file:', payloadSourcePath, e.message);
    }
  }
}

if (require.main === module) main();
