import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/auth/login-event
 * Records a password sign-in for the signed-in caller (feeds the /usuarios
 * dashboard). Best effort: the login page does not depend on the outcome.
 */
export async function POST() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  const { error } = await (admin as unknown as SupabaseClient)
    .from('login_events')
    .insert({ user_id: user.id })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })

  return NextResponse.json({ ok: true })
}
