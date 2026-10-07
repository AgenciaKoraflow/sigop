import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDb, isSameOrigin, jsonNoStore } from '@/lib/auth/reset'
import { MUST_CHANGE_PASSWORD_FLAG, changePasswordSchema } from '@/lib/auth/password'
import { PASSWORD_AUDIT_ENTITY } from '@/lib/usuarios/form'

/**
 * POST /api/auth/change-password { currentPassword, password }
 * Used for the mandatory first-login change. Re-checks the current password so
 * a hijacked session alone cannot take over the account.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'Requisição inválida.' }, 403)

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return jsonNoStore({ error: 'Não autenticado.' }, 401)

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return jsonNoStore({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, 400)
  }
  const { currentPassword, password } = parsed.data

  if (currentPassword === password) {
    return jsonNoStore({ error: 'A nova senha deve ser diferente da atual.' }, 400)
  }

  // Verify the current password on a throwaway client (no session persisted).
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyError) return jsonNoStore({ error: 'A senha atual está incorreta.' }, 400)

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return jsonNoStore({ error: 'Serviço indisponível. Tente mais tarde.' }, 503)
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    app_metadata: { [MUST_CHANGE_PASSWORD_FLAG]: false },
  })
  if (error) return jsonNoStore({ error: 'Não foi possível trocar a senha.' }, 400)

  await getDb()?.from('audit_log').insert({
    entity_type: PASSWORD_AUDIT_ENTITY,
    entity_id: user.id,
    operation: 'update',
    performed_by: user.id,
  })

  return jsonNoStore({ ok: true })
}
