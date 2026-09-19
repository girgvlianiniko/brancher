import { useState } from 'react'

import type { CellStatus, Colour, ServiceKind, ServiceState } from '../../../shared/status'
import { formatNumber } from '../lib/format'
import { cn } from './ui'

/** Plain words. Nobody reading the board should need to know what "front" means. */
export const SERVICE_TAG: Record<ServiceKind, string> = {
  front: 'Website',
  admin: 'Admin',
  api: 'API',
  ws: 'Live',
  chat: 'Chat',
  pay: 'Payments',
}

export const DOT: Record<Colour, string> = {
  green: 'bg-add',
  yellow: 'bg-warn',
  red: 'bg-del',
  grey: 'bg-line-strong',
}

export const TEXT: Record<Colour, string> = {
  green: 'text-add',
  yellow: 'text-warn',
  red: 'text-del',
  grey: 'text-fg-3',
}

export const SOFT: Record<Colour, string> = {
  green: 'border-add/30 bg-add-soft/40',
  yellow: 'border-warn/35 bg-warn-soft/40',
  red: 'border-del/35 bg-del-soft/40',
  grey: 'border-line bg-surface-2/40',
}

export function StatusDot({ colour, className }: { colour: Colour; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', DOT[colour], className)} aria-hidden />
}

/** Colour, word, and the count that explains it, on one line. */
export function StatusLine({ cell, className }: { cell: CellStatus; className?: string }) {
  const figure = headlineFigure(cell)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 text-[13px]', className)}>
      <StatusDot colour={cell.colour} />
      <span className={cn('font-semibold', TEXT[cell.colour])}>{cell.word}</span>
      {figure && (
        <span className="tabular truncate text-fg-3">
          {formatNumber(figure.value)} {figure.unit}
        </span>
      )}
    </span>
  )
}

export function ServiceLine({ services, className }: { services: ServiceState[]; className?: string }) {
  if (services.length === 0) return null
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3', className)}>
      {services.map((service, i) => (
        <span key={service.ref} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-line-strong">·</span>}
          <span
            className={cn(service.status === 'down' && 'font-semibold text-del')}
            title={`${service.url}${service.error ? ` — ${service.error}` : ''}`}
          >
            {SERVICE_TAG[service.kind]}
          </span>
        </span>
      ))}
    </p>
  )
}

/** The count behind an amber cell, or nothing when the colour needs no number. */
export function headlineFigure(cell: CellStatus): { value: number; unit: string } | null {
  if (cell.colour !== 'yellow') return null
  const waiting = cell.lag.filter((edge) => edge.overThreshold).reduce((sum, edge) => sum + edge.realCommits, 0)
  return waiting > 0 ? { value: waiting, unit: waiting === 1 ? 'change waiting' : 'changes waiting' } : null
}

/** A stable colour per client, so the same monogram is the same hue every visit. */
export function monogramHue(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

export function Monogram({
  name,
  id,
  src,
  size = 'md',
}: {
  name: string
  id: string
  /** The client's own favicon. Falls back to initials when it is missing or broken. */
  src?: string | null
  size?: 'md' | 'lg'
}) {
  const [failed, setFailed] = useState(false)
  const hue = monogramHue(id)
  // Two letters from the first word, so "Oribets.com" reads OR rather than OC.
  const first = name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(Boolean)[0] ?? name
  const letters = first.slice(0, 2).toUpperCase()
  const box = size === 'lg' ? 'size-12' : 'size-10'

  if (src && !failed) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2', box)}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn('object-contain', size === 'lg' ? 'size-8' : 'size-6')}
        />
      </span>
    )
  }

  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-lg font-bold', box, size === 'lg' ? 'text-base' : 'text-[13px]')}
      style={{
        background: `oklch(0.55 0.16 ${hue} / 0.18)`,
        color: `oklch(0.72 0.16 ${hue})`,
        boxShadow: `inset 0 0 0 1px oklch(0.6 0.16 ${hue} / 0.3)`,
      }}
      aria-hidden
    >
      {letters || '?'}
    </span>
  )
}
