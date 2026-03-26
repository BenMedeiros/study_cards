import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const candidateFileNames = ['.secrets.json', '.env.json'];

let cachedConfig;

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function normalizeConfig(rawConfig, sourcePath) {
  const root = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const firebase = root.firebase && typeof root.firebase === 'object' ? root.firebase : {};
  const out = firebase.out && typeof firebase.out === 'object' ? firebase.out : {};

  return {
    sourcePath,
    uid: pickString(firebase.uid, root.uid),
    serviceAccountJson: pickString(
      firebase.serviceAccountJson,
      firebase.serviceAccountPath,
      firebase.key,
      root.serviceAccountJson,
      root.serviceAccountPath,
      root.key,
    ),
    storageBucket: pickString(firebase.storageBucket, root.storageBucket),
    databaseUrl: pickString(firebase.databaseUrl, root.databaseUrl),
    collectionSettingsOut: pickString(
      out.collectionSettings,
      firebase.collectionSettingsOut,
      firebase.pullOut,
      root.collectionSettingsOut,
      root.pullOut,
    ),
    rulesOut: pickString(
      out.securityRules,
      firebase.rulesOut,
      root.rulesOut,
    ),
  };
}

function loadConfig() {
  for (const fileName of candidateFileNames) {
    const filePath = path.join(repoRoot, fileName);
    if (!fs.existsSync(filePath)) continue;

    try {
      const jsonText = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(jsonText);
      return normalizeConfig(parsed, filePath);
    } catch (error) {
      throw new Error(`Unable to parse ${fileName}: ${String(error?.message || error)}`);
    }
  }

  return normalizeConfig({}, '');
}

export function getFirebaseLocalConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
