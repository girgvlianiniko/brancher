import './env'

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AddRepoInput, GraphScope, HealthResponse, SettingsResponse } from '../../shared/types'
import { invalidate } from './cache'
import { assertRef, badRequest, HttpError } from './errors'
import { GitCommandError } from './git/exec'
import { cloneFromEnvironment, cloneRepo, useGitCredentials } from './clone'
import { checkToken, listGitHubRepos } from './github'
import { WEB_DIR } from './paths'
import { saveSettings, tokenHint, tokenSource } from './settings'
import { addRepo, getRepo, listRepos, removeRepo } from './repos'
import { sourceFor } from './sources'
import { getBoard, getClientDetail, getRecentChanges, refreshNow, siteUrlFor, startEngine } from './status/engine'
import { resolveIcon } from './status/icon'
import { getConfig, parseClient, removeClient, setLayout, upsertClient } from './status/config'
import { discoverBranches, discoverTriggers, probeUrl, suggestServices } from './status/discover'

const api = new Hono()

api.get('/health', (c) => c.json({ ok: true, githubToken: Boolean(process.env.GITHUB_TOKEN?.trim()) } satisfies HealthResponse))

api.get('/repos', (c) => c.json(listRepos()))

api.get('/settings', (c) =>
  c.json({ github: { source: tokenSource(), hint: tokenHint() } } satisfies SettingsResponse),
)

api.put('/settings/github', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) throw badRequest('A token is required')
  const account = await checkToken(token)
  saveSettings({ githubToken: token })
  useGitCredentials()
  return c.json({ account, github: { source: tokenSource(), hint: tokenHint() } })
})

api.get('/github/repos', async (c) => c.json(await listGitHubRepos(c.req.query('q') ?? '')))

api.post('/github/clone', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { slug?: unknown } | null
  if (typeof body?.slug !== 'string') throw badRequest('slug is required')
  return c.json(await cloneRepo(body.slug), 201)
})

api.get('/board', (c) => c.json(getBoard()))

api.post('/board/refresh', async (c) => {
  await refreshNow()
  return c.json(getBoard())
})

api.get('/board/changes', (c) => c.json(getRecentChanges(Number(c.req.query('limit')) || 50)))

api.get('/clients', (c) => c.json(getConfig()?.clients ?? []))

api.put('/board/layout', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { order?: unknown; pinned?: unknown } | null
  const ids = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  setLayout(ids(body?.order), ids(body?.pinned))
  return c.json(getBoard())
})

api.put('/clients/:id', async (c) => {
  const body = (await c.req.json().catch(() => null)) as unknown
  const client = parseClient({ ...(body as object), id: c.req.param('id') }, 'client')
  const config = upsertClient(client)
  void refreshNow()
  return c.json(config.clients.find((candidate) => candidate.id === client.id))
})

api.delete('/clients/:id', (c) => {
  removeClient(c.req.param('id'))
  return c.body(null, 204)
})

api.get('/discover/branches', async (c) => c.json(await discoverBranches(c.req.query('repoId') ?? '')))

api.get('/discover/triggers', async (c) => c.json(await discoverTriggers(c.req.query('repoId') ?? '')))

api.get('/discover/services', (c) => c.json(suggestServices(c.req.query('domain') ?? '')))

api.post('/discover/probe', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { url?: string } | null
  return c.json(await probeUrl(body?.url ?? ''))
})

api.get('/clients/:id/icon', async (c) => {
  const site = siteUrlFor(c.req.param('id'))
  const icon = site ? await resolveIcon(site) : null
  if (!icon) return c.body(null, 404)
  return c.body(icon.body as unknown as ArrayBuffer, 200, {
    'Content-Type': icon.contentType,
    'Cache-Control': 'public, max-age=86400',
  })
})

api.get('/clients/:id', (c) => {
  const hours = Number(c.req.query('hours'))
  return c.json(getClientDetail(c.req.param('id'), Number.isFinite(hours) && hours > 0 ? Math.min(hours, 720) : 24))
})

api.post('/repos', async (c) => {
  const input = (await c.req.json().catch(() => null)) as AddRepoInput | null
  return c.json(await addRepo(input), 201)
})

api.delete('/repos/:id', (c) => {
  removeRepo(c.req.param('id'))
  invalidate(`gh:${c.req.param('id')}:`)
  return c.body(null, 204)
})

api.get('/repos/:id/overview', async (c) => c.json(await sourceFor(getRepo(c.req.param('id'))).overview()))

api.get('/repos/:id/branches', async (c) => c.json(await sourceFor(getRepo(c.req.param('id'))).branches()))

api.get('/repos/:id/graph', async (c) => {
  const requested = Number(c.req.query('limit'))
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 2000) : 300
  const scope: GraphScope = c.req.query('scope') === 'local' ? 'local' : 'all'
  return c.json(await sourceFor(getRepo(c.req.param('id'))).graph(limit, scope))
})

api.get('/repos/:id/branch', async (c) => {
  const name = assertRef(c.req.query('name'), 'name')
  return c.json(await sourceFor(getRepo(c.req.param('id'))).branchOverview(name))
})

api.get('/repos/:id/compare', async (c) => {
  const base = assertRef(c.req.query('base'), 'base')
  const head = assertRef(c.req.query('head'), 'head')
  return c.json(await sourceFor(getRepo(c.req.param('id'))).compare(base, head))
})

api.get('/repos/:id/position', async (c) => {
  const base = assertRef(c.req.query('base'), 'base')
  const head = assertRef(c.req.query('head'), 'head')
  return c.json(await sourceFor(getRepo(c.req.param('id'))).position(base, head))
})

api.post('/repos/:id/fetch', async (c) => {
  const id = c.req.param('id')
  const repo = getRepo(id)
  const source = sourceFor(repo)
  if (source.fetch) {
    await source.fetch()
  } else if (repo.source === 'github') {
    // Nothing to fetch; just drop cached API answers so the next read is fresh.
    invalidate(`gh:${id}:`)
  } else {
    throw badRequest('This repo can not be fetched')
  }
  return c.json({ ok: true })
})

api.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as ContentfulStatusCode)
  if (error instanceof GitCommandError) return c.json({ error: error.message }, 500)
  console.error(error)
  return c.json({ error: 'Unexpected server error' }, 500)
})

/**
 * In a container the same process serves the built web app, so there is one port to
 * publish and no separate web server to keep in step with the API.
 */
const app = new Hono()
app.route('/api', api)

const indexHtml = path.join(WEB_DIR, 'index.html')
if (existsSync(indexHtml)) {
  app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), WEB_DIR) }))
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), WEB_DIR) }))
  // Anything else is a client-side route, so hand back the app shell.
  app.get('*', (c) => c.html(readFileSync(indexHtml, 'utf8')))
}

const port = Number(process.env.BRANCHER_PORT) || 4317
// Loopback on a laptop, every interface in a container.
const hostname = process.env.BRANCHER_HOST || '127.0.0.1'
serve({ fetch: app.fetch, port, hostname }, async () => {
  console.log(`brancher on http://${hostname}:${port}  (${listRepos().length} repos)`)
  if (!existsSync(indexHtml)) console.log('no built web app at ' + WEB_DIR + ', serving the API only')
  useGitCredentials()
  await cloneFromEnvironment()
  startEngine()
})
