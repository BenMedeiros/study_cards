/**
 * Rebuilds collections/index.json by scanning all collection JSON files
 * and validating their schema and entries.
 *
 * Non-destructive: does not modify any collection files. Writes only
 * collections/index.json with lightweight records and per-collection
 * validation summaries.
 *
 * Usage: node scripts/build/rebuild_index.js
 */
const fs = require('fs').promises;
const path = require('path');

const collectionsDir = path.resolve(__dirname, '..', '..', 'collections');

function formatDuration(durationMs) {
  const durationSeconds = durationMs / 1000;
  return `${durationMs}ms (${durationSeconds.toFixed(3)}s)`;
}

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

function parseFieldType(type) {
  const raw = typeof type === 'string' ? type.trim() : '';
  if (!raw) return { raw: '', isArrayType: false, baseType: '' };
  const nestedArrayMatch = raw.match(/^array<(.+)>$/);
  if (nestedArrayMatch) {
    return { raw, isArrayType: true, baseType: nestedArrayMatch[1].trim() };
  }
  const isArrayType = raw.endsWith('[]');
  const baseType = isArrayType ? raw.slice(0, -2).trim() : raw;
  return { raw, isArrayType, baseType };
}

function isCustomSchemaTypeName(typeName) {
  return typeof typeName === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(typeName);
}

function parseSchemaRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw.startsWith('$ref:')) return null;
  const body = raw.slice(5).trim();
  if (!body) return null;
  const hashIndex = body.indexOf('#');
  const schemaPath = hashIndex >= 0 ? body.slice(0, hashIndex).trim() : body;
  const typeName = hashIndex >= 0 ? body.slice(hashIndex + 1).trim() : '';
  if (!schemaPath) return null;
  return { raw, schemaPath, typeName };
}

function classifyJsonFile(rel, raw) {
  const base = path.basename(rel);
  if (rel === '_index.json' || rel === '_collections.schema.json') return 'ignore';
  if (/\.promptPresets\.json$/i.test(base)) return 'prompt';
  if (/\.schemas\.json$/i.test(base)) return 'schema';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (Array.isArray(raw.prompts)) return 'prompt';
    if (raw.schemaTypes && !raw.metadata && !raw.entries) return 'schema';
  }
  return 'collection';
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
    const { raw: t, baseType } = parseFieldType(f.type);
    if (t && !allowedTypes.has(baseType) && !isCustomSchemaTypeName(baseType)) {
      out.warnings.push(`Field '${key || ('#'+i)}' has unknown type '${t}'.`);
    }
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
    const { isArrayType, baseType } = parseFieldType(f.type);
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
      // Validate array types like 'string[]', 'array<string>', etc.
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

function validatePromptPresetsFile(obj) {
  const out = { errors: [], warnings: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    out.errors.push('Prompt presets file must be a JSON object.');
    return out;
  }
  if (typeof obj.version !== 'number') out.errors.push("Prompt presets file missing required numeric field 'version'.");
  if (!Array.isArray(obj.prompts)) {
    out.errors.push("Prompt presets file missing required array field 'prompts'.");
    return out;
  }
  for (let i = 0; i < obj.prompts.length; i++) {
    const prompt = obj.prompts[i];
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      out.errors.push(`Prompt preset at index ${i} must be an object.`);
      continue;
    }
    if (typeof prompt.id !== 'string' || !prompt.id.trim()) out.errors.push(`Prompt preset at index ${i} is missing string field 'id'.`);
    if (typeof prompt.details !== 'string' || !prompt.details.trim()) out.errors.push(`Prompt preset '${prompt.id || '#'+i}' is missing string field 'details'.`);
    if (typeof prompt.example !== 'string' || !prompt.example.trim()) out.errors.push(`Prompt preset '${prompt.id || '#'+i}' is missing string field 'example'.`);
  }
  return out;
}

function validateSharedSchemaRegistry(obj) {
  const out = { errors: [], warnings: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    out.errors.push('Shared schema file must be a JSON object.');
    return out;
  }
  if (typeof obj.version !== 'number') out.errors.push("Shared schema file missing required numeric field 'version'.");
  if (typeof obj.description !== 'string' || !obj.description.trim()) out.errors.push("Shared schema file missing required string field 'description'.");
  if (!obj.schemaTypes || typeof obj.schemaTypes !== 'object' || Array.isArray(obj.schemaTypes)) {
    out.errors.push("Shared schema file missing required object field 'schemaTypes'.");
    return out;
  }
  for (const [typeName, def] of Object.entries(obj.schemaTypes)) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      out.errors.push(`Schema type '${typeName}' must be an object.`);
      continue;
    }
    if (!Array.isArray(def.fields)) {
      out.errors.push(`Schema type '${typeName}' must define a fields array.`);
      continue;
    }
    const sv = validateSchemaArray(def.fields);
    out.errors.push(...sv.errors.map((msg) => `${typeName}: ${msg}`));
    out.warnings.push(...sv.warnings.map((msg) => `${typeName}: ${msg}`));
  }
  return out;
}

