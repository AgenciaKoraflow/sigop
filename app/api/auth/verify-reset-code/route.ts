import {
  GENERIC_INVALID,
  RESET_TOKEN_TTL_MIN,
  generateResetToken,
  getDb,
  hmac,
  isSameOrigin,
  jsonNoStore,
  minutesFromNow,
  safeEqualHex,
} from '@/lib/auth/reset'
import { verifyCodeSchema } from '@/lib/auth/password'

/**
 * POST /api/auth/verify-reset-code { email, code }
 * Checks the e-mailed code (max 5 attempts, single use, 10 min) and, on
 * success, returns a one-time reset token for the final step.
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

  const { data: row } = await db
    .from('password_reset_codes')
    .select('id, code_hash')
    .eq('email', email)
    .not('code_hash', 'is', null)
    .is('consumed_at', null)
    .is('reset_token_hash', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; code_hash: string }>()
  if (!row) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  const { data: attempts } = await db.rpc('bump_password_reset_attempt', { p_id: row.id })
  if (attempts === null || attempts === undefined) {
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }

  if (!safeEqualHex(hmac(`code:${email}:${code}`), row.code_hash)) {
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }

  const token = generateResetToken()
  const { error } = await db
    .from('password_reset_codes')
    .update({
      reset_token_hash: hmac(`token:${token}`),
      reset_expires_at: minutesFromNow(RESET_TOKEN_TTL_MIN),
    })
    .eq('id', row.id)
    .is('reset_token_hash', null)
  if (error) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  return jsonNoStore({ token })
}
