const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();

app.use(express.json({ limit: '2mb' }));

// Serve the static site from repo root (minimal root layout).
const repoRoot = path.join(__dirname, '..', '..');

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(repoRoot, 'index.html'));
});

app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(repoRoot, 'styles.css'));
});

app.use('/src', express.static(path.join(repoRoot, 'src')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: 'local', ts: new Date().toISOString() });
});

const collectionsDir = path.join(repoRoot, 'collections');

// Recursive function to list all JSON files in collections folder
async function listCollectionFiles(dir, basePath = '') {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      const subFiles = await listCollectionFiles(fullPath, relativePath);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(relativePath);
    }
  }
  
  return files.sort();
}

// API endpoint to list all collection files (must come before static middleware)
app.get('/api/collections/list', async (req, res) => {
  try {
    const files = await listCollectionFiles(collectionsDir);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// Serve collections as static files under /collections so the web UI can fetch them.
app.use('/collections', express.static(collectionsDir));

app.get('/collections/index.json', async (req, res) => {
  try {
    const files = await fs.readdir(collectionsDir);
    const ids = files
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => f.replace(/\.json$/i, ''))
      .sort();

    res.json({ collections: ids });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/collections', async (req, res) => {
  try {
    const files = await fs.readdir(collectionsDir);
    const jsonFiles = files.filter((f) => f.toLowerCase().endsWith('.json'));
    const collections = [];

    for (const filename of jsonFiles) {
      const fullPath = path.join(collectionsDir, filename);
      const raw = await fs.readFile(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      collections.push({
        id: parsed?.metadata?.id ?? filename,
        name: parsed?.metadata?.name ?? filename,
        description: parsed?.metadata?.description ?? '',
        version: parsed?.metadata?.version ?? 1,
      });
    }

    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/collections/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const fullPath = path.join(collectionsDir, `${id}.json`);
    const raw = await fs.readFile(fullPath, 'utf8');
    res.type('json').send(raw);
  } catch (err) {
    res.status(404).json({ error: 'Not found' });
  }
});

// v0 stub: accept a pushed collection (client decides when to push)
app.post('/api/sync/pushCollection', async (req, res) => {
  try {
    const collection = req.body;
    const id = collection?.metadata?.id;
    if (!id) return res.status(400).json({ error: 'Missing collection.metadata.id' });

    const fullPath = path.join(collectionsDir, `${id}.json`);

    // v0: overwrite (later: version checks + backups)
    await fs.writeFile(fullPath, JSON.stringify(collection, null, 2) + '\n', 'utf8');

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Study Cards server running at http://0.0.0.0:${port}`);
  console.log(`Access from this machine: http://127.0.0.1:${port}`);
  console.log(`Access from local network: http://[your-ip]:${port}`);
});
