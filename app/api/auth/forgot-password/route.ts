import {
  CODE_TTL_MIN,
  clientIpHash,
  generateCode,
  getDb,
  hmac,
  isRateLimited,
  isSameOrigin,
  jsonNoStore,
  minutesFromNow,
  sendResetCodeEmail,
} from '@/lib/auth/reset'
import { forgotPasswordSchema } from '@/lib/auth/password'

const GENERIC_OK = {
  ok: true,
  message: 'Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos.',
}

/**
 * POST /api/auth/forgot-password { email }
 * Always answers the same 200 whether or not the e-mail exists, is rate
 * limited, or the mail failed — so it cannot be used to enumerate accounts.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Requisição inválida.' }, 403)

  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonNoStore({ error: 'Informe um e-mail válido.' }, 400)
  const { email } = parsed.data

  const db = getDb()
  if (!db || !process.env.PASSWORD_RESET_SECRET) {
    console.error('[auth] password reset is not configured')
    return jsonNoStore(GENERIC_OK)
  }

  const ipHash = clientIpHash(request)
  if (await isRateLimited(db, email, ipHash)) return jsonNoStore(GENERIC_OK)

  const { data: profile } = await db
    .from('profiles')
    .select('id, is_active')
    .eq('email', email)
    .maybeSingle<{ id: string; is_active: boolean }>()
  const eligible = Boolean(profile && profile.is_active)

  if (!eligible || !profile) {
    // Logged so the rate limit treats unknown addresses like real ones.
    await db.from('password_reset_codes').insert({
      email,
      expires_at: new Date().toISOString(),
      ip_hash: ipHash,
    })
    return jsonNoStore(GENERIC_OK)
  }

  // Only the newest code is valid.
  await db
    .from('password_reset_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', profile.id)
    .is('consumed_at', null)

  const code = generateCode()
  const { error } = await db.from('password_reset_codes').insert({
    email,
    user_id: profile.id,
    code_hash: hmac(`code:${email}:${code}`),
    expires_at: minutesFromNow(CODE_TTL_MIN),
    ip_hash: ipHash,
  })
  if (error) {
    console.error('[auth] could not store reset code')
    return jsonNoStore(GENERIC_OK)
  }

  if (!(await sendResetCodeEmail(email, code))) console.error('[auth] reset e-mail not sent')
  return jsonNoStore(GENERIC_OK)
}
