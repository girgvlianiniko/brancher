import { ArrowLeft, ArrowRight, ExternalLink, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import type { CellStatus, LagEdge, ProbeSample, ServiceState } from '../../../shared/status'
import { useClientDetail } from '../api'
import { Shell } from '../components/Shell'
import { Monogram, SERVICE_TAG, SOFT, StatusDot, TEXT } from '../components/StatusBits'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, plural, timeAgo } from '../lib/format'

/** One environment, expanded: status, what is waiting, and what was checked. */
function EnvCard({ cell }: { cell: CellStatus }) {
  return (
    <div className={cn('glass rounded-lg border bg-card p-4', SOFT[cell.colour])}>
      <p className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{cell.label}</p>
      <p className={cn('mt-2 text-lg font-bold', TEXT[cell.colour])}>{cell.word}</p>
      <p className="mt-1 text-[13px] text-fg-2">{cell.sentence}</p>
      {cell.lastDeployedAt && (
        <p className="mt-2 text-xs text-fg-3">Last change {timeAgo(cell.lastDeployedAt)}</p>
      )}
      {(cell.autoDeploy === 'off' || cell.autoDeploy === 'mixed') && (
        <p className="mt-1 text-xs text-warn">
          {cell.autoDeploy === 'off' ? 'Deploys by hand only' : 'Some parts deploy by hand'}
        </p>
      )}
    </div>
  )
}

/** A single hop: what is waiting to move from one environment into the next. */
function Hop({ edge, repoId, detailed }: { edge: LagEdge; repoId: string; detailed: boolean }) {
  const waiting = edge.realCommits > 0
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="text-xs text-fg-3">{edge.fromEnv}</span>
        <ArrowRight className="size-3.5 text-fg-3" aria-hidden />
        <span className="text-xs font-medium">{edge.toEnv}</span>
      </span>
      {edge.error ? (
        <span className="mt-1 block text-[13px] text-fg-3">{edge.error}</span>
      ) : (
        <span
          className={cn(
            'mt-1 block text-[13px] font-semibold',
            edge.overThreshold ? 'text-warn' : waiting ? 'text-fg' : 'text-add',
          )}
        >
          {waiting ? `${plural(edge.realCommits, 'change')} waiting` : 'In step'}
        </span>
      )}
      {detailed && waiting && !edge.error && (
        <span className="mt-1 block text-xs text-fg-3">
          {plural(edge.filesChanged, 'file')}
          {edge.mergeCommits > 0 && ` · ${plural(edge.mergeCommits, 'merge')}`}
          {edge.oldestWaitingAt && ` · oldest ${timeAgo(edge.oldestWaitingAt)}`}
        </span>
      )}
      {detailed && (
        <span className="mt-1.5 block truncate font-mono text-[11px] text-fg-3">
          {edge.fromBranch} → {edge.toBranch}
        </span>
      )}
    </>
  )

  if (edge.error) return <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">{body}</div>

  return (
    <Link
      to={`/r/${repoId}/compare?base=${encodeURIComponent(edge.toRef || edge.toBranch)}&head=${encodeURIComponent(edge.fromRef || edge.fromBranch)}`}
      className="block rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 transition-colors hover:border-line-strong"
      title="Open the full comparison"
    >
      {body}
    </Link>
  )
}

function HistoryStrip({ samples }: { samples: ProbeSample[] }) {
  if (samples.length === 0) return <span className="text-[11px] text-fg-3">no checks yet</span>
  const size = Math.max(1, Math.ceil(samples.length / 40))
  const groups = Array.from({ length: Math.ceil(samples.length / size) }, (_, i) =>
    samples.slice(i * size, (i + 1) * size),
  )
  return (
    <span className="flex h-4 items-end gap-px" title={`${samples.length} checks in this window`}>
      {groups.map((group, i) => (
        <span
          key={i}
          className={cn('h-full w-1 rounded-[1px]', group.some((s) => !s.ok) ? 'bg-del' : 'bg-add/70')}
          title={group[0]?.at ? formatDateTime(group[0].at) : undefined}
        />
      ))}
    </span>
  )
}

function ServiceRow({ service, samples }: { service: ServiceState; samples: ProbeSample[] }) {
  const colour = service.status === 'up' ? 'green' : service.status === 'down' ? 'red' : 'grey'
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <StatusDot colour={colour} />
      <span className="w-20 shrink-0 font-medium">{SERVICE_TAG[service.kind]}</span>
      <a
        href={service.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-fg-3 hover:text-accent"
      >
        <span className="truncate">{service.url}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
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
  const [detailed, setDetailed] = useState(false)

  if (detail.isPending)
    return (
      <Shell title="Client">
        <Spinner label="Reading client…" />
      </Shell>
    )
  if (detail.isError)
    return (
      <Shell title="Client">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Back to status
        </Link>
        <ErrorBox error={detail.error} />
      </Shell>
    )

  const { row, changes, history } = detail.data
  const cells = row.cells.filter((cell): cell is CellStatus => cell !== null)
  const repos = [...new Map(cells.flatMap((c) => c.tips).map((t) => [t.repoId, t.repoName])).entries()]

  return (
    <Shell
      title={
        <span className="flex items-center gap-3">
          <Monogram name={row.name} id={row.id} />
          {row.name}
        </span>
      }
      subtitle={row.region}
      actions={
        row.id !== 'development' && (
          <Link to={`/c/${row.id}/setup`}>
            <Button>
              <Settings2 className="size-4" aria-hidden /> Edit
            </Button>
          </Link>
        )
      }
    >
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back to status
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cells.map((cell) => (
          <EnvCard key={cell.ref} cell={cell} />
        ))}
      </div>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">How changes reach this client</h2>
          <Button variant="ghost" onClick={() => setDetailed(!detailed)}>
            {detailed ? 'Hide branch detail' : 'Show branch detail'}
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {repos.map(([repoId, repoName]) => {
            const edges = cells.flatMap((cell) => cell.lag.filter((edge) => edge.repoId === repoId))
            if (edges.length === 0) return null
            // Follow the promotion links so hops read in the order a change travels.
            const byFrom = new Map(edges.map((edge) => [edge.fromEnv, edge]))
            const targets = new Set(edges.map((edge) => edge.toEnv))
            const chain: LagEdge[] = []
            const seen = new Set<string>()
            let current: LagEdge | undefined = edges.find((edge) => !targets.has(edge.fromEnv)) ?? edges[0]
            while (current && !seen.has(current.toEnv)) {
              seen.add(current.toEnv)
              chain.push(current)
              current = byFrom.get(current.toEnv)
            }
            return (
              <Card key={repoId} title={repoName} subtitle="One step per promotion">
                <div className="space-y-2">
                  {chain.map((edge) => (
                    <Hop key={`${edge.fromEnv}-${edge.toEnv}`} edge={edge} repoId={repoId} detailed={detailed} />
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <Card title="Addresses checked" subtitle="Last 24 hours, newest on the right">
          {cells.every((cell) => cell.services.length === 0) ? (
            <Empty>No addresses configured yet.</Empty>
          ) : (
            <div className="space-y-4">
              {cells
                .filter((cell) => cell.services.length > 0)
                .map((cell) => (
                  <div key={cell.ref}>
                    <p className="text-xs font-semibold tracking-wide text-fg-3 uppercase">{cell.label}</p>
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
                <li key={`${change.cellRef}-${change.at}`} className="flex items-baseline gap-2 py-2.5">
                  <StatusDot colour={change.to} />
                  <span className="font-medium capitalize">{change.envKind}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-3" title={change.sentence}>
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
    </Shell>
  )
}
