import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CODE_TTL_MIN,
  bindingHash,
  generateCode,
  getDb,
  hmac,
  isSameOrigin,
  jsonNoStore,
  minutesFromNow,
  newBinding,
  readBinding,
  sendResetCodeEmail,
  setBindingCookie,
} from '@/lib/auth/reset'
import { LIMITS, clientIp, rateLimit } from '@/lib/auth/rate-limit'
import { forgotPasswordSchema } from '@/lib/auth/password'

const GENERIC_OK = {
  ok: true,
  message: 'Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos.',
}

/** Everything that differs between a known and an unknown address. */
async function issueCode(db: SupabaseClient, email: string, binding: string, ip: string) {
  try {
    const { data: profile } = await db
      .from('profiles')
      .select('id, is_active')
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; is_active: boolean }>()
    if (!profile || !profile.is_active) return

    const binding_hash = bindingHash(binding)

    // Only the newest code of THIS browser is valid. Codes requested from other
    // browsers are left alone so a stranger cannot cancel the victim's code.
    await db
      .from('password_reset_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('email', email)
      .eq('binding_hash', binding_hash)
      .is('consumed_at', null)

    const code = generateCode()
    const { error } = await db.from('password_reset_codes').insert({
      email,
      user_id: profile.id,
      code_hash: hmac(`code:${email}:${code}`),
      binding_hash,
      expires_at: minutesFromNow(CODE_TTL_MIN),
      ip_hash: hmac(`ip:${ip}`),
    })
    if (error) {
      console.error('[auth] could not store reset code')
      return
    }

    if (!(await sendResetCodeEmail(email, code))) console.error('[auth] reset e-mail not sent')
  } catch {
    console.error('[auth] reset code issuing failed')
  }
}

/**
 * POST /api/auth/forgot-password { email }
 *
 * Anti-enumeration: before answering, the request does exactly the same work
 * for every address (parse, the rate-limit RPC, mint/refresh the binding
 * cookie). The account lookup, the code insert and the e-mail run in `after()`,
 * i.e. once the identical response is already on its way, so neither the body,
 * the status, the headers nor the latency say whether the address exists, is
 * inactive, was throttled, or the mail failed.
 *
 * Anti-lockout: counters are keyed by IP, IP+address and (only once the caller's
 * own buckets pass) the address, and the code is bound to the requesting
 * browser — see lib/auth/rate-limit.ts and sql/028.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Requisição inválida.' }, 403)

  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return jsonNoStore({ error: 'Informe um e-mail válido.' }, 400)
  const { email } = parsed.data

  const binding = readBinding(request) ?? newBinding()
  const respond = () => setBindingCookie(jsonNoStore(GENERIC_OK), binding)

  const db = getDb()
  if (!db || !process.env.PASSWORD_RESET_SECRET) {
    console.error('[auth] password reset is not configured')
    return respond()
  }

  const ip = clientIp(request)
  const { allowed } = await rateLimit(db, [
    { scope: 'fp:ip', parts: [ip], ...LIMITS.forgot.ip },
    { scope: 'fp:cd', parts: [ip, email], ...LIMITS.forgot.ipEmailCooldown },
    { scope: 'fp:ipe', parts: [ip, email], ...LIMITS.forgot.ipEmail },
    { scope: 'fp:e', parts: [email], ...LIMITS.forgot.email },
  ])
  if (allowed) after(() => issueCode(db, email, binding, ip))

  return respond()
}
