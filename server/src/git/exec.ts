import { execFile } from 'node:child_process'

/** Field and record separators used in `--format` strings (`%x1f` / `%x1e`). */
export const US = '\x1f'
export const RS = '\x1e'

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message)
  }
}

interface GitOptions {
  /** Resolve with an empty string instead of rejecting when git exits non-zero. */
  allowFail?: boolean
  timeoutMs?: number
}

/**
 * Runs git in `cwd` without a shell. These are repos people are actively working in, so
 * `GIT_OPTIONAL_LOCKS=0` keeps read commands like `status` from taking the index lock,
 * and `GIT_TERMINAL_PROMPT=0` makes a fetch that needs credentials fail instead of hang.
 */
export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  const { allowFail = false, timeoutMs = 60_000 } = options
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args],
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if (allowFail) return resolve('')
        const exitCode = typeof error.code === 'number' ? error.code : null
        const detail = stderr.trim() || error.message
        reject(new GitCommandError(`git ${args[0]} failed: ${detail}`, exitCode, stderr))
      },
    )
  })
}
