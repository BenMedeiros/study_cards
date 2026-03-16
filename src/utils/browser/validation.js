import {
  validateCollection as validateCollectionShared,
  validateCollectionContract as validateCollectionContractShared,
} from '../common/validation.mjs';

const COLLECTION_CONTRACT_SCHEMA_URL = new URL('../../../collections/_collections.schema.json', import.meta.url);
let collectionContractSchemaPromise = null;

async function loadCollectionContractSchema() {
  if (!collectionContractSchemaPromise) {
    collectionContractSchemaPromise = (async () => {
      const res = await fetch(COLLECTION_CONTRACT_SCHEMA_URL);
      if (!res.ok) throw new Error(`Failed to load collection contract schema (status ${res.status})`);
      return res.json();
    })();
  }
  return collectionContractSchemaPromise;
}

export async function validateCollectionContract(collection, opts = {}) {
  const contractSchema = opts?.contractSchema || await loadCollectionContractSchema();
  return validateCollectionContractShared(collection, { ...(opts || {}), contractSchema });
}

export async function validateCollection(collection, opts = {}) {
  const contractSchema = opts?.contractSchema || await loadCollectionContractSchema();
  return validateCollectionShared(collection, { ...(opts || {}), contractSchema });
}

export default {
  validateCollection,
  validateCollectionContract,
};