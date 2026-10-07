import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientIp } from '@/lib/security/client-ip'
import { hmac } from '@/lib/auth/reset'

/**
 * Server-only rate limiting for the auth endpoints, backed by the atomic
 * `auth_rate_limit_hit` RPC (sql/028). Keys are HMACs, so no raw e-mail or IP
 * lands in the database.
 *
 * Buckets are passed narrow -> wide: the RPC stops at the first denied bucket,
 * so a caller that is already blocked on its own IP / IP+identifier cannot keep
 * draining the shared per-identifier budget (that is how a victim would
 * otherwise be locked out by someone hammering their address).
 *
 * Fixed windows: a burst straddling a boundary can reach 2x the limit once.
 */

export interface RateRule {
  scope: string
  /** What is being counted (ip, e-mail, user id…); hashed before it is stored. */
  parts: string[]
  limit: number
  windowSec: number
}

export interface RateResult {
  allowed: boolean
  retryAfter: number
}

export const LIMITS = {
  forgot: {
    ip: { limit: 20, windowSec: 3600 },
    ipEmailCooldown: { limit: 1, windowSec: 60 },
    ipEmail: { limit: 3, windowSec: 3600 },
    /** Shared per address: a ceiling against mail-bombing, deliberately generous. */
    email: { limit: 10, windowSec: 3600 },
  },
  verify: {
    ip: { limit: 40, windowSec: 900 },
    ipEmail: { limit: 10, windowSec: 900 },
  },
  reset: {
    ip: { limit: 20, windowSec: 900 },
    ipEmail: { limit: 10, windowSec: 900 },
  },
  change: {
    ip: { limit: 30, windowSec: 900 },
    user: { limit: 10, windowSec: 900 },
  },
} as const

export function clientIp(request: Request): string {
  return getClientIp(request.headers)
}

export async function rateLimit(db: SupabaseClient, rules: RateRule[]): Promise<RateResult> {
  try {
    const { data, error } = await db.rpc('auth_rate_limit_hit', {
      p_buckets: rules.map((r) => `${r.scope}:${hmac(`rl:${r.scope}:${r.parts.join('|')}`)}`),
      p_limits: rules.map((r) => r.limit),
      p_windows: rules.map((r) => r.windowSec),
    })
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) throw new Error('rate-limit-unavailable')
    return { allowed: Boolean(row.allowed), retryAfter: Number(row.retry_after) || 0 }
  } catch {
    // Fail closed: if the limiter is down, the sensitive endpoints stay shut.
    console.error('[auth] rate limiter unavailable')
    return { allowed: false, retryAfter: 60 }
  }
}
