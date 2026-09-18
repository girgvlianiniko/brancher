import { Link } from 'react-router'

import type { RepoConfig, WorkingTreeStatus } from '../../../shared/types'
import { useOverview } from '../api'
import { ActivityChart } from '../components/ActivityChart'
import { Card, Empty, ErrorBox, Sha, Spinner, Stat } from '../components/ui'
import { formatNumber, plural, timeAgo } from '../lib/format'

function workingTree(status: WorkingTreeStatus) {
  const parts = [
    status.conflicted && `${status.conflicted} conflicted`,
    status.staged && `${status.staged} staged`,
    status.modified && `${status.modified} modified`,
    status.untracked && `${status.untracked} untracked`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function OverviewTab({ repo }: { repo: RepoConfig }) {
  const overview = useOverview(repo.id)
  if (overview.isPending) return <Spinner label="Reading repo…" />
  if (overview.isError) return <ErrorBox error={overview.error} />
  const data = overview.data

  const count = (value: number, capped?: boolean) => `${formatNumber(value)}${capped ? '+' : ''}`
  const changes = data.status ? workingTree(data.status) : null
  const totalActivity = data.activity.reduce((sum, w) => sum + w.commits, 0)
  const maxContributor = Math.max(1, ...data.contributors.map((c) => c.commits))

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Checked out" bodyClassName="space-y-1.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{data.currentBranch ?? 'Detached HEAD'}</span>
            {data.defaultBranch && data.currentBranch !== data.defaultBranch && (
              <Link
                to={`/r/${repo.id}/compare?base=${encodeURIComponent(data.defaultBranch)}&head=${encodeURIComponent(data.currentBranch ?? 'HEAD')}`}
                className="text-xs text-accent hover:underline"
              >
                Compare with {data.defaultBranch} →
              </Link>
            )}
          </div>
          {data.head && (
            <div className="flex min-w-0 items-baseline gap-2 text-fg-2">
              <Sha sha={data.head.sha} />
              <span className="truncate">{data.head.subject}</span>
              <span className="shrink-0 text-xs text-fg-3">{timeAgo(data.head.date)}</span>
            </div>
          )}
          <div className="text-xs text-fg-3">Default branch: {data.defaultBranch ?? 'unknown'}</div>
        </Card>
        <Card title="Remotes" bodyClassName="space-y-1 text-sm">
          {data.remotes.length === 0 ? (
            <span className="text-fg-3">No remotes configured</span>
          ) : (
            data.remotes.map((r) => (
              <div key={r.name} className="flex min-w-0 gap-2">
                <span className="shrink-0 font-medium">{r.name}</span>
                <span className="truncate text-fg-2" title={r.url}>{r.url}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={repo.source === 'github' ? 'Branches' : 'Local branches'} value={count(data.counts.localBranches, data.capped.branches)} />
        {repo.source === 'local' && <Stat label="Remote branches" value={count(data.counts.remoteBranches)} />}
        <Stat label="Tags" value={count(data.counts.tags, data.capped.tags)} />
        <Stat label="Commits on HEAD" value={data.counts.commits === null ? '—' : count(data.counts.commits)} hint={data.counts.commits === null ? 'Not available from GitHub' : undefined} />
        <Stat label="Contributors" value={count(data.counts.contributors, data.capped.contributors)} />
        {data.status && (
          <Stat label="Working tree" value={changes ? 'Changes' : 'Clean'} hint={changes ?? 'Nothing to commit'} />
        )}
      </div>

      <Card
        title="Commits per week"
        subtitle={data.activity.length ? `${plural(totalActivity, 'commit')} across all branches in the last 52 weeks` : undefined}
      >
        {data.activity.length ? (
          <ActivityChart weeks={data.activity} />
        ) : (
          <Empty>GitHub is still computing the statistics for this repo. Refresh in a minute.</Empty>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Top contributors" subtitle={repo.source === 'local' ? 'Commits reachable from HEAD' : 'Commits on the default branch'}>
          {data.contributors.length === 0 ? (
            <Empty>No commits yet</Empty>
          ) : (
            <ul className="space-y-2">
              {data.contributors.slice(0, 10).map((c) => (
                <li key={`${c.name}-${c.email}`} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3 text-sm">
                  <span className="truncate" title={c.email ?? c.name}>{c.name}</span>
                  <span className="h-2 rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(c.commits / maxContributor) * 100}%` }} />
                  </span>
                  <span className="tabular text-right text-fg-2">{formatNumber(c.commits)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent tags">
          {data.tags.length === 0 ? (
            <Empty>No tags</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {data.tags.map((t) => (
                <li key={t.name} className="flex min-w-0 items-baseline gap-2 py-1.5">
                  <span className="shrink-0 font-medium">{t.name}</span>
                  <Sha sha={t.sha} />
                  <span className="truncate text-fg-3">{t.subject}</span>
                  {t.date && <span className="ml-auto shrink-0 text-xs text-fg-3">{timeAgo(t.date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
