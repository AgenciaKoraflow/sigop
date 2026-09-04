import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS and unlocks the Auth Admin API (`auth.admin.*`). It must only be
 * imported from server code — Route Handlers under `app/api/**`. The key is read
 * from `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`), so it is impossible to
 * bundle into the client as long as this module is not imported from a
 * `'use client'` tree.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não configurada — defina em .env.local para usar a gestão de usuários.',
    )
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
