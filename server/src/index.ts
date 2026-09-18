import './env'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AddRepoInput, GraphScope, HealthResponse } from '../../shared/types'
import { invalidate } from './cache'
import { assertRef, badRequest, HttpError } from './errors'
import { GitCommandError } from './git/exec'
import { addRepo, getRepo, listRepos, removeRepo } from './repos'
import { sourceFor } from './sources'

const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ ok: true, githubToken: Boolean(process.env.GITHUB_TOKEN?.trim()) } satisfies HealthResponse))

app.get('/repos', (c) => c.json(listRepos()))

app.post('/repos', async (c) => {
  const input = (await c.req.json().catch(() => null)) as AddRepoInput | null
  return c.json(await addRepo(input), 201)
})

app.delete('/repos/:id', (c) => {
  removeRepo(c.req.param('id'))
  invalidate(`gh:${c.req.param('id')}:`)
  return c.body(null, 204)
})

app.get('/repos/:id/overview', async (c) => c.json(await sourceFor(getRepo(c.req.param('id'))).overview()))

app.get('/repos/:id/branches', async (c) => c.json(await sourceFor(getRepo(c.req.param('id'))).branches()))

app.get('/repos/:id/graph', async (c) => {
  const requested = Number(c.req.query('limit'))
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 2000) : 300
  const scope: GraphScope = c.req.query('scope') === 'local' ? 'local' : 'all'
  return c.json(await sourceFor(getRepo(c.req.param('id'))).graph(limit, scope))
})

app.get('/repos/:id/compare', async (c) => {
  const base = assertRef(c.req.query('base'), 'base')
  const head = assertRef(c.req.query('head'), 'head')
  return c.json(await sourceFor(getRepo(c.req.param('id'))).compare(base, head))
})

app.get('/repos/:id/position', async (c) => {
  const base = assertRef(c.req.query('base'), 'base')
  const head = assertRef(c.req.query('head'), 'head')
  return c.json(await sourceFor(getRepo(c.req.param('id'))).position(base, head))
})

app.post('/repos/:id/fetch', async (c) => {
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

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status as ContentfulStatusCode)
  if (error instanceof GitCommandError) return c.json({ error: error.message }, 500)
  console.error(error)
  return c.json({ error: 'Unexpected server error' }, 500)
})

const port = Number(process.env.BRANCHER_PORT) || 4317
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`brancher api on http://127.0.0.1:${port}  (${listRepos().length} repos)`)
})
