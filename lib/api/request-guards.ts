/**
 * Request checks shared by every `app/api/**` handler. Kept free of imports so
 * it can be unit-tested with the Node test runner (`npm test`).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a canonical UUID — path ids are checked before they reach a query. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

interface HeaderReader {
  get(name: string): string | null
}

/**
 * Rejects cross-site browser requests (CSRF defence in depth). Browsers always
 * send `Origin` / `Sec-Fetch-Site` on cross-site writes; their absence means a
 * non-browser caller, whose authentication is still enforced per route.
 */
export function isSameOriginRequest(headers: HeaderReader): boolean {
  if (headers.get('sec-fetch-site') === 'cross-site') return false

  const origin = headers.get('origin')
  if (!origin) return true
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
