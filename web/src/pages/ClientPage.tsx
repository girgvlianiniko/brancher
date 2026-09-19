import { ArrowLeft, ArrowRight, GitCompareArrows, Settings2 } from 'lucide-react'
import { Link, useParams } from 'react-router'

import type { CellStatus, DeployTrigger, LagEdge, ProbeSample, ServiceState } from '../../../shared/status'
import { useClientDetail } from '../api'
import { Cell, SERVICE_TAG, StatusDot } from '../components/StatusBits'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'

/** One box on a promotion rail: an environment, and the branch that lands there. */
function RailBox({ env, branch, trigger }: { env: string; branch: string; trigger: DeployTrigger | null }) {
  return (
    <div className="w-44 shrink-0 rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-[11px] tracking-wide text-fg-3 uppercase">{env}</div>
      <div className="truncate font-mono text-xs text-fg" title={branch}>
        {branch || '—'}
      </div>
      {trigger && trigger.mode !== 'push' && (
        <div className="mt-1 text-[11px] text-warn" title={trigger.workflowFile || undefined}>
          {trigger.mode === 'manual' ? 'deploys by hand' : 'no deploy found'}
        </div>
      )}
    </div>
  )
}

function RailEdge({ edge, repoId }: { edge: LagEdge; repoId: string }) {
  if (edge.error) {
    return (
      <div className="flex min-w-36 flex-col items-center px-2 text-center">
        <ArrowRight className="size-4 text-fg-3" aria-hidden />
        <span className="text-[11px] text-fg-3">{edge.error}</span>
      </div>
    )
  }
  const waiting = edge.realCommits > 0
  return (
    <Link
      to={`/r/${repoId}/compare?base=${encodeURIComponent(edge.toRef || edge.toBranch)}&head=${encodeURIComponent(edge.fromRef || edge.fromBranch)}`}
      className="group flex min-w-36 flex-col items-center px-2 text-center"
      title="Open the full comparison"
    >
      <ArrowRight
        className={cn('size-4', edge.overThreshold ? 'text-warn' : waiting ? 'text-fg-2' : 'text-add')}
        aria-hidden
      />
      <span
        className={cn(
          'text-xs font-medium group-hover:underline',
          edge.overThreshold ? 'text-warn' : waiting ? 'text-fg' : 'text-fg-3',
        )}
      >
        {waiting ? `${plural(edge.realCommits, 'change')} waiting` : 'in step'}
      </span>
      {waiting && (
        <span className="text-[11px] text-fg-3">
          {plural(edge.filesChanged, 'file')}
          {edge.mergeCommits > 0 && ` · ${plural(edge.mergeCommits, 'merge')}`}
        </span>
      )}
      {edge.oldestWaitingAt && (
        <span className="text-[11px] text-fg-3">oldest {timeAgo(edge.oldestWaitingAt)}</span>
      )}
    </Link>
  )
}

/**
 * How code reaches this client, one repo at a time. Boxes are environments, arrows carry
 * what is waiting on that hop, and every arrow opens the real comparison.
 */
function PromotionRail({ repoId, repoName, cells }: { repoId: string; repoName: string; cells: CellStatus[] }) {
  const hops = cells.flatMap((cell) =>
    cell.lag.filter((edge) => edge.repoId === repoId).map((edge) => ({ cell, edge })),
  )
  if (hops.length === 0) return null

  // Follow the promotion links rather than sorting, so the rail reads in the order a
  // change actually travels however the environments are chained.
  const byFrom = new Map(hops.map((hop) => [hop.edge.fromEnv, hop]))
  const targets = new Set(hops.map((hop) => hop.edge.toEnv))
  const edges: typeof hops = []
  const seen = new Set<string>()
  let current: (typeof hops)[number] | undefined = hops.find((hop) => !targets.has(hop.edge.fromEnv)) ?? hops[0]
  while (current && !seen.has(current.edge.toEnv)) {
    seen.add(current.edge.toEnv)
    edges.push(current)
    current = byFrom.get(current.edge.toEnv)
  }

  const triggerFor = (cell: CellStatus, branch: string) =>
    cell.triggers.find((t) => t.repoId === repoId && t.branch === branch) ?? null
  const first = edges[0]

  return (
    <Card title={repoName} subtitle="Left to right is the way a change travels" bodyClassName="overflow-x-auto p-4">
      <div className="flex min-w-max items-stretch gap-1">
        <RailBox env={first.edge.fromEnv} branch={first.edge.fromBranch} trigger={null} />
        {edges.map(({ cell, edge }) => (
          <div key={`${edge.fromEnv}-${edge.toEnv}`} className="flex items-stretch gap-1">
            <div className="flex items-center">
              <RailEdge edge={edge} repoId={repoId} />
            </div>
            <RailBox env={cell.label} branch={edge.toBranch} trigger={triggerFor(cell, edge.toBranch)} />
          </div>
        ))}
      </div>
    </Card>
  )
}

