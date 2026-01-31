# Study Cards

Local-first, vanilla JavaScript study tools — single-page app with hash routing and client-side collections.

Features
- Multiple study apps built on the same collections model
  - Flashcards — browse fields, batch navigation, randomize support
  - QA Cards — type answers (with romaji→hiragana support in some collections)
  - Crossword — generate crosswords from collection entries
  - Collections Manager — view and edit collections (client-side)
  - Data viewer — raw collection JSON browser
- Static-first: runs entirely in the browser with JSON collection files
- Simple dev server for local development (no backend required)

Quickstart (local)
1. Install dependencies:
   npm install
2. Start the local server:
   npm run dev
3. Open the app in your browser:
   http://127.0.0.1:3000/#/

Notes
- The app is served statically. The repo's dev script uses http-server (see package.json).
- Collections are loaded from the collections/ folder and from collections/index.json.

Collections and metadata
- Collections are listed in collections/index.json (array of relative paths).
- Individual collections typically live under collections/<category>/<collection>.json.
- Category-level metadata (e.g., collections/<language>/metadata.json) provides shared "commonFields" and category info.
- When a collection sits inside a category folder, category metadata is merged into the collection at load time: category commonFields are prepended unless the collection overrides them.

Collections tooling
- Aggregation: `node _collections/scripts/aggregate_collections.js` writes aggregated JSON into `_collections/aggregates`.
- Restore: `node _collections/scripts/restore_collections.js --input _collections/aggregates/<collection>.json [--dry-run] [--overwrite]` restores files into `collections/`.
- Extraction: `node _collections/scripts/extract_defaults_japanese.js` extracts common entry fields into `defaults` for Japanese files.
- Validation: `node _collections/scripts/validate_collections.js` validates entries against the nearest `_metadata.json` and warns for undefined properties.

Example collection shape
```
{
  "metadata": {
    "id": "my-collection",
    "name": "My Collection",
    "fields": [
      { "key": "front", "label": "Front" },
      { "key": "back", "label": "Back" }
    ],
    "settings": {
      "flashcards": { "randomize": true },
      "qaCards": { "submitMethod": "enter" }
    }
  },
  "entries": [
    { "front": "Question 1", "back": "Answer 1" }
  ]
}
```

Settings model
- Each app exposes default settings (in code) and collections store only non-default overrides in metadata.
- The store removes settings equal to defaults to minimize saved data.

Architecture highlights
- Hash-based routing: src/router.js
- App shell and header: src/shell.js
- Central store and collection loading/merging: src/store.js
- Entry point: index.html → src/main.js
- Dev server: npm run dev (http-server)

Project structure (top-level)
- apps/             — optional server code (unused for static mode)
- collections/      — collection JSON files and category metadata
- src/              — client source
  - apps/           — app implementations (flashcards, qaCards, crossword, landing, collections, data, placeholder)
  - components/     — reusable UI components
  - utils/          — helpers
  - router.js
  - shell.js
  - store.js
  - main.js
- index.html
- styles.css
- package.json

Development notes
- The app initializes the store, loads collections listed in collections/index.json, merges category metadata, then mounts the shell and installs the hash router.
- The store updates the URL query parameter `collection` when the active collection changes.

Deployment
- The repo is static and can be deployed via GitHub Pages (configure Pages to serve from the master branch root) or any static host.