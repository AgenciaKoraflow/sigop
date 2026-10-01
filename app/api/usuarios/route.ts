import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
import { nullIfEmpty, userCreateSchema } from '@/lib/usuarios/form'

/** POST /api/usuarios — create a login user with a provisional password. */
export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const json = await request.json().catch(() => null)
  const parsed = userCreateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' },
      { status: 400 },
    )
  }
  const { email, password, full_name, role, badge_number, unit_id } = parsed.data

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (error || !data.user) {
    const duplicate =
      error?.code === 'email_exists' ||
      /already been registered|already exists/i.test(error?.message ?? '')
    // "Database error creating new user" = the `handle_new_user` trigger on
    // auth.users raised (see sql/014_handle_new_user_fix.sql).
    const triggerFailure = /database error/i.test(error?.message ?? '')
    if (triggerFailure) console.error('[usuarios] createUser failed in the profile trigger:', error)
    const message = duplicate
      ? 'Já existe um usuário com esse e-mail.'
      : triggerFailure
        ? 'O banco recusou a criação do perfil do usuário (trigger handle_new_user). Avise o suporte técnico.'
        : error?.message ?? 'Falha ao criar o usuário.'
    return NextResponse.json(
      { error: message },
      { status: duplicate ? 409 : triggerFailure ? 500 : 400 },
    )
  }

  // The `handle_new_user` trigger already created the profile row (id, name,
  // role, email). Fill in the columns it does not cover.
  const db = admin as unknown as SupabaseClient
  const { error: profileError } = await db
    .from('profiles')
    .update({
      full_name,
      role,
      badge_number: nullIfEmpty(badge_number),
      unit_id: nullIfEmpty(unit_id),
    })
    .eq('id', data.user.id)

  if (profileError) {
    return NextResponse.json(
      { error: `Usuário criado, mas o perfil não pôde ser completado: ${profileError.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ id: data.user.id }, { status: 201 })
}
