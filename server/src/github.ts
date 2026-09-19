import { HttpError } from './errors'
import { REPOS_DIR } from './paths'
import { listRepos } from './repos'
import { githubToken } from './settings'
import type { GitHubRepoSummary, TokenHealth } from '../../shared/types'
import path from 'node:path'

const API = 'https://api.github.com'

const send = (url: string, token: string) =>
  fetch(url.startsWith('http') ? url : `${API}${url}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'brancher',
      Authorization: `Bearer ${token}`,
    },
  })

async function call<T>(url: string, token: string): Promise<T> {
  const response = await send(url, token)
  if (response.status === 401) throw new HttpError(400, 'GitHub rejected that token')
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new HttpError(502, `GitHub: ${body?.message ?? response.statusText}`)
  }
  return response.json() as Promise<T>
}

/** Confirms a token works and says who it belongs to. Throws if GitHub refuses it. */
export async function checkToken(token: string): Promise<{ login: string; scopes: string | null }> {
  const user = await call<{ login: string }>('/user', token)
  return { login: user.login, scopes: null }
}

/** GitHub writes expiry as `2027-01-05 20:00:00 UTC`, which `Date` will not parse. */
function parseExpiry(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value.trim().replace(' UTC', '').replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const number = (value: string | null): number | null =>
  value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value)

const DAY = 86_400_000
/** Warn this far ahead of expiry, which is enough notice to mint a replacement. */
const EXPIRY_WARNING_DAYS = 14

function unhealthy(problem: string): TokenHealth {
  return {
    ok: false,
    problem,
    warning: null,
    login: null,
    scopes: null,
    expiresAt: null,
    expiresInDays: null,
    rateRemaining: null,
    rateLimit: null,
    rateResetAt: null,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Asks GitHub about the token itself. One request: the body names the account and the
 * response headers carry the scopes, the expiry date and the rate limit allowance.
 */
export async function readTokenHealth(token: string): Promise<TokenHealth> {
  let response: Response
  try {
    response = await send('/user', token)
  } catch (error) {
    return unhealthy(`Could not reach GitHub: ${error instanceof Error ? error.message : error}`)
  }

  if (response.status === 401)
    return unhealthy('GitHub rejected this token. It has been revoked, expired or mistyped.')
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
    return unhealthy('This token has used up its hourly API allowance.')
  if (!response.ok) return unhealthy(`GitHub answered ${response.status} ${response.statusText}.`)

  const user = (await response.json().catch(() => null)) as { login?: string } | null
  const header = (name: string) => response.headers.get(name)

  // Fine-grained tokens report no scope header at all, so absent is not the same as empty.
  const rawScopes = header('x-oauth-scopes')
  const scopes =
    rawScopes === null
      ? null
      : rawScopes
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean)

  const expiresAt = parseExpiry(header('github-authentication-token-expiration'))
  const expiresInDays = expiresAt
    ? Math.round((new Date(expiresAt).getTime() - Date.now()) / DAY)
    : null

  const rateRemaining = number(header('x-ratelimit-remaining'))
  const rateLimit = number(header('x-ratelimit-limit'))
  const reset = number(header('x-ratelimit-reset'))

  const health: TokenHealth = {
    ok: true,
    problem: null,
    warning: null,
    login: user?.login ?? null,
    scopes,
    expiresAt,
    expiresInDays,
    rateRemaining,
    rateLimit,
    rateResetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
  }

  if (expiresInDays !== null && expiresInDays < 0)
    return { ...health, ok: false, problem: 'This token has expired. Replace it to keep reading repositories.' }

  if (expiresInDays !== null && expiresInDays <= EXPIRY_WARNING_DAYS)
    health.warning =
      expiresInDays === 0
        ? 'This token expires today.'
        : `This token expires in ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}.`
  else if (scopes && scopes.length > 0 && !scopes.includes('repo') && !scopes.includes('public_repo'))
    health.warning = 'This token has no repo scope, so private repositories stay out of reach.'
  else if (rateRemaining !== null && rateLimit !== null && rateRemaining < rateLimit * 0.1)
    health.warning = `Only ${rateRemaining} of ${rateLimit} API calls left this hour.`

  return health
}

/**
 * Health is cached: several browsers and a wall screen all poll the settings endpoint,
 * and GitHub does not need to hear from each of them. The promise is cached rather than
 * the value, so simultaneous first callers share one request.
 */
const HEALTH_TTL = 5 * 60_000
let cached: { token: string; at: number; health: Promise<TokenHealth> } | null = null

export function tokenHealth(): Promise<TokenHealth | null> {
  const token = githubToken()
  if (!token) {
    cached = null
    return Promise.resolve(null)
  }
  if (cached && cached.token === token && Date.now() - cached.at < HEALTH_TTL) return cached.health

  const health = readTokenHealth(token)
  cached = { token, at: Date.now(), health }
  // A thrown request should not stick around as the cached answer.
  health.catch(() => {
    if (cached?.health === health) cached = null
  })
  return health
}

/** Forces the next read to ask GitHub again, after the token changes. */
export const forgetTokenHealth = () => {
  cached = null
}

/**
 * Repositories the token can reach, most recently pushed first, marked with whether
 * they are already cloned here.
 */
export async function listGitHubRepos(query: string): Promise<GitHubRepoSummary[]> {
  const token = githubToken()
  if (!token) throw new HttpError(400, 'Connect a GitHub token first')

  const repos = await call<
    { full_name: string; description: string | null; private: boolean; pushed_at: string | null }[]
  >('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token)

  const cloned = new Set(
    listRepos()
      .filter((repo) => repo.source === 'local')
      .map((repo) => path.basename(repo.path).toLowerCase()),
  )
  const term = query.trim().toLowerCase()

  return repos
    .filter((repo) => !term || repo.full_name.toLowerCase().includes(term))
    .map((repo) => ({
      slug: repo.full_name,
      description: repo.description,
      private: repo.private,
      pushedAt: repo.pushed_at,
      present: cloned.has(repo.full_name.split('/')[1].toLowerCase()),
    }))
}

export const reposDirectory = () => REPOS_DIR
