/**
 * Rebuilds collections/index.json by scanning all collection JSON files
 * and validating their schema and entries.
 *
 * Non-destructive: does not modify any collection files. Writes only
 * collections/index.json with lightweight records and per-collection
 * validation summaries.
 *
 * Usage: node scripts/rebuild_index.js
 */
const fs = require('fs').promises;
const path = require('path');

const collectionsDir = path.resolve(__dirname, '..', 'collections');

async function walk(dir) {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await walk(full);
      files.push(...sub);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

function detectArrayKey(collection) {
  if (!collection || typeof collection !== 'object') return 'entries';
  for (const k of ['entries', 'sentences', 'paragraphs', 'items', 'cards']) {
    if (Array.isArray(collection[k])) return k;
  }
  for (const [k, v] of Object.entries(collection)) {
    if (k === 'metadata' || k === 'schema') continue;
    if (Array.isArray(v)) return k;
  }
  return 'entries';
}

function isSchemaArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  return arr.some(x => x && typeof x === 'object' && typeof x.key === 'string');
}

function validateSchemaArray(schemaArr) {
  const out = { errors: [], warnings: [] };
  if (!Array.isArray(schemaArr)) {
    out.errors.push('Schema must be an array.');
    return out;
  }
  const allowedTypes = new Set(['string','text','number','integer','boolean','enum','tags','tag','kanji','reading','date','select']);
  for (let i = 0; i < schemaArr.length; i++) {
    const f = schemaArr[i];
    if (!f || typeof f !== 'object') {
      out.errors.push(`Schema item at index ${i} must be an object.`);
      continue;
    }
    const key = typeof f.key === 'string' ? f.key.trim() : '';
    if (!key) out.errors.push(`Schema item at index ${i} is missing a string 'key'.`);
    let t = f.type && typeof f.type === 'string' ? f.type.trim() : '';
    const isArrayType = t.endsWith('[]');
    const baseType = isArrayType ? t.slice(0, -2) : t;
    if (t && !allowedTypes.has(baseType)) out.warnings.push(`Field '${key || ('#'+i)}' has unknown type '${t}'.`);
    if (baseType === 'enum') {
      const vals = f.values;
      if (!vals || typeof vals !== 'object' || Array.isArray(vals) || Object.keys(vals).length === 0) {
        out.errors.push(`Enum field '${key || ('#'+i)}' must provide a non-empty 'values' object.`);
      }
    }
  }
  return out;
}

function validateEntryAgainstSchema(entry, schemaArr, entryId) {
  const errors = [];
  const warnings = [];
  if (!entry || typeof entry !== 'object') {
    errors.push({ id: entryId, message: 'Entry is not an object.' });
    return { errors, warnings };
  }
  for (const f of (Array.isArray(schemaArr) ? schemaArr : [])) {
    if (!f || typeof f !== 'object') continue;
    const k = typeof f.key === 'string' ? f.key.trim() : '';
    if (!k) continue;
    let t = f.type && typeof f.type === 'string' ? f.type.trim() : '';
    const isArrayType = t.endsWith('[]');
    const baseType = isArrayType ? t.slice(0, -2) : t;
    if (!(k in entry)) continue; // missing fields are allowed
    const v = entry[k];
    if (baseType === 'enum') {
      const vals = f.values && typeof f.values === 'object' && !Array.isArray(f.values) ? Object.keys(f.values) : [];
      if (!vals.length) {
        warnings.push({ id: entryId, field: k, message: `Enum field '${k}' has no defined values.` });
        continue;
      }
      if (isArrayType) {
        if (!Array.isArray(v)) {
          errors.push({ id: entryId, field: k, message: `Field '${k}' should be an array of enum values.` });
        } else {
          for (const item of v) {
            const vs = item == null ? '' : String(item);
            if (!vals.includes(vs)) errors.push({ id: entryId, field: k, message: `Invalid enum value '${vs}' for '${k}'. Allowed: ${vals.join(', ')}` });
          }
        }
      } else {
        const vs = v == null ? '' : String(v);
        if (!vals.includes(vs)) errors.push({ id: entryId, field: k, message: `Invalid enum value '${vs}' for '${k}'. Allowed: ${vals.join(', ')}` });
      }
    } else if (isArrayType) {
      // Validate array types like 'string[]', 'number[]', 'boolean[]', etc.
      if (!Array.isArray(v)) {
        errors.push({ id: entryId, field: k, message: `Field '${k}' should be an array of ${baseType === 'string' ? 'strings' : baseType + 's'}.` });
      } else {
        for (const item of v) {
          if (baseType === 'string' || baseType === 'text' || baseType === 'kanji' || baseType === 'reading') {
            if (item != null && typeof item !== 'string') errors.push({ id: entryId, field: k, message: `Array item for '${k}' should be a string.` });
          } else if (baseType === 'number' || baseType === 'integer') {
            if (item != null && typeof item !== 'number') errors.push({ id: entryId, field: k, message: `Array item for '${k}' should be a number.` });
          } else if (baseType === 'boolean') {
            if (item != null && typeof item !== 'boolean') errors.push({ id: entryId, field: k, message: `Array item for '${k}' should be boolean.` });
          }
        }
      }
    } else if (baseType === 'string' || baseType === 'text' || baseType === 'kanji' || baseType === 'reading') {
      if (v != null && typeof v !== 'string') errors.push({ id: entryId, field: k, message: `Field '${k}' should be a string.` });
    } else if (baseType === 'tags' || baseType === 'tag') {
      if (v != null && !Array.isArray(v)) errors.push({ id: entryId, field: k, message: `Field '${k}' should be an array of strings.` });
    } else if (baseType === 'number' || baseType === 'integer') {
      if (v != null && typeof v !== 'number') errors.push({ id: entryId, field: k, message: `Field '${k}' should be a number.` });
    } else if (baseType === 'boolean') {
      if (v != null && typeof v !== 'boolean') errors.push({ id: entryId, field: k, message: `Field '${k}' should be boolean.` });
    }
  }
  return { errors, warnings };
}

