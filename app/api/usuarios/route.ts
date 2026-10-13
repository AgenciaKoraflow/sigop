import { NextResponse } from 'next/server'
import { adminUnavailable } from '@/lib/api/errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { MUST_CHANGE_PASSWORD_FLAG } from '@/lib/auth/password'
import { requireAdmin } from '@/lib/usuarios/guard'
import {
  describeAuthError,
  describeBadgeTaken,
  describeEmailTaken,
  type ExistingAccount,
} from '@/lib/usuarios/errors'
import { nullIfEmpty, userCreateSchema } from '@/lib/usuarios/form'
import { buildProvisionedUserAttributes, generateProvisionToken, sha256Hex } from '@/lib/usuarios/provision'

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
    return adminUnavailable(err)
  }

  const db = admin as unknown as SupabaseClient

  // Fail early, and say who holds the e-mail / badge, instead of letting Auth or
  // the unique index reject a half-created user.
  const { data: owner } = await db
    .from('profiles')
    .select('id, full_name, is_active, deleted_at')
    .eq('email', email.toLowerCase())
    .maybeSingle<ExistingAccount>()
  if (owner) {
    const { error, status, code } = describeEmailTaken(owner)
    return NextResponse.json({ error, code, userId: owner.id }, { status })
  }

  const badge = nullIfEmpty(badge_number)
  if (badge) {
    const { data: holder } = await db
      .from('profiles')
      .select('full_name')
      .eq('badge_number', badge)
      .is('deleted_at', null)
      .maybeSingle<{ full_name: string | null }>()
    if (holder) {
      const { error, status, code } = describeBadgeTaken(badge, holder)
      return NextResponse.json({ error, code }, { status })
    }
  }

  // The database refuses any auth.users insert without a single-use ticket
  // (sql/026), and takes the profile role from the ticket — never from metadata.
  const token = generateProvisionToken()
  const tokenHash = `\\x${await sha256Hex(token)}`
  const { error: ticketError } = await db.from('user_provisioning_tickets').insert({
    token_hash: tokenHash,
    email,
    role,
    created_by: gate.userId,
  })
  if (ticketError) {
    console.error('[usuarios] provisioning ticket failed:', ticketError.message)
    return NextResponse.json(
      { error: 'Falha ao autorizar a criação do usuário. Verifique se a migration 026 foi aplicada.' },
      { status: 500 },
    )
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...buildProvisionedUserAttributes({
      fullName: full_name,
      token,
      mustChangePasswordFlag: MUST_CHANGE_PASSWORD_FLAG,
    }),
  })

  if (error || !data.user) {
    await db.from('user_provisioning_tickets').delete().eq('token_hash', tokenHash)
    if (error) console.error('[usuarios] createUser failed:', error.message)
    const failure = describeAuthError(error, 'Falha ao criar o usuário.')
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status })
  }

  // GoTrue rewrites the row after the insert, which re-persists the (already
  // consumed, so harmless) token the trigger had stripped. Drop it for hygiene.
  const { error: scrubError } = await admin.auth.admin.updateUserById(data.user.id, {
    user_metadata: { full_name },
  })
  if (scrubError) console.error('[usuarios] could not scrub provision token:', scrubError.message)

  // The `handle_new_user` trigger already created the profile row (id, name,
  // role, email). Fill in the columns it does not cover.
  const { error: profileError } = await db
    .from('profiles')
    .update({
      full_name,
      role,
      badge_number: badge,
      unit_id: nullIfEmpty(unit_id),
    })
    .eq('id', data.user.id)

  if (profileError) {
    console.error('[usuarios] profile completion failed:', profileError.message)
    return NextResponse.json(
      { error: 'Usuário criado, mas o perfil não pôde ser completado. Edite o usuário para concluir.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ id: data.user.id }, { status: 201 })
}
