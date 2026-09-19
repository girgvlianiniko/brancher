import { AlertTriangle, Boxes, CheckCircle2, Plus, Search, Settings2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import type { BoardRow, CellStatus, Colour, EnvKind } from '../../../shared/status'
import { useBoard } from '../api'
import { Shell } from '../components/Shell'
import { StatTile } from '../components/StatTile'
import { Monogram, ServiceLine, StatusDot, StatusLine, TEXT } from '../components/StatusBits'
import { Button, cn, ErrorBox, Spinner } from '../components/ui'
import { timeAgo } from '../lib/format'

const SLOTS: EnvKind[] = ['staging', 'production', 'mirror']
const SLOT_LABEL: Record<EnvKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  mirror: 'Mirror',
}

type Filter = 'all' | 'attention' | 'working' | 'down'

const worstOf = (cells: (CellStatus | null)[]): Colour => {
  const colours = cells.filter((c): c is CellStatus => c !== null).map((c) => c.colour)
  return colours.includes('red')
    ? 'red'
    : colours.includes('yellow')
      ? 'yellow'
      : colours.includes('green')
        ? 'green'
        : 'grey'
}

function EnvRow({ cell, kind, kiosk }: { cell: CellStatus | null; kind: EnvKind; kiosk: boolean }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <span className={cn('shrink-0 text-fg-3', kiosk ? 'text-base' : 'text-[13px]')}>{SLOT_LABEL[kind]}</span>
      {cell ? (
        <span className="min-w-0 text-right">
          <StatusLine cell={cell} className={cn('justify-end', kiosk && 'text-base')} />
          {(cell.autoDeploy === 'off' || cell.autoDeploy === 'mixed') && (
            <span className="mt-0.5 block text-[11px] text-fg-3 italic">
              {cell.autoDeploy === 'off' ? 'deploys by hand' : 'partly by hand'}
            </span>
          )}
        </span>
      ) : (
        <span className={cn('text-fg-3/50', kiosk ? 'text-base' : 'text-[13px]')}>not used</span>
      )}
    </div>
  )
}

