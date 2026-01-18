# Study Cards

Vanilla JavaScript study tools with two ways to run:

- **Static** (GitHub Pages): read-only collections from the repo
- **Local backend** (Express server): full read/write with persistent storage

## Apps

- **Flashcards**: Browse all fields, navigate through entries with batch support
- **QA Cards**: Type answers with automatic romaji-to-hiragana conversion  
- **Crossword**: Generate crossword puzzles from collection entries

## Architecture

### Collections
Collections are stored in `collections/*.json` with structure:
```json
{
  "metadata": {
    "id": "...",
    "name": "...",
    "fields": [...],
    "settings": {
      "flashcards": { "randomize": true },
      "qaCards": { "submitMethod": "enter" },
      "crossword": { "maxWords": 20 }
    }
  },
  "entries": [...]
}
```

Settings are per-collection and per-app. Only non-default values are stored.

### Settings Model
Each app exports `getDefaultSettings()` which provides default configuration.
User settings override defaults and are stored in the collection's metadata.
When a setting equals the default, it's automatically removed (minimizes saved data).

## Local Development

1. Install dependencies:
   ```
   npm install
   ```

2. Start the local server:
   ```
   npm run dev
   ```

3. Open `http://127.0.0.1:3000/#/`

## GitHub Pages Deployment

In GitHub repo settings, set **Pages** to deploy from the `main` branch `/ (root)`.

The static mode loads collections from JSON files and works entirely client-side.

## Project Structure

```
├── apps/api/          # Express backend server
├── collections/       # Collection JSON files
├── src/
│   ├── apps/          # App implementations
│   │   ├── flashcards/
│   │   ├── qaCards/   # QA mode with romaji conversion
│   │   └── crossword/
│   ├── views/         # UI views (landing, settings, etc)
│   ├── utils/         # Utilities (backend detection, time, etc)
│   ├── router.js      # Hash-based routing
│   ├── shell.js       # App shell and header
│   └── store.js       # State management
├── index.html         # Entry point
└── styles.css         # Global styles
```
