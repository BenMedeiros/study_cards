const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const destDir = path.join(repoRoot, 'dist');
fs.mkdirSync(destDir, { recursive: true });

// Use a single date suffix (YYYYMMDD) for all zip filenames
function dateSuffix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

function winPath(p) {
  return p.replace(/\//g, '\\\\');
}

function runPowershellCompress(paths, destZip) {
  const psPaths = paths.map(p => `'${winPath(p)}'`).join(',');
  const cmd = `powershell -NoProfile -Command "Compress-Archive -Path ${psPaths} -DestinationPath '${winPath(destZip)}' -Force"`;
  execSync(cmd, { stdio: 'inherit' });
}

function runZip(paths, destZip) {
  // attempt to use zip if available
  try {
    const args = ['-r', destZip].concat(paths);
    execSync(`zip ${args.map(a => `'${a}'`).join(' ')}`, { cwd: repoRoot, stdio: 'inherit' });
  } catch (e) {
    // fallback to tar gz if zip isn't available
    const tarName = destZip.replace(/\.zip$/i, '.tar.gz');
    const args = ['-czf', tarName].concat(paths);
    execSync(`tar ${args.map(a => `'${a}'`).join(' ')}`, { cwd: repoRoot, stdio: 'inherit' });
  }
}

function fileExists(...parts) {
  return fs.existsSync(path.join(...parts));
}

function cleanDist() {
  try {
    const files = fs.readdirSync(destDir).filter(f => f.toLowerCase().endsWith('.zip'));
    if (files.length === 0) return;
    console.log('Removing existing zip files in', destDir);
    for (const f of files) {
      const p = path.join(destDir, f);
      try { fs.unlinkSync(p); console.log('  removed', p); } catch (e) { console.warn('  failed to remove', p, e.message || e); }
    }
  } catch (e) {
    // ignore
  }
}

function buildArchive(name, items, dateSuffixStr) {
  const dest = path.join(destDir, `${name}-${dateSuffixStr}.zip`);
  const absPaths = items
    .map(p => path.join(repoRoot, p))
    .filter(p => fs.existsSync(p));

  if (absPaths.length === 0) {
    console.warn(`No items found for archive '${name}', skipping.`);
    return null;
  }

  console.log(`Creating ${dest} ...`);
  if (os.platform() === 'win32') {
    runPowershellCompress(absPaths, dest);
  } else {
    // for unix-like, run from repo root and pass relative paths if possible
    const relPaths = items.filter(p => fs.existsSync(path.join(repoRoot, p)));
    runZip(relPaths, dest);
  }
  console.log(`Created ${dest}`);
  return dest;
}

function main() {
  // archives to create
  const archives = [
    { name: 'collections', items: ['collections'] },
    { name: 'src', items: ['src'] },
    // "all" — include the main top-level project items; adjust as needed
    { name: 'all', items: ['index.html', 'package.json', 'README.md', 'collections', 'src', 'scripts'] },
  ];

  const args = process.argv.slice(2);
  const clean = args.includes('--clean') || args.includes('-c');
  const openDist = args.includes('--openDistFolder') || args.includes('--open-dist-folder') || args.includes('-o');

  if (clean) cleanDist();

  const created = [];
  const dateSuffixStr = dateSuffix();
  for (const a of archives) {
    try {
      const out = buildArchive(a.name, a.items, dateSuffixStr);
      if (out) created.push(out);
    } catch (err) {
      console.error(`Failed to create ${a.name}:`, err.message || err);
    }
  }

  if (created.length === 0) {
    console.log('No archives were created.');
  } else {
    console.log('\nArchives created:');
    for (const c of created) console.log(' -', c);
    if (openDist) {
      // attempt to open the destination folder so the user can see the files
      try {
        if (os.platform() === 'win32') {
          // Use cmd start to open Explorer on Windows
          execSync(`cmd /c start "" "${winPath(destDir)}"`, { stdio: 'ignore', shell: true });
        } else if (os.platform() === 'darwin') {
          execSync(`open "${destDir}"`, { stdio: 'ignore' });
        } else {
          // Most linux desktops support xdg-open
          execSync(`xdg-open "${destDir}"`, { stdio: 'ignore' });
        }
      } catch (e) {
        // ignore failures to open the folder
      }
    }
  }
}

if (require.main === module) main();
