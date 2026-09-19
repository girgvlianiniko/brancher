import { Bell, Check, Loader2, Plus, Send, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import type { AlertChannel, ChannelKind, Colour, EnvKind } from '../../../shared/status'
import { CHANNEL_KINDS, ENV_KINDS } from '../../../shared/status'
import { useAlerts, useBoard, useDeleteChannel, useSaveChannel, useTestChannel } from '../api'
import { Shell } from '../components/Shell'
import { StatusDot, TEXT } from '../components/StatusBits'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { timeAgo } from '../lib/format'

const KIND_LABEL: Record<ChannelKind, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
  webhook: 'Your own endpoint',
  apprise: 'Apprise',
}

/** What to ask for, and where to get it, per service. */
const FIELDS: Record<ChannelKind, { key: string; label: string; hint: string; secret?: boolean }[]> = {
  slack: [{ key: 'url', label: 'Incoming webhook URL', hint: 'Slack → Apps → Incoming Webhooks → Add to a channel' }],
  discord: [{ key: 'url', label: 'Webhook URL', hint: 'Channel settings → Integrations → Webhooks' }],
  webhook: [{ key: 'url', label: 'Endpoint URL', hint: 'We POST JSON with the pieces, not a sentence' }],
  apprise: [{ key: 'url', label: 'Apprise notify URL', hint: 'Your Apprise container, e.g. http://apprise:8000/notify/key' }],
  telegram: [
    { key: 'token', label: 'Bot token', hint: 'Talk to @BotFather to make a bot', secret: true },
    { key: 'chat', label: 'Chat id', hint: 'A numeric id, or @channelname for a public channel' },
  ],
}

const SEVERITIES: { colour: Colour; label: string; note: string }[] = [
  { colour: 'red', label: 'Down', note: 'a site is not answering' },
  { colour: 'alert', label: 'Far behind', note: 'one part is past the limit' },
  { colour: 'yellow', label: 'Behind', note: 'anything waiting too long' },
  { colour: 'grey', label: 'Not checked', note: 'a check stopped working' },
]

const blank = (kind: ChannelKind): AlertChannel => ({
  id: '',
  kind,
  label: KIND_LABEL[kind],
  enabled: true,
  config: {},
  notifyOn: ['red'],
  notifyRecovery: true,
  clients: [],
  environments: [],
  holdMinutes: 2,
  quietHours: null,
})

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface-2/50 px-3 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none'

const chip = (on: boolean) =>
  cn(
    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
    on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg',
  )

