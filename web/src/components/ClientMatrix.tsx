import { GripVertical, Settings2, Star, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'

import type { BoardRow, CellStatus, Colour, EnvKind, ServiceKind } from '../../../shared/status'
import { formatNumber, percent, shortAge } from '../lib/format'
import { Monogram, StatusDot, TEXT } from './StatusBits'
import { cn } from './ui'

export const SLOTS: EnvKind[] = ['staging', 'production', 'mirror']
export const SLOT_LABEL: Record<EnvKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  mirror: 'Mirror',
}

/** Rows of the matrix: the parts of the product a client is built from. */
const ROLE_ORDER: ServiceKind[] = ['front', 'admin', 'api', 'pay', 'ws', 'chat']
export const ROLE_LABEL: Record<ServiceKind, string> = {
  front: 'Website',
  admin: 'Admin',
  api: 'API',
  ws: 'Live',
  chat: 'Chat',
  pay: 'Payments',
}

export const worstOf = (cells: (CellStatus | null)[]): Colour => {
  const colours = cells.filter((c): c is CellStatus => c !== null).map((c) => c.colour)
  return colours.includes('red')
    ? 'red'
    : colours.includes('yellow')
      ? 'yellow'
      : colours.includes('green')
        ? 'green'
        : 'grey'
}

function rolesOf(row: BoardRow): ServiceKind[] {
  const found = new Set<ServiceKind>()
  for (const cell of row.cells) {
    if (!cell) continue
    for (const edge of cell.lag) if (edge.role) found.add(edge.role)
    for (const service of cell.services) found.add(service.kind)
  }
  return ROLE_ORDER.filter((role) => found.has(role))
}

interface RoleState {
  down: boolean
  slow: boolean
  behind: number
  overThreshold: boolean
  oldest: string | null
  known: boolean
  latency: number | null
}

const SLOW_MS = 1500

/** Label column, a spacer, the environment columns, then a matching spacer. */
const COLUMNS = (count: number) => `4.75rem 1fr repeat(${count}, minmax(4.5rem, 8rem)) 1fr`

function roleState(cell: CellStatus | null, role: ServiceKind): RoleState {
  if (!cell)
    return { down: false, slow: false, behind: 0, overThreshold: false, oldest: null, known: false, latency: null }
  const service = cell.services.find((s) => s.kind === role)
  const edges = cell.lag.filter((e) => e.role === role)
  const oldest = edges
    .map((e) => e.oldestWaitingAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0]
  return {
    down: service?.status === 'down',
    slow: (service?.latencyMs ?? 0) > SLOW_MS && service?.status === 'up',
    behind: edges.reduce((sum, e) => sum + e.realCommits, 0),
    overThreshold: edges.some((e) => e.overThreshold),
    oldest: oldest ?? null,
    known: Boolean(service) || edges.length > 0,
    latency: service?.latencyMs ?? null,
  }
}

/** Every cell is the same height, so rows line up whether or not they carry an age. */
const CELL = 'flex min-h-10 flex-col items-center justify-center rounded-md px-1 leading-tight'

