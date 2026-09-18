import { ArrowDown, ArrowUp, Copy, GitFork, GitMerge } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import type { BranchPosition, Commit, GraphScope, RepoConfig } from '../../../shared/types'
import { useBranches, useGraph, usePosition } from '../api'
import { BranchSelect } from '../components/BranchSelect'
import { Card, cn, Empty, ErrorBox, RefBadge, Segmented, Sha, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'
import { type GraphRow, laneColor, layoutGraph } from '../lib/graphLayout'

const ROW_HEIGHT = 30
const LANE_WIDTH = 12
/** Lanes past this are clipped so a very wide history doesn't push the text off screen. */
const MAX_VISIBLE_LANES = 24
/** The gutter follows the widest row within this many rows, so text shifts gradually. */
const WIDTH_WINDOW = 12

function gutterWidths(rows: GraphRow[]): number[] {
  const lanes = rows.map((r) => Math.max(r.before.length, r.after.length, r.column + 1))
  return lanes.map((_, i) => {
    let widest = 1
    for (let j = Math.max(0, i - WIDTH_WINDOW); j <= Math.min(lanes.length - 1, i + WIDTH_WINDOW); j++) {
      widest = Math.max(widest, lanes[j])
    }
    return Math.min(widest, MAX_VISIBLE_LANES) * LANE_WIDTH + 4
  })
}

const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + 2
const mid = ROW_HEIGHT / 2

/** Labels shown inline per commit; the rest collapse into a "+N" chip. */
const MAX_INLINE_REFS = 2

/** A vertical S-curve from one point to another, so lane changes read as smooth bends. */
const curve = (x1: number, y1: number, x2: number, y2: number) =>
  x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`

const GraphCell = memo(function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const { commit, column, before, parentColumns } = row
  const isMerge = commit.parents.length > 1
  return (
    <svg width={width} height={ROW_HEIGHT} className="block shrink-0" aria-hidden>
      {before.map((sha, lane) =>
        sha && sha !== commit.sha ? <path key={`pass-${lane}`} d={`M${x(lane)} 0V${ROW_HEIGHT}`} stroke={laneColor(lane)} strokeWidth={2} fill="none" /> : null,
      )}
      {before.map((sha, lane) =>
        sha === commit.sha ? <path key={`in-${lane}`} d={curve(x(lane), 0, x(column), mid)} stroke={laneColor(lane)} strokeWidth={2} fill="none" /> : null,
      )}
      {parentColumns.map((lane, i) => (
        <path key={`out-${i}`} d={curve(x(column), mid, x(lane), ROW_HEIGHT)} stroke={laneColor(lane)} strokeWidth={2} fill="none" />
      ))}
      <circle
        cx={x(column)}
        cy={mid}
        r={isMerge ? 4 : 4.5}
        fill={isMerge ? 'var(--surface)' : laneColor(column)}
        stroke={isMerge ? laneColor(column) : 'var(--surface)'}
        strokeWidth={2}
      />
    </svg>
  )
})

type PositionMark = 'ahead' | 'behind' | 'split' | 'shared' | 'elsewhere'

interface PositionMarks {
  ahead: Set<string>
  behind: Set<string>
  mergeBase: string | null
  /** Loaded commits reachable from the merge base, so already on both branches. */
  shared: Set<string>
  loadedAhead: number
  loadedBehind: number
  mergeBaseLoaded: boolean
}

/** Same colours the Compare tab uses for the head and base sides. */
const MARK_COLOR = { ahead: 'var(--lane-1)', behind: 'var(--lane-2)' } as const

function positionMarks(position: BranchPosition, commits: Commit[]): PositionMarks {
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const shared = new Set<string>()
  const stack = position.mergeBase ? [position.mergeBase] : []
  while (stack.length) {
    const sha = stack.pop()!
    const commit = bySha.get(sha)
    if (!commit || shared.has(sha)) continue
    shared.add(sha)
    stack.push(...commit.parents)
  }
  return {
    ahead: new Set(position.aheadShas),
    behind: new Set(position.behindShas),
    mergeBase: position.mergeBase,
    shared,
    loadedAhead: position.aheadShas.filter((sha) => bySha.has(sha)).length,
    loadedBehind: position.behindShas.filter((sha) => bySha.has(sha)).length,
    mergeBaseLoaded: position.mergeBase ? bySha.has(position.mergeBase) : false,
  }
}

function markFor(sha: string, marks: PositionMarks): PositionMark {
  if (marks.ahead.has(sha)) return 'ahead'
  if (marks.behind.has(sha)) return 'behind'
  if (sha === marks.mergeBase) return 'split'
  if (marks.shared.has(sha)) return 'shared'
  return 'elsewhere'
}

/** Words carry the meaning; the coloured arrow only ties the row to its side. */
function PositionPill({ mark }: { mark: PositionMark | null }) {
  const base = 'inline-flex w-[5.25rem] shrink-0 items-center gap-1 text-[11px] leading-4 font-medium'
  if (mark === 'ahead' || mark === 'behind') {
    const Icon = mark === 'ahead' ? ArrowUp : ArrowDown
    return (
      <span className={cn(base, 'text-fg')}>
        <Icon className="size-3.5 shrink-0" style={{ color: MARK_COLOR[mark] }} aria-hidden />
        {mark}
      </span>
    )
  }
  if (mark === 'split') {
    return (
      <span className={cn(base, 'text-fg-2')}>
        <GitFork className="size-3.5 shrink-0" aria-hidden />
        split point
      </span>
    )
  }
  return <span className={base} aria-hidden />
}

function PositionSummary({ position, marks, onJump }: { position: BranchPosition; marks: PositionMarks; onJump: (sha: string) => void }) {
  const missing = position.ahead - marks.loadedAhead + (position.behind - marks.loadedBehind)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="size-4" style={{ color: MARK_COLOR.ahead }} aria-hidden />
        <strong className="tabular">{formatNumber(position.ahead)}</strong> ahead
        <span className="text-fg-3">: on {position.head}, not on {position.base}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowDown className="size-4" style={{ color: MARK_COLOR.behind }} aria-hidden />
        <strong className="tabular">{formatNumber(position.behind)}</strong> behind
        <span className="text-fg-3">: on {position.base}, not on {position.head}</span>
      </span>
      {position.mergeBase &&
        (marks.mergeBaseLoaded ? (
          <button onClick={() => onJump(position.mergeBase!)} className="inline-flex items-center gap-1 text-accent hover:underline">
            <GitFork className="size-3.5" aria-hidden /> Jump to split point <Sha sha={position.mergeBase} className="text-accent" />
          </button>
        ) : (
          <span className="text-fg-3">
            Split point <Sha sha={position.mergeBase} /> is older than the loaded commits
          </span>
        ))}
      {missing > 0 && <span className="text-xs text-fg-3">{plural(missing, 'marked commit')} not in the loaded history; load more above.</span>}
    </div>
  )
}

function CommitDetails({ commit, onSelectSha }: { commit: Commit; onSelectSha: (sha: string) => void }) {
  return (
    <Card title="Commit" bodyClassName="space-y-3 text-sm">
      <p className="font-medium break-words">{commit.subject}</p>
      {commit.refs.length > 0 && (
        <div className="flex flex-wrap gap-1">{commit.refs.map((r) => <RefBadge key={`${r.kind}:${r.name}`} refName={r} />)}</div>
      )}
      <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1.5 text-xs">
        <dt className="text-fg-3">SHA</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <code className="truncate font-mono">{commit.sha}</code>
          <button className="shrink-0 rounded p-0.5 text-fg-3 hover:text-fg" onClick={() => navigator.clipboard?.writeText(commit.sha)} aria-label="Copy SHA" title="Copy SHA">
            <Copy className="size-3.5" />
          </button>
        </dd>
        <dt className="text-fg-3">Author</dt>
        <dd className="min-w-0 break-words">{commit.author}{commit.email && <span className="text-fg-3"> &lt;{commit.email}&gt;</span>}</dd>
        <dt className="text-fg-3">Date</dt>
        <dd>{formatDateTime(commit.date)}</dd>
        <dt className="text-fg-3">{commit.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
        <dd className="flex flex-wrap gap-2">
          {commit.parents.length === 0 ? <span className="text-fg-3">Root commit</span> : commit.parents.map((p) => (
            <button key={p} onClick={() => onSelectSha(p)} className="font-mono text-accent hover:underline" title={p}>{p.slice(0, 7)}</button>
          ))}
        </dd>
      </dl>
    </Card>
  )
}

export function GraphTab({ repo }: { repo: RepoConfig }) {
  const [limit, setLimit] = useState(300)
  const [scope, setScope] = useState<GraphScope>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const graph = useGraph(repo.id, limit, scope)
  const branches = useBranches(repo.id)

  // Which branch is measured against which, kept in the URL like the Compare tab.
  const [params, setParams] = useSearchParams()
  const branchList = branches.data?.branches ?? []
  const defaultBase = branches.data?.defaultBranch ?? ''
  const base = params.get('base') ?? defaultBase
  const head =
    params.get('head') ??
    branchList.find((b) => b.isCurrent && b.name !== defaultBase)?.name ??
    branchList.find((b) => b.name !== defaultBase)?.name ??
    ''
  const showPosition = params.get('position') !== 'off'
  const setPositionParams = (next: { base?: string; head?: string; position?: 'on' | 'off' }) => {
    const merged = { base: next.base ?? base, head: next.head ?? head, position: next.position ?? (showPosition ? 'on' : 'off') }
    setParams(merged, { replace: true })
  }
  const position = usePosition(repo.id, base || null, head || null, showPosition)

  const layout = useMemo(() => layoutGraph(graph.data ?? []), [graph.data])
  const widths = useMemo(() => gutterWidths(layout.rows), [layout.rows])
  const selectedCommit = graph.data?.find((c) => c.sha === selected) ?? null
  const marks = useMemo(
    () => (showPosition && position.data && graph.data ? positionMarks(position.data, graph.data) : null),
    [showPosition, position.data, graph.data],
  )

  const selectSha = (sha: string) => {
    setSelected(sha)
    document.getElementById(`commit-${sha}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Commits to load"
          value={limit}
          onChange={setLimit}
          options={[200, 300, 600, 1200].map((n) => ({ value: n, label: `${n}` }))}
        />
        {repo.source === 'local' ? (
          <Segmented
            label="Branches to include"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Local + remote' },
              { value: 'local', label: 'Local only' },
            ]}
          />
        ) : (
          <span className="text-xs text-fg-3">GitHub: default branch plus the 9 most recently updated branches, up to 100 commits each.</span>
        )}
        {graph.isFetching && !graph.isPending && <span className="text-xs text-fg-3">Updating…</span>}
      </div>

      {branchList.length > 1 && (
        <Card bodyClassName="flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
          <label className="flex items-center gap-2 self-center text-sm font-medium">
            <input
              type="checkbox"
              checked={showPosition}
              onChange={(e) => setPositionParams({ position: e.target.checked ? 'on' : 'off' })}
              className="size-4 accent-[var(--accent)]"
            />
            Show ahead / behind
          </label>
          <BranchSelect label="Branch" value={head} branches={branchList} onChange={(value) => setPositionParams({ head: value })} />
          <span className="pb-2 text-sm text-fg-3">compared with</span>
          <BranchSelect label="Base" value={base} branches={branchList} onChange={(value) => setPositionParams({ base: value })} />
          {showPosition && (
            <div className="min-w-0 basis-full text-sm">
              {base === head ? (
                <span className="text-fg-3">Pick two different branches.</span>
              ) : position.isError ? (
                <ErrorBox error={position.error} />
              ) : !position.data || !marks ? (
                <span className="text-fg-3">Working out positions…</span>
              ) : (
                <PositionSummary position={position.data} marks={marks} onJump={selectSha} />
              )}
            </div>
          )}
        </Card>
      )}

      {graph.isPending ? (
        <Spinner label="Reading history…" />
      ) : graph.isError ? (
        <ErrorBox error={graph.error} />
      ) : graph.data.length === 0 ? (
        <Empty>No commits yet.</Empty>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card bodyClassName="p-0 overflow-x-auto" className={cn(graph.isFetching && 'opacity-70')}>
            <div className="min-w-[40rem] py-1" role="list" aria-label="Commit history">
              {layout.rows.map((row, index) => {
                const { commit } = row
                const isSelected = commit.sha === selected
                const mark = marks ? markFor(commit.sha, marks) : null
                return (
                  <div
                    key={commit.sha}
                    id={`commit-${commit.sha}`}
                    role="listitem"
                    onClick={() => setSelected(isSelected ? null : commit.sha)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 pr-4 pl-2 text-sm',
                      isSelected ? 'bg-accent-soft' : 'hover:bg-surface-2',
                      mark === 'elsewhere' && !isSelected && 'opacity-40 hover:opacity-100',
                    )}
                    style={{
                      height: ROW_HEIGHT,
                      boxShadow: mark === 'ahead' || mark === 'behind' ? `inset 3px 0 0 ${MARK_COLOR[mark]}` : undefined,
                    }}
                  >
                    {marks && <PositionPill mark={mark} />}
                    <GraphCell row={row} width={widths[index]} />
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      {commit.refs.slice(0, MAX_INLINE_REFS).map((r) => <RefBadge key={`${r.kind}:${r.name}`} refName={r} />)}
                      {commit.refs.length > MAX_INLINE_REFS && (
                        <span
                          className="shrink-0 rounded border border-line-strong px-1 py-px text-[11px] leading-4 text-fg-2"
                          title={commit.refs.slice(MAX_INLINE_REFS).map((r) => r.name).join(', ')}
                        >
                          +{commit.refs.length - MAX_INLINE_REFS}
                        </span>
                      )}
                      {commit.parents.length > 1 && <GitMerge className="size-3.5 shrink-0 text-fg-3" aria-label="Merge commit" />}
                      <span className={cn('min-w-24 flex-1 truncate', commit.parents.length > 1 && 'text-fg-2')} title={commit.subject}>{commit.subject}</span>
                    </div>
                    <span className="hidden w-32 shrink-0 truncate text-xs text-fg-2 md:block" title={commit.email ?? undefined}>{commit.author}</span>
                    <span className="w-24 shrink-0 text-right text-xs text-fg-3" title={formatDateTime(commit.date)}>{timeAgo(commit.date)}</span>
                    <Sha sha={commit.sha} className="w-14 shrink-0 text-right" />
                  </div>
                )
              })}
            </div>
            {layout.laneCount > MAX_VISIBLE_LANES && (
              <p className="border-t border-line px-4 py-2 text-xs text-fg-3">
                The graph is {layout.laneCount} lanes wide at its widest; lanes past {MAX_VISIBLE_LANES} are hidden.
              </p>
            )}
          </Card>
          <div className="order-first xl:sticky xl:top-4 xl:order-none">
            {selectedCommit ? (
              <CommitDetails commit={selectedCommit} onSelectSha={selectSha} />
            ) : (
              <Card title="Commit"><p className="text-sm text-fg-3">Click a commit to see its details.</p></Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
