# Study Cards

Vanilla JavaScript study tools (Flashcards first) with two ways to run:

- **Static** (GitHub Pages): read-only collections in the repo, plus **local edits saved in IndexedDB**.
- **Local backend** (this computer): the same UI is served by Express, and `/api/*` endpoints are available for future sync.

Collections live in one place:

- `collections/*.json`
- `collections/index.json` is the small manifest the app loads first

## Local run

1. Install deps:

   `npm install`

2. Start the local server:

   `npm run dev`

Then open `http://127.0.0.1:3000/#/`.

## GitHub Pages

In GitHub repo settings, set **Pages** to deploy from the `main` branch `/ (root)`.

## Notes on “one URL” + local backend

If you’re browsing from GitHub Pages (`https://...github.io/...`), the browser will not call a local `http://localhost` backend due to HTTPS mixed-content restrictions.

The simple setup here is:
- GitHub Pages = static mode
- `http://127.0.0.1:3000` = local-backend mode (same UI, plus API)

We can later add HTTPS for the local backend if you want the Pages URL to talk to it.
