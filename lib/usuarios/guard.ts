import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSameOriginRequest } from '@/lib/api/request-guards'
import { createClient } from '@/lib/supabase/server'

/**
 * Shared authorization gate for the admin-only Route Handlers.
 *
 * Every `app/api/**` handler must call this first: it confirms the
 * caller is signed in AND holds the `administrator` role (checked against
 * `profiles`, not just a client claim). On failure it returns a ready-made
 * `NextResponse`; on success it hands back the caller's auth id.
 */
export type AdminGate =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

export async function requireAdmin(): Promise<AdminGate> {
  // CSRF defence in depth: a browser request from another site is refused.
  if (!isSameOriginRequest(headers())) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Requisição inválida.' }, { status: 403 }),
    }
  }

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

  // A user still on the provisional password must change it first — the
  // middleware does not cover /api, so the gate has to live here.
  if (user.app_metadata?.must_change_password === true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Troque a senha provisória antes de continuar.' },
        { status: 403 },
      ),
    }
  }

  const { data: profile } = await (supabase as unknown as SupabaseClient)
    .from('profiles')
    .select('role, is_active, deleted_at')
    .eq('id', user.id)
    .single<{ role: string; is_active: boolean | null; deleted_at: string | null }>()

  // A deactivated / deleted admin keeps a valid JWT until it expires, so the
  // profile state is re-checked on every call.
  if (
    profile?.role !== 'administrator' ||
    profile.is_active === false ||
    profile.deleted_at !== null
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Apenas administradores podem realizar esta ação.' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userId: user.id }
}
