/**
 * URL allowlists for user-controlled values that end up in `href` / `src`.
 *
 * `javascript:`, `data:`, `vbscript:` and friends are rejected by construction:
 * only parsed `https:` URLs on an explicit host allowlist are returned, always
 * re-serialized from the parsed URL (never the raw input).
 *
 * Mirrors the CHECK constraints in `sql/023_url_xss_hardening.sql`.
 */

const GOOGLE_MAPS_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co'])

/** `google.<tld>` / `*.google.<tld>` for the TLDs Google Maps actually uses. */
const GOOGLE_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*google\.(?:com|com\.br)$/

function parseHttpsUrl(input: string | null | undefined): URL | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text || text.length > 2048) return null
  // Control characters / whitespace inside the URL are a filter-evasion tell
  // (e.g. `java\tscript:`); the WHATWG parser would silently strip them.
  if (/[\u0000- \u007f]/.test(text)) return null

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url
}

/** Returns a safe Google Maps link, or `null` when the input is not one. */
export function safeGoogleMapsUrl(input: string | null | undefined): string | null {
  const url = parseHttpsUrl(input)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  if (!GOOGLE_MAPS_HOSTS.has(host) && !GOOGLE_HOST_PATTERN.test(host)) return null
  return url.href
}

/**
 * Returns a value safe for `<img src>` coming from a legacy free-text column:
 * an `https:` URL, or `null`. Storage paths are NOT accepted here — they must
 * be exchanged for signed URLs (`lib/fotos/urls.ts`) before reaching the DOM.
 */
export function safeImageUrl(input: string | null | undefined): string | null {
  const url = parseHttpsUrl(input)
  return url ? url.href : null
}
