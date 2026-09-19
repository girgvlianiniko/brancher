import { AlertTriangle, KeyRound } from 'lucide-react'
import { Link } from 'react-router'

import { useSettings } from '../api'
import { cn } from './ui'

/**
 * The board's warning strip about the GitHub token. Without a working token every
 * fetch fails quietly and each client just reads "could not be checked", so a broken
 * or expiring token has to say so out loud on the page people actually watch.
 */
export function TokenNotice() {
  const settings = useSettings()
  const github = settings.data?.github
  const failing = settings.data?.git.failing ?? []

  const problem = github?.health?.problem ?? null
  const warning =
    problem ??
    github?.health?.warning ??
    (failing.length > 0
      ? `Could not fetch ${failing.length === 1 ? failing[0] : `${failing.length} repositories`} from GitHub.`
      : null)

  if (!warning) return null

  return (
    <div
      role="alert"
      className={cn(
        'mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border px-4 py-3 text-sm',
        problem ? 'border-del/35 bg-del-soft' : 'border-warn/40 bg-warn-soft/40',
      )}
    >
      <AlertTriangle
        className={cn('size-4 shrink-0', problem ? 'text-del' : 'text-warn')}
        aria-hidden
      />
      <span>{warning}</span>
      <Link to="/settings" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
        <KeyRound className="size-3.5" aria-hidden /> Settings
      </Link>
    </div>
  )
}
