import { ArrowLeft, ExternalLink, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import type { CellStatus, ProbeSample, ServiceState } from '../../../shared/status'
import { useBoard, useClientDetail } from '../api'
import { PromotionGraph } from '../components/PromotionGraph'
import { Shell } from '../components/Shell'
import { Monogram, SERVICE_TAG, SOFT, StatusDot, TEXT } from '../components/StatusBits'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { formatDateTime, formatNumber, timeAgo } from '../lib/format'

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
  const board = useBoard()
  const [detailed, setDetailed] = useState(false)
  const [repoId, setRepoId] = useState<string | null>(null)

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
  // The shared development row is the source every client is measured from.
  const shared = board.data?.rows.find((r) => r.kind === 'shared' && r.id === 'development')
  const devCell = shared?.cells[board.data?.columns.indexOf('development') ?? 0] ?? null

  return (
    <Shell
      title={
        <span className="flex items-center gap-3">
          <Monogram name={row.name} id={row.id} src={row.iconUrl} />
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
          <div>
            <h2 className="text-sm font-bold">How changes reach this client</h2>
            <p className="mt-0.5 text-[13px] text-fg-3">
              Every line carries what is waiting on that step. Click a number to see the commits.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setRepoId(null)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                repoId === null
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-fg-3 hover:border-line-strong hover:text-fg',
              )}
            >
              Everything
            </button>
            {repos.map(([id, name]) => (
              <button
                key={id}
                onClick={() => setRepoId(id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  repoId === id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-fg-3 hover:border-line-strong hover:text-fg',
                )}
              >
                {name}
              </button>
            ))}
            <button
              onClick={() => setDetailed(!detailed)}
              className={cn(
                'ml-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                detailed
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-fg-3 hover:border-line-strong hover:text-fg',
              )}
            >
              Branch names
            </button>
          </div>
        </div>
        <div className="glass rounded-lg border border-line bg-card p-5">
          <PromotionGraph cells={cells} devCell={devCell} repoId={repoId} detailed={detailed} />
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
