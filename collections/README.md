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
  "defaults": { /* optional - default key/value pairs to apply to each entry */ },
  "entries": [ /* array of entry objects */ ]
}

- `metadata`: Describes the collection. The loader will fill `metadata.name` from the filename if missing.
- `defaults`: Optional. Any key/value pairs here are applied to each `entry` if the entry does not already define that key. This allows you to set common properties like `type` at collection-level and only override when needed per entry.
- `entries`: Array of objects representing cards/rows. Each entry may override values from `defaults`.

Validation
- A validator utility used to live under `_collections/scripts/validate_collections.js`, but it is no longer present after scripts were moved to the repo root.

Best practices
- **Defaults vs entries:** Use `defaults` for repeated primitive values (strings/numbers/booleans). Avoid storing complex nested objects in `defaults`.
- **Keep entries minimal:** Store per-item data in `entries`; put shared values in `defaults` or `_metadata.json`.

**Behavior in code**
- The app reads `collections/index.json` and loads each path.
- Folder metadata (`_metadata.json`) is inherited from the nearest parent folder.
- Collection-level `defaults` are shallow-merged into each entry (only missing keys are filled).

**Examples**
- A collection with `"defaults": { "type": "godan-verb" }` will cause every entry that doesn't explicitly set `type` to receive `type: "godan-verb"`.

**Notes**
- Keep collection JSON valid (no trailing commas). The loader will skip invalid JSON files and log a warning.
- Use `entries` to store the minimal per-entry data and `defaults` for repetitive fields.
