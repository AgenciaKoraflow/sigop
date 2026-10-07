import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSameOriginRequest } from '@/lib/api/request-guards'
import { createClient } from '@/lib/supabase/server'
import { evaluateAdminAccess } from '@/lib/usuarios/access'

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
  if (!isSameOriginRequest(await headers())) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Requisição inválida.' }, { status: 403 }),
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }),
    }
  }

  // The profile is re-checked on every call: a deactivated / deleted admin keeps
  // a valid JWT until it expires.
  const { data: profile } = await (supabase as unknown as SupabaseClient)
    .from('profiles')
    .select('role, is_active, deleted_at')
    .eq('id', user.id)
    .single<{ role: string; is_active: boolean | null; deleted_at: string | null }>()

  const denial = evaluateAdminAccess(user, profile)
  if (denial === 'must_change_password') {
    // The middleware does not cover /api, so the first-login gate lives here.
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Troque a senha provisória antes de continuar.' },
        { status: 403 },
      ),
    }
  }
  if (denial) {
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
