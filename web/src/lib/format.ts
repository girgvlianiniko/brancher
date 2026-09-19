export const shortSha = (sha: string) => sha.slice(0, 7)

const numberFormat = new Intl.NumberFormat()
export const formatNumber = (value: number) => numberFormat.format(value)

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  if (Number.isNaN(seconds)) return '—'
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const formatDateTime = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isNaN(ms) ? '—' : dateTime.format(ms)
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
/** For `YYYY-MM-DD` days, read as calendar dates rather than UTC instants. */
export const formatDay = (day: string) => shortDate.format(new Date(`${day}T00:00:00`))

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${formatNumber(count)} ${count === 1 ? one : many}`

/** "3d", "2w", "5mo" — compact enough to sit under a number in a grid cell. */
export function shortAge(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return ''
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 730) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export const percent = (value: number) => `${(value * 100).toFixed(value >= 0.999 ? 0 : 1)}%`
