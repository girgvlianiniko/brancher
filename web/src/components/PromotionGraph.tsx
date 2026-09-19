import { Link } from 'react-router'

import type { CellStatus, Colour, EnvKind, ServiceKind } from '../../../shared/status'
import { formatNumber, shortAge, timeAgo } from '../lib/format'
import { StatusDot, TEXT } from './StatusBits'
import { cn } from './ui'

const NODE_W = 168
const NODE_H = 76
const COL_GAP = 108
const ROW_GAP = 22

interface Edge {
  from: EnvKind
  to: EnvKind
  count: number
  over: boolean
  far: boolean
  oldest: string | null
  fromRef: string
  toRef: string
  error: string | null
}

interface Node {
  kind: EnvKind
  label: string
  cell: CellStatus | null
  col: number
  row: number
}

/** The health and backlog of one part of the product inside one environment. */
function nodeState(cell: CellStatus | null, role: ServiceKind | null, incoming: Edge[]): {
  colour: Colour
  word: string
} {
  if (!cell) return { colour: 'grey', word: 'Source' }
  const service = role ? cell.services.find((s) => s.kind === role) : undefined
  if (service?.status === 'down') return { colour: 'red', word: 'Down' }
  if (incoming.some((edge) => edge.far)) return { colour: 'alert', word: 'Far behind' }
  if (incoming.some((edge) => edge.over)) return { colour: 'yellow', word: 'Behind' }
  if (service?.status === 'unknown') return { colour: 'grey', word: 'Checking' }
  return { colour: 'green', word: 'Working' }
}

function buildEdges(cells: CellStatus[], repoId: string): Edge[] {
  const edges: Edge[] = []
  for (const cell of cells) {
    for (const lag of cell.lag) {
      if (lag.repoId !== repoId) continue
      edges.push({
        from: lag.fromEnv,
        to: lag.toEnv,
        count: lag.realCommits,
        over: lag.overThreshold,
        far: lag.farBehind,
        oldest: lag.oldestWaitingAt,
        fromRef: lag.fromRef || lag.fromBranch,
        toRef: lag.toRef || lag.toBranch,
        error: lag.error,
      })
    }
  }
  return edges
}

/** Columns come from how far a node sits from the start of this repo's chain. */
function layout(edges: Edge[], cells: CellStatus[], devCell: CellStatus | null): Node[] {
  const kinds = new Set<EnvKind>()
  for (const edge of edges) {
    kinds.add(edge.from)
    kinds.add(edge.to)
  }

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

  const perColumn = new Map<number, number>()
  return [...kinds]
    .sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0))
    .map((kind) => {
      const col = depth.get(kind) ?? 0
      const row = perColumn.get(col) ?? 0
      perColumn.set(col, row + 1)
      const own = cells.find((c) => c.envKind === kind) ?? null
      const cell = own ?? (kind === 'development' ? devCell : null)
      return { kind, label: cell?.label ?? kind, cell, col, row }
    })
}

const x = (col: number) => col * (NODE_W + COL_GAP)
const y = (row: number) => row * (NODE_H + ROW_GAP)

/**
 * One repository's path from development to everywhere it lands. Separate graphs per
 * repository make the one that is falling behind obvious without reading any numbers:
 * its line is the amber one.
 */
