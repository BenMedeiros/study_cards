import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getSecurityRules } from 'firebase-admin/security-rules';

import { getFirebaseLocalConfig } from './firebaseLocalConfig.mjs';

const repoRoot = process.cwd();
const defaultOutputPath = path.join(repoRoot, 'firebase', 'rules', 'current');
const localConfig = getFirebaseLocalConfig();

function getArgValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index < 0) return '';
  const next = process.argv[index + 1];
  return typeof next === 'string' ? next.trim() : '';
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

function toRepoRelativePath(targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  return relative ? relative.replace(/\\/g, '/') : '.';
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
    || localConfig.rulesOut
    || String(process.env.FIREBASE_RULES_OUT || '').trim()
  );
  return requested ? path.resolve(repoRoot, requested) : defaultOutputPath;
}

function resolveStorageBucket() {
  return (
    getArgValue('--storage-bucket')
    || localConfig.storageBucket
    || String(process.env.FIREBASE_STORAGE_BUCKET || '').trim()
  );
}

function resolveDatabaseUrl() {
  return (
    getArgValue('--database-url')
    || localConfig.databaseUrl
    || String(process.env.FIREBASE_DATABASE_URL || '').trim()
  );
}

function formatUsage() {
  return [
    'Usage:',
    '  npm run firebase:pull-security-rules -- [options]',
    '',
    'Options:',
    '  --key <path>             Service-account JSON path',
    '  --storage-bucket <name>  Storage bucket name for storage rules',
    '  --database-url <url>     Realtime Database URL for RTDB rules',
    '  --out <path>             Output directory',
    '  --help                   Show this message',
    '',
    'Environment:',
    '  FIREBASE_SERVICE_ACCOUNT_JSON',
    '  GOOGLE_APPLICATION_CREDENTIALS',
    '  FIREBASE_STORAGE_BUCKET',
    '  FIREBASE_DATABASE_URL',
    '  FIREBASE_RULES_OUT',
    '',
    'Local config files:',
    '  .secrets.json',
    '  .env.json',
  ].join('\n');
}

async function loadServiceAccountCredential() {
  const explicitPath = resolveServiceAccountPath();
  if (!explicitPath) return { credential: null, projectId: '' };
  const jsonText = await fs.readFile(explicitPath, 'utf8');
  const parsed = JSON.parse(jsonText);
  return {
    credential: cert(parsed),
    projectId: String(parsed.project_id || '').trim(),
  };
}

async function ensureAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const explicit = await loadServiceAccountCredential().catch(() => ({ credential: null, projectId: '' }));
  const storageBucket = resolveStorageBucket();
  const databaseURL = resolveDatabaseUrl();
  const projectId = (
    explicit.projectId
    || String(process.env.GCLOUD_PROJECT || '').trim()
    || String(process.env.GOOGLE_CLOUD_PROJECT || '').trim()
  );

  return initializeApp({
    credential: explicit.credential || applicationDefault(),
    ...(projectId ? { projectId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
    ...(databaseURL ? { databaseURL } : {}),
  });
}

function serializeRulesetSource(ruleset, fallbackName) {
  const files = Array.isArray(ruleset?.source) ? ruleset.source : [];
  if (!files.length) return '';
  if (files.length === 1) return String(files[0]?.content || '');

  return files.map((file, index) => {
    const name = String(file?.name || `${fallbackName}.${index + 1}`).trim() || `${fallbackName}.${index + 1}`;
    const content = String(file?.content || '');
    return `// File: ${name}\n${content}`.trimEnd();
  }).join('\n\n');
}

async function writeTextFile(baseDir, relativePath, content) {
  const targetPath = path.join(baseDir, ...String(relativePath).split('/'));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${String(content || '').replace(/\s+$/, '')}\n`, 'utf8');
  return targetPath;
}

function buildRulesetMetadata(kind, ruleset, relativePath, extra = {}) {
  return {
    kind,
    path: relativePath,
    rulesetName: ruleset?.name || null,
    rulesetCreateTime: ruleset?.createTime || null,
    sourceFiles: Array.isArray(ruleset?.source)
      ? ruleset.source.map((file) => ({
          name: String(file?.name || '').trim() || null,
        }))
      : [],
    ...extra,
  };
}

async function pullSecurityRules() {
  if (hasFlag('--help')) {
    console.log(formatUsage());
    return;
  }

  const app = await ensureAdminApp();
  const rules = getSecurityRules(app);
  const outputDir = resolveOutputPath();
  const storageBucket = String(resolveStorageBucket() || app.options.storageBucket || '').trim();
  const databaseURL = String(resolveDatabaseUrl() || app.options.databaseURL || '').trim();

  await fs.mkdir(outputDir, { recursive: true });

  const manifest = {
    pulledAt: new Date().toISOString(),
    projectId: String(app.options.projectId || '').trim() || null,
    outputDir: toRepoRelativePath(outputDir),
    firestore: null,
    storage: null,
    realtimeDatabase: null,
  };

  let successCount = 0;

  try {
    const firestoreRuleset = await rules.getFirestoreRuleset();
    const relativePath = 'firestore.rules';
    await writeTextFile(outputDir, relativePath, serializeRulesetSource(firestoreRuleset, relativePath));
    manifest.firestore = buildRulesetMetadata('firestore', firestoreRuleset, relativePath);
    successCount += 1;
  } catch (error) {
    manifest.firestore = {
      kind: 'firestore',
      error: String(error?.message || error || 'Unable to pull Firestore rules'),
    };
  }

  if (storageBucket) {
    try {
      const storageRuleset = await rules.getStorageRuleset(storageBucket);
      const relativePath = 'storage.rules';
      await writeTextFile(outputDir, relativePath, serializeRulesetSource(storageRuleset, relativePath));
      manifest.storage = buildRulesetMetadata('storage', storageRuleset, relativePath, { bucket: storageBucket });
      successCount += 1;
    } catch (error) {
      manifest.storage = {
        kind: 'storage',
        bucket: storageBucket,
        error: String(error?.message || error || 'Unable to pull Storage rules'),
      };
    }
  } else {
    manifest.storage = {
      kind: 'storage',
      skipped: 'No storage bucket configured. Provide --storage-bucket or FIREBASE_STORAGE_BUCKET.',
    };
  }

  if (databaseURL) {
    try {
      const database = getDatabaseWithUrl(databaseURL, app);
      const relativePath = 'database.rules.json';
      const source = await database.getRules();
      await writeTextFile(outputDir, relativePath, source);
      manifest.realtimeDatabase = {
        kind: 'realtime-database',
        path: relativePath,
        databaseURL,
      };
      successCount += 1;
    } catch (error) {
      manifest.realtimeDatabase = {
        kind: 'realtime-database',
        databaseURL,
        error: String(error?.message || error || 'Unable to pull Realtime Database rules'),
      };
    }
  } else {
    manifest.realtimeDatabase = {
      kind: 'realtime-database',
      skipped: 'No database URL configured. Provide --database-url or FIREBASE_DATABASE_URL.',
    };
  }

  await writeTextFile(outputDir, '_firebase.rules.json', JSON.stringify(manifest, null, 2));

  if (!successCount) {
    throw new Error('No Firebase rules were pulled. Check credentials, project access, and optional bucket/database settings.');
  }

  console.log(`Wrote Firebase rules snapshot to ${outputDir}`);
}

pullSecurityRules().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
