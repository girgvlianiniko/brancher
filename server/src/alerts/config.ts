import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import type { AlertChannel, ChannelKind, Colour, EnvKind } from '../../../shared/status'
import { CHANNEL_KINDS, ENV_KINDS } from '../../../shared/status'
import { badRequest } from '../errors'
import { dataFile } from '../paths'

const FILE = dataFile('alerts.json')

const COLOURS: Colour[] = ['green', 'yellow', 'alert', 'red', 'grey']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${at} is required`)
  return value.trim()
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], at: string): T => {
  const found = allowed.find((option) => option === value)
  if (!found) throw badRequest(`${at} must be one of ${allowed.join(', ')}`)
  return found
}

/** What each kind needs before it can send anything. */
const REQUIRED: Record<ChannelKind, string[]> = {
  slack: ['url'],
  discord: ['url'],
  webhook: ['url'],
  apprise: ['url'],
  telegram: ['token', 'chat'],
}

export function parseChannel(raw: unknown, at = 'channel'): AlertChannel {
  const value = isRecord(raw) ? raw : {}
  const kind = pick<ChannelKind>(value.kind, CHANNEL_KINDS, `${at}.kind`)
  const config = isRecord(value.config) ? value.config : {}

  const cleaned: Record<string, string> = {}
  for (const key of REQUIRED[kind]) cleaned[key] = text(config[key], `${at}.config.${key}`)
  if (kind === 'telegram' && !/^-?\d+$/.test(cleaned.chat) && !cleaned.chat.startsWith('@')) {
    throw badRequest(`${at}.config.chat should be a numeric chat id or an @channelname`)
  }
  if (cleaned.url) {
    try {
      const parsed = new URL(cleaned.url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('scheme')
    } catch {
      throw badRequest(`${at}.config.url is not a valid URL`)
    }
  }

  const hours = isRecord(value.quietHours) ? value.quietHours : null
  const hour = (input: unknown) => {
    const number = Number(input)
    return Number.isInteger(number) && number >= 0 && number <= 23 ? number : null
  }
  const from = hours ? hour(hours.from) : null
  const to = hours ? hour(hours.to) : null

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : crypto.randomUUID(),
    kind,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : kind,
    enabled: value.enabled !== false,
    config: cleaned,
    notifyOn: Array.isArray(value.notifyOn)
      ? [...new Set(value.notifyOn.filter((c): c is Colour => COLOURS.includes(c as Colour)))]
      : ['red'],
    notifyRecovery: value.notifyRecovery === true,
    clients: Array.isArray(value.clients)
      ? value.clients.filter((c): c is string => typeof c === 'string')
      : [],
    environments: Array.isArray(value.environments)
      ? value.environments.filter((e): e is EnvKind => ENV_KINDS.includes(e as EnvKind))
      : [],
    holdMinutes: Math.max(0, Math.min(120, Number(value.holdMinutes) || 0)),
    quietHours: from !== null && to !== null ? { from, to } : null,
  }
}

function load(): AlertChannel[] {
  if (!existsSync(FILE)) return []
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as unknown
    return Array.isArray(raw) ? raw.map((entry) => parseChannel(entry)) : []
  } catch (error) {
    console.error(`alerts.json is not usable: ${error instanceof Error ? error.message : error}`)
    return []
  }
}

let channels = load()

export const getChannels = () => channels

function save() {
  const temporary = `${FILE}.tmp`
  writeFileSync(temporary, JSON.stringify(channels, null, 2))
  renameSync(temporary, FILE)
}

export function upsertChannel(channel: AlertChannel): AlertChannel {
  channels = channels.some((existing) => existing.id === channel.id)
    ? channels.map((existing) => (existing.id === channel.id ? channel : existing))
    : [...channels, channel]
  save()
  return channel
}

export function removeChannel(id: string) {
  channels = channels.filter((channel) => channel.id !== id)
  save()
}

export const publicUrl = () => process.env.BRANCHER_PUBLIC_URL?.replace(/\/$/, '') || null
