import { ArrowDown, ArrowUp, GitCompareArrows } from 'lucide-react'
import { Link } from 'react-router'

import type { BranchOverview } from '../../../shared/types'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'
import { ActivityChart } from './ActivityChart'
import { Card, cn, Empty, Sha, Stat } from './ui'

/** The repo overview, asked of one branch instead of the whole clone. */
export function BranchOverviewPanel({ repoId, data }: { repoId: string; data: BranchOverview }) {
  const totalActivity = data.activity.reduce((sum, week) => sum + week.commits, 0)
  const busiest = Math.max(1, ...data.contributors.map((person) => person.commits))
  const isDefault = data.name === data.defaultBranch

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Tip of this branch" bodyClassName="space-y-2 text-sm">
          {data.tip ? (
            <>
              <div className="flex min-w-0 items-baseline gap-2">
                <Sha sha={data.tip.sha} />
                <span className="truncate">{data.tip.subject}</span>
              </div>
              <div className="text-xs text-fg-3">
                {data.tip.author} · <span title={formatDateTime(data.tip.date)}>{timeAgo(data.tip.date)}</span>
              </div>
            </>
          ) : (
            <Empty>No commits on this branch.</Empty>
          )}
          {data.upstream && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-xs">
              <span className="text-fg-3">Tracking</span>
              <span className="font-mono">{data.upstream}</span>
              {!data.upstreamAhead && !data.upstreamBehind ? (
                <span className="text-add">in sync</span>
              ) : (
                <span className="tabular flex items-center gap-2">
                  {!!data.upstreamAhead && (
                    <span className="flex items-center" title="Commits to push">
                      <ArrowUp className="size-3" />
                      {data.upstreamAhead}
                    </span>
                  )}
                  {!!data.upstreamBehind && (
                    <span className="flex items-center" title="Commits to pull">
                      <ArrowDown className="size-3" />
                      {data.upstreamBehind}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </Card>

        <Card
          title={isDefault ? 'This is the default branch' : `Compared with ${data.defaultBranch ?? 'the default branch'}`}
          action={
            !isDefault && data.defaultBranch ? (
              <Link
                to={`/r/${repoId}/compare?base=${encodeURIComponent(data.defaultBranch)}&head=${encodeURIComponent(data.name)}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <GitCompareArrows className="size-3.5" aria-hidden /> Full comparison
              </Link>
            ) : undefined
          }
          bodyClassName="text-sm"
        >
          {isDefault || !data.vsDefault ? (
            <p className="text-fg-3">Everything else in this repository is measured against it.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="tabular text-2xl font-bold text-add">+{formatNumber(data.vsDefault.ahead)}</div>
                <div className="mt-0.5 text-xs text-fg-3">commits it has</div>
              </div>
              <div>
                <div className="tabular text-2xl font-bold text-fg-2">
                  −{formatNumber(data.vsDefault.behind)}
                </div>
                <div className="mt-0.5 text-xs text-fg-3">commits it misses</div>
              </div>
              <div>
                <div className="tabular text-2xl font-bold">
                  {data.filesChanged === null ? '—' : formatNumber(data.filesChanged)}
                </div>
                <div className="mt-0.5 text-xs text-fg-3">files differ</div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Commits" value={data.commits === null ? '—' : formatNumber(data.commits)} />
        <Stat label="Contributors" value={formatNumber(data.contributors.length)} />
        <Stat label="Last 52 weeks" value={formatNumber(totalActivity)} hint="commits on this branch" />
        <Stat
          label="Last change"
          value={data.tip ? timeAgo(data.tip.date) : '—'}
          hint={data.tip ? formatDateTime(data.tip.date) : undefined}
        />
      </div>

      <Card
        title="Commits per week"
        subtitle={data.activity.length ? `${plural(totalActivity, 'commit')} on this branch` : undefined}
      >
        {data.activity.length ? (
          <ActivityChart weeks={data.activity} />
        ) : (
          <Empty>Not available for this source.</Empty>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Who works on it" subtitle="Commits reachable from this branch">
          {data.contributors.length === 0 ? (
            <Empty>No commits yet</Empty>
          ) : (
            <ul className="space-y-2">
              {data.contributors.slice(0, 8).map((person) => (
                <li
                  key={`${person.name}-${person.email}`}
                  className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 text-sm"
                >
                  <span className="truncate" title={person.email ?? person.name}>
                    {person.name}
                  </span>
                  <span className="h-1.5 rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${(person.commits / busiest) * 100}%` }}
                    />
                  </span>
                  <span className="tabular text-right text-xs text-fg-3">
                    {formatNumber(person.commits)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Latest commits" bodyClassName="p-0">
          {data.recent.length === 0 ? (
            <Empty>Nothing yet</Empty>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {data.recent.slice(0, 15).map((commit) => (
                <li key={commit.sha} className="flex min-w-0 items-baseline gap-2 px-5 py-2 text-sm">
                  <Sha sha={commit.sha} />
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate', commit.parents.length > 1 && 'text-fg-3')}>
                      {commit.subject}
                    </div>
                    <div className="truncate text-xs text-fg-3">
                      {commit.author} · <span title={formatDateTime(commit.date)}>{timeAgo(commit.date)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
