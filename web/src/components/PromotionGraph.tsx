import { Link } from 'react-router'

import type { CellStatus, EnvKind, LagEdge, ServiceKind } from '../../../shared/status'
import { formatNumber, shortAge, timeAgo } from '../lib/format'
import { ROLE_LABEL } from './ClientMatrix'
import { StatusDot, TEXT } from './StatusBits'
import { cn } from './ui'

const NODE_W = 192
const NODE_H = 92
const COL_GAP = 120
const ROW_GAP = 28

const ROLE_ORDER: ServiceKind[] = ['front', 'admin', 'api', 'pay', 'ws', 'chat']

interface Hop {
  role: ServiceKind
  repoId: string
  count: number
  over: boolean
  oldest: string | null
  fromRef: string
  toRef: string
}

interface Edge {
  from: EnvKind
  to: EnvKind
  hops: Hop[]
}

interface Node {
  kind: EnvKind
  label: string
  cell: CellStatus | null
  col: number
  row: number
}

function buildEdges(cells: CellStatus[]): Edge[] {
  const byPair = new Map<string, Edge>()
  for (const cell of cells) {
    for (const lag of cell.lag) {
      if (!lag.role) continue
      const key = `${lag.fromEnv}>${lag.toEnv}`
      const edge = byPair.get(key) ?? { from: lag.fromEnv, to: lag.toEnv, hops: [] }
      edge.hops.push({
        role: lag.role,
        repoId: lag.repoId,
        count: lag.realCommits,
        over: lag.overThreshold,
        oldest: lag.oldestWaitingAt,
        fromRef: lag.fromRef || lag.fromBranch,
        toRef: lag.toRef || lag.toBranch,
      })
      byPair.set(key, edge)
    }
  }
  for (const edge of byPair.values()) {
    edge.hops.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  }
  return [...byPair.values()]
}

/** Columns come from how far a node sits from the start of the chain. */
function layout(edges: Edge[], cells: CellStatus[], devCell: CellStatus | null): Node[] {
  const kinds = new Set<EnvKind>()
  for (const edge of edges) {
    kinds.add(edge.from)
    kinds.add(edge.to)
  }
  for (const cell of cells) kinds.add(cell.envKind)

  const depth = new Map<EnvKind, number>()
  const resolve = (kind: EnvKind, seen: Set<EnvKind>): number => {
    if (depth.has(kind)) return depth.get(kind)!
    if (seen.has(kind)) return 0
    seen.add(kind)
    const incoming = edges.filter((edge) => edge.to === kind)
    const value = incoming.length === 0 ? 0 : Math.max(...incoming.map((e) => resolve(e.from, seen) + 1))
    depth.set(kind, value)
    return value
  }
  for (const kind of kinds) resolve(kind, new Set())

  const cellFor = (kind: EnvKind) =>
    kind === 'development' && !cells.some((c) => c.envKind === kind)
      ? devCell
      : (cells.find((c) => c.envKind === kind) ?? null)

  const perColumn = new Map<number, number>()
  return [...kinds]
    .sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0))
    .map((kind) => {
      const col = depth.get(kind) ?? 0
      const row = perColumn.get(col) ?? 0
      perColumn.set(col, row + 1)
      const cell = cellFor(kind)
      return { kind, label: cell?.label ?? kind, cell, col, row }
    })
}

const x = (col: number) => col * (NODE_W + COL_GAP)
const y = (row: number) => row * (NODE_H + ROW_GAP)

function EdgeLabel({ edge, repoId, detailed }: { edge: Edge; repoId: string | null; detailed: boolean }) {
  const hops = repoId ? edge.hops.filter((hop) => hop.repoId === repoId) : edge.hops
  const waiting = hops.filter((hop) => hop.count > 0)

  if (waiting.length === 0) {
    return (
      <span className="rounded-md border border-line bg-card px-2 py-1 text-[11px] font-medium text-add">
        in step
      </span>
    )
  }

  return (
    <span className="flex flex-col items-stretch gap-0.5 rounded-md border border-line bg-card px-2 py-1.5">
      {waiting.map((hop) => (
        <Link
          key={`${hop.repoId}-${hop.role}`}
          to={`/r/${hop.repoId}/compare?base=${encodeURIComponent(hop.toRef)}&head=${encodeURIComponent(hop.fromRef)}`}
          className="flex items-baseline justify-between gap-2.5 text-[11px] leading-tight whitespace-nowrap hover:underline"
          title={`${hop.count} changes waiting to reach ${edge.to}`}
        >
          <span className="text-fg-3">{ROLE_LABEL[hop.role]}</span>
          <span className={cn('tabular font-semibold', hop.over ? 'text-warn' : 'text-fg')}>
            {formatNumber(hop.count)}
          </span>
          {detailed && hop.oldest && <span className="text-fg-3/70">{shortAge(hop.oldest)}</span>}
        </Link>
      ))}
    </span>
  )
}