async function resolveSchema(collectionPath, schemaRef, collectionDir) {
  // schemaRef can be an array or a string path
  if (Array.isArray(schemaRef)) return { schema: schemaRef, source: 'inline' };
  if (!schemaRef || typeof schemaRef !== 'string') return { schema: null, source: null };
  // Resolve relative path
  let rel = String(schemaRef).trim().replace(/^\.\//, '');
  if (!rel) return { schema: null, source: null };
  // If rel is absolute-like (starts with '/'), strip leading '/'
  if (rel.startsWith('/')) rel = rel.slice(1);
  const candidate = path.join(collectionDir, rel);
  try {
    const txt = await fs.readFile(candidate, 'utf8');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return { schema: parsed, source: rel };
    // if parsed is object, try parsed.metadata.schema or parsed.schema
    if (parsed && typeof parsed === 'object') {
      // If the parsed file is a schema file (convention: basename starts with '_' or it declares category),
      // require that it contains category, description, and schema (array).
      const base = path.basename(candidate);
      const looksLikeSchemaFile = base.startsWith('_') || typeof parsed.category === 'string';
      if (looksLikeSchemaFile) {
        const missing = [];
        if (typeof parsed.category === 'undefined' || parsed.category === null) missing.push('category');
        if (typeof parsed.description === 'undefined' || parsed.description === null) missing.push('description');
        if (!Array.isArray(parsed.schema)) missing.push('schema');
        if (missing.length) {
          return { schema: Array.isArray(parsed.schema) ? parsed.schema : null, source: rel, schemaFileMissing: missing };
        }
        return { schema: parsed.schema, source: rel };
      }
      if (Array.isArray(parsed.metadata?.schema)) return { schema: parsed.metadata.schema, source: rel };
      if (Array.isArray(parsed.schema)) return { schema: parsed.schema, source: rel };
    }
    return { schema: null, source: rel };
  } catch (e) {
    return { schema: null, source: rel, error: e };
  }
}

async function rebuildIndex() {
  const files = await walk(collectionsDir);
  const collections = [];

  for (const f of files) {
    const rel = path.relative(collectionsDir, f).split(path.sep).join('/');
    // skip top-level _index.json and any _*.json tooling files
    const base = path.basename(rel);
    if (rel === '_index.json') continue;
    if (base.startsWith('_')) continue;

    const fullPath = f;
    let modifiedAt = null;
    try { const st = await fs.stat(fullPath); modifiedAt = st.mtime.toISOString(); } catch (e) {}

    let raw = null;
    let txt = null;
    try {
      txt = await fs.readFile(fullPath, 'utf8');
      raw = JSON.parse(txt);
    } catch (e) {
      const msg = `Failed to read/parse JSON: ${e.message || e}`;
      console.error(`[rebuild_index] ${rel}: ${msg}`);
      collections.push({ path: rel, error: msg });
      continue;
    }

    // Normalize detection of entries array and metadata
    let metadata = raw && raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : null;
    const arrayKey = detectArrayKey(raw);
    const entries = Array.isArray(raw?.[arrayKey]) ? raw[arrayKey] : [];

    // locate text positions for array items so we can report line numbers
    function findArrayItemPositions(text, key) {
      try {
        const re = new RegExp(`"${key}"\\s*:\\s*\\[`);
        const m = re.exec(text);
        let start = -1;
        if (m && m.index != null) start = m.index + m[0].length - 1; // position of '['
        else {
          // fallback: find first '[' after the start of file
          start = text.indexOf('[');
        }
        if (start === -1) return [];
        // scan from start for top-level array items
        let i = start + 1;
        const len = text.length;
        const items = [];
        let depth = 0;
        while (i < len) {
          const ch = text[i];
          if (ch === '{') {
            // object start at depth 0 -> top-level array item
            if (depth === 0) {
              const objStart = i;
              // find matching }
              let j = i;
              let d = 0;
              let inStr = false;
              while (j < len) {
                const c = text[j];
                if (c === '"') {
                  // toggle string, but handle escapes
                  let k = j - 1;
                  let esc = false;
                  while (k >= 0 && text[k] === '\\') { esc = !esc; k--; }
                  if (!esc) inStr = !inStr;
                }
                if (!inStr) {
                  if (c === '{') d++;
                  else if (c === '}') d--;
                }
                j++;
                if (!inStr && d === 0) break;
              }
              const objEnd = j - 1;
              // compute line number of objStart
              const before = text.slice(0, objStart);
              const startLine = before.split('\n').length;
              const snippet = text.slice(objStart, Math.min(objEnd + 1, objStart + 200)).split('\n')[0];
              items.push({ start: objStart, end: objEnd, startLine, snippet });
              i = objEnd + 1;
              continue;
            }
          } else if (ch === ']') {
            if (depth === 0) break; // end of array
          } else if (ch === '"') {
            // skip string
            i++;
            while (i < len) {
              if (text[i] === '"') {
                // check escape
                let k = i - 1; let esc = false;
                while (k >= 0 && text[k] === '\\') { esc = !esc; k--; }
                if (!esc) break;
              }
              i++;
            }
          }
          i++;
        }
        return items;
      } catch (e) { return []; }
    }

    const itemPositions = findArrayItemPositions(txt, arrayKey);

    // Validate presence of required metadata fields
    const req = ['name','description','version','category','entry_key','schema'];
    const missing = [];
    if (!metadata) missing.push('metadata');
    else {
      for (const k of req) {
        if (typeof metadata[k] === 'undefined' || metadata[k] === null || (k === 'schema' && (typeof metadata[k] === 'undefined' || metadata[k] === null))) missing.push(k);
      }
    }

    const record = { path: rel, modifiedAt, name: metadata?.name || null, description: metadata?.description || null, entriesCount: entries.length, valid: false, validation: { schema: { errors: [], warnings: [] }, entries: { errors: [], warnings: [] } } };

    if (missing.length) {
      const errMsg = `Missing required metadata fields: ${missing.join(', ')}`;
      record.validation.schema.errors.push(errMsg);
      console.error(`[rebuild_index] ${rel}: ${errMsg}`);
      collections.push(record);
      continue;
    }

    // Resolve schema: only inline arrays are allowed now
    let schema = null;
    let schemaSource = null;
    try {
      if (Array.isArray(metadata.schema)) {
        schema = metadata.schema;
        schemaSource = 'inline';
      } else if (typeof metadata.schema === 'string') {
        const msg = 'External schema files are not allowed; metadata.schema must be an inline array in the collection file.';
        record.validation.schema.errors.push(msg);
        console.error(`[rebuild_index] ${rel}: ${msg}`);
      }
    } catch (e) {
      record.validation.schema.errors.push(`Schema processing error: ${e.message || e}`);
    }

    if (!schema || !Array.isArray(schema)) {
      const errMsg = 'No valid schema array found (metadata.schema must be an array or a path to a schema file).';
      record.validation.schema.errors.push(errMsg);
      console.error(`[rebuild_index] ${rel}: ${errMsg}`);
      collections.push(record);
      continue;
    }

    // Validate schema
    const sv = validateSchemaArray(schema);
    record.validation.schema.errors.push(...sv.errors);
    record.validation.schema.warnings.push(...sv.warnings);

    // Validate entries and enforce per-file uniqueness of entry_key
    const entryKeyField = typeof metadata.entry_key === 'string' ? metadata.entry_key : '';
    const entryErrors = [];
    const entryWarnings = [];

    const keyCounts = new Map();
    const entryKeys = new Array(entries.length);
    const duplicatesReport = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let k = null;
      try {
        if (entryKeyField && e && typeof e === 'object' && e[entryKeyField] != null) k = String(e[entryKeyField]);
      } catch (e2) { k = null; }
      entryKeys[i] = k;
      if (k != null) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const keyVal = entryKeys[i];
      const id = keyVal != null ? String(keyVal) : `#${i}`;

      // Missing entry key when metadata declares one
      if (entryKeyField && (keyVal == null || String(keyVal).trim() === '')) {
        const msg = `Missing entry key '${entryKeyField}' for entry ${id}`;
        entryErrors.push({ id, message: msg });
        console.error(`[rebuild_index] ${rel}: ${msg}`);
      }

      // Schema-based field validations
      const res = validateEntryAgainstSchema(e, schema, id);
      if (res.errors && res.errors.length) entryErrors.push(...res.errors.slice(0, 50));
      if (res.warnings && res.warnings.length) entryWarnings.push(...res.warnings.slice(0, 50));
    }

    // Duplicate keys within this file
    for (const [k, cnt] of keyCounts.entries()) {
      if (cnt > 1) {
        const msg = `Duplicate entry key '${k}' appears ${cnt} times in file`;
        entryErrors.push({ id: k, message: msg });
        // build occurrences list with indices and line numbers
        const occ = [];
        for (let i = 0; i < entryKeys.length; i++) {
          if (entryKeys[i] == null) continue;
          if (String(entryKeys[i]) === String(k)) {
            const pos = itemPositions[i] || null;
            occ.push({ index: i, line: pos ? pos.startLine : null, entry: entries[i] });
          }
        }
        duplicatesReport.push({ key: k, count: cnt, occurrences: occ });
        console.error(`[rebuild_index] ${rel}: ${msg}`);
        if (occ.length) console.error(`[rebuild_index] ${rel}: occurrences:`, occ);
      }
    }
    if (duplicatesReport.length) record.validation.entries.duplicates = duplicatesReport;
    record.validation.entries.errors.push(...entryErrors);
    record.validation.entries.warnings.push(...entryWarnings);

    // Print errors/warnings to console for visibility
    try {
      if (record.validation.schema.errors.length) console.error(`[rebuild_index] ${rel} schema errors:`, record.validation.schema.errors);
      if (record.validation.schema.warnings.length) console.warn(`[rebuild_index] ${rel} schema warnings:`, record.validation.schema.warnings);
      if (record.validation.entries.errors.length) console.error(`[rebuild_index] ${rel} entry errors:`, record.validation.entries.errors.slice(0, 50));
      if (record.validation.entries.warnings.length) console.warn(`[rebuild_index] ${rel} entry warnings:`, record.validation.entries.warnings.slice(0, 50));
    } catch (e) {}

    // summary valid flag
    record.valid = (record.validation.schema.errors.length === 0) && (record.validation.entries.errors.length === 0);
    record.schemaSource = schemaSource || null;

    collections.push(record);
  }

  // build index
  const out = { collections };
  const outPath = path.join(collectionsDir, '_index.json');
  try {
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote index to ${outPath} (${collections.length} collections)`);
  } catch (e) {
    console.error('Failed to write _index.json:', e);
    process.exitCode = 1;
  }
}

if (require.main === module) rebuildIndex().catch(err => { console.error('Error:', err); process.exitCode = 1; });

module.exports = { rebuildIndex };
