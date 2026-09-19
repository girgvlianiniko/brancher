import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { dataFile } from './paths'

/**
 * Settings an operator sets through the interface rather than the environment. The
 * environment still wins, so a container can be configured without anyone logging in.
 */
export interface Settings {
  githubToken?: string
}

const FILE = dataFile('settings.json')

function load(): Settings {
  if (!existsSync(FILE)) return {}
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Settings
  } catch {
    return {}
  }
}

let settings = load()

export function saveSettings(next: Settings) {
  settings = { ...settings, ...next }
  writeFileSync(FILE, JSON.stringify(settings, null, 2))
  // The token is a credential, so keep it off other accounts on the host.
  chmodSync(FILE, 0o600)
}

export const getSettings = () => settings

/** The environment wins, so a deployment can set it without anyone saving it here. */
export const githubToken = (): string | null =>
  process.env.GITHUB_TOKEN?.trim() || settings.githubToken?.trim() || null

export const tokenSource = (): 'environment' | 'saved' | 'none' =>
  process.env.GITHUB_TOKEN?.trim() ? 'environment' : settings.githubToken?.trim() ? 'saved' : 'none'

/** Last four characters only, so the interface can show which token is in use. */
export const tokenHint = (): string | null => {
  const token = githubToken()
  return token ? `…${token.slice(-4)}` : null
}
