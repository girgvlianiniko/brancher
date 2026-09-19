import { RefreshCw, Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'

import type { BoardRow, EnvKind } from '../../../shared/status'
import { useBoard, useRefreshBoard } from '../api'
import { Cell, StatusDot } from '../components/StatusBits'
import { Button, cn, ErrorBox, Spinner } from '../components/ui'
import { timeAgo } from '../lib/format'

/** The columns a client row can fill. Development is shown once, above the table. */
const CLIENT_COLUMNS: EnvKind[] = ['staging', 'production', 'mirror']

const COLUMN_LABEL: Record<EnvKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  mirror: 'Mirror',
}

function ClientRow({ row, columns, kiosk }: { row: BoardRow; columns: EnvKind[]; kiosk: boolean }) {
  const cellFor = (kind: EnvKind) => row.cells[columns.indexOf(kind)] ?? null
  return (
    <tr className="border-b border-line last:border-0">
      <td className={cn('align-top', kiosk ? 'px-6 py-5' : 'px-4 py-4')}>
        <Link to={`/c/${row.id}`} className="group block min-w-0">
          <div className={cn('font-semibold group-hover:text-accent', kiosk ? 'text-2xl' : 'text-base')}>
            {row.name}
          </div>
          {row.region && <div className={cn('text-fg-3', kiosk ? 'text-sm' : 'text-xs')}>{row.region}</div>}
        </Link>
      </td>
      {CLIENT_COLUMNS.map((kind) => {
        const cell = cellFor(kind)
        return (
          <td key={kind} className={cn('align-top', kiosk ? 'px-6 py-5' : 'px-4 py-4')}>
            {cell ? (
              <Cell cell={cell} big={kiosk} />
            ) : (
              <span className={cn('text-fg-3 italic', kiosk ? 'text-base' : 'text-xs')}>none</span>
            )}
          </td>
        )
      })}
    </tr>
  )
}

export function BoardPage() {
  const [params] = useSearchParams()
  const kiosk = params.get('kiosk') === '1'
  const board = useBoard(kiosk ? 20_000 : 30_000)
  const refresh = useRefreshBoard()

  // A wall screen is usually in a dark room, and nobody is there to press the toggle.
  useEffect(() => {
    if (!kiosk) return
    const root = document.documentElement
    const previous = root.dataset.theme
    root.dataset.theme = 'dark'
    return () => {
      if (previous) root.dataset.theme = previous
      else delete root.dataset.theme
    }
  }, [kiosk])

  if (board.isPending) return <Spinner label="Reading status…" />
  if (board.isError) {
    return (
      <div className="p-6">
        <ErrorBox error={board.error} />
      </div>
    )
  }

  const data = board.data
  const clients = data.rows.filter((row) => row.kind === 'client')
  const development = data.rows.find((row) => row.kind === 'shared')
  const developmentCell = development?.cells[data.columns.indexOf('development')] ?? null

  if (!data.configured) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">No clients set up yet</h1>
        <p className="mt-2 text-sm text-fg-2">
          Copy <code className="font-mono text-xs">clients.example.json</code> to{' '}
          <code className="font-mono text-xs">server/data/clients.json</code> and restart the server.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('mx-auto', kiosk ? 'max-w-none px-6 py-6' : 'max-w-7xl px-4 py-5 md:px-6')}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className={cn('font-semibold', kiosk ? 'text-3xl' : 'text-xl')}>Client status</h1>
          <p className={cn('mt-0.5 text-fg-3', kiosk ? 'text-base' : 'text-xs')}>
            Updated {timeAgo(data.generatedAt)}
            {' · '}
            {clients.length} clients
            {' · '}
            {data.needsAttention === 0 ? 'all good' : `${data.needsAttention} need attention`}
          </p>
        </div>
        {!kiosk && (
          <div className="flex items-center gap-2">
            <Link to="/r" className="text-xs text-accent hover:underline">
              Repo tools
            </Link>
            <Button onClick={() => refresh.mutate()} disabled={refresh.isPending} title="Fetch and probe now">
              <RefreshCw className={cn('size-4', refresh.isPending && 'animate-spin')} aria-hidden />
              {refresh.isPending ? 'Checking…' : 'Check now'}
            </Button>
          </div>
        )}
      </header>

      {!data.probeHostReachable && (
        <div className="mt-4 rounded-lg border border-warn/50 bg-warn-soft px-4 py-3 text-sm text-warn">
          This machine cannot reach the internet, so the colours below are the last known ones.
        </div>
      )}

      {developmentCell && (
        <div className={cn('mt-4 rounded-lg border border-line bg-surface', kiosk ? 'px-6 py-5' : 'px-4 py-4')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={cn('font-semibold', kiosk ? 'text-xl' : 'text-sm')}>Development</div>
              <div className={cn('text-fg-3', kiosk ? 'text-sm' : 'text-xs')}>
                Shared by every client. Everything below is measured against it.
              </div>
            </div>
            <Cell cell={developmentCell} big={kiosk} />
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[56rem] table-fixed">
          <colgroup>
            <col className="w-[19%]" />
            <col className="w-[27%]" />
            <col className="w-[27%]" />
            <col className="w-[27%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-fg-3">
              <th className={cn('font-medium', kiosk ? 'px-6 py-3 text-sm' : 'px-4 py-2 text-xs')}>Client</th>
              {CLIENT_COLUMNS.map((kind) => (
                <th
                  key={kind}
                  className={cn('font-medium', kiosk ? 'px-6 py-3 text-sm' : 'px-4 py-2 text-xs')}
                >
                  {COLUMN_LABEL[kind]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((row) => (
              <ClientRow key={row.id} row={row} columns={data.columns} kiosk={kiosk} />
            ))}
          </tbody>
        </table>
      </div>

      {!kiosk && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
          <Settings2 className="size-3.5" aria-hidden />
          <span className="ml-1 inline-flex items-center gap-1.5">
            <StatusDot colour="green" /> working
          </span>
          <span className="ml-2 inline-flex items-center gap-1.5">
            <StatusDot colour="yellow" /> needs a look
          </span>
          <span className="ml-2 inline-flex items-center gap-1.5">
            <StatusDot colour="red" /> down
          </span>
          <span className="ml-2">
            Add <code className="font-mono">?kiosk=1</code> for the wall screen.
          </span>
        </p>
      )}
    </div>
  )
}
