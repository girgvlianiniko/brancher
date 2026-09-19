import type { LucideIcon } from 'lucide-react'

import { cn } from './ui'

/** The counts across the top, borrowed from Arcane's container summary. Each one filters. */
export function StatTile({
  icon: Icon,
  value,
  label,
  tone = 'neutral',
  active,
  onClick,
}: {
  icon: LucideIcon
  value: number
  label: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  active?: boolean
  onClick?: () => void
}) {
  const tint = {
    neutral: 'text-fg-3 bg-surface-2',
    good: 'text-add bg-add-soft/50',
    warn: 'text-warn bg-warn-soft/50',
    bad: 'text-del bg-del-soft/50',
  }[tone]
  const ring = {
    neutral: 'border-line-strong',
    good: 'border-add/45',
    warn: 'border-warn/45',
    bad: 'border-del/45',
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'glass flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors',
        active ? ring : 'border-line hover:border-line-strong',
      )}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tint)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="tabular block text-lg leading-none font-bold">{value}</span>
        <span className="mt-1 block truncate text-xs text-fg-3">{label}</span>
      </span>
    </button>
  )
}
