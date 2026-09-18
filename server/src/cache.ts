const entries = new Map<string, { expires: number; value: Promise<unknown> }>()

/**
 * Memoises an async call for `ttlMs`. The promise itself is stored, so concurrent callers
 * share one in-flight request; a rejected promise is dropped so the next call retries.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = entries.get(key)
  if (hit && hit.expires > now) return hit.value as Promise<T>

  const value = load()
  entries.set(key, { expires: now + ttlMs, value })
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key)
  })
  return value
}

/** Forgets every entry whose key starts with `prefix`. */
export function invalidate(prefix: string) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
}
