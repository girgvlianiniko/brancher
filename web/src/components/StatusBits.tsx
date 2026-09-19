import type { AutoDeploy, CellStatus, Colour, ServiceKind, ServiceState } from '../../../shared/status'
import { timeAgo } from '../lib/format'
import { cn } from './ui'

/** Green, amber, red, grey. The only four things a viewer has to tell apart. */
export const DOT: Record<Colour, string> = {
  green: 'bg-add',
  yellow: 'bg-warn',
  red: 'bg-del',
  grey: 'bg-line-strong',
}

const RING: Record<Colour, string> = {
  green: 'ring-add/25',
  yellow: 'ring-warn/25',
  red: 'ring-del/25',
  grey: 'ring-line/40',
}

export const WORD_TEXT: Record<Colour, string> = {
  green: 'text-fg',
  yellow: 'text-fg',
  red: 'text-del',
  grey: 'text-fg-3',
}

/** Short enough for a wall screen, and never jargon. */
const SERVICE_TAG: Record<ServiceKind, string> = {
  front: 'Website',
  admin: 'Admin',
  api: 'API',
  ws: 'Live',
  chat: 'Chat',
  pay: 'Pay',
}

export function StatusDot({ colour, big }: { colour: Colour; big?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full ring-4',
        DOT[colour],
        RING[colour],
        big ? 'size-3.5' : 'size-2.5',
      )}
      aria-hidden
    />
  )
}

export function ServiceTags({ services }: { services: ServiceState[] }) {
  if (services.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {services.map((service) => (
        <span
          key={service.ref}
          title={`${service.url}${service.error ? ` — ${service.error}` : ''}`}
          className={cn(
            'rounded border px-1.5 py-0.5 text-[11px] leading-4',
            service.status === 'down'
              ? 'border-del/50 bg-del/10 text-del'
              : service.status === 'unknown'
                ? 'border-line text-fg-3'
                : 'border-line text-fg-3',
          )}
        >
          {SERVICE_TAG[service.kind]}
        </span>
      ))}
    </div>
  )
}

const AUTO_DEPLOY_NOTE: Record<AutoDeploy, string | null> = {
  on: null,
  off: 'Deploys by hand only',
  mixed: 'Some parts deploy by hand',
  unknown: null,
}

/** One environment, as it appears on the board: colour, one word, one sentence. */
export function Cell({ cell, big }: { cell: CellStatus; big?: boolean }) {
  const note = AUTO_DEPLOY_NOTE[cell.autoDeploy]
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className={cn('flex shrink-0', big ? 'mt-2' : 'mt-1.5')}>
        <StatusDot colour={cell.colour} big={big} />
      </span>
      <div className="min-w-0">
        <div className={cn('font-semibold', WORD_TEXT[cell.colour], big ? 'text-lg' : 'text-sm')}>{cell.word}</div>
        <div className={cn('text-fg-2', big ? 'text-sm' : 'text-xs')}>{cell.sentence}</div>
        {cell.lastDeployedAt && (
          <div className={cn('text-fg-3', big ? 'text-sm' : 'text-xs')}>
            Last change {timeAgo(cell.lastDeployedAt)}
          </div>
        )}
        {note && <div className="mt-0.5 text-[11px] text-fg-3 italic">{note}</div>}
        <ServiceTags services={cell.services} />
      </div>
    </div>
  )
}

export { SERVICE_TAG }
