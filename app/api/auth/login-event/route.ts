import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSameOrigin } from '@/lib/auth/reset'

/** One recorded sign-in per user per window — the endpoint cannot inflate the stats. */
const MIN_INTERVAL_MS = 30_000

/**
 * POST /api/auth/login-event
 * Records a password sign-in for the signed-in caller (feeds the /usuarios
 * dashboard). Best effort: the login page does not depend on the outcome.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 403 })
  }

  const supabase = await createClient()
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
  const db = admin as unknown as SupabaseClient

  const { count } = await db
    .from('login_events')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('logged_at', new Date(Date.now() - MIN_INTERVAL_MS).toISOString())
  if ((count ?? 0) > 0) return NextResponse.json({ ok: true })

  const { error } = await db.from('login_events').insert({ user_id: user.id })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })

  return NextResponse.json({ ok: true })
}
