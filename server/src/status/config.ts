import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type {
  BoardConfig,
  ClientConfig,
  EnvironmentConfig,
  EnvKind,
  ProbeSettings,
  RepoBinding,
  ServiceConfig,
  ServiceKind,
  Thresholds,
} from '../../../shared/status'
import { ENV_KINDS, SERVICE_KINDS } from '../../../shared/status'
import { badRequest } from '../errors'
import { PROJECT_ROOT } from '../repos'

const CONFIG_FILE = path.join(PROJECT_ROOT, 'server', 'data', 'clients.json')

const DEFAULT_THRESHOLDS: Thresholds = { commits: 10, days: 7 }
const DEFAULT_PROBE: ProbeSettings = {
  intervalSec: 30,
  timeoutMs: 5000,
  failuresToRed: 2,
  controlUrl: 'https://www.google.com/generate_204',
}
const DEFAULT_FETCH_INTERVAL_SEC = 60

/** A board row: the shared development environment, or one client. */
export interface Row {
  id: string
  name: string
  region: string
  kind: 'client' | 'shared'
  thresholds: Thresholds
  environments: EnvironmentConfig[]
}

// ------------------------------------------------------------- validation

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function record(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) throw badRequest(`${at} must be an object`)
  return value
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw badRequest(`${at} must be an array`)
  return value
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${at} must be a non-empty string`)
  return value.trim()
}

function count(value: unknown, at: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest(`${at} must be a number of 0 or more`)
  }
  return value
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  const found = allowed.find((option) => option === value)
  if (!found) throw badRequest(`${at} must be one of ${allowed.join(', ')}`)
  return found
}

function parseUrl(value: unknown, at: string): string {
  const raw = text(value, at)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw badRequest(`${at} is not a valid URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest(`${at} must be http or https`)
  }
  return parsed.toString()
}

function parseService(raw: unknown, at: string): ServiceConfig {
  const value = record(raw, at)
  return {
    kind: oneOf<ServiceKind>(value.kind, SERVICE_KINDS, `${at}.kind`),
    url: parseUrl(value.url, `${at}.url`),
    enabled: flag(value.enabled, true),
  }
}

function parseBinding(raw: unknown, at: string): RepoBinding {
  const value = record(raw, at)
  const branches = list(value.branches, `${at}.branches`).map((branch, i) =>
    text(branch, `${at}.branches[${i}]`),
  )
  if (branches.length === 0) throw badRequest(`${at}.branches needs at least one branch`)
  return { repoId: text(value.repoId, `${at}.repoId`), branches }
}

