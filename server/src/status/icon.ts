/**
 * Client icons, taken from the site itself.
 *
 * The board proxies them rather than pointing an <img> at each casino: it keeps the
 * office screen from making a request to every client domain on every load, works when a
 * site only serves its icon to a browser-shaped user agent, and means one cache for
 * everyone looking at the board.
 */

const TTL_OK_MS = 24 * 3600_000
const TTL_FAIL_MS = 60 * 60_000
/** Enough of the page to reach the <head>. */
const HTML_LIMIT = 256 * 1024
const ICON_LIMIT = 512 * 1024

export interface Icon {
  body: Uint8Array
  contentType: string
}

const cache = new Map<string, { at: number; icon: Icon | null }>()

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
}

async function get(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: HEADERS,
    })
    return response.ok ? response : null
  } catch {
    return null
  }
}

/** `<link rel="icon" href="…">` from the page head, best candidate first. */
function iconLinks(html: string, base: URL): string[] {
  const found: { href: string; size: number }[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!rel || !/\bicon\b/.test(rel)) continue
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const sizes = /sizes\s*=\s*["'](\d+)/i.exec(tag)?.[1]
    // Apple touch icons are usually the crispest thing a site publishes.
    const bonus = rel.includes('apple') ? 180 : 0
    found.push({ href, size: Number(sizes ?? 0) + bonus })
  }
  return found
    .sort((a, b) => b.size - a.size)
    .map((entry) => {
      try {
        return new URL(entry.href, base).toString()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

async function fetchIcon(url: string): Promise<Icon | null> {
  const response = await get(url, 5000)
  if (!response) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) return null
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > ICON_LIMIT) return null
  return { body, contentType: contentType.split(';')[0] }
}

/** Reads the site, follows its declared icon, and falls back to /favicon.ico. */
export async function resolveIcon(siteUrl: string): Promise<Icon | null> {
  const hit = cache.get(siteUrl)
  if (hit && Date.now() - hit.at < (hit.icon ? TTL_OK_MS : TTL_FAIL_MS)) return hit.icon

  let icon: Icon | null = null
  try {
    const base = new URL(siteUrl)
    const page = await get(base.toString(), 6000)
    if (page) {
      const html = (await page.text()).slice(0, HTML_LIMIT)
      for (const candidate of iconLinks(html, new URL(page.url || base))) {
        icon = await fetchIcon(candidate)
        if (icon) break
      }
    }
    if (!icon) icon = await fetchIcon(new URL('/favicon.ico', base).toString())
  } catch {
    icon = null
  }

  cache.set(siteUrl, { at: Date.now(), icon })
  return icon
}
