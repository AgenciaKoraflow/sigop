import { createAdminClient, revokeUserSessions } from '@/lib/supabase/admin'
import {
  GENERIC_INVALID,
  getDb,
  hmac,
  isSameOrigin,
  jsonNoStore,
} from '@/lib/auth/reset'
import { MUST_CHANGE_PASSWORD_FLAG, resetPasswordSchema } from '@/lib/auth/password'
import { PASSWORD_AUDIT_ENTITY } from '@/lib/usuarios/form'

/**
 * POST /api/auth/reset-password { email, token, password }
 * Final step: consumes the one-time token and sets the new password.
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

  // Atomic single use: only one concurrent caller gets the row back.
  const { data: row } = await db
    .from('password_reset_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', email)
    .eq('reset_token_hash', hmac(`token:${token}`))
    .is('consumed_at', null)
    .gt('reset_expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle<{ user_id: string | null }>()
  if (!row?.user_id) return jsonNoStore({ error: GENERIC_INVALID }, 400)

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(row.user_id, {
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
  await revokeUserSessions(admin, row.user_id)

  await db
    .from('password_reset_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', row.user_id)
    .is('consumed_at', null)

  await db.from('audit_log').insert({
    entity_type: PASSWORD_AUDIT_ENTITY,
    entity_id: row.user_id,
    operation: 'update',
    performed_by: row.user_id,
  })

  return jsonNoStore({ ok: true })
}
