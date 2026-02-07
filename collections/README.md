**Collections Folder**
- **Purpose:** Contains content collections used by the app. Each collection is a JSON file listed in `index.json`.

**Index (`index.json`)**
- `collections/index.json` lists all collection files (relative paths) under the `collections` array.
- Optional `folderMetadata` maps folder names to a metadata file path (used to avoid probing for `_metadata.json`).

**Folder metadata (`_metadata.json`)**
- Placed in a folder (e.g., `collections/japanese/_metadata.json`) and describes category-level metadata and common `fields` used by collections in that folder.
- Metadata is resolved by inheritance: the loader finds the nearest `_metadata.json` up the folder chain and merges it with collection metadata.

**Collection JSON structure**
Each collection JSON should follow this shape:

{
  "metadata": { /* collection-level metadata (name, description, version, fields, etc.) */ },
  "entries": [ /* array of entry objects */ ]
}

- `metadata`: Describes the collection. The loader will fill `metadata.name` from the filename if missing.
- `entries`: Array of objects representing cards/rows. Each entry should be fully specified (no per-file defaults).

Validation
- A validator utility used to live under `_collections/scripts/validate_collections.js`, but it is no longer present after scripts were moved to the repo root.

Best practices
- **Keep entries minimal:** Store per-item data in `entries`; put shared values in `_metadata.json`.

**Behavior in code**
- The app reads `collections/index.json` and loads each path.
- Folder metadata (`_metadata.json`) is inherited from the nearest parent folder.
- The loader does not apply collection-level defaults.

**Examples**
- If you previously used per-file `defaults`, run `node scripts/flatten_collection_defaults.js --write` to flatten them into entries and remove the `defaults` objects.

**Notes**
- Keep collection JSON valid (no trailing commas). The loader will skip invalid JSON files and log a warning.
- Use `entries` to store the minimal per-entry data.