function parseEnvironment(raw: unknown, at: string): EnvironmentConfig {
  const value = record(raw, at)
  const kind = oneOf<EnvKind>(value.kind, ENV_KINDS, `${at}.kind`)
  const feedsFrom =
    value.feedsFrom === undefined || value.feedsFrom === null
      ? null
      : oneOf<EnvKind>(value.feedsFrom, ENV_KINDS, `${at}.feedsFrom`)
  if (feedsFrom === kind) throw badRequest(`${at}.feedsFrom cannot be the environment itself`)
  return {
    kind,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : kind,
    feedsFrom,
    services: list(value.services ?? [], `${at}.services`).map((service, i) =>
      parseService(service, `${at}.services[${i}]`),
    ),
    repos: list(value.repos ?? [], `${at}.repos`).map((binding, i) =>
      parseBinding(binding, `${at}.repos[${i}]`),
    ),
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function parseClient(raw: unknown, at: string): ClientConfig {
  const value = record(raw, at)
  const id = text(value.id, `${at}.id`)
  if (!SLUG.test(id)) throw badRequest(`${at}.id must be lowercase letters, numbers and dashes`)

  const environments = list(value.environments, `${at}.environments`).map((env, i) =>
    parseEnvironment(env, `${at}.environments[${i}]`),
  )
  const kinds = new Set<EnvKind>()
  for (const env of environments) {
    if (kinds.has(env.kind)) throw badRequest(`${at} has two "${env.kind}" environments`)
    kinds.add(env.kind)
  }

  const thresholds = isRecord(value.thresholds) ? value.thresholds : undefined
  return {
    id,
    name: text(value.name, `${at}.name`),
    region: typeof value.region === 'string' ? value.region.trim() : '',
    ...(thresholds
      ? {
          thresholds: {
            commits: count(thresholds.commits, `${at}.thresholds.commits`, DEFAULT_THRESHOLDS.commits),
            days: count(thresholds.days, `${at}.thresholds.days`, DEFAULT_THRESHOLDS.days),
          },
        }
      : {}),
    environments,
  }
}

/** Validates a raw config object, filling in defaults. Throws `HttpError` on bad input. */
export function parseConfig(raw: unknown): BoardConfig {
  const value = record(raw, 'config')
  const thresholds = isRecord(value.thresholds) ? value.thresholds : {}
  const probe = isRecord(value.probe) ? value.probe : {}

  const clients = list(value.clients ?? [], 'config.clients').map((client, i) =>
    parseClient(client, `config.clients[${i}]`),
  )
  const seen = new Set<string>()
  for (const client of clients) {
    if (seen.has(client.id)) throw badRequest(`Two clients share the id "${client.id}"`)
    seen.add(client.id)
  }
  if (seen.has('development')) throw badRequest('"development" is reserved for the shared row')

  const development = parseEnvironment(value.development, 'config.development')
  if (development.kind !== 'development') throw badRequest('config.development.kind must be "development"')

  return {
    thresholds: {
      commits: count(thresholds.commits, 'config.thresholds.commits', DEFAULT_THRESHOLDS.commits),
      days: count(thresholds.days, 'config.thresholds.days', DEFAULT_THRESHOLDS.days),
    },
    probe: {
      intervalSec: Math.max(5, count(probe.intervalSec, 'config.probe.intervalSec', DEFAULT_PROBE.intervalSec)),
      timeoutMs: Math.max(500, count(probe.timeoutMs, 'config.probe.timeoutMs', DEFAULT_PROBE.timeoutMs)),
      failuresToRed: Math.max(
        1,
        count(probe.failuresToRed, 'config.probe.failuresToRed', DEFAULT_PROBE.failuresToRed),
      ),
      controlUrl:
        probe.controlUrl === undefined
          ? DEFAULT_PROBE.controlUrl
          : parseUrl(probe.controlUrl, 'config.probe.controlUrl'),
    },
    fetchIntervalSec: Math.max(
      15,
      count(value.fetchIntervalSec, 'config.fetchIntervalSec', DEFAULT_FETCH_INTERVAL_SEC),
    ),
    development,
    clients,
  }
}

// ------------------------------------------------------------- state

function load(): BoardConfig | null {
  if (!existsSync(CONFIG_FILE)) return null
  try {
    return parseConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as unknown)
  } catch (error) {
    console.error(`clients.json is not usable: ${error instanceof Error ? error.message : error}`)
    return null
  }
}

let config: BoardConfig | null = load()

export const getConfig = () => config

export function saveConfig(next: BoardConfig): BoardConfig {
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2))
  config = next
  return next
}

/** Replaces one client, or adds it when the id is new. */
export function upsertClient(client: ClientConfig): BoardConfig {
  const current = config
  if (!current) throw badRequest('No board config yet')
  const clients = current.clients.some((c) => c.id === client.id)
    ? current.clients.map((c) => (c.id === client.id ? client : c))
    : [...current.clients, client]
  return saveConfig({ ...current, clients })
}

export function removeClient(id: string): BoardConfig {
  const current = config
  if (!current) throw badRequest('No board config yet')
  return saveConfig({ ...current, clients: current.clients.filter((c) => c.id !== id) })
}

/** The development row first, then one row per client, in config order. */
export function getRows(): Row[] {
  const current = config
  if (!current) return []
  const shared: Row = {
    id: 'development',
    name: 'Development',
    region: 'Shared',
    kind: 'shared',
    thresholds: current.thresholds,
    environments: [current.development],
  }
  const clients = current.clients.map<Row>((client) => ({
    id: client.id,
    name: client.name,
    region: client.region,
    kind: 'client',
    thresholds: { ...current.thresholds, ...client.thresholds },
    environments: client.environments,
  }))
  return [shared, ...clients]
}

/**
 * The environment an environment is promoted from: the client's own when it has one,
 * otherwise the shared development row.
 */
export function sourceOf(row: Row, env: EnvironmentConfig): EnvironmentConfig | null {
  if (!env.feedsFrom) return null
  const own = row.environments.find((candidate) => candidate.kind === env.feedsFrom)
  if (own) return own
  return env.feedsFrom === 'development' ? (config?.development ?? null) : null
}

export const configPath = () => CONFIG_FILE
