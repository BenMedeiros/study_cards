import { idbGet, idbPut } from '../utils/browser/idb.js';
import { studyProgressSeenStateMigration } from './studyProgressSeenStateMigration.js';

const MIGRATION_META_ID = 'frontend_migrations';
const migrations = [
  studyProgressSeenStateMigration,
];

function normalizeWholeNumber(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function cloneObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : {};
}

async function readMigrationMeta() {
  const record = await idbGet('app_meta', MIGRATION_META_ID).catch(() => null);
  const value = cloneObject(record?.value);
  return {
    id: MIGRATION_META_ID,
    value: {
      version: normalizeWholeNumber(value.version),
      applied: cloneObject(value.applied),
      updatedAt: String(value.updatedAt || '').trim() || null,
    },
  };
}

export async function runFrontendMigrations() {
  const meta = await readMigrationMeta();
  const applied = cloneObject(meta.value.applied);
  let latestVersion = normalizeWholeNumber(meta.value.version);
  const results = [];

  for (const migration of migrations) {
    const id = String(migration?.id || '').trim();
    const version = normalizeWholeNumber(migration?.version);
    if (!id || !version || applied[id] === true) continue;

    const result = await migration.run();
    applied[id] = true;
    latestVersion = Math.max(latestVersion, version);
    results.push(result);
  }

  await idbPut('app_meta', {
    id: MIGRATION_META_ID,
    value: {
      version: latestVersion,
      applied,
      updatedAt: new Date().toISOString(),
    },
  });

  return {
    version: latestVersion,
    results,
  };
}
