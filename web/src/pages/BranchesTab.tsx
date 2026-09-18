import { ArrowDown, ArrowUp, GitCompareArrows, Search, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import type { Branch, RepoConfig } from '../../../shared/types'
import { useBranches } from '../api'
import { Card, cn, Empty, ErrorBox, Segmented, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'

type KindFilter = 'all' | 'local' | 'remote'
type SortBy = 'updated' | 'name' | 'ahead' | 'behind'

/**
 * Behind grows left from the centre line, ahead grows right. Square-root scaling keeps a
 * branch that is 3 ahead visible next to one that is 400 behind.
 */
function Divergence({ value, max, defaultBranch }: { value: Branch['vsDefault']; max: number; defaultBranch: string }) {
  if (!value) return <span className="text-fg-3">—</span>
  const width = (n: number) => (n ? `${Math.max(6, (Math.sqrt(n) / Math.sqrt(max)) * 100)}%` : '0')
  return (
    <div
      className="grid grid-cols-[2.5rem_3.5rem_3.5rem_2.5rem] items-center gap-1 text-xs"
      title={`${plural(value.ahead, 'commit')} ahead of and ${plural(value.behind, 'commit')} behind ${defaultBranch}`}
    >
      <span className="tabular text-right text-fg-2">{value.behind ? `−${formatNumber(value.behind)}` : ''}</span>
      <span className="flex h-2 justify-end border-r border-line-strong">
        <span className="h-full rounded-l-[3px] bg-fg-3" style={{ width: width(value.behind) }} />
      </span>
      <span className="flex h-2">
        <span className="h-full rounded-r-[3px] bg-accent" style={{ width: width(value.ahead) }} />
      </span>
      <span className="tabular text-fg-2">{value.ahead ? `+${formatNumber(value.ahead)}` : ''}</span>
    </div>
  )
}

function Upstream({ branch }: { branch: Branch }) {
  if (branch.kind === 'remote') return <span className="text-fg-3">—</span>
  if (!branch.upstream) return <span className="text-xs text-fg-3">Not tracked</span>
  if (branch.upstreamGone) {
    return <span className="rounded border border-warn/50 bg-warn-soft px-1.5 py-px text-xs text-warn">Upstream gone</span>
  }
  const synced = !branch.upstreamAhead && !branch.upstreamBehind
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <span className="truncate text-fg-2">{branch.upstream}</span>
      {synced ? (
        <span className="whitespace-nowrap text-fg-3">in sync</span>
      ) : (
        <span className="tabular flex shrink-0 gap-1.5 text-fg" aria-label={`${branch.upstreamAhead} to push, ${branch.upstreamBehind} to pull`}>
          {!!branch.upstreamAhead && <span className="flex items-center" title="Commits to push"><ArrowUp className="size-3" />{branch.upstreamAhead}</span>}
          {!!branch.upstreamBehind && <span className="flex items-center" title="Commits to pull"><ArrowDown className="size-3" />{branch.upstreamBehind}</span>}
        </span>
      )}
    </span>
  )
}

export function BranchesTab({ repo }: { repo: RepoConfig }) {
  const branches = useBranches(repo.id)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('updated')

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = (branches.data?.branches ?? []).filter(
      (b) => (kind === 'all' || b.kind === kind) && (!term || b.name.toLowerCase().includes(term) || b.author?.toLowerCase().includes(term)),
    )
    const sorters: Record<SortBy, (a: Branch, b: Branch) => number> = {
      updated: (a, b) => (b.date ?? '').localeCompare(a.date ?? ''),
      name: (a, b) => a.name.localeCompare(b.name),
      ahead: (a, b) => (b.vsDefault?.ahead ?? -1) - (a.vsDefault?.ahead ?? -1),
      behind: (a, b) => (b.vsDefault?.behind ?? -1) - (a.vsDefault?.behind ?? -1),
    }
    return [...list].sort(sorters[sortBy])
  }, [branches.data, search, kind, sortBy])

  if (branches.isPending) return <Spinner label="Reading branches…" />
  if (branches.isError) return <ErrorBox error={branches.error} />

  const { defaultBranch } = branches.data
  const maxDivergence = Math.max(1, ...visible.flatMap((b) => (b.vsDefault ? [b.vsDefault.ahead, b.vsDefault.behind] : [])))
  const hasDivergence = visible.some((b) => b.vsDefault)

  return (
    <Card
      title={plural(visible.length, 'branch', 'branches')}
      subtitle={
        hasDivergence && defaultBranch ? (
          <span className="inline-flex flex-wrap items-center gap-x-3">
            <span>Compared with {defaultBranch}:</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-[2px] bg-fg-3" />commits behind</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-[2px] bg-accent" />commits ahead</span>
          </span>
        ) : undefined
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute top-2 left-2 size-4 text-fg-3" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter branches"
              aria-label="Filter branches"
              className="h-8 w-44 rounded-md border border-line bg-surface pr-2 pl-8 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
            />
          </label>
          {repo.source === 'local' && (
            <Segmented
              label="Branch kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'local', label: 'Local' },
                { value: 'remote', label: 'Remote' },
              ]}
            />
          )}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort branches"
            className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
            <option value="ahead">Most ahead</option>
            <option value="behind">Most behind</option>
          </select>
        </div>
      }
      bodyClassName="p-0 overflow-x-auto"
    >
      {visible.length === 0 ? (
        <Empty>No branches match.</Empty>
      ) : (
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium">Last commit</th>
              <th className="px-3 py-2 font-medium">vs {defaultBranch ?? 'default'}</th>
              {repo.source === 'local' && <th className="px-3 py-2 font-medium">Upstream</th>}
              <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((b) => (
              <tr key={`${b.kind}:${b.name}`} className={cn('border-b border-line last:border-0 hover:bg-surface-2', b.isCurrent && 'bg-accent-soft/50')}>
                <td className="px-4 py-2">
                  <div className="flex max-w-56 min-w-0 items-center gap-1.5">
                    {b.isCurrent && <span className="size-2 shrink-0 rounded-full bg-accent" title="Checked out" />}
                    <span className={cn('truncate', b.kind === 'local' ? 'font-medium' : 'text-fg-2')} title={b.name}>{b.name}</span>
                    {b.isDefault && <Star className="size-3.5 shrink-0 fill-warn text-warn" aria-label="Default branch" />}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="max-w-64 truncate text-fg-2" title={[b.subject, formatDateTime(b.date)].filter(Boolean).join(' · ')}>{b.subject ?? <code className="font-mono text-xs">{b.sha.slice(0, 7)}</code>}</div>
                  <div className="max-w-64 truncate text-xs text-fg-3">
                    {[b.author, b.date && timeAgo(b.date)].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {b.isDefault ? <span className="text-xs text-fg-3">default</span> : <Divergence value={b.vsDefault} max={maxDivergence} defaultBranch={defaultBranch ?? 'default'} />}
                </td>
                {repo.source === 'local' && <td className="px-3 py-2"><div className="max-w-48"><Upstream branch={b} /></div></td>}
                <td className="px-4 py-2 text-right">
                  {defaultBranch && !b.isDefault && (
                    <Link
                      to={`/r/${repo.id}/compare?base=${encodeURIComponent(defaultBranch)}&head=${encodeURIComponent(b.name)}`}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent-soft"
                    >
                      <GitCompareArrows className="size-3.5" aria-hidden /> Compare
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
