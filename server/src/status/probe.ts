import type { ProbeResult } from '../../../shared/status'

/**
 * One HTTP check. A 2xx or 3xx within the timeout is up; anything else, including a
 * refused connection, a TLS error or a timeout, is down. Redirects are followed, so a
 * site that sends http to https still reads as up.
 */
export async function probe(url: string, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'brancher-status/1.0',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      },
    })
    // Drain the body so the socket is released; the content is never used.
    await response.arrayBuffer().catch(() => undefined)
    const ok = response.status >= 200 && response.status < 400
    return {
      ok,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      error: ok ? null : `HTTP ${response.status}`,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? `No answer within ${timeoutMs} ms`
          : (error.cause instanceof Error ? error.cause.message : error.message)
        : 'Request failed'
    return { ok: false, httpStatus: null, latencyMs: Date.now() - started, error: message }
  }
}

/** Runs `tasks` with at most `limit` in flight, keeping the input order in the result. */
export async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  })
  await Promise.all(workers)
  return results
}
