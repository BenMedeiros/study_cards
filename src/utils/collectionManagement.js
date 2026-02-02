// Collection management helpers: deterministic shuffle
export function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededPermutation(n, seed) {
  const rng = mulberry32(seed >>> 0);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// Given original entries and a collection-state object (may contain order_hash_int),
// return the view that apps should render: entries array and metadata.
export function getCollectionView(originalEntries, collState = {}, opts = { windowSize: 10 }) {
  const n = Array.isArray(originalEntries) ? originalEntries.length : 0;
  const baseIndices = Array.from({ length: n }, (_, i) => i);
  const baseEntries = baseIndices.map(i => originalEntries[i]).filter(Boolean);
  const m = baseEntries.length;
  const orderHashInt = (collState && typeof collState.order_hash_int === 'number') ? collState.order_hash_int : null;
  if (orderHashInt !== null && m > 0) {
    const perm = seededPermutation(m, orderHashInt);
    const entries = perm.map(i => baseEntries[i]);
    const indices = perm.map(i => baseIndices[i]);
    return { entries, indices, isShuffled: true, order_hash_int: orderHashInt };
  }
  return { entries: baseEntries, indices: baseIndices.slice(), isShuffled: false, order_hash_int: null };
}
