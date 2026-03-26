import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { getFirebaseLocalConfig } from './firebaseLocalConfig.mjs';

const repoRoot = process.cwd();
const defaultOutputPath = path.join(repoRoot, 'firebase', 'exports', 'collection_settings');
const localConfig = getFirebaseLocalConfig();

function getArgValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index < 0) return '';
  const next = process.argv[index + 1];
  return typeof next === 'string' ? next.trim() : '';
}

function resolveRequestedUid() {
  return (
    getArgValue('--uid')
    || localConfig.uid
    || String(process.env.FIREBASE_UID || '').trim()
  );
}

function resolveServiceAccountPath() {
  return (
    getArgValue('--key')
    || localConfig.serviceAccountJson
    || String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()
    || String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()
  );
}

function resolveOutputPath() {
  const requested = (
    getArgValue('--out')
    || localConfig.collectionSettingsOut
    || String(process.env.FIREBASE_PULL_OUT || '').trim()
  );
  return requested ? path.resolve(repoRoot, requested) : defaultOutputPath;
}

async function loadServiceAccountCredential() {
  const explicitPath = resolveServiceAccountPath();
  if (!explicitPath) return null;
  const jsonText = await fs.readFile(explicitPath, 'utf8');
  const parsed = JSON.parse(jsonText);
  return cert(parsed);
}

async function ensureAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const explicitCredential = await loadServiceAccountCredential().catch(() => null);
  return initializeApp({
    credential: explicitCredential || applicationDefault(),
  });
}

function normalizeDocData(docSnap) {
  const data = docSnap.data() || {};
  return {
    docId: docSnap.id,
    collectionId: String(data.collectionId || '').trim() || decodeURIComponent(docSnap.id),
    dbName: String(data.dbName || '').trim() || 'study_cards',
    storeName: String(data.storeName || '').trim() || 'collection_settings',
    snapshotType: String(data.snapshotType || '').trim() || 'idb.collection_settings',
    schemaVersion: Number.isFinite(Number(data.schemaVersion)) ? Number(data.schemaVersion) : 1,
    clientSnapshotCreatedAt: data.clientSnapshotCreatedAt || null,
    row: data.row ?? null,
  };
}

function normalizeCollectionRelativePath(collectionId) {
  const normalized = String(collectionId || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) throw new Error('collectionId is required');
  const segments = normalized.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid collectionId path: ${collectionId}`);
  }
  const joined = segments.join('/');
  return joined.toLowerCase().endsWith('.json') ? joined : `${joined}.json`;
}

async function writePerCollectionExports(outputDir, docs) {
  const manifestDocs = [];
  for (const entry of docs) {
    const relativePath = normalizeCollectionRelativePath(entry.collectionId);
    const targetPath = path.join(outputDir, ...relativePath.split('/'));
    const payload = (entry.row && typeof entry.row === 'object' && entry.row.value !== undefined)
      ? entry.row.value
      : entry.row;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(payload ?? null, null, 2)}\n`, 'utf8');
    manifestDocs.push({
      docId: entry.docId,
      collectionId: entry.collectionId,
      relativePath,
      dbName: entry.dbName,
      storeName: entry.storeName,
      snapshotType: entry.snapshotType,
      schemaVersion: entry.schemaVersion,
      clientSnapshotCreatedAt: entry.clientSnapshotCreatedAt,
    });
  }
  return manifestDocs;
}

async function pullCollectionSettings() {
  const uid = resolveRequestedUid();
  if (!uid) {
    throw new Error('Missing Firebase uid. Provide --uid <uid>, set FIREBASE_UID, or add firebase.uid to .secrets.json.');
  }

  await ensureAdminApp();
  const db = getFirestore();
  const snapshot = await db.collection('users').doc(uid).collection('collection_settings').get();

  const docs = snapshot.docs.map(normalizeDocData).sort((a, b) => a.collectionId.localeCompare(b.collectionId));
  const outPath = resolveOutputPath();
  await fs.rm(outPath, { recursive: true, force: true });
  await fs.mkdir(outPath, { recursive: true });

  const manifestDocs = await writePerCollectionExports(outPath, docs);
  const output = {
    userId: uid,
    exportedAt: new Date().toISOString(),
    source: 'firestore.users.{uid}.collection_settings',
    count: docs.length,
    docs: manifestDocs,
  };

  const manifestPath = path.join(outPath, '_firebase.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${docs.length} collection_settings docs to ${outPath}`);
}

pullCollectionSettings().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});