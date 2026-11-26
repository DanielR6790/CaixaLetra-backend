// Cache simples em memória, para não repetir buscas idênticas às APIs externas.
// Zera quando o servidor reinicia.
const store = new Map();
const MAX_ENTRIES = 500;

export async function remember(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await producer();

  if (store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value); // remove a entrada mais antiga
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}