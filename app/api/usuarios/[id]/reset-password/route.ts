import { NextResponse } from 'next/server'
import { adminUnavailable, invalidId } from '@/lib/api/errors'
import { describeAuthError } from '@/lib/usuarios/errors'
import { isUuid } from '@/lib/api/request-guards'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, revokeUserSessions } from '@/lib/supabase/admin'
import { MUST_CHANGE_PASSWORD_FLAG } from '@/lib/auth/password'
import { requireAdmin } from '@/lib/usuarios/guard'
import { saveProvisionalPassword } from '@/lib/usuarios/credentials-store'
import {
  PASSWORD_AUDIT_ENTITY,
  generateProvisionalPassword,
  passwordChangeSchema,
} from '@/lib/usuarios/form'

/**
 * POST /api/usuarios/[id]/reset-password
 * Changes a user's password. The admin may send the new one (`{ password }`);
 * without it a fresh provisional password is generated. Either way it is
 * returned once, for the admin to hand over to the user.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return invalidId()

  const json = await request.json().catch(() => null)
  const parsed = passwordChangeSchema.safeParse(json ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' },
      { status: 400 },
    )
  }
  const password = parsed.data.password ?? generateProvisionalPassword()

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return adminUnavailable(err)
  }

  const { error } = await admin.auth.admin.updateUserById(params.id, {
    password,
    app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: true },
  })
  if (error) {
    console.error('[api] reset-password:', error.message)
    const failure = describeAuthError(error, 'Não foi possível trocar a senha.')
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status })
  }

  // Old sessions must not survive a password change.
  const revoked = await revokeUserSessions(admin, params.id)
  if (!revoked) {
    // Never hand over a password while the old (possibly stolen) session lives.
    return NextResponse.json(
      { error: 'Senha alterada, mas as sessões antigas não puderam ser encerradas. Repita a operação.' },
      { status: 500 },
    )
  }

  // The new password is provisional again (must change on next login): keep it
  // encrypted for the bulk access export until the user replaces it.
  await saveProvisionalPassword(admin as unknown as SupabaseClient, params.id, password, gate.userId)

  // Best effort — feeds the "trocas de senha" counter on the users dashboard.
  await (admin as unknown as SupabaseClient).from('audit_log').insert({
    entity_type: PASSWORD_AUDIT_ENTITY,
    entity_id: params.id,
    operation: 'update',
    performed_by: gate.userId,
  })

  // The plaintext provisional password is shown once: keep it out of every cache.
  return NextResponse.json({ password }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
