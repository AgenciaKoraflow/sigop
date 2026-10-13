import { createAdminClient, revokeUserSessions } from '@/lib/supabase/admin'
import {
  GENERIC_INVALID,
  bindingHash,
  clearBindingCookie,
  getDb,
  hmac,
  isSameOrigin,
  jsonNoStore,
  readBinding,
  safeEqualHex,
  tooManyRequests,
} from '@/lib/auth/reset'
import { LIMITS, clientIp, rateLimit } from '@/lib/auth/rate-limit'
import { MUST_CHANGE_PASSWORD_FLAG, resetPasswordSchema } from '@/lib/auth/password'
import { PASSWORD_AUDIT_ENTITY } from '@/lib/usuarios/form'

/**
 * POST /api/auth/reset-password { email, token, password }
 * Final step: consumes the one-time token (bound to the requesting browser,
 * compared in constant time, single use) and sets the new password.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Requisição inválida.' }, 403)

  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const passwordIssue = issue?.path[0] === 'password'
    return jsonNoStore({ error: passwordIssue ? issue.message : GENERIC_INVALID }, 400)
  }
  const { email, token, password } = parsed.data

  const db = getDb()
  if (!db || !process.env.PASSWORD_RESET_SECRET) {
    return jsonNoStore({ error: 'Serviço indisponível. Tente mais tarde.' }, 503)
  }

  const ip = clientIp(request)
  const limit = await rateLimit(db, [
    { scope: 'rs:ip', parts: [ip], ...LIMITS.reset.ip },
    { scope: 'rs:ipe', parts: [ip, email], ...LIMITS.reset.ipEmail },
  ])
  if (!limit.allowed) return tooManyRequests(limit.retryAfter)

  const candidate = hmac(`token:${token}`)

  const { data: row } = await db
    .from('password_reset_codes')
    .select('id, user_id, reset_token_hash')
    .eq('email', email)
    .eq('binding_hash', bindingHash(readBinding(request)))
    .not('reset_token_hash', 'is', null)
    .is('consumed_at', null)
    .gt('reset_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; user_id: string | null; reset_token_hash: string }>()

  if (!row) {
    safeEqualHex(candidate, hmac('token:decoy'))
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }
  if (!row.user_id || !safeEqualHex(candidate, row.reset_token_hash)) {
    return jsonNoStore({ error: GENERIC_INVALID }, 400)
  }
  const userId = row.user_id

  // Atomic single use: only one concurrent caller gets the row back.
  const { data: claimed } = await db
    .from('password_reset_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (!claimed) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  // The account may have been deactivated/deleted since the code was sent.
  const { data: profile } = await db
    .from('profiles')
    .select('is_active')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle<{ is_active: boolean }>()
  if (!profile?.is_active) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: false },
  })
  if (error) {
    console.error('[auth] password update failed')
    return jsonNoStore(
      { error: 'Não foi possível trocar a senha. Solicite um novo código.' },
      400,
    )
  }

  // Whoever held the old password (or a stolen session) is signed out.
  await revokeUserSessions(admin, userId)

  // Every other pending code/token of this account dies with the old password.
  await db
    .from('password_reset_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('consumed_at', null)

  await db.from('audit_log').insert({
    entity_type: PASSWORD_AUDIT_ENTITY,
    entity_id: userId,
    operation: 'update',
    performed_by: userId,
  })

  return clearBindingCookie(jsonNoStore({ ok: true }))
}
