import { ArrowLeftRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import type { Commit, Comparison, FileChange, RepoConfig } from '../../../shared/types'
import { useBranches, useCompare } from '../api'
import { BranchSelect } from '../components/BranchSelect'
import { Button, Card, cn, Empty, ErrorBox, Sha, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'

const HEAD_COLOR = 'var(--lane-1)'
const BASE_COLOR = 'var(--lane-2)'

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Two lines leaving the merge base: head's commits on top, base's below, one dot per
 * commit (thinned out when there are more than fit). Names and counts sit in text beside
 * a colour swatch, so the picture never relies on colour alone.
 */
function DivergenceDiagram({ comparison }: { comparison: Comparison }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const height = 92
  const headY = 18
  const baseY = height - 18
  const midY = height / 2
  const forkX = 28
  const trackStart = forkX + 48
  const trackEnd = Math.max(trackStart + 40, width - 12)
  const maxDots = Math.max(1, Math.floor((trackEnd - trackStart) / 16))

  const dots = (count: number) => {
    const shown = Math.min(count, maxDots)
    if (shown === 0) return []
    if (shown === 1) return [trackEnd]
    return Array.from({ length: shown }, (_, i) => trackStart + ((trackEnd - trackStart) * i) / (shown - 1))
  }

  const lane = (y: number, count: number, color: string) => (
    <g>
      <path
        d={`M${forkX} ${midY}C${forkX + 24} ${midY} ${forkX + 20} ${y} ${trackStart - 8} ${y}H${count ? trackEnd : trackStart}`}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeDasharray={count ? undefined : '4 4'}
      />
      {dots(count).map((cx, i, all) => (
        <circle key={i} cx={cx} cy={y} r={i === all.length - 1 ? 6 : 4} fill={color} stroke="var(--surface)" strokeWidth={2} />
      ))}
    </g>
  )

  const legend = (name: string, count: number, other: string, color: string) => (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="truncate font-medium" title={name}>{name}</span>
      <span className="text-fg-2">
        {count === 0 ? `nothing that ${other} doesn't have` : `${plural(count, 'commit')} not on ${other}`}
      </span>
    </div>
  )

  return (
    <figure className="m-0 space-y-1">
      {legend(comparison.head, comparison.ahead, comparison.base, HEAD_COLOR)}
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label={`${comparison.head} is ${comparison.ahead} ahead and ${comparison.behind} behind ${comparison.base}`}>
            <path d={`M0 ${midY}H${forkX}`} stroke="var(--line-strong)" strokeWidth={2} />
            {lane(headY, comparison.ahead, HEAD_COLOR)}
            {lane(baseY, comparison.behind, BASE_COLOR)}
            <circle cx={forkX} cy={midY} r={5} fill="var(--surface)" stroke="var(--fg-3)" strokeWidth={2} />
          </svg>
        )}
      </div>
      {legend(comparison.base, comparison.behind, comparison.head, BASE_COLOR)}
    </figure>
  )
}