function MatrixCell({ state }: { state: RoleState }) {
  if (!state.known) return <span className={cn(CELL, 'text-[13px] text-fg-3/35')}>–</span>

  const title = [
    state.down ? 'Not answering' : state.latency !== null ? `Answers in ${state.latency} ms` : null,
    state.behind > 0 ? `${state.behind} changes waiting to deploy` : 'Up to date',
    state.oldest ? `oldest waiting since ${new Date(state.oldest).toLocaleDateString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (state.down) {
    return (
      <span className={cn(CELL, 'bg-del-soft/60 text-[13px] font-semibold text-del')} title={title}>
        down
      </span>
    )
  }

  if (state.behind === 0) {
    return (
      <span className={cn(CELL, 'text-[13px]', state.slow ? 'text-warn' : 'text-add/70')} title={title}>
        {state.slow ? 'slow' : '✓'}
      </span>
    )
  }

  return (
    <span
      className={cn(CELL, 'tabular', state.overThreshold ? 'bg-warn-soft/55 text-warn' : 'text-fg-2')}
      title={title}
    >
      <span className="text-[13px] font-semibold">{formatNumber(state.behind)}</span>
      {state.oldest && <span className="text-[10px] opacity-75">{shortAge(state.oldest)}</span>}
    </span>
  )
}

export function ClientMatrixCard({
  row,
  columns,
  onTogglePin,
  onDragStart,
  onDragOver,
  onDrop,
  dragging,
}: {
  row: BoardRow
  columns: EnvKind[]
  onTogglePin: (id: string) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string) => void
  onDrop: () => void
  dragging: boolean
}) {
  const roles = rolesOf(row)
  const present = SLOTS.filter((kind) => row.cells[columns.indexOf(kind)])
  const overall = worstOf(row.cells)
  const worstCell = row.cells.find((cell) => cell?.colour === overall) ?? null

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart(row.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver(row.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDrop}
      className={cn(
        'glass group rounded-lg border bg-card transition-[border-color,opacity]',
        dragging ? 'border-accent opacity-40' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex items-center gap-2.5 px-4 py-3.5">
        <span
          className="-ml-1 cursor-grab text-fg-3/40 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
          title="Drag to reorder"
          aria-hidden
        >
          <GripVertical className="size-4" />
        </span>
        <Monogram name={row.name} id={row.id} />
        <div className="min-w-0 flex-1">
          <Link draggable={false} to={`/c/${row.id}`} className="block truncate text-[15px] font-bold hover:text-accent">
            {row.name}
          </Link>
          <p className="truncate text-xs text-fg-3">{row.region}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <StatusDot colour={overall} />
          <span className={cn('text-[13px] font-semibold', TEXT[overall])}>{worstCell?.word ?? '—'}</span>
        </span>
        <button
          onClick={() => onTogglePin(row.id)}
          title={row.pinned ? 'Unpin' : 'Pin to the top'}
          aria-label={row.pinned ? `Unpin ${row.name}` : `Pin ${row.name}`}
          aria-pressed={row.pinned}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-surface-2',
            row.pinned ? 'text-warn' : 'text-fg-3/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Star className={cn('size-4', row.pinned && 'fill-current')} />
        </button>
        <Link
          draggable={false}
          to={`/c/${row.id}/setup`}
          aria-label={`Edit ${row.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-3/40 opacity-0 transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Settings2 className="size-4" />
        </Link>
      </header>

      <div
        className="grid gap-x-2 gap-y-1.5 border-t border-line px-4 py-3"
        style={{ gridTemplateColumns: COLUMNS(present.length) }}
      >
        <span />
        <span />
        {present.map((kind) => (
          <span
            key={kind}
            className="truncate text-center text-[10px] font-semibold tracking-wider text-fg-3 uppercase"
          >
            {SLOT_LABEL[kind]}
          </span>
        ))}
        <span />

        {roles.map((role) => (
          <div key={role} className="contents">
            <span className="flex min-h-10 items-center truncate text-[13px] text-fg-3">
              {ROLE_LABEL[role]}
            </span>
            <span />
            {present.map((kind) => (
              <MatrixCell key={kind} state={roleState(row.cells[columns.indexOf(kind)] ?? null, role)} />
            ))}
            <span />
          </div>
        ))}
      </div>

      <div
        className="grid gap-x-2 border-t border-line px-4 py-3"
        style={{ gridTemplateColumns: COLUMNS(present.length) }}
      >
        <span className="flex items-center text-[10px] tracking-wider text-fg-3/70 uppercase">Deploys</span>
        <span />
        {present.map((kind) => {
          const cell = row.cells[columns.indexOf(kind)]!
          const byHand = cell.autoDeploy === 'off' || cell.autoDeploy === 'mixed'
          return (
            <span key={kind} className="flex flex-col items-center justify-center gap-0.5 leading-tight">
              <span className="flex h-4 items-center gap-1 text-[11px]">
                {byHand ? (
                  <>
                    <TriangleAlert className="size-3 shrink-0 text-warn" aria-hidden />
                    <span className="text-warn">by hand</span>
                  </>
                ) : (
                  <span className="text-fg-3">on push</span>
                )}
              </span>
              <span className="flex h-4 items-center text-[11px] text-fg-3/70">
                {cell.uptime !== null ? `${percent(cell.uptime)} up` : ''}
              </span>
            </span>
          )
        })}
        <span />
      </div>
    </article>
  )
}
