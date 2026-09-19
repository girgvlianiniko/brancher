import { HttpError } from './errors'
import { REPOS_DIR } from './paths'
import { listRepos } from './repos'
import { githubToken } from './settings'
import type { GitHubRepoSummary } from '../../shared/types'
import path from 'node:path'

const API = 'https://api.github.com'

async function call<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'brancher',
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401) throw new HttpError(400, 'GitHub rejected that token')
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new HttpError(502, `GitHub: ${body?.message ?? response.statusText}`)
  }
  return response.json() as Promise<T>
}

/** Confirms a token works and says who it belongs to. */
export async function checkToken(token: string): Promise<{ login: string; scopes: string | null }> {
  const user = await call<{ login: string }>('/user', token)
  return { login: user.login, scopes: null }
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
