import { AlertTriangle, Boxes, CheckCircle2, Plus, Search, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import type { BoardRow } from '../../../shared/status'
import { useBoard, useSetLayout } from '../api'
import { ClientMatrixCard, worstOf } from '../components/ClientMatrix'
import { Shell } from '../components/Shell'
import { StatTile } from '../components/StatTile'
import { Button, cn, ErrorBox, Spinner } from '../components/ui'
import { percent, timeAgo } from '../lib/format'

type Filter = 'all' | 'attention' | 'working' | 'down'

export function BoardPage() {
  const [params] = useSearchParams()
  const kiosk = params.get('kiosk') === '1'
  const board = useBoard(kiosk ? 20_000 : 30_000)
  const setLayout = useSetLayout()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  /** Order held locally while a card is in flight, so dragging feels immediate. */
  const [draft, setDraft] = useState<string[] | null>(null)

  useEffect(() => {
    if (kiosk) document.documentElement.dataset.theme = 'dark'
  }, [kiosk])

  const data = board.data
  const shared = useMemo(() => (data?.rows ?? []).filter((row) => row.kind === 'shared'), [data])
  const clients = useMemo(() => {
    const rows = (data?.rows ?? []).filter((row) => row.kind === 'client')
    if (!draft) return rows
    const byId = new Map(rows.map((row) => [row.id, row]))
    return draft.map((id) => byId.get(id)).filter((row): row is BoardRow => row !== undefined)
  }, [data, draft])

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

  const commit = (order: string[], pinned: string[]) => {
    setDraft(order)
    setLayout.mutate({ order, pinned }, { onSettled: () => setDraft(null) })
  }

  const togglePin = (id: string) => {
    const pinned = new Set(clients.filter((row) => row.pinned).map((row) => row.id))
    if (pinned.has(id)) pinned.delete(id)
    else pinned.add(id)
    commit(
      clients.map((row) => row.id),
      [...pinned],
    )
  }

  /** Moves the dragged card in front of the one it is hovering. */
  const reorder = (overId: string) => {
    if (!dragId || dragId === overId) return
    const order = clients.map((row) => row.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(overId)
    if (from === -1 || to === -1) return
    order.splice(to, 0, ...order.splice(from, 1))
    setDraft(order)
  }

  const dropped = () => {
    if (!dragId) return
    setDragId(null)
    if (draft) commit(draft, clients.filter((row) => row.pinned).map((row) => row.id))
  }

  if (board.isPending)
    return (
      <Shell title="Status">
        <Spinner label="Reading status…" />
      </Shell>
    )
  if (board.isError || !data)
    return (
      <Shell title="Status">
        <ErrorBox error={board.error} />
      </Shell>
    )
  if (!data.configured)
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

  const pinned = visible.filter((row) => row.pinned)
  const rest = visible.filter((row) => !row.pinned)

  const section = (rows: BoardRow[]) => (
    <div className={cn('grid gap-4', kiosk ? 'md:grid-cols-2 2xl:grid-cols-3' : 'xl:grid-cols-2 2xl:grid-cols-3')}>
      {rows.map((row) => (
        <ClientMatrixCard
          key={row.id}
          row={row}
          columns={data.columns}
          onTogglePin={togglePin}
          onDragStart={setDragId}
          onDragOver={reorder}
          onDrop={dropped}
          dragging={dragId === row.id}
        />
      ))}
    </div>
  )

  const heading = (label: string, count: number, note?: string) => (
    <h2 className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">
      {label}
      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-3">{count}</span>
      {note && <span className="font-normal tracking-normal normal-case text-fg-3/70">{note}</span>}
    </h2>
  )

  const body = (
    <>
      {shared.length > 0 && (
        <section className="mb-7">
          {heading('Shared services', shared.length, 'Used by every client')}
          {section(shared)}
        </section>
      )}
      {pinned.length > 0 && (
        <section className="mb-7">
          {heading('Pinned', pinned.length)}
          {section(pinned)}
        </section>
      )}
      {rest.length > 0 && (
        <section>
          {heading(pinned.length > 0 ? 'Everyone else' : 'Clients', rest.length)}
          {section(rest)}
        </section>
      )}
      {visible.length === 0 && <p className="py-12 text-center text-sm text-fg-3">No clients match.</p>}
    </>
  )

  if (kiosk) {
    return (
      <div className="min-h-screen bg-bg px-6 py-6">
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight">
            {counts.down + counts.attention > 0
              ? `${counts.down + counts.attention} of ${counts.total} need a look`
              : 'All clear'}
          </h1>
          <p className="text-sm text-fg-3">Checked {timeAgo(data.generatedAt)}</p>
        </div>
        {body}
      </div>
    )
  }

  return (
    <Shell
      title="Status"
      subtitle={`${counts.total} clients · checked ${timeAgo(data.generatedAt)}${
        data.uptime !== null ? ` · ${percent(data.uptime)} up over the last day` : ''
      }`}
      actions={
        <Link to="/c/new">
          <Button variant="primary">
            <Plus className="size-4" aria-hidden /> Add client
          </Button>
        </Link>
      }
    >
      {!data.probeHostReachable && (
        <div className="mb-5 rounded-lg border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm">
          This machine cannot reach the internet, so these are the last known colours.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Boxes} value={counts.total} label="Clients" active={filter === 'all'} onClick={() => setFilter('all')} />
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

      <div className="mt-5 mb-5 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
            className="h-10 w-full rounded-lg border border-line bg-card pr-3 pl-9 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
        </label>
        <p className="max-w-md text-xs leading-relaxed text-fg-3">
          Numbers are changes waiting to deploy, with the age of the oldest underneath.
          Drag a card to reorder, use the star to pin.
        </p>
      </div>

      {body}
    </Shell>
  )
}
