# Firebase Layout

- `src/integrations/firebase/` contains browser runtime Firebase modules for the static app.
- `firebase/` is reserved for repo-level Firebase scripts, exports, and local setup notes.
- `firebase-admin` belongs to local Node scripts, not the GitHub Pages frontend.
- Browser-side sync target: Firestore under `users/{uid}/collection_settings/{encodedCollectionId}`.
- Each Firestore document stores one IndexedDB `study_cards / collection_settings` row.

## Pull Script

- Script: `firebase/scripts/pullCollectionSettings.mjs`
- npm alias: `npm run firebase:pull-collection-settings`
- Default output directory: `firebase/exports/collection_settings/`
- Per-collection output path: `firebase/exports/collection_settings/{collectionId}`
- Firebase metadata manifest: `firebase/exports/collection_settings/_firebase.json`

## Credentials

The pull script uses `firebase-admin`. Use one of these:

- `/.secrets.json` or `/.env.json` with a `firebase.serviceAccountJson` value
- `--key C:\path\to\service-account.json`
- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file
- `FIREBASE_SERVICE_ACCOUNT_JSON` pointing to a service-account JSON file

## Required Environment

- `FIREBASE_UID`: the Firebase Auth user id to pull from

You can also keep the common Firebase values in a repo-local `/.secrets.json` file.

Example:

```json
{
	"firebase": {
		"uid": "7wy1SYYxOSbgKeqi2foc4xVmyNa2",
		"serviceAccountJson": "C:\\Users\\benme\\.secrets\\study-cards-sync-firebase-adminsdk-fbsvc-dc17f765fd.json",
		"storageBucket": "study-cards-sync.firebasestorage.app",
		"databaseUrl": "https://your-project-default-rtdb.firebaseio.com",
		"out": {
			"collectionSettings": "firebase/exports/collection_settings",
			"securityRules": "firebase/rules/current"
		}
	}
}
```

Resolution order is: CLI flags, local JSON config, then environment variables.

Optional:

- `FIREBASE_PULL_OUT`: custom output directory

## Example

PowerShell:

```powershell
npm run firebase:pull-collection-settings
```

If you want to override the local config for a one-off run:

```powershell
npm run firebase:pull-collection-settings -- --uid "your-firebase-auth-uid" --key "C:\path\to\service-account.json"
```

The script writes one JSON file per collection using the collection id as the relative path. The Firestore metadata is written to `_firebase.json`.

## Security Rules Pull

- Script: `firebase/scripts/pullSecurityRules.mjs`
- npm alias: `npm run firebase:pull-security-rules`
- Default output directory: `firebase/rules/current/`
- Manifest path: `firebase/rules/current/_firebase.rules.json`

The rules pull script uses `firebase-admin` and supports:

- Firestore security rules
- Storage security rules for the configured bucket
- Realtime Database rules when `FIREBASE_DATABASE_URL` or `--database-url` is provided

Optional:

- `FIREBASE_STORAGE_BUCKET`: storage bucket name for storage rules
- `FIREBASE_DATABASE_URL`: realtime database URL for RTDB rules
- `FIREBASE_RULES_OUT`: custom output directory

Examples:

```powershell
npm run firebase:pull-security-rules
```

```powershell
npm run firebase:pull-security-rules -- --key "C:\path\to\service-account.json" --storage-bucket "study-cards-sync.firebasestorage.app" --database-url "https://your-project-default-rtdb.firebaseio.com"
```
