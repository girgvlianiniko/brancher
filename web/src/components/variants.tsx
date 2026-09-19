import { Fragment } from 'react'
import { Link } from 'react-router'

import type { BoardRow, CellStatus, Colour, EnvKind, ServiceKind } from '../../../shared/status'
import { formatNumber, timeAgo } from '../lib/format'
import { Monogram, StatusDot, TEXT } from './StatusBits'
import { cn } from './ui'

export const SLOTS: EnvKind[] = ['staging', 'production', 'mirror']
export const SLOT_LABEL: Record<EnvKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  mirror: 'Mirror',
}

/** Short enough to sit in a grid cell, still a word rather than a code. */
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

/** Which parts of the product a client actually has, in a stable order. */
export function rolesOf(row: BoardRow): ServiceKind[] {
  const order: ServiceKind[] = ['front', 'admin', 'api', 'pay', 'ws', 'chat']
  const found = new Set<ServiceKind>()
  for (const cell of row.cells) {
    if (!cell) continue
    for (const edge of cell.lag) if (edge.role) found.add(edge.role)
    for (const service of cell.services) found.add(service.kind)
  }
  return order.filter((role) => found.has(role))
}

export interface RoleState {
  role: ServiceKind
  down: boolean
  behind: number
  overThreshold: boolean
  known: boolean
}

/** Health and lag for one part of the product inside one environment. */
export function roleState(cell: CellStatus | null, role: ServiceKind): RoleState {
  if (!cell) return { role, down: false, behind: 0, overThreshold: false, known: false }
  const service = cell.services.find((s) => s.kind === role)
  const edges = cell.lag.filter((e) => e.role === role)
  return {
    role,
    down: service?.status === 'down',
    behind: edges.reduce((sum, e) => sum + e.realCommits, 0),
    overThreshold: edges.some((e) => e.overThreshold),
    known: Boolean(service) || edges.length > 0,
  }
}

const cellColour = (state: RoleState): Colour =>
  state.down ? 'red' : state.overThreshold ? 'yellow' : state.known ? 'green' : 'grey'

// ───────────────────────────────────────────── v1: one line per client

function BehindChips({ cell }: { cell: CellStatus }) {
  const parts = cell.lag
    .filter((edge) => edge.realCommits > 0 && edge.role)
    .sort((a, b) => b.realCommits - a.realCommits)
  if (parts.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {parts.map((edge) => (
        <span
          key={edge.repoId}
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            edge.overThreshold ? 'bg-warn-soft/60 text-warn' : 'bg-surface-2 text-fg-3',
          )}
        >
          {ROLE_LABEL[edge.role!]} {formatNumber(edge.realCommits)}
        </span>
      ))}
    </span>
  )
}

export function VariantLines({ rows, columns }: { rows: BoardRow[]; columns: EnvKind[] }) {
  return (
    <div className="glass overflow-hidden rounded-lg border border-line bg-card">
      <div className="hidden grid-cols-[13rem_repeat(3,1fr)] gap-4 border-b border-line px-4 py-2.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase lg:grid">
        <span>Client</span>
        {SLOTS.map((kind) => (
          <span key={kind}>{SLOT_LABEL[kind]}</span>
        ))}
      </div>
      {rows.map((row) => (
        <Link
          key={row.id}
          to={`/c/${row.id}`}
          className="grid grid-cols-1 gap-3 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-surface-2/40 lg:grid-cols-[13rem_repeat(3,1fr)] lg:gap-4"
        >
          <span className="flex items-center gap-2.5">
            <StatusDot colour={worstOf(row.cells)} />
            <span className="truncate text-sm font-semibold">{row.name}</span>
            <span className="truncate text-xs text-fg-3">{row.region}</span>
          </span>
          {SLOTS.map((kind) => {
            const cell = row.cells[columns.indexOf(kind)] ?? null
            if (!cell) return <span key={kind} className="text-xs text-fg-3/40">—</span>
            return (
              <span key={kind} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('text-[13px] font-semibold', TEXT[cell.colour])}>{cell.word}</span>
                <BehindChips cell={cell} />
              </span>
            )
          })}
        </Link>
      ))}
    </div>
  )
}

// ───────────────────────────────────────────── v2: service by environment grid

