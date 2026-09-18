import { useState } from 'react'

import type { ActivityWeek } from '../../../shared/types'
import { formatDay, formatNumber, plural } from '../lib/format'

const HEIGHT = 140

/** A "nice" axis ceiling: 1, 2 or 5 times a power of ten, at or above `max`. */
function niceCeiling(max: number): number {
  if (max <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((step) => step * power).find((v) => v >= max) ?? max
}

/**
 * Commits per week as columns. One series, so no legend; the card title names it.
 * Each week is a full-height hover target so thin columns are still easy to hit.
 */
export function ActivityChart({ weeks }: { weeks: ActivityWeek[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const ceiling = niceCeiling(Math.max(...weeks.map((w) => w.commits)))
  const active = hovered === null ? null : weeks[hovered]

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        <div className="tabular flex w-8 flex-col justify-between text-right text-[11px] text-fg-3" style={{ height: HEIGHT }} aria-hidden>
          <span className="-translate-y-1/2">{formatNumber(ceiling)}</span>
          <span className="-translate-y-1/2">{formatNumber(ceiling / 2)}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ top: HEIGHT / 2 }} />
          <div
            className="relative flex items-end gap-[2px] border-b border-line-strong"
            style={{ height: HEIGHT }}
            onMouseLeave={() => setHovered(null)}
          >
            {weeks.map((week, i) => (
              <div
                key={week.weekStart}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => setHovered(i)}
                aria-label={`Week of ${formatDay(week.weekStart)}: ${plural(week.commits, 'commit')}`}
              >
                <div
                  className="w-full rounded-t-[4px] bg-accent transition-opacity"
                  style={{
                    height: week.commits ? Math.max(2, (week.commits / ceiling) * HEIGHT) : 0,
                    opacity: hovered === null || hovered === i ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
          </div>
          {active && hovered !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
              style={{
                left: `${((hovered + 0.5) / weeks.length) * 100}%`,
                transform: `translateX(${hovered > weeks.length / 2 ? '-105%' : '5%'})`,
              }}
            >
              <div className="text-fg-3">Week of {formatDay(active.weekStart)}</div>
              <div className="tabular font-semibold text-fg">{plural(active.commits, 'commit')}</div>
            </div>
          )}
          <div className="relative mt-1 h-4 text-[11px] text-fg-3" aria-hidden>
            {weeks.map((week, i) => {
              const date = new Date(`${week.weekStart}T00:00:00`)
              const firstOfMonth = i === 0 || new Date(`${weeks[i - 1].weekStart}T00:00:00`).getMonth() !== date.getMonth()
              if (!firstOfMonth || i > weeks.length - 3) return null
              return (
                <span key={week.weekStart} className="absolute" style={{ left: `${(i / weeks.length) * 100}%` }}>
                  {date.toLocaleDateString(undefined, { month: 'short' })}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </figure>
  )
}
