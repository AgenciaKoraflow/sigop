import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Shared authorization gate for the user-management Route Handlers.
 *
 * Every `app/api/usuarios/**` handler must call this first: it confirms the
 * caller is signed in AND holds the `administrator` role (checked against
 * `profiles`, not just a client claim). On failure it returns a ready-made
 * `NextResponse`; on success it hands back the caller's auth id.
 */
export type AdminGate =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

export async function requireAdmin(): Promise<AdminGate> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }),
    }
  }

  const { data: profile } = await (supabase as unknown as SupabaseClient)
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string }>()

  if (profile?.role !== 'administrator') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Apenas administradores podem gerenciar usuários.' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id }
}