export function VariantGrid({ rows, columns }: { rows: BoardRow[]; columns: EnvKind[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => {
        const roles = rolesOf(row)
        const present = SLOTS.filter((kind) => row.cells[columns.indexOf(kind)])
        return (
          <article key={row.id} className="glass relative rounded-lg border border-line bg-card p-4">
            <Link to={`/c/${row.id}`} className="absolute inset-0 rounded-lg" aria-label={row.name} />
            <header className="mb-3 flex items-center gap-3">
              <Monogram name={row.name} id={row.id} />
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-bold">{row.name}</h3>
                <p className="truncate text-xs text-fg-3">{row.region}</p>
              </div>
            </header>
            <div
              className="grid gap-x-2 gap-y-1 text-[13px]"
              style={{ gridTemplateColumns: `5.5rem repeat(${present.length}, minmax(0,1fr))` }}
            >
              <span />
              {present.map((kind) => (
                <span key={kind} className="truncate pb-1 text-center text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
                  {SLOT_LABEL[kind]}
                </span>
              ))}
              {roles.map((role) => (
                <Fragment key={role}>
                  <span className="truncate py-1.5 text-fg-3">{ROLE_LABEL[role]}</span>
                  {present.map((kind) => {
                    const state = roleState(row.cells[columns.indexOf(kind)] ?? null, role)
                    const colour = cellColour(state)
                    return (
                      <span
                        key={kind}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium tabular',
                          colour === 'red' && 'bg-del-soft/50 text-del',
                          colour === 'yellow' && 'bg-warn-soft/50 text-warn',
                          colour === 'green' && 'text-fg-3',
                          colour === 'grey' && 'text-fg-3/40',
                        )}
                        title={
                          state.down
                            ? 'Not answering'
                            : state.behind > 0
                              ? `${state.behind} changes waiting`
                              : state.known
                                ? 'Up to date'
                                : 'Not used'
                        }
                      >
                        {state.down ? 'down' : state.behind > 0 ? formatNumber(state.behind) : state.known ? '✓' : '—'}
                      </span>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────── v3: only the exceptions

export function VariantExceptions({ rows, columns }: { rows: BoardRow[]; columns: EnvKind[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const problems = SLOTS.flatMap((kind) => {
          const cell = row.cells[columns.indexOf(kind)] ?? null
          if (!cell) return []
          const parts = cell.lag
            .filter((edge) => edge.overThreshold && edge.role)
            .sort((a, b) => b.realCommits - a.realCommits)
          const down = cell.services.filter((s) => s.status === 'down')
          if (parts.length === 0 && down.length === 0) return []
          return [{ cell, kind, parts, down }]
        })
        const clean = problems.length === 0

        return (
          <article
            key={row.id}
            className={cn(
              'glass relative rounded-lg border bg-card px-4 py-3.5',
              clean ? 'border-line' : 'border-warn/30',
            )}
          >
            <Link to={`/c/${row.id}`} className="absolute inset-0 rounded-lg" aria-label={row.name} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusDot colour={worstOf(row.cells)} />
              <h3 className="text-[15px] font-bold">{row.name}</h3>
              <span className="text-xs text-fg-3">{row.region}</span>
              {clean && <span className="ml-auto text-[13px] text-add">Everything up to date</span>}
            </div>
            {!clean && (
              <ul className="mt-2.5 space-y-1.5">
                {problems.map(({ cell, kind, parts, down }) => (
                  <li key={kind} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="w-24 shrink-0 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
                      {SLOT_LABEL[kind]}
                    </span>
                    {down.length > 0 && (
                      <span className="font-semibold text-del">
                        {down.map((s) => ROLE_LABEL[s.kind]).join(', ')} not answering
                      </span>
                    )}
                    {parts.map((edge) => (
                      <span key={edge.repoId} className="text-fg-2">
                        <span className="font-semibold text-warn">{ROLE_LABEL[edge.role!]}</span>{' '}
                        {formatNumber(edge.realCommits)} behind
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-fg-3">{timeAgo(cell.lastDeployedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────── v4: bars per service

export function VariantBars({ rows, columns }: { rows: BoardRow[]; columns: EnvKind[] }) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) =>
      row.cells.flatMap((cell) => (cell ? cell.lag.map((edge) => edge.realCommits) : [])),
    ),
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((row) => {
        const present = SLOTS.filter((kind) => row.cells[columns.indexOf(kind)])
        const roles = rolesOf(row)
        return (
          <article key={row.id} className="glass relative rounded-lg border border-line bg-card p-4">
            <Link to={`/c/${row.id}`} className="absolute inset-0 rounded-lg" aria-label={row.name} />
            <header className="mb-3 flex items-center gap-3">
              <StatusDot colour={worstOf(row.cells)} />
              <h3 className="text-[15px] font-bold">{row.name}</h3>
              <span className="text-xs text-fg-3">{row.region}</span>
            </header>
            <div className="space-y-3">
              {present.map((kind) => {
                const cell = row.cells[columns.indexOf(kind)]!
                return (
                  <div key={kind}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
                        {SLOT_LABEL[kind]}
                      </span>
                      <span className={cn('text-xs font-semibold', TEXT[cell.colour])}>{cell.word}</span>
                    </div>
                    <div className="space-y-1">
                      {roles.map((role) => {
                        const state = roleState(cell, role)
                        if (!state.known) return null
                        const width = state.behind === 0 ? 0 : Math.max(4, (state.behind / max) * 100)
                        return (
                          <div key={role} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 truncate text-[11px] text-fg-3">
                              {ROLE_LABEL[role]}
                            </span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className={cn(
                                  'block h-full rounded-full',
                                  state.down ? 'bg-del' : state.overThreshold ? 'bg-warn' : 'bg-add',
                                )}
                                style={{ width: `${state.behind === 0 ? 100 : width}%` }}
                              />
                            </span>
                            <span className="tabular w-10 shrink-0 text-right text-[11px] text-fg-3">
                              {state.down ? 'down' : state.behind === 0 ? 'ok' : formatNumber(state.behind)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </article>
        )
      })}
    </div>
  )
}
