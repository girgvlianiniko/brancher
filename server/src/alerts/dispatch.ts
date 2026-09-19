import type { AlertChannel, AlertDelivery, Colour, StatusChange } from '../../../shared/status'
import { getChannels, publicUrl } from './config'
import { send, type Message } from './send'

/**
 * Changes wait here before anyone hears about them. The board checks every thirty
 * seconds, so without a hold a single slow response would page somebody at 3am for
 * something that fixed itself before they read it.
 */
interface Pending {
  change: StatusChange
  due: number
}

const pending = new Map<string, Pending>()
const recent: AlertDelivery[] = []
/** What each cell last looked like when we told someone about it. */
const announced = new Map<string, Colour>()

export const recentDeliveries = (limit = 40) => recent.slice(0, limit)

const matches = (channel: AlertChannel, change: StatusChange): boolean => {
  if (!channel.enabled) return false
  if (channel.clients.length > 0 && !channel.clients.includes(change.rowId)) return false
  if (channel.environments.length > 0 && !channel.environments.includes(change.envKind)) return false
  if (change.to === 'green') return channel.notifyRecovery && announced.get(change.cellRef) !== undefined
  return channel.notifyOn.includes(change.to)
}

/** Quiet hours never hold back something that is actually down. */
function isQuiet(channel: AlertChannel, colour: Colour): boolean {
  if (!channel.quietHours || colour === 'red') return false
  const { from, to } = channel.quietHours
  const hour = new Date().getHours()
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to
}

/** Called for every colour change the engine records. */
export function queueChange(change: StatusChange) {
  const anyone = getChannels().some((channel) => matches(channel, change))
  if (!anyone) {
    pending.delete(change.cellRef)
    return
  }
  // A recovery cancels a warning that has not been sent yet, which is the whole point.
  const hold = Math.max(...getChannels().filter((c) => matches(c, change)).map((c) => c.holdMinutes), 0)
  pending.set(change.cellRef, { change, due: Date.now() + hold * 60_000 })
}

function describe(change: StatusChange): Message {
  const link = publicUrl()
  const client = change.rowName
  return {
    where: `${client} · ${change.envKind}`,
    summary: change.to === 'green' ? `back to normal — ${change.word}` : change.word,
    detail: change.sentence,
    colour: change.to,
    link: link ? `${link}/c/${change.rowId}` : null,
  }
}

async function deliver(channel: AlertChannel, change: StatusChange) {
  const message = describe(change)
  const entry: AlertDelivery = {
    at: new Date().toISOString(),
    channelId: channel.id,
    channelLabel: channel.label,
    cellRef: change.cellRef,
    summary: `${message.where} — ${message.summary}`,
    ok: true,
    error: null,
  }
  try {
    await send(channel, message)
  } catch (error) {
    entry.ok = false
    entry.error = error instanceof Error ? error.message : 'Send failed'
  }
  recent.unshift(entry)
  recent.length = Math.min(recent.length, 200)
}

/** Sends anything whose hold has expired. Run me on a timer. */
export async function flush(currentColour: (cellRef: string) => Colour | undefined) {
  const now = Date.now()
  for (const [ref, item] of [...pending]) {
    if (item.due > now) continue
    pending.delete(ref)

    // It may have moved on while it waited; only tell people about where it is now.
    const colour = currentColour(ref)
    if (colour === undefined || colour !== item.change.to) continue

    for (const channel of getChannels()) {
      if (!matches(channel, item.change)) continue
      if (isQuiet(channel, item.change.to)) continue
      await deliver(channel, item.change)
    }
    if (item.change.to === 'green') announced.delete(ref)
    else announced.set(ref, item.change.to)
  }
}

/** Sends one message immediately, for the test button. */
export async function sendTest(channel: AlertChannel) {
  const link = publicUrl()
  await send(channel, {
    where: 'Brancher',
    summary: 'test message',
    detail: 'If you can read this, alerts to this channel work.',
    colour: 'green',
    link,
  })
}