async function resolveSchema(collectionPath, schemaRef, collectionDir, schemaCache = new Map()) {
  if (Array.isArray(schemaRef)) return { schema: schemaRef, source: 'inline' };
  if (!schemaRef || typeof schemaRef !== 'string') return { schema: null, source: null };
  const parsedRef = parseSchemaRef(schemaRef);
  if (!parsedRef) return { schema: null, source: null, error: new Error('Unsupported schema ref format') };
  const rel = parsedRef.schemaPath.replace(/^\.\//, '').replace(/^collections\//, '');
  const candidate = path.join(collectionDir, rel);
  try {
    let parsed = schemaCache.get(candidate);
    if (!parsed) {
      const txt = await fs.readFile(candidate, 'utf8');
      parsed = JSON.parse(txt);
      schemaCache.set(candidate, parsed);
    }
    if (Array.isArray(parsed)) return { schema: parsed, source: rel };
    if (!parsed || typeof parsed !== 'object') return { schema: null, source: rel };
    if (parsedRef.typeName) {
      const schemaTypes = parsed.schemaTypes && typeof parsed.schemaTypes === 'object' ? parsed.schemaTypes : null;
      const typeDef = schemaTypes ? schemaTypes[parsedRef.typeName] : null;
      const fields = Array.isArray(typeDef?.fields) ? typeDef.fields : null;
      return { schema: fields, source: `${rel}#${parsedRef.typeName}` };
    }
    if (Array.isArray(parsed.metadata?.schema)) return { schema: parsed.metadata.schema, source: rel };
    if (Array.isArray(parsed.schema)) return { schema: parsed.schema, source: rel };
    return { schema: null, source: rel };
  } catch (e) {
    return { schema: null, source: rel, error: e };
  }
}

async function rebuildIndex() {
  const files = await walk(collectionsDir);
  const collections = [];
  const schemas = [];
  const prompts = [];
  const schemaCache = new Map();

  for (const f of files) {
    const rel = path.relative(collectionsDir, f).split(path.sep).join('/');
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

    const kind = classifyJsonFile(rel, raw);
    if (kind === 'ignore') continue;

    if (kind === 'schema') {
      const validation = validateSharedSchemaRegistry(raw);
      const record = {
        path: rel,
        modifiedAt,
        description: typeof raw?.description === 'string' ? raw.description : null,
        schemaTypeCount: (raw?.schemaTypes && typeof raw.schemaTypes === 'object' && !Array.isArray(raw.schemaTypes)) ? Object.keys(raw.schemaTypes).length : 0,
        valid: validation.errors.length === 0,
        validation,
      };
      schemas.push(record);
      continue;
    }

    if (kind === 'prompt') {
      const validation = validatePromptPresetsFile(raw);
      const record = {
        path: rel,
        modifiedAt,
        promptCount: Array.isArray(raw?.prompts) ? raw.prompts.length : 0,
        valid: validation.errors.length === 0,
        validation,
      };
      prompts.push(record);
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

    // Resolve schema: inline arrays or $ref:...#TypeName shared-schema refs
    let schema = null;
    let schemaSource = null;
    try {
      if (Array.isArray(metadata.schema)) {
        schema = metadata.schema;
        schemaSource = 'inline';
      } else if (typeof metadata.schema === 'string') {
        const resolved = await resolveSchema(rel, metadata.schema, collectionsDir, schemaCache);
        if (resolved?.schema && Array.isArray(resolved.schema)) {
          schema = resolved.schema;
          schemaSource = resolved.source || metadata.schema;
        } else {
          const msg = resolved?.error
            ? `Failed to resolve schema ref '${metadata.schema}': ${resolved.error.message || resolved.error}`
            : `Failed to resolve schema ref '${metadata.schema}'.`;
          record.validation.schema.errors.push(msg);
          console.error(`[rebuild_index] ${rel}: ${msg}`);
        }
      }
    } catch (e) {
      record.validation.schema.errors.push(`Schema processing error: ${e.message || e}`);
    }

    if (!schema || !Array.isArray(schema)) {
      const errMsg = 'No valid schema array found.';
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
  const out = { schemas, collections, prompts };
  const outPath = path.join(collectionsDir, '_index.json');
  try {
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote index to ${outPath} (${collections.length} collections, ${schemas.length} schemas, ${prompts.length} prompts)`);
  } catch (e) {
    console.error('Failed to write _index.json:', e);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const startedAt = new Date();
  rebuildIndex()
    .then(() => {
      const finishedAt = new Date();
      console.log(`[rebuild_index] completed in ${formatDuration(finishedAt.getTime() - startedAt.getTime())}`);
    })
    .catch((err) => {
      const finishedAt = new Date();
      console.error('Error:', err);
      console.error(`[rebuild_index] failed after ${formatDuration(finishedAt.getTime() - startedAt.getTime())}`);
      process.exitCode = 1;
    });
}

module.exports = { rebuildIndex };