function ChannelForm({
  channel,
  onChange,
  onDone,
}: {
  channel: AlertChannel
  onChange: (next: AlertChannel) => void
  onDone: () => void
}) {
  const save = useSaveChannel()
  const test = useTestChannel()
  const board = useBoard()
  const clients = (board.data?.rows ?? []).filter((row) => row.kind === 'client')

  const set = (patch: Partial<AlertChannel>) => onChange({ ...channel, ...patch })
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {CHANNEL_KINDS.map((kind) => (
          <button
            key={kind}
            onClick={() => set({ kind, config: {}, label: KIND_LABEL[kind] })}
            className={chip(channel.kind === kind)}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-3">Name</span>
        <input value={channel.label} onChange={(e) => set({ label: e.target.value })} className={inputClass} />
      </label>

      {FIELDS[channel.kind].map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-xs font-medium text-fg-3">{field.label}</span>
          <input
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            value={channel.config[field.key] ?? ''}
            onChange={(e) => set({ config: { ...channel.config, [field.key]: e.target.value } })}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-fg-3">{field.hint}</span>
        </label>
      ))}

      <div>
        <span className="mb-1.5 block text-xs font-medium text-fg-3">Send when something becomes</span>
        <div className="flex flex-wrap gap-1.5">
          {SEVERITIES.map((severity) => (
            <button
              key={severity.colour}
              onClick={() => set({ notifyOn: toggle(channel.notifyOn, severity.colour) })}
              className={cn(chip(channel.notifyOn.includes(severity.colour)), 'inline-flex items-center gap-1.5')}
              title={severity.note}
            >
              <StatusDot colour={severity.colour} />
              {severity.label}
            </button>
          ))}
          <button
            onClick={() => set({ notifyRecovery: !channel.notifyRecovery })}
            className={cn(chip(channel.notifyRecovery), 'inline-flex items-center gap-1.5')}
            title="Also say when it goes back to normal"
          >
            <StatusDot colour="green" />
            and when it recovers
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-3">Wait before sending</span>
          <select
            value={channel.holdMinutes}
            onChange={(e) => set({ holdMinutes: Number(e.target.value) })}
            className={inputClass}
          >
            {[0, 1, 2, 5, 10, 15, 30].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? 'Send straight away' : `${minutes} minute${minutes === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-fg-3">
            Anything that fixes itself inside this window is never sent.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-3">Stay quiet between</span>
          <div className="flex items-center gap-2">
            <select
              value={channel.quietHours?.from ?? -1}
              onChange={(e) =>
                set({
                  quietHours:
                    Number(e.target.value) < 0
                      ? null
                      : { from: Number(e.target.value), to: channel.quietHours?.to ?? 8 },
                })
              }
              className={inputClass}
            >
              <option value={-1}>Never quiet</option>
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            {channel.quietHours && (
              <select
                value={channel.quietHours.to}
                onChange={(e) =>
                  set({ quietHours: { from: channel.quietHours!.from, to: Number(e.target.value) } })
                }
                className={inputClass}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="mt-1 block text-xs text-fg-3">Something being down still gets through.</span>
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-fg-3">
          Only these clients {channel.clients.length === 0 && <span className="text-fg-3/70">· all of them</span>}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {clients.map((client) => (
            <button
              key={client.id}
              onClick={() => set({ clients: toggle(channel.clients, client.id) })}
              className={chip(channel.clients.includes(client.id))}
            >
              {client.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-fg-3">
          Only these environments{' '}
          {channel.environments.length === 0 && <span className="text-fg-3/70">· all of them</span>}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ENV_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => set({ environments: toggle(channel.environments, kind as EnvKind) })}
              className={cn(chip(channel.environments.includes(kind)), 'capitalize')}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      {(save.isError || test.isError) && <ErrorBox error={save.error ?? test.error} />}
      {test.isSuccess && <p className="text-[13px] text-add">Sent. Go and look.</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate(channel, { onSuccess: onDone })}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save
        </Button>
        <Button disabled={test.isPending} onClick={() => test.mutate(channel)}>
          {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send a test
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function AlertsPage() {
  const alerts = useAlerts()
  const save = useSaveChannel()
  const remove = useDeleteChannel()
  const [editing, setEditing] = useState<AlertChannel | null>(null)

  return (
    <Shell
      title="Alerts"
      subtitle={
        alerts.data
          ? `${alerts.data.channels.length} destination${alerts.data.channels.length === 1 ? '' : 's'}`
          : undefined
      }
      actions={
        !editing && (
          <Button variant="primary" onClick={() => setEditing(blank('slack'))}>
            <Plus className="size-4" aria-hidden /> Add a destination
          </Button>
        )
      }
    >
      <div className="max-w-3xl space-y-4">
        {alerts.data && !alerts.data.publicUrl && (
          <div className="rounded-lg border border-warn/40 bg-warn-soft/30 px-4 py-3 text-[13px]">
            <TriangleAlert className="mr-1.5 inline size-4 text-warn" aria-hidden />
            Set <code className="font-mono">BRANCHER_PUBLIC_URL</code> and every alert will carry a link
            back to the client it is about.
          </div>
        )}

        {editing && (
          <Card title={editing.id ? `Edit ${editing.label}` : 'New destination'}>
            <ChannelForm channel={editing} onChange={setEditing} onDone={() => setEditing(null)} />
          </Card>
        )}

        {alerts.isPending ? (
          <Spinner />
        ) : alerts.isError ? (
          <ErrorBox error={alerts.error} />
        ) : alerts.data.channels.length === 0 && !editing ? (
          <Card title="Nowhere to send anything yet">
            <Empty>
              Add Slack, Telegram or anything else and Brancher will tell it when a client goes down.
            </Empty>
          </Card>
        ) : (
          alerts.data.channels.map((channel) => (
            <Card
              key={channel.id}
              title={
                <span className="flex items-center gap-2">
                  <Bell className="size-4 text-fg-3" aria-hidden />
                  {channel.label}
                  <span className="text-xs font-normal text-fg-3">{KIND_LABEL[channel.kind]}</span>
                  {!channel.enabled && <span className="text-xs font-normal text-warn">paused</span>}
                </span>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-x-2">
                  <span>
                    on{' '}
                    {channel.notifyOn.map((colour, i) => (
                      <span key={colour} className={TEXT[colour]}>
                        {i > 0 && ', '}
                        {SEVERITIES.find((s) => s.colour === colour)?.label ?? colour}
                      </span>
                    ))}
                    {channel.notifyRecovery && <span className="text-add">, recovery</span>}
                  </span>
                  <span>·</span>
                  <span>{channel.clients.length === 0 ? 'every client' : `${channel.clients.length} clients`}</span>
                  {channel.holdMinutes > 0 && <span>· after {channel.holdMinutes} min</span>}
                  {channel.quietHours && (
                    <span>
                      · quiet {String(channel.quietHours.from).padStart(2, '0')}–
                      {String(channel.quietHours.to).padStart(2, '0')}
                    </span>
                  )}
                </span>
              }
              action={
                <div className="flex items-center gap-1.5">
                  <Button onClick={() => save.mutate({ ...channel, enabled: !channel.enabled })}>
                    {channel.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button onClick={() => setEditing(channel)}>Edit</Button>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${channel.label}?`)) remove.mutate(channel.id)
                    }}
                    aria-label={`Remove ${channel.label}`}
                    className="grid size-9 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-del"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              }
            >
              <span className="sr-only">{channel.label}</span>
            </Card>
          ))
        )}

        {alerts.data && alerts.data.recent.length > 0 && (
          <Card title="Recently sent" subtitle="The last few, newest first">
            <ul className="divide-y divide-line text-sm">
              {alerts.data.recent.slice(0, 12).map((delivery, index) => (
                <li key={`${delivery.at}-${index}`} className="flex flex-wrap items-baseline gap-2 py-2">
                  <StatusDot colour={delivery.ok ? 'green' : 'red'} />
                  <span className="min-w-0 flex-1 truncate">{delivery.summary}</span>
                  <span className="text-xs text-fg-3">{delivery.channelLabel}</span>
                  <span className="text-xs text-fg-3">{timeAgo(delivery.at)}</span>
                  {!delivery.ok && <span className="w-full text-xs text-del">{delivery.error}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  )
}