export function PromotionGraph({
  cells,
  devCell,
  repoId,
  role,
  detailed,
}: {
  cells: CellStatus[]
  devCell: CellStatus | null
  repoId: string
  role: ServiceKind | null
  detailed: boolean
}) {
  const edges = buildEdges(cells, repoId)
  const nodes = layout(edges, cells, devCell)
  if (nodes.length === 0) return <p className="text-[13px] text-fg-3">Not used by this client.</p>

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
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2 - 6} ${y2}`}
                fill="none"
                stroke={
                  edge.far
                    ? 'var(--alert)'
                    : edge.over
                      ? 'var(--warn)'
                      : edge.count > 0
                        ? 'var(--line-strong)'
                        : 'var(--add)'
                }
                strokeOpacity={edge.count > 0 ? 1 : 0.55}
                strokeWidth={edge.far ? 2.5 : 2}
                markerEnd={
                  edge.far
                    ? 'url(#arrow-alert)'
                    : edge.over
                      ? 'url(#arrow-warn)'
                      : edge.count > 0
                        ? 'url(#arrow-plain)'
                        : 'url(#arrow-ok)'
                }
              />
            )
          })}
          <defs>
            {[
              ['arrow-plain', 'var(--line-strong)'],
              ['arrow-warn', 'var(--warn)'],
              ['arrow-alert', 'var(--alert)'],
              ['arrow-ok', 'var(--add)'],
            ].map(([id, fill]) => (
              <marker key={id} id={id} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill={fill} />
              </marker>
            ))}
          </defs>
        </svg>

        {edges.map((edge) => {
          const from = at(edge.from)
          const to = at(edge.to)
          if (!from || !to) return null
          const left = (x(from.col) + NODE_W + x(to.col)) / 2
          const top = (y(from.row) + y(to.row)) / 2 + NODE_H / 2
          const label = edge.error ? (
            <span className="text-[11px] text-fg-3">{edge.error}</span>
          ) : edge.count === 0 ? (
            <span className="text-[11px] font-medium text-add">in step</span>
          ) : (
            <Link
              to={`/r/${repoId}/compare?base=${encodeURIComponent(edge.toRef)}&head=${encodeURIComponent(edge.fromRef)}`}
              className="flex flex-col items-center leading-tight hover:underline"
              title={`${edge.count} changes waiting to reach ${edge.to}`}
            >
              <span
                className={cn(
                  'tabular text-sm font-bold',
                  edge.far ? 'text-alert' : edge.over ? 'text-warn' : 'text-fg',
                )}
              >
                {formatNumber(edge.count)}
              </span>
              <span className="text-[10px] text-fg-3">
                waiting{edge.oldest && detailed ? ` · ${shortAge(edge.oldest)}` : ''}
              </span>
            </Link>
          )
          return (
            <div
              key={`label-${edge.from}-${edge.to}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-card px-2 py-1"
              style={{ left, top }}
            >
              {label}
            </div>
          )
        })}

        {nodes.map((node) => {
          const incoming = edges.filter((edge) => edge.to === node.kind)
          const state = nodeState(node.cell, role, incoming)
          const branch = node.cell?.tips.find((tip) => tip.repoId === repoId && tip.isPrimary)

          const tone =
            state.colour === 'alert'
              ? 'border-alert/45 bg-alert-soft/30'
              : state.colour === 'yellow'
                ? 'border-warn/35 bg-warn-soft/25'
                : state.colour === 'red'
                  ? 'border-del/40 bg-del-soft/25'
                  : 'border-line bg-surface-2/40'

          const body = (
            <>
              <p className="text-[10px] font-semibold tracking-wider text-fg-3 uppercase">{node.label}</p>
              <p className={cn('mt-1 flex items-center gap-1.5 text-[13px] font-bold', TEXT[state.colour])}>
                <StatusDot colour={state.colour} />
                {state.word}
              </p>
              {detailed && branch ? (
                <p className="mt-0.5 truncate font-mono text-[10px] text-fg-3/80" title={branch.branch}>
                  {branch.branch}
                </p>
              ) : (
                node.cell?.lastDeployedAt && (
                  <p className="mt-0.5 truncate text-[10px] text-fg-3">{timeAgo(node.cell.lastDeployedAt)}</p>
                )
              )}
            </>
          )

          const box = 'absolute flex flex-col justify-center rounded-lg border px-3'
          const place = { left: x(node.col), top: y(node.row), width: NODE_W, height: NODE_H }

          // The whole box opens the branch behind it, so reaching the commits is one click
          // from the picture rather than a hunt through the repository tools.
          return branch ? (
            <Link
              key={node.kind}
              to={`/r/${repoId}/branches?branch=${encodeURIComponent(branch.branch)}`}
              title={`Open ${branch.branch} in the repository tools`}
              className={cn(box, tone, 'transition-colors hover:border-accent hover:bg-accent-soft/25')}
              style={place}
            >
              {body}
            </Link>
          ) : (
            <div key={node.kind} className={cn(box, tone)} style={place}>
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
