import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database.types'

/**
 * Memoised browser Supabase client.
 *
 * `createBrowserClient` is safe to call many times, but each call builds a new
 * client (its own auth listeners, its own in-flight token refresh). The app
 * calls `createClient()` from a dozen hooks/components per screen, so we keep a
 * single module-level instance and hand it back every time.
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function createClient() {
  if (browserClient) return browserClient

  browserClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  return browserClient
}
