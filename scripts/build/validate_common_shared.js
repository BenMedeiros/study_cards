const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const COMMON_DIR = path.join(ROOT, 'src', 'utils', 'common');

const BANNED = [
  /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bindexedDB\b/, /\bfetch\b/, /\bspeechSynthesis\b/, /\bSpeechSynthesisUtterance\b/, /\bnavigator\b/, /\blocation\b/, /\bHTMLElement\b/, /\bcustomElements\b/, /\bXMLHttpRequest\b/
];

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (p.endsWith('.js') || p.endsWith('.mjs'))) out.push(p);
  }
  return out;
}

function checkFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  if (/\/\*\s*allow-browser\s*\*\//i.test(txt.split('\n', 3).join('\n'))) return null;
  for (const rx of BANNED) {
    const m = rx.exec(txt);
    if (m) {
      const idx = m.index;
      const upTo = txt.slice(0, idx);
      const lineNum = upTo.split('\n').length;
      const lines = txt.split('\n');
      const sample = lines[lineNum - 1].trim();
      return { file: filePath, token: rx.toString(), line: lineNum, sample };
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(COMMON_DIR)) {
    console.log('No common utils directory; skipping check.');
    return 0;
  }
  const files = walk(COMMON_DIR);
  const extensionProblems = files.filter((f) => f.endsWith('.js'));
  const problems = [];
  for (const f of files) {
    console.log('Validating:', path.relative(ROOT, f));
    const p = checkFile(f);
    if (p) problems.push(p);
  }
  if (extensionProblems.length) {
    console.error('\nFound non-.mjs modules in src/utils/common:');
    for (const f of extensionProblems) {
      console.error(`- ${path.relative(ROOT, f)}`);
    }
    console.error('\nRename shared common modules to .mjs so they can be imported consistently by browser code and Node scripts.');
  }
  if (problems.length) {
    console.error('\nFound browser-only tokens in src/utils/common files:');
    for (const p of problems) {
      console.error(`- ${path.relative(ROOT, p.file)}:${p.line} -> ${p.sample}`);
    }
    console.error('\nRemove browser globals from common utils or move the file to src/utils/browser.');
  }
  if (extensionProblems.length || problems.length) {
    throw new Error('validate_common_shared: validation failed for src/utils/common files');
  }
  console.log('OK: src/utils/common uses .mjs modules and passes browser-global checks.');
  return 0;
}

if (require.main === module) process.exitCode = main();