import { detectCollectionArrayKey, inferEntryKeyField } from './collectionDiff.js';

function safeJsonStringify(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

export function validateSchemaArray(schemaArr) {
  const out = { errors: [], warnings: [] };
  if (!Array.isArray(schemaArr)) {
    out.errors.push('Schema must be an array of field definitions.');
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
        continue;
      }
      for (const [vk, vv] of Object.entries(vals)) {
        if (typeof vk !== 'string' || !vk.trim()) out.warnings.push(`Enum field '${key}' has an invalid value key.`);
        if (typeof vv !== 'string') out.warnings.push(`Enum field '${key}' value for '${vk}' should be a string description.`);
      }
    }
  }
  return out;
}

export function validateSchemaFile(obj, { path = '' } = {}) {
  const out = { errors: [], warnings: [] };
  if (!obj || typeof obj !== 'object') {
    out.errors.push('Schema file must be a JSON object.');
    return out;
  }
  // required top-level fields for a schema file
  const need = ['category', 'description', 'schema'];
  for (const k of need) {
    if (typeof obj[k] === 'undefined' || obj[k] === null) out.errors.push(`Schema file missing required field '${k}'.`);
  }
  if (Array.isArray(obj.schema)) {
    const sv = validateSchemaArray(obj.schema);
    out.errors.push(...sv.errors);
    out.warnings.push(...sv.warnings);
  } else if (typeof obj.schema !== 'undefined') {
    out.errors.push("Schema file 'schema' must be an array of field definitions.");
  }
  return out;
}

export function validateEntriesAgainstSchema(entries, schemaArr, { entryKeyField = '', verbose = false, logLimit = 5 } = {}) {
  const out = { entryErrors: [], entryWarnings: [], warnings: [], diagnostics: {} };
  if (!Array.isArray(entries) || !entries.length) return out;
  if (!Array.isArray(schemaArr) || !schemaArr.length) return out;

  const schemaMap = new Map();
  for (const f of schemaArr) {
    if (!f || typeof f !== 'object') continue;
    const k = typeof f.key === 'string' ? f.key.trim() : '';
    if (!k) continue;
    schemaMap.set(k, f);
  }

  if (verbose) console.group(`validateEntriesAgainstSchema: fields=${schemaMap.size} entries=${entries.length}`);
  // diagnostics for developer visibility
  out.diagnostics = { enumChecks: 0, enumInvalid: 0, arrayChecks: 0, arrayInvalid: 0 };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') continue;
    const id = (entryKeyField && e[entryKeyField] != null) ? String(e[entryKeyField]) : `#${i}`;
    for (const [k, f] of schemaMap.entries()) {
      let t = f.type && typeof f.type === 'string' ? f.type.trim() : '';
      const isArrayType = t.endsWith('[]');
      const baseType = isArrayType ? t.slice(0, -2) : t;
      if (baseType === 'enum') {
        const vals = f.values && typeof f.values === 'object' && !Array.isArray(f.values) ? Object.keys(f.values) : [];
        if (verbose && i < Math.max(5, logLimit)) console.log(`validateEntriesAgainstSchema: checking enum field '${k}' for entry ${id}`);
        if (!vals.length) {
          out.warnings.push(`Schema enum field '${k}' has no defined values.`);
          out.entryWarnings.push({ id, index: i, field: k, message: `Schema enum field '${k}' has no defined values.` });
          continue;
        }
        out.diagnostics.enumChecks++;
        if (k in e) {
          const v = e[k];
          if (isArrayType) {
            if (!Array.isArray(v)) {
              out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: field '${k}' must be an array of enum values.` });
              out.diagnostics.arrayInvalid++;
            } else {
              out.diagnostics.arrayChecks++;
              for (const item of v) {
                if (item == null || (typeof item !== 'string' && typeof item !== 'number')) {
                  out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: array items for '${k}' must be strings.` });
                  out.diagnostics.arrayInvalid++;
                } else if (!vals.includes(String(item))) {
                  out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: invalid enum value '${String(item)}' for '${k}'. Allowed: ${vals.join(', ')}.` });
                  out.diagnostics.enumInvalid++;
                }
              }
            }
          } else {
            if (v == null || (typeof v !== 'string' && typeof v !== 'number')) {
              const msg = `Entry ${id}: field '${k}' must be one of: ${vals.join(', ')}.`;
              out.entryErrors.push({ id, index: i, field: k, message: msg });
              out.diagnostics.enumInvalid++;
            } else {
              const vs = String(v);
              if (!vals.includes(vs)) {
                const msg = `Entry ${id}: invalid value '${vs}' for enum '${k}'. Allowed: ${vals.join(', ')}.`;
                out.entryErrors.push({ id, index: i, field: k, message: msg });
                out.diagnostics.enumInvalid++;
              }
            }
          }
        }
      } else if (isArrayType) {
        // validate array-typed fields (string[], number[], boolean[])
        if (k in e) {
          if (verbose && i < Math.max(5, logLimit)) console.log(`validateEntriesAgainstSchema: checking array field '${k}' for entry ${id}`);
          out.diagnostics.arrayChecks++;
          const v = e[k];
          if (!Array.isArray(v)) {
            out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: field '${k}' should be an array.` });
            out.diagnostics.arrayInvalid++;
          } else {
            for (const item of v) {
              if (baseType === 'string' || baseType === 'text' || baseType === 'kanji' || baseType === 'reading') {
                if (item != null && typeof item !== 'string') { out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: array item for '${k}' should be a string.` }); out.diagnostics.arrayInvalid++; }
              } else if (baseType === 'number' || baseType === 'integer') {
                if (item != null && typeof item !== 'number') { out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: array item for '${k}' should be a number.` }); out.diagnostics.arrayInvalid++; }
              } else if (baseType === 'boolean') {
                if (item != null && typeof item !== 'boolean') { out.entryErrors.push({ id, index: i, field: k, message: `Entry ${id}: array item for '${k}' should be boolean.` }); out.diagnostics.arrayInvalid++; }
              }
            }
          }
        }
      }
      // future: add other type checks (tags arrays, number ranges, etc.)
    }
  }

  if (verbose) {
    console.log('validateEntriesAgainstSchema diagnostics:', out.diagnostics);
    console.groupEnd();
  }
  return out;
}

