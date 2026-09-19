import type {
  AutoDeploy,
  BranchTip,
  Colour,
  DeployTrigger,
  LagEdge,
  ServiceKind,
  ServiceState,
  Thresholds,
} from '../../../shared/status'

/**
 * Services whose loss means the site is broken for its users. The rest (websockets,
 * chat, payments widget) degrade the experience without taking the site down, so they
 * turn a cell yellow rather than red.
 */
const CRITICAL: ServiceKind[] = ['front', 'admin', 'api']

const SERVICE_LABEL: Record<ServiceKind, string> = {
  front: 'Website',
  admin: 'Admin panel',
  api: 'API',
  ws: 'Live updates',
  chat: 'Chat',
  pay: 'Payments',
}

export interface CellVerdict {
  colour: Colour
  word: string
  sentence: string
  lastDeployedAt: string | null
  autoDeploy: AutoDeploy
}

/** "14:02" today, "18 Sep 14:02" before that. Both sides run on the same machine. */
function clockSince(iso: string | null): string {
  if (!iso) return 'a while ago'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'a while ago'
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameDay = at.toDateString() === new Date().toDateString()
  return sameDay ? time : `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : Math.floor((Date.now() - at) / 86_400_000)
}

/** True when this edge alone is enough to call the environment behind. */
export function edgeOverThreshold(edge: LagEdge, thresholds: Thresholds): boolean {
  if (edge.realCommits === 0) return false
  if (edge.realCommits >= thresholds.commits) return true
  const age = daysSince(edge.oldestWaitingAt)
  return age !== null && age >= thresholds.days
}

function deployState(tips: BranchTip[], triggers: DeployTrigger[]): AutoDeploy {
  const primary = tips.filter((tip) => tip.isPrimary)
  if (primary.length === 0 || triggers.length === 0) return 'unknown'
  const states = primary.map((tip) =>
    triggers.some((t) => t.repoId === tip.repoId && t.branch === tip.branch && t.mode === 'push'),
  )
  if (states.every(Boolean)) return 'on'
  if (states.some(Boolean)) return 'mixed'
  return 'off'
}

/**
 * The whole colour decision for one cell, in one place. First rule that matches wins:
 * a broken service beats a slow promotion, and "still checking" beats a false green.
 */
export function verdict(input: {
  services: ServiceState[]
  lag: LagEdge[]
  tips: BranchTip[]
  triggers: DeployTrigger[]
  thresholds: Thresholds
  sourceLabel: string | null
}): CellVerdict {
  const { services, lag, tips, triggers, thresholds, sourceLabel } = input

  const lastDeployedAt =
    tips
      .filter((tip) => tip.isPrimary && tip.date)
      .map((tip) => tip.date as string)
      .sort()
      .pop() ?? null
  const autoDeploy = deployState(tips, triggers)

  const down = services.filter((service) => service.status === 'down')
  const criticalDown = down.filter((service) => CRITICAL.includes(service.kind))
  const unknown = services.filter((service) => service.status === 'unknown')

  if (criticalDown.length > 0) {
    const names = listNames(criticalDown.map((service) => SERVICE_LABEL[service.kind]))
    return {
      colour: 'red',
      word: 'Down',
      sentence: `${names} not answering since ${clockSince(criticalDown[0].since)}`,
      lastDeployedAt,
      autoDeploy,
    }
  }

  if (services.length > 0 && unknown.length === services.length) {
    return { colour: 'grey', word: 'Checking', sentence: 'Not checked yet', lastDeployedAt, autoDeploy }
  }

  const waiting = lag.filter((edge) => edgeOverThreshold(edge, thresholds))
  const commits = waiting.reduce((total, edge) => total + edge.realCommits, 0)
  const oldest = waiting
    .map((edge) => daysSince(edge.oldestWaitingAt))
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a)[0]

  if (down.length > 0) {
    const names = listNames(down.map((service) => SERVICE_LABEL[service.kind]))
    return {
      colour: 'yellow',
      word: 'Degraded',
      sentence: `${names} not answering since ${clockSince(down[0].since)}`,
      lastDeployedAt,
      autoDeploy,
    }
  }

  if (waiting.length > 0) {
    const from = sourceLabel ? ` from ${sourceLabel.toLowerCase()}` : ''
    const age = oldest !== undefined && oldest >= thresholds.days ? `, oldest ${plural(oldest, 'day')}` : ''
    return {
      colour: 'yellow',
      word: 'Behind',
      sentence: `${plural(commits, 'change')} waiting${from}${age}`,
      lastDeployedAt,
      autoDeploy,
    }
  }

  const pending = lag.reduce((total, edge) => total + edge.realCommits, 0)
  // A repo we could not read reports zero changes waiting, which would otherwise pass for
  // up to date. Say so instead of quietly counting it as fine.
  const unreadable = lag.filter((edge) => edge.error).length
  const caveat = unreadable > 0 ? `, ${plural(unreadable, 'part')} could not be checked` : ''

  // Nothing is probed here, so "working" would be a claim the board cannot make.
  if (services.length === 0) {
    return {
      colour: 'grey',
      word: 'No checks',
      sentence: lag.length === 0 ? 'Nothing to check yet' : 'No address to check',
      lastDeployedAt,
      autoDeploy,
    }
  }

  const sentence =
    (pending > 0 ? `${plural(pending, 'change')} waiting, within limits` : 'Up to date') + caveat
  return { colour: unreadable > 0 ? 'grey' : 'green', word: 'Working', sentence, lastDeployedAt, autoDeploy }
}

export { SERVICE_LABEL }