/**
 * The path a change takes, drawn rather than listed. Nodes are environments, the line
 * between two of them carries what is waiting on that hop, and the shape follows the
 * real promotion links, so a mirror that branches off shows as a branch.
 */
export function PromotionGraph({
  cells,
  devCell,
  repoId,
  detailed,
}: {
  cells: CellStatus[]
  devCell: CellStatus | null
  repoId: string | null
  detailed: boolean
}) {
  const edges = buildEdges(cells)
  const nodes = layout(edges, cells, devCell)
  if (nodes.length === 0) return null

  const at = (kind: EnvKind) => nodes.find((node) => node.kind === kind)
  const cols = Math.max(...nodes.map((n) => n.col)) + 1
  const rows = Math.max(...nodes.map((n) => n.row)) + 1
  const width = cols * NODE_W + (cols - 1) * COL_GAP
  const height = rows * NODE_H + (rows - 1) * ROW_GAP

  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative" style={{ width, height, minWidth: width }}>
        <svg width={width} height={height} className="absolute inset-0" aria-hidden>
          {edges.map((edge) => {
            const from = at(edge.from)
            const to = at(edge.to)
            if (!from || !to) return null
            const x1 = x(from.col) + NODE_W
            const y1 = y(from.row) + NODE_H / 2
            const x2 = x(to.col)
            const y2 = y(to.row) + NODE_H / 2
            const mid = (x1 + x2) / 2
            const waiting = (repoId ? edge.hops.filter((h) => h.repoId === repoId) : edge.hops).some(
              (hop) => hop.count > 0,
            )
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2 - 7} ${y2}`}
                fill="none"
                strokeWidth={2}
                stroke={waiting ? 'var(--warn)' : 'var(--line-strong)'}
                markerEnd={waiting ? 'url(#arrow-waiting)' : 'url(#arrow-clear)'}
              />
            )
          })}
          <defs>
            <marker id="arrow-clear" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--line-strong)" />
            </marker>
            <marker id="arrow-waiting" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--warn)" />
            </marker>
          </defs>
        </svg>

        {edges.map((edge) => {
          const from = at(edge.from)
          const to = at(edge.to)
          if (!from || !to) return null
          const left = (x(from.col) + NODE_W + x(to.col)) / 2
          const top = (y(from.row) + y(to.row)) / 2 + NODE_H / 2
          return (
            <div
              key={`label-${edge.from}-${edge.to}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top }}
            >
              <EdgeLabel edge={edge} repoId={repoId} detailed={detailed} />
            </div>
          )
        })}

        {nodes.map((node) => (
          <div
            key={node.kind}
            className={cn(
              'glass absolute flex flex-col justify-center rounded-lg border bg-card px-3.5',
              node.cell?.colour === 'yellow'
                ? 'border-warn/35'
                : node.cell?.colour === 'red'
                  ? 'border-del/40'
                  : 'border-line',
            )}
            style={{ left: x(node.col), top: y(node.row), width: NODE_W, height: NODE_H }}
          >
            <p className="text-[10px] font-semibold tracking-wider text-fg-3 uppercase">{node.label}</p>
            {node.cell ? (
              <>
                <p className={cn('mt-1 flex items-center gap-2 text-sm font-bold whitespace-nowrap', TEXT[node.cell.colour])}>
                  <StatusDot colour={node.cell.colour} />
                  {node.cell.word}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-fg-3">
                  {node.cell.lastDeployedAt ? `changed ${timeAgo(node.cell.lastDeployedAt)}` : 'no changes yet'}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-fg-3">Source</p>
            )}
            {detailed && node.cell && (
              <p className="mt-1 truncate font-mono text-[10px] text-fg-3/70">
                {[...new Set(node.cell.tips.filter((t) => t.isPrimary).map((t) => t.branch))].join(' · ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export type { Edge as PromotionEdge, LagEdge }