function CommitList({ title, commits, total, color }: { title: string; commits: Commit[]; total: number; color: string }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate">{title}</span>
        </span>
      }
      subtitle={commits.length < total ? `Latest ${formatNumber(commits.length)} of ${formatNumber(total)}` : plural(total, 'commit')}
      bodyClassName="p-0"
    >
      {commits.length === 0 ? (
        <Empty>No commits</Empty>
      ) : (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {commits.map((c) => (
            <li key={c.sha} className="flex min-w-0 items-baseline gap-2 px-4 py-2 text-sm">
              <Sha sha={c.sha} />
              <div className="min-w-0 flex-1">
                <div className="truncate" title={c.subject}>{c.subject}</div>
                <div className="truncate text-xs text-fg-3">
                  {c.author} · <span title={formatDateTime(c.date)}>{timeAgo(c.date)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const STATUS_LABEL: Record<FileChange['status'], { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-add border-add/40' },
  modified: { letter: 'M', className: 'text-fg-2 border-line-strong' },
  deleted: { letter: 'D', className: 'text-del border-del/40' },
  renamed: { letter: 'R', className: 'text-accent border-accent/40' },
  copied: { letter: 'C', className: 'text-accent border-accent/40' },
  other: { letter: '?', className: 'text-fg-3 border-line' },
}

/** GitHub-style five blocks: the share of added vs deleted lines in this file. */
function ChangeBlocks({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  const added = total ? Math.round((additions / total) * 5) : 0
  const deleted = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0
  return (
    <span className="flex gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn('size-2 rounded-[2px]', i < added ? 'bg-add' : i < added + deleted ? 'bg-del' : 'bg-surface-2')} />
      ))}
    </span>
  )
}

function FileList({ comparison }: { comparison: Comparison }) {
  const [filter, setFilter] = useState('')
  const term = filter.trim().toLowerCase()
  const files = term ? comparison.files.filter((f) => f.path.toLowerCase().includes(term)) : comparison.files
  const additions = comparison.files.reduce((sum, f) => sum + (f.additions ?? 0), 0)
  const deletions = comparison.files.reduce((sum, f) => sum + (f.deletions ?? 0), 0)

  return (
    <Card
      title={`${plural(comparison.files.length, 'file')} changed${comparison.filesTruncated ? ' (list truncated)' : ''}`}
      subtitle={
        <span className="tabular">
          <span className="text-add">+{formatNumber(additions)}</span> <span className="text-del">−{formatNumber(deletions)}</span> on {comparison.head} since the merge base
        </span>
      }
      action={
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          className="h-8 w-48 rounded-md border border-line bg-surface px-2 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
      }
      bodyClassName="p-0"
    >
      {files.length === 0 ? (
        <Empty>{comparison.files.length ? 'No files match.' : 'No file changes.'}</Empty>
      ) : (
        <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
          {files.map((f) => {
            const status = STATUS_LABEL[f.status]
            return (
              <li key={`${f.oldPath}:${f.path}`} className="flex min-w-0 items-center gap-3 px-4 py-1.5 text-sm">
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border font-mono text-[11px] font-semibold', status.className)} title={f.status}>
                  {status.letter}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                  {f.oldPath && <span className="text-fg-3">{f.oldPath} → </span>}
                  {f.path}
                </span>
                {f.additions === null ? (
                  <span className="text-xs text-fg-3">binary</span>
                ) : (
                  <>
                    <span className="tabular w-24 shrink-0 text-right text-xs">
                      <span className="text-add">+{formatNumber(f.additions)}</span>{' '}
                      <span className="text-del">−{formatNumber(f.deletions ?? 0)}</span>
                    </span>
                    <ChangeBlocks additions={f.additions} deletions={f.deletions ?? 0} />
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export function CompareTab({ repo }: { repo: RepoConfig }) {
  const branches = useBranches(repo.id)
  const [params, setParams] = useSearchParams()

  const list = branches.data?.branches ?? []
  const defaultBase = branches.data?.defaultBranch ?? list[0]?.name ?? ''
  const defaultHead =
    list.find((b) => b.isCurrent && b.name !== defaultBase)?.name ?? list.find((b) => b.name !== defaultBase)?.name ?? ''
  const base = params.get('base') ?? defaultBase
  const head = params.get('head') ?? defaultHead

  // Put the defaults into the URL once they're known, so the view is linkable as-is.
  useEffect(() => {
    if (branches.data && (!params.get('base') || !params.get('head')) && base && head) {
      setParams({ base, head }, { replace: true })
    }
  }, [branches.data, params, base, head, setParams])

  const comparison = useCompare(repo.id, base || null, head || null)

  if (branches.isPending) return <Spinner label="Reading branches…" />
  if (branches.isError) return <ErrorBox error={branches.error} />
  if (list.length < 2) return <Empty>This repo needs at least two branches to compare.</Empty>

  const set = (next: { base?: string; head?: string }) => setParams({ base: next.base ?? base, head: next.head ?? head })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <BranchSelect label="Base" value={base} branches={list} onChange={(value) => set({ base: value })} />
        <Button variant="ghost" size="icon" className="mb-0.5" onClick={() => set({ base: head, head: base })} aria-label="Swap base and head" title="Swap">
          <ArrowLeftRight className="size-4" />
        </Button>
        <BranchSelect label="Head" value={head} branches={list} onChange={(value) => set({ head: value })} />
      </div>

      {base === head ? (
        <Empty>Pick two different branches.</Empty>
      ) : comparison.isPending ? (
        <Spinner label="Comparing…" />
      ) : comparison.isError ? (
        <ErrorBox error={comparison.error} />
      ) : (
        <div className={cn('space-y-4', comparison.isFetching && 'opacity-70')}>
          <Card
            title={
              comparison.data.ahead === 0 && comparison.data.behind === 0
                ? 'These branches point at the same history'
                : `${comparison.data.head} is ${plural(comparison.data.ahead, 'commit')} ahead and ${plural(comparison.data.behind, 'commit')} behind ${comparison.data.base}`
            }
            subtitle={
              comparison.data.mergeBase ? (
                <span>Split from each other at <Sha sha={comparison.data.mergeBase} /></span>
              ) : (
                'No common history'
              )
            }
          >
            <DivergenceDiagram comparison={comparison.data} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <CommitList title={`Only on ${comparison.data.head}`} commits={comparison.data.headOnly} total={comparison.data.ahead} color={HEAD_COLOR} />
            <CommitList title={`Only on ${comparison.data.base}`} commits={comparison.data.baseOnly} total={comparison.data.behind} color={BASE_COLOR} />
          </div>

          <FileList comparison={comparison.data} />
        </div>
      )}
    </div>
  )
}