/** The last day of probes, bucketed so a wide window still fits on one line. */
function HistoryStrip({ samples }: { samples: ProbeSample[] }) {
  if (samples.length === 0) return <span className="text-[11px] text-fg-3">no checks yet</span>
  const buckets = 48
  const size = Math.ceil(samples.length / buckets)
  const groups = Array.from({ length: Math.ceil(samples.length / size) }, (_, i) =>
    samples.slice(i * size, (i + 1) * size),
  )
  return (
    <span className="flex h-4 items-end gap-px" title={`${samples.length} checks in this window`}>
      {groups.map((group, i) => {
        const bad = group.some((sample) => !sample.ok)
        return (
          <span
            key={i}
            className={cn('h-full w-1 rounded-[1px]', bad ? 'bg-del' : 'bg-add/70')}
            title={`${group[0]?.at ? formatDateTime(group[0].at) : ''}${bad ? ' — failed' : ''}`}
          />
        )
      })}
    </span>
  )
}

function ServiceRow({ service, samples }: { service: ServiceState; samples: ProbeSample[] }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <StatusDot colour={service.status === 'up' ? 'green' : service.status === 'down' ? 'red' : 'grey'} />
      <span className="w-20 shrink-0 font-medium">{SERVICE_TAG[service.kind]}</span>
      <a
        href={service.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-xs text-fg-2 hover:text-accent hover:underline"
      >
        {service.url}
      </a>
      <span className="tabular w-16 shrink-0 text-right text-xs text-fg-3">
        {service.latencyMs === null ? '—' : `${formatNumber(service.latencyMs)} ms`}
      </span>
      <HistoryStrip samples={samples} />
      {service.error && <span className="w-full text-xs text-del">{service.error}</span>}
    </li>
  )
}

export function ClientPage() {
  const { clientId = '' } = useParams()
  const detail = useClientDetail(clientId)

  if (detail.isPending) return <Spinner label="Reading client…" />
  if (detail.isError)
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Back to the board
        </Link>
        <ErrorBox error={detail.error} />
      </div>
    )

  const { row, changes, history } = detail.data
  const cells = row.cells.filter((cell): cell is CellStatus => cell !== null)
  const repos = [...new Map(cells.flatMap((cell) => cell.tips).map((tip) => [tip.repoId, tip.repoName])).entries()]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 md:px-6">
      <header>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Back to the board
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">{row.name}</h1>
            {row.region && <p className="text-sm text-fg-3">{row.region}</p>}
          </div>
          {row.kind === 'client' && (
            <Link to={`/c/${row.id}/setup`}>
              <Button>
                <Settings2 className="size-4" aria-hidden /> Edit setup
              </Button>
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cells.map((cell) => (
          <Card key={cell.ref} title={cell.label}>
            <Cell cell={cell} />
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {repos.map(([repoId, repoName]) => (
          <PromotionRail key={repoId} repoId={repoId} repoName={repoName} cells={cells} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Addresses checked" subtitle="Last 24 hours, newest on the right">
          {cells.every((cell) => cell.services.length === 0) ? (
            <Empty>No addresses configured yet.</Empty>
          ) : (
            <div className="space-y-4">
              {cells
                .filter((cell) => cell.services.length > 0)
                .map((cell) => (
                  <div key={cell.ref}>
                    <div className="text-xs font-medium text-fg-3">{cell.label}</div>
                    <ul className="divide-y divide-line">
                      {cell.services.map((service) => (
                        <ServiceRow key={service.ref} service={service} samples={history[service.ref] ?? []} />
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card title="What changed" subtitle="Every time a colour moved">
          {changes.length === 0 ? (
            <Empty>Nothing has changed since the board started.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {changes.map((change) => (
                <li key={`${change.cellRef}-${change.at}`} className="flex items-baseline gap-2 py-2">
                  <StatusDot colour={change.to} />
                  <span className="font-medium">{change.envKind}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-2" title={change.sentence}>
                    {change.word} — {change.sentence}
                  </span>
                  <span className="shrink-0 text-xs text-fg-3" title={formatDateTime(change.at)}>
                    {timeAgo(change.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-fg-3">
        <GitCompareArrows className="size-3.5" aria-hidden />
        Every arrow above opens the full commit and file comparison in the repo tools.
      </p>
    </div>
  )
}
