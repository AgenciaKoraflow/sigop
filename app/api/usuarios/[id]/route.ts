import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
import { userEditSchema, nullIfEmpty } from '@/lib/usuarios/form'

/** ~100 years — long enough to be a permanent login block until reverted. */
const BAN_DURATION = '876000h'

/** PATCH /api/usuarios/[id] — update an existing user's profile / activation. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const json = await request.json().catch(() => null)
  const parsed = userEditSchema.partial().safeParse(json)
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: parsed.success ? 'Nada para atualizar.' : parsed.error.issues[0]?.message ?? 'Dados inválidos.' },
      { status: 400 },
    )
  }

  const selfEdit = params.id === gate.userId
  if (selfEdit && (parsed.data.role !== undefined || parsed.data.is_active === false)) {
    return NextResponse.json(
      { error: 'Você não pode alterar o próprio papel nem se desativar.' },
      { status: 400 },
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }
  const db = admin as unknown as SupabaseClient

  const patch: Record<string, unknown> = {}
  if (parsed.data.full_name !== undefined) patch.full_name = parsed.data.full_name
  if (parsed.data.role !== undefined) patch.role = parsed.data.role
  if (parsed.data.badge_number !== undefined) {
    patch.badge_number = nullIfEmpty(parsed.data.badge_number)
  }
  if (parsed.data.unit_id !== undefined) patch.unit_id = nullIfEmpty(parsed.data.unit_id)
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active

  const { error } = await db.from('profiles').update(patch).eq('id', params.id)
  if (error) {
    const duplicate = /duplicate key|unique/i.test(error.message)
    return NextResponse.json(
      { error: duplicate ? 'Esse número de matrícula já está em uso.' : error.message },
      { status: duplicate ? 409 : 400 },
    )
  }

  // Toggling activation must also (un)block the actual login.
  if (parsed.data.is_active !== undefined) {
    const { error: banError } = await admin.auth.admin.updateUserById(params.id, {
      ban_duration: parsed.data.is_active ? 'none' : BAN_DURATION,
    })
    if (banError) {
      return NextResponse.json(
        { error: `Perfil atualizado, mas o acesso não pôde ser ${parsed.data.is_active ? 'liberado' : 'bloqueado'}: ${banError.message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ id: params.id })
}

/** DELETE /api/usuarios/[id] — remove a user for good. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  if (params.id === gate.userId) {
    return NextResponse.json({ error: 'Você não pode excluir a própria conta.' }, { status: 400 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }
  const db = admin as unknown as SupabaseClient

  // A user with no history is removed outright (the profile cascades from auth.users).
  const { error: hardError } = await admin.auth.admin.deleteUser(params.id)
  if (!hardError) return NextResponse.json({ id: params.id })
  if (hardError.status === 404) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  }

  // Incidents, offenders, photos and audit entries reference the profile, so a
  // user with history cannot be dropped without losing authorship. Soft-delete
  // instead: the login is destroyed (and the e-mail freed) while the profile
  // row stays behind, hidden from the listing.
  const { error: markError } = await db
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.id)
  if (markError) {
    const missingColumn = /deleted_at/i.test(markError.message)
    return NextResponse.json(
      {
        error: missingColumn
          ? 'Este usuário possui registros no sistema. Para excluí-lo, aplique a migração sql/015_profiles_deleted_at.sql no banco.'
          : markError.message,
      },
      { status: missingColumn ? 409 : 400 },
    )
  }

  const { error: softError } = await admin.auth.admin.deleteUser(params.id, true)
  if (softError) {
    await db.from('profiles').update({ deleted_at: null }).eq('id', params.id)
    return NextResponse.json({ error: softError.message }, { status: 500 })
  }

  // Free the unique identifiers so they can be reused by a new user.
  await db
    .from('profiles')
    .update({ is_active: false, badge_number: null, email: null })
    .eq('id', params.id)

  return NextResponse.json({ id: params.id })
}
