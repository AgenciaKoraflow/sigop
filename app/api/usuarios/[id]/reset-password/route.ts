import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
import { generateProvisionalPassword } from '@/lib/usuarios/form'

/**
 * POST /api/usuarios/[id]/reset-password
 * Sets a fresh provisional password and returns it once, for the admin to hand
 * over to the user (who should change it on first login).
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const password = generateProvisionalPassword()

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

  return NextResponse.json({ password })
}
