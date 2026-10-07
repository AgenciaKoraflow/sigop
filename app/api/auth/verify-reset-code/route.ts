import {
  GENERIC_INVALID,
  RESET_TOKEN_TTL_MIN,
  bindingHash,
  generateResetToken,
  getDb,
  hmac,
  isSameOrigin,
  jsonNoStore,
  minutesFromNow,
  readBinding,
  safeEqualHex,
  tooManyRequests,
} from '@/lib/auth/reset'
import { LIMITS, clientIp, rateLimit } from '@/lib/auth/rate-limit'
import { verifyCodeSchema } from '@/lib/auth/password'

/**
 * POST /api/auth/verify-reset-code { email, code }
 * Checks the e-mailed code and, on success, returns a one-time reset token.
 *
 * Budgets: per IP and per IP+address (answered with 429; they depend only on
 * the caller, never on whether the account exists), plus 5 attempts per code,
 * counted atomically in the database. The code is looked up through the
 * caller's binding cookie, so only the browser that requested it can spend its
 * attempts — a stranger hammering the victim's address burns nothing but their
 * own IP budget.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Requisição inválida.' }, 403)

  const parsed = verifyCodeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonNoStore({ error: GENERIC_INVALID }, 400)
  const { email, code } = parsed.data

  const db = getDb()
  if (!db || !process.env.PASSWORD_RESET_SECRET) {
    return jsonNoStore({ error: 'Serviço indisponível. Tente mais tarde.' }, 503)
  }

  const ip = clientIp(request)
  const limit = await rateLimit(db, [
    { scope: 'vf:ip', parts: [ip], ...LIMITS.verify.ip },
    { scope: 'vf:ipe', parts: [ip, email], ...LIMITS.verify.ipEmail },
  ])
  if (!limit.allowed) return tooManyRequests(limit.retryAfter)

  const candidate = hmac(`code:${email}:${code}`)

  const { data: row } = await db
    .from('password_reset_codes')
    .select('id, code_hash')
    .eq('email', email)
    .eq('binding_hash', bindingHash(readBinding(request)))
    .not('code_hash', 'is', null)
    .is('consumed_at', null)
    .is('reset_token_hash', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; code_hash: string }>()

  if (!row) {
    // Same hash + compare work as the real path, so a missing code is not faster.
    safeEqualHex(candidate, hmac('code:decoy'))
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }

  const { data: attempts } = await db.rpc('bump_password_reset_attempt', { p_id: row.id })
  if (attempts === null || attempts === undefined) {
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }

  if (!safeEqualHex(candidate, row.code_hash)) {
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }

  const token = generateResetToken()
  const { data: updated, error } = await db
    .from('password_reset_codes')
    .update({
      reset_token_hash: hmac(`token:${token}`),
      reset_expires_at: minutesFromNow(RESET_TOKEN_TTL_MIN),
    })
    .eq('id', row.id)
    .is('reset_token_hash', null)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (error || !updated) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  return jsonNoStore({ token })
}
