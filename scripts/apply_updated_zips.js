const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const downloadsDir = path.join(os.homedir(), 'Downloads');
const distDir = path.join(repoRoot, 'dist');

function winPath(p) {
  return p.replace(/\//g, '\\\\');
}

function isArchive(name) {
  return /\.zip$/i.test(name) || /\.tar\.gz$/i.test(name) || /\.tgz$/i.test(name);
}

function findMostRecentArchive(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .map(f => ({ name: f, full: path.join(dir, f) }))
    .filter(f => fs.existsSync(f.full) && fs.statSync(f.full).isFile() && isArchive(f.name));
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);
  return files[0].full;
}

function safeCopy(src, dest) {
  fs.copyFileSync(src, dest);
  return dest;
}

function extractArchive(archivePath, destRoot) {
  const lower = archivePath.toLowerCase();
  if (os.platform() === 'win32') {
    if (/\.zip$/.test(lower)) {
      const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${winPath(archivePath)}' -DestinationPath '${winPath(destRoot)}' -Force"`;
      execSync(cmd, { stdio: 'inherit' });
      return;
    }
    // On Windows, try tar for tar.gz/tgz
    if (/\.tar\.gz$/.test(lower) || /\.tgz$/.test(lower)) {
      execSync(`tar -xzf '${archivePath}' -C '${destRoot}'`, { stdio: 'inherit', shell: true });
      return;
    }
  } else {
    // Unix-like
    if (/\.zip$/.test(lower)) {
      try {
        execSync(`unzip -o '${archivePath}' -d '${destRoot}'`, { stdio: 'inherit' });
      } catch (e) {
        // fallback to unzip via busybox or pigz not expected; rethrow
        throw e;
      }
      return;
    }
    if (/\.tar\.gz$/.test(lower) || /\.tgz$/.test(lower)) {
      execSync(`tar -xzf '${archivePath}' -C '${destRoot}'`, { stdio: 'inherit' });
      return;
    }
  }
  throw new Error('Unsupported archive type: ' + archivePath);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function makeUniqueDest(dest) {
  if (!fs.existsSync(dest)) return dest;
  const parsed = path.parse(dest);
  const uniq = `${parsed.name}-${Date.now()}${parsed.ext}`;
  return path.join(parsed.dir, uniq);
}

function main() {
  console.log('Looking for most recent archive in', downloadsDir);
  const found = findMostRecentArchive(downloadsDir);
  if (!found) {
    console.error('No recent archive (.zip, .tar.gz, .tgz) found in', downloadsDir);
    process.exitCode = 2;
    return;
  }

  console.log('Found:', found);

  ensureDir(distDir);

  const baseName = path.basename(found);
  let destPath = path.join(distDir, baseName);
  destPath = makeUniqueDest(destPath);

  try {
    console.log(`Copying ${found} -> ${destPath}`);
    safeCopy(found, destPath);
  } catch (err) {
    console.error('Failed to copy file:', err.message || err);
    process.exitCode = 3;
    return;
  }

  try {
    console.log('Extracting to repo root:', repoRoot);
    extractArchive(destPath, repoRoot);
    console.log('Extraction complete.');
  } catch (err) {
    console.error('Extraction failed:', err.message || err);
    process.exitCode = 4;
    return;
  }

  console.log('Done. Zip moved to', destPath);
}

if (require.main === module) main();
