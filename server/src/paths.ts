import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** The brancher project folder, as laid out in the repository. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * Everything the app writes: the repo list, the client config and the status history.
 * A container mounts a volume here so it survives a redeploy.
 */
export const DATA_DIR = path.resolve(process.env.BRANCHER_DATA_DIR || path.join(PROJECT_ROOT, 'server', 'data'))

/**
 * Where git clones live. On a laptop this is the folder brancher sits in, so the clones
 * you already have are picked up. On a server it is a volume the app clones into.
 */
export const REPOS_DIR = path.resolve(process.env.BRANCHER_REPOS_DIR || path.dirname(PROJECT_ROOT))

/** The built web app, served by the same process in a container. */
export const WEB_DIR = path.resolve(process.env.BRANCHER_WEB_DIR || path.join(PROJECT_ROOT, 'web', 'dist'))

export const dataFile = (name: string) => path.join(DATA_DIR, name)

mkdirSync(DATA_DIR, { recursive: true })
