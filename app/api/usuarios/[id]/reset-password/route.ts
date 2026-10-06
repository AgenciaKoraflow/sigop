import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
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
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }

  const { error } = await admin.auth.admin.updateUserById(params.id, { password })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Best effort — feeds the "trocas de senha" counter on the users dashboard.
  await (admin as unknown as SupabaseClient).from('audit_log').insert({
    entity_type: PASSWORD_AUDIT_ENTITY,
    entity_id: params.id,
    operation: 'update',
    performed_by: gate.userId,
  })

  return NextResponse.json({ password })
}
