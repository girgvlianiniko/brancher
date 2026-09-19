import type { AlertChannel, Colour } from '../../../shared/status'

/**
 * One adapter per service, written directly.
 *
 * There is no Node library worth depending on here: the unified ones are either stale,
 * unpublished, or brand new with almost no use, and every service below is a single
 * POST. A library would also fight us on formatting, which is the one place these
 * services genuinely differ. Anything not covered can go through a generic webhook, or
 * through an Apprise container for the long tail of services.
 */

export interface Message {
  /** One line, already in plain language. */
  summary: string
  /** Where the trouble is, e.g. "Asdfbet · Production". */
  where: string
  colour: Colour
  detail?: string
  link?: string | null
}

const MARK: Record<Colour, string> = {
  red: '🔴',
  alert: '🟠',
  yellow: '🟡',
  green: '🟢',
  grey: '⚪',
}

const plain = (message: Message) =>
  [`${MARK[message.colour]} ${message.where} — ${message.summary}`, message.detail, message.link]
    .filter(Boolean)
    .join('\n')

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
}

const SENDERS: Record<AlertChannel['kind'], (channel: AlertChannel, message: Message) => Promise<void>> = {
  slack: (channel, message) =>
    post(channel.config.url, {
      text: plain(message),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${MARK[message.colour]} *${message.where}*\n${message.summary}`,
          },
        },
        ...(message.detail
          ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: message.detail }] }]
          : []),
        ...(message.link
          ? [
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'Open the board' },
                    url: message.link,
                  },
                ],
              },
            ]
          : []),
      ],
    }),

  discord: (channel, message) =>
    post(channel.config.url, {
      content: plain(message),
    }),

  telegram: (channel, message) =>
    post(`https://api.telegram.org/bot${channel.config.token}/sendMessage`, {
      chat_id: channel.config.chat,
      text: plain(message),
      disable_web_page_preview: true,
    }),

  // Apprise's API container takes a body like this and fans it out to anything it knows.
  apprise: (channel, message) =>
    post(channel.config.url, {
      title: `${message.where} — ${message.summary}`,
      body: [message.detail, message.link].filter(Boolean).join('\n') || message.summary,
      type: message.colour === 'red' ? 'failure' : message.colour === 'green' ? 'success' : 'warning',
    }),

  // Your own endpoint, with the pieces rather than a rendered sentence.
  webhook: (channel, message) =>
    post(channel.config.url, {
      where: message.where,
      summary: message.summary,
      detail: message.detail ?? null,
      colour: message.colour,
      link: message.link ?? null,
      at: new Date().toISOString(),
    }),
}

export const send = (channel: AlertChannel, message: Message) => SENDERS[channel.kind](channel, message)
