/** An error that maps straight onto an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429 | 500 | 502,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (message: string) => new HttpError(400, message)
export const notFound = (message: string) => new HttpError(404, message)

const REF_PATTERN = /^[A-Za-z0-9._/@+-]+$/

/**
 * Accepts a branch, tag or sha from a query string. Refs reach `git` as plain arguments
 * (no shell), but a leading `-` would still read as an option, so it is refused along
 * with anything git itself wouldn't allow in a ref name.
 */
export function assertRef(value: string | undefined, label: string): string {
  if (!value) throw badRequest(`${label} is required`)
  if (!REF_PATTERN.test(value) || value.startsWith('-') || value.includes('..')) {
    throw badRequest(`${label} "${value}" is not a valid ref name`)
  }
  return value
}
