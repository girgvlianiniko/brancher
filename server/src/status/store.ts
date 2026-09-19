import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Colour, EnvKind, ProbeSample, ServiceStatus, StatusChange } from '../../../shared/status'
import { dataFile } from '../paths'

const DB_FILE = dataFile('status.db')
/** Probe samples older than this are dropped once a day. */
const RETENTION_DAYS = 30

mkdirSync(path.dirname(DB_FILE), { recursive: true })

const db = new DatabaseSync(DB_FILE)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS probe_samples (
    service_ref TEXT NOT NULL,
    at          TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    http_status INTEGER,
    latency_ms  INTEGER,
    error       TEXT
  );
  CREATE INDEX IF NOT EXISTS probe_samples_ref_at ON probe_samples (service_ref, at);

  CREATE TABLE IF NOT EXISTS service_state (
    service_ref          TEXT PRIMARY KEY,
    status               TEXT NOT NULL,
    since                TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_changes (
    cell_ref    TEXT NOT NULL,
    row_id      TEXT NOT NULL,
    row_name    TEXT NOT NULL,
    env_kind    TEXT NOT NULL,
    from_colour TEXT,
    to_colour   TEXT NOT NULL,
    word        TEXT NOT NULL,
    sentence    TEXT NOT NULL,
    at          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS status_changes_row_at ON status_changes (row_id, at);
`)

/** A value straight out of sqlite, before it is narrowed to the column's real type. */
type Cell = unknown
type SqlRow = Record<string, Cell>

const asText = (value: Cell): string => (typeof value === 'string' ? value : '')
const asNumber = (value: Cell): number => (typeof value === 'number' ? value : Number(value ?? 0))
const asNullableNumber = (value: Cell): number | null =>
  value === null || value === undefined ? null : asNumber(value)

const insertSample = db.prepare(
  'INSERT INTO probe_samples (service_ref, at, ok, http_status, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
)
const upsertState = db.prepare(`
  INSERT INTO service_state (service_ref, status, since, consecutive_failures) VALUES (?, ?, ?, ?)
  ON CONFLICT (service_ref) DO UPDATE SET status = excluded.status, since = excluded.since,
    consecutive_failures = excluded.consecutive_failures
`)
const insertChange = db.prepare(`
  INSERT INTO status_changes (cell_ref, row_id, row_name, env_kind, from_colour, to_colour, word, sentence, at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const selectStates = db.prepare('SELECT * FROM service_state')
const selectHistory = db.prepare(
  'SELECT * FROM probe_samples WHERE service_ref = ? AND at >= ? ORDER BY at ASC',
)
const selectChanges = db.prepare('SELECT * FROM status_changes WHERE row_id = ? ORDER BY at DESC LIMIT ?')
const selectAllChanges = db.prepare('SELECT * FROM status_changes ORDER BY at DESC LIMIT ?')
const deleteOldSamples = db.prepare('DELETE FROM probe_samples WHERE at < ?')
const selectUptime = db.prepare(
  'SELECT COUNT(*) AS total, SUM(ok) AS good FROM probe_samples WHERE service_ref = ? AND at >= ?',
)

export interface StoredServiceState {
  status: ServiceStatus
  since: string
  consecutiveFailures: number
}

export function recordProbe(serviceRef: string, sample: ProbeSample) {
  insertSample.run(
    serviceRef,
    sample.at,
    sample.ok ? 1 : 0,
    sample.httpStatus,
    sample.latencyMs,
    sample.error,
  )
}

export function saveServiceState(serviceRef: string, state: StoredServiceState) {
  upsertState.run(serviceRef, state.status, state.since, state.consecutiveFailures)
}

/** Service states from the last run, so "down since" survives a restart. */
export function loadServiceStates(): Map<string, StoredServiceState> {
  const states = new Map<string, StoredServiceState>()
  for (const raw of selectStates.all() as SqlRow[]) {
    const status = asText(raw.status)
    states.set(asText(raw.service_ref), {
      status: status === 'up' || status === 'down' ? status : 'unknown',
      since: asText(raw.since),
      consecutiveFailures: asNumber(raw.consecutive_failures),
    })
  }
  return states
}

export function recordChange(change: StatusChange) {
  insertChange.run(
    change.cellRef,
    change.rowId,
    change.rowName,
    change.envKind,
    change.from,
    change.to,
    change.word,
    change.sentence,
    change.at,
  )
}

const toChange = (raw: SqlRow): StatusChange => ({
  cellRef: asText(raw.cell_ref),
  rowId: asText(raw.row_id),
  rowName: asText(raw.row_name),
  envKind: asText(raw.env_kind) as EnvKind,
  from: raw.from_colour === null || raw.from_colour === undefined ? null : (asText(raw.from_colour) as Colour),
  to: asText(raw.to_colour) as Colour,
  word: asText(raw.word),
  sentence: asText(raw.sentence),
  at: asText(raw.at),
})

export function changesFor(rowId: string, limit = 50): StatusChange[] {
  return (selectChanges.all(rowId, limit) as SqlRow[]).map(toChange)
}

export function recentChanges(limit = 50): StatusChange[] {
  return (selectAllChanges.all(limit) as SqlRow[]).map(toChange)
}

export function historyFor(serviceRef: string, hours: number): ProbeSample[] {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  return (selectHistory.all(serviceRef, since) as SqlRow[]).map((raw) => ({
    at: asText(raw.at),
    ok: asNumber(raw.ok) === 1,
    httpStatus: asNullableNumber(raw.http_status),
    latencyMs: asNullableNumber(raw.latency_ms),
    error: raw.error === null || raw.error === undefined ? null : asText(raw.error),
  }))
}

/** Share of probes that answered in the window, or `null` when there were none. */
export function uptimeFor(serviceRefs: string[], hours: number): number | null {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  let total = 0
  let good = 0
  for (const ref of serviceRefs) {
    const row = selectUptime.get(ref, since) as SqlRow | undefined
    if (!row) continue
    total += asNumber(row.total)
    good += asNumber(row.good)
  }
  return total === 0 ? null : good / total
}

export function pruneOldSamples() {
  deleteOldSamples.run(new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString())
}

export function closeStore() {
  db.close()
}
