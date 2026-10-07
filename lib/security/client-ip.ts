/**
 * Client IP resolution for rate limiting. Import-free apart from node:net so it
 * can be unit-tested with the Node test runner.
 *
 * `X-Forwarded-For` is client-controlled unless a proxy we trust overwrites it,
 * so a header is only believed when the deployment says so:
 *   - on Vercel (`VERCEL` is set) the edge overwrites `x-forwarded-for`,
 *     `x-real-ip` and `x-vercel-forwarded-for` with the connecting client IP and
 *     drops any value sent by the client;
 *   - elsewhere set `TRUSTED_IP_HEADER` to the single header your proxy
 *     overwrites (e.g. `cf-connecting-ip`, `fly-client-ip`);
 *   - with neither, forwarding headers are ignored (spoofable) and every caller
 *     falls into one bucket — safe against bypass, only used in local dev.
 */
import { isIP } from 'node:net'

interface HeaderReader {
  get(name: string): string | null
}

export const UNKNOWN_IP = 'unknown'

/** Parses the first address of a header value; null when it is not an IP. */
function parseIp(raw: string | null): string | null {
  const first = raw?.split(',')[0]?.trim()
  if (!first) return null
  // `[::1]:443` / `1.2.3.4:80` forms some proxies emit.
  const unbracketed = first.startsWith('[') ? first.slice(1, first.indexOf(']')) : first
  const candidate =
    isIP(unbracketed) === 0 && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(unbracketed)
      ? unbracketed.slice(0, unbracketed.lastIndexOf(':'))
      : unbracketed
  return isIP(candidate) === 0 ? null : candidate.toLowerCase()
}

/**
 * IPv6 clients usually own a whole /64, so counting full addresses lets an
 * attacker rotate through 2^64 buckets. Keep only the /64 prefix.
 */
export function normalizeIp(ip: string): string {
  if (isIP(ip) !== 6) return ip
  const [head, tail = ''] = ip.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const hasGap = ip.includes('::')
  const missing = 8 - headGroups.length - tailGroups.length
  const groups = hasGap
    ? [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups]
    : headGroups
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`
}

export function getClientIp(
  headers: HeaderReader,
  env: Record<string, string | undefined> = process.env,
): string {
  let ip: string | null = null

  const custom = env.TRUSTED_IP_HEADER?.trim().toLowerCase()
  if (custom) {
    ip = parseIp(headers.get(custom))
  } else if (env.VERCEL) {
    ip =
      parseIp(headers.get('x-vercel-forwarded-for')) ??
      parseIp(headers.get('x-real-ip')) ??
      parseIp(headers.get('x-forwarded-for'))
  }

  return ip ? normalizeIp(ip) : UNKNOWN_IP
}
