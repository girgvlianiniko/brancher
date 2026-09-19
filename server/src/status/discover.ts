import type { DeployTrigger, ProbeResult, ServiceConfig, ServiceKind } from '../../../shared/status'
import { badRequest } from '../errors'
import { listRepos } from '../repos'
import { getConfig } from './config'
import { loadTips } from './lag'
import { probe } from './probe'
import { readTriggers } from './triggers'

export interface DiscoveredBranch {
  name: string
  sha: string
  subject: string
  author: string
  date: string
  /** How a push to this branch behaves, so the wizard can warn while you pick. */
  trigger: DeployTrigger['mode']
  workflowFile: string
}

function localRepo(repoId: string) {
  if (!repoId) throw badRequest('repoId is required')
  const repo = listRepos().find((candidate) => candidate.id === repoId)
  if (!repo) throw badRequest(`No repo with id "${repoId}"`)
  if (repo.source !== 'local') throw badRequest('Only local clones can be used by the status board')
  return repo
}

/** Real branches, newest first, each with what happens when you push to it. */
export async function discoverBranches(repoId: string): Promise<DiscoveredBranch[]> {
  const repo = localRepo(repoId)
  const tips = await loadTips(repo.path)
  const triggers = await readTriggers(repoId, repo.path, new Set(tips.keys()))
  const byBranch = new Map(triggers.map((trigger) => [trigger.branch, trigger]))

  return [...tips]
    .map<DiscoveredBranch>(([name, tip]) => ({
      name,
      sha: tip.sha,
      subject: tip.subject,
      author: tip.author,
      date: tip.date,
      trigger: byBranch.get(name)?.mode ?? 'none',
      workflowFile: byBranch.get(name)?.workflowFile ?? '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function discoverTriggers(repoId: string): Promise<DeployTrigger[]> {
  const repo = localRepo(repoId)
  const tips = await loadTips(repo.path)
  return readTriggers(repoId, repo.path, new Set(tips.keys()))
}

/** A health path is only worth guessing where we know one exists. */
const HEALTH_PATH: Partial<Record<ServiceKind, string>> = { api: '/health-check' }

const SUBDOMAIN: Record<ServiceKind, string | null> = {
  front: null,
  admin: 'admin',
  api: 'api',
  ws: 'ws',
  chat: 'chat',
  pay: 'pay',
}

/** Services on by default. The rest are offered but left off. */
const ON_BY_DEFAULT: ServiceKind[] = ['front', 'admin', 'api']

/**
 * Proposes the usual addresses from one domain. Every field stays editable in the
 * wizard, because a casino changing its domain is routine here.
 */
export function suggestServices(domain: string): ServiceConfig[] {
  const bare = domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (!bare) throw badRequest('domain is required')

  return (Object.keys(SUBDOMAIN) as ServiceKind[]).map<ServiceConfig>((kind) => {
    const host = SUBDOMAIN[kind] ? `${SUBDOMAIN[kind]}.${bare}` : bare
    return {
      kind,
      url: `https://${host}${HEALTH_PATH[kind] ?? '/'}`,
      enabled: ON_BY_DEFAULT.includes(kind),
    }
  })
}

/** One immediate check, so the wizard can show whether an address answers. */
export async function probeUrl(url: string): Promise<ProbeResult> {
  if (!url.trim()) throw badRequest('url is required')
  try {
    new URL(url)
  } catch {
    throw badRequest(`Not a valid URL: ${url}`)
  }
  return probe(url, getConfig()?.probe.timeoutMs ?? 5000)
}