export function validateCollection(collection, { entryArrayKey = null, verbose = false, logLimit = 5 } = {}) {
  const coll = collection && typeof collection === 'object' ? collection : { metadata: {} };
  const meta = coll.metadata && typeof coll.metadata === 'object' ? coll.metadata : {};
  const schemaArr = Array.isArray(meta.schema) ? meta.schema : (Array.isArray(coll.schema) ? coll.schema : null);
  const arrayKey = entryArrayKey || (detectCollectionArrayKey(coll).key || 'entries');
  const entries = Array.isArray(coll[arrayKey]) ? coll[arrayKey] : [];
  const entryKeyField = inferEntryKeyField({ collection: coll, arrayKey, entries });

  if (verbose) console.groupCollapsed(`validateCollection: ${meta.name || meta.title || coll.name || coll.path || 'collection'}`);
  if (verbose) console.log('detected arrayKey:', arrayKey, 'entryKeyField:', entryKeyField, 'entriesCount:', entries.length);

  if (verbose) console.group('schema validation');
  const schemaValidation = schemaArr ? validateSchemaArray(schemaArr) : { errors: [], warnings: [] };
  if (verbose) {
    console.log('schema present:', !!schemaArr);
    if (schemaValidation.errors && schemaValidation.errors.length) console.error('schema errors:', schemaValidation.errors);
    if (schemaValidation.warnings && schemaValidation.warnings.length) console.warn('schema warnings:', schemaValidation.warnings);
  }
  if (verbose) console.groupEnd();

  if (verbose) console.group('entries validation');
  const entriesValidation = schemaArr ? validateEntriesAgainstSchema(entries, schemaArr, { entryKeyField, verbose, logLimit }) : { entryErrors: [], entryWarnings: [], warnings: [] };
  if (verbose) {
    console.log('entriesValidation.entryErrors count:', (entriesValidation.entryErrors || []).length);
    console.log('entriesValidation.entryWarnings count:', (entriesValidation.entryWarnings || []).length);
  }
  if (verbose) console.groupEnd();

  // detect duplicate entry keys within this collection when an entryKeyField is declared
  entriesValidation.duplicates = [];
  try {
    if (entryKeyField && Array.isArray(entries) && entries.length) {
      const counts = new Map();
      const occ = new Map();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        let k = null;
        try { if (e && typeof e === 'object' && e[entryKeyField] != null) k = String(e[entryKeyField]); } catch (e2) { k = null; }
        if (k == null) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
        if (!occ.has(k)) occ.set(k, []);
        occ.get(k).push({ index: i, entry: e });
      }
      for (const [k, cnt] of counts.entries()) {
        if (cnt > 1) {
          const msg = `Duplicate entry key '${k}' appears ${cnt} times in collection`;
          entriesValidation.entryErrors = entriesValidation.entryErrors || [];
          entriesValidation.entryErrors.push({ id: k, message: msg });
          const occurrences = (occ.get(k) || []).map(o => ({ index: o.index, entry: safeJsonStringify(o.entry) }));
          entriesValidation.duplicates.push({ key: k, count: cnt, occurrences });
        }
      }
    }
  } catch (e) {
    // don't fail validation on duplicate-detection code errors
  }

  if (verbose) {
    if (entriesValidation.duplicates && entriesValidation.duplicates.length) {
      console.group('duplicates');
      for (let i = 0; i < Math.min(entriesValidation.duplicates.length, logLimit); i++) {
        const d = entriesValidation.duplicates[i];
        console.warn(`duplicate key: ${d.key} count:${d.count}`);
        for (let j = 0; j < Math.min(d.occurrences.length, 4); j++) console.log('occurrence', d.occurrences[j]);
      }
      console.groupEnd();
    } else {
      console.log('no duplicates found');
    }
  }

  const valid = (!schemaValidation.errors.length) && (!(entriesValidation.entryErrors && entriesValidation.entryErrors.length));

  return {
    arrayKey,
    entryKeyField,
    schemaValidation,
    entriesValidation,
    valid,
  };
}

export default { validateSchemaArray, validateEntriesAgainstSchema, validateCollection };
