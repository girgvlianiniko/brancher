import type { ActivityWeek } from '../../shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
export const ACTIVITY_WEEKS = 52

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Midnight UTC of the Monday starting the week that contains `ms`. */
function weekStart(ms: number): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS
  const weekday = (new Date(day).getUTCDay() + 6) % 7
  return day - weekday * DAY_MS
}

/** The first day of the oldest week in the activity window, as an ISO date. */
export function activitySince(now = Date.now()): string {
  return isoDay(weekStart(now) - (ACTIVITY_WEEKS - 1) * 7 * DAY_MS)
}

/** Buckets commit dates into the last 52 Monday-started weeks, oldest first. */
export function bucketByWeek(dates: string[], now = Date.now()): ActivityWeek[] {
  const first = weekStart(now) - (ACTIVITY_WEEKS - 1) * 7 * DAY_MS
  const counts = new Array<number>(ACTIVITY_WEEKS).fill(0)
  for (const date of dates) {
    const ms = Date.parse(date)
    if (Number.isNaN(ms)) continue
    const index = Math.floor((weekStart(ms) - first) / (7 * DAY_MS))
    if (index >= 0 && index < ACTIVITY_WEEKS) counts[index]++
  }
  return counts.map((commits, i) => ({ weekStart: isoDay(first + i * 7 * DAY_MS), commits }))
}