function ClientCard({
  row,
  columns,
  kiosk,
  index,
}: {
  row: BoardRow
  columns: EnvKind[]
  kiosk: boolean
  index: number
}) {
  const cellFor = (kind: EnvKind) => row.cells[columns.indexOf(kind)] ?? null
  const overall = worstOf(row.cells)
  const headline = row.cells.find((c) => c?.colour === overall) ?? null
  const services = row.cells.filter((c): c is CellStatus => c !== null).flatMap((c) => c.services)

  return (
    <article
      className="rise glass group relative flex h-full flex-col rounded-lg border border-line bg-card transition-colors hover:border-line-strong"
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
    >
      <Link to={`/c/${row.id}`} className="absolute inset-0 rounded-lg" aria-label={`Open ${row.name}`} />

      <header className="flex items-start gap-3 px-4 pt-4">
        <Monogram name={row.name} id={row.id} size={kiosk ? 'lg' : 'md'} />
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate font-bold tracking-tight', kiosk ? 'text-xl' : 'text-[15px]')}>{row.name}</h3>
          <p className={cn('truncate text-fg-3', kiosk ? 'text-sm' : 'text-xs')}>
            {[row.region, headline?.lastDeployedAt && `changed ${timeAgo(headline.lastDeployedAt)}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {!kiosk && (
          <Link
            to={`/c/${row.id}/setup`}
            aria-label={`Edit ${row.name}`}
            className="relative z-10 grid size-8 place-items-center rounded-lg text-fg-3 opacity-0 transition hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Settings2 className="size-4" />
          </Link>
        )}
      </header>

      <div className="mt-3 divide-y divide-line border-t border-line px-4">
        {SLOTS.map((kind) => (
          <EnvRow key={kind} cell={cellFor(kind)} kind={kind} kiosk={kiosk} />
        ))}
      </div>

      <footer className="mt-auto px-4 pt-2 pb-3.5">
        <ServiceLine services={services.filter((s, i, all) => all.findIndex((x) => x.kind === s.kind) === i)} />
      </footer>
    </article>
  )
}

function DevelopmentBar({ cell, kiosk }: { cell: CellStatus; kiosk: boolean }) {
  return (
    <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-card px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <StatusDot colour={cell.colour} />
        Development
      </span>
      <span className={cn('text-[13px]', TEXT[cell.colour])}>{cell.word}</span>
      <span className="text-[13px] text-fg-3">{cell.sentence}</span>
      <span className={cn('ml-auto text-fg-3', kiosk ? 'text-sm' : 'text-xs')}>Shared by every client</span>
    </div>
  )
}

export function BoardPage() {
  const [params] = useSearchParams()
  const kiosk = params.get('kiosk') === '1'
  const board = useBoard(kiosk ? 20_000 : 30_000)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // A wall screen is usually in a dim room with nobody there to press anything.
  useEffect(() => {
    if (kiosk) document.documentElement.dataset.theme = 'dark'
  }, [kiosk])

  const data = board.data
  const clients = useMemo(() => (data?.rows ?? []).filter((row) => row.kind === 'client'), [data])

  const counts = useMemo(() => {
    const colours = clients.map((row) => worstOf(row.cells))
    return {
      total: clients.length,
      working: colours.filter((c) => c === 'green').length,
      attention: colours.filter((c) => c === 'yellow').length,
      down: colours.filter((c) => c === 'red').length,
    }
  }, [clients])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return clients.filter((row) => {
      if (term && !`${row.name} ${row.region}`.toLowerCase().includes(term)) return false
      const colour = worstOf(row.cells)
      if (filter === 'attention') return colour === 'yellow'
      if (filter === 'working') return colour === 'green'
      if (filter === 'down') return colour === 'red'
      return true
    })
  }, [clients, search, filter])

  if (board.isPending) return <Shell title="Status"><Spinner label="Reading status…" /></Shell>
  if (board.isError || !data)
    return (
      <Shell title="Status">
        <ErrorBox error={board.error} />
      </Shell>
    )

  if (!data.configured) {
    return (
      <Shell title="Status">
        <div className="glass mx-auto mt-8 max-w-md rounded-lg border border-line bg-card px-6 py-10 text-center">
          <h2 className="text-lg font-bold">Nothing to watch yet</h2>
          <p className="mt-2 text-sm text-fg-3">
            Add a client and Brancher starts checking its sites and tracking what is waiting to ship.
          </p>
          <Link to="/c/new" className="mt-5 inline-block">
            <Button variant="primary">
              <Plus className="size-4" aria-hidden /> Add a client
            </Button>
          </Link>
        </div>
      </Shell>
    )
  }

  const development = data.rows.find((row) => row.kind === 'shared')
  const developmentCell = development?.cells[data.columns.indexOf('development')] ?? null

  const grid = (
    <div
      className={cn(
        'grid gap-4',
        kiosk ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-3',
      )}
    >
      {visible.map((row, i) => (
        <ClientCard key={row.id} row={row} columns={data.columns} kiosk={kiosk} index={i} />
      ))}
    </div>
  )

  if (kiosk) {
    return (
      <div className="min-h-screen bg-bg px-6 py-6">
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight">
            {counts.down > 0 || counts.attention > 0
              ? `${counts.down + counts.attention} of ${counts.total} need a look`
              : 'All clear'}
          </h1>
          <p className="text-sm text-fg-3">Checked {timeAgo(data.generatedAt)}</p>
        </div>
        {developmentCell && (
          <div className="mb-4">
            <DevelopmentBar cell={developmentCell} kiosk />
          </div>
        )}
        {grid}
      </div>
    )
  }

  return (
    <Shell
      title="Status"
      subtitle={`${counts.total} clients · checked ${timeAgo(data.generatedAt)}`}
      actions={
        <Link to="/c/new">
          <Button variant="primary">
            <Plus className="size-4" aria-hidden /> Add client
          </Button>
        </Link>
      }
    >
      {!data.probeHostReachable && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm">
          This machine cannot reach the internet, so these are the last known colours.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Boxes}
          value={counts.total}
          label="Clients"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <StatTile
          icon={CheckCircle2}
          value={counts.working}
          label="Working"
          tone="good"
          active={filter === 'working'}
          onClick={() => setFilter(filter === 'working' ? 'all' : 'working')}
        />
        <StatTile
          icon={AlertTriangle}
          value={counts.attention}
          label="Need a look"
          tone="warn"
          active={filter === 'attention'}
          onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
        />
        <StatTile
          icon={XCircle}
          value={counts.down}
          label="Down"
          tone="bad"
          active={filter === 'down'}
          onClick={() => setFilter(filter === 'down' ? 'all' : 'down')}
        />
      </div>

      {developmentCell && (
        <div className="mt-4">
          <DevelopmentBar cell={developmentCell} kiosk={false} />
        </div>
      )}

      <div className="mt-4 mb-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
            className="h-10 w-full rounded-lg border border-line bg-card pr-3 pl-9 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-3">No clients match.</p>
      ) : (
        grid
      )}

      <p className="mt-8 text-xs text-fg-3">
        Add <code className="font-mono">?kiosk=1</code> to the address for the office screen.
      </p>
    </Shell>
  )
}
