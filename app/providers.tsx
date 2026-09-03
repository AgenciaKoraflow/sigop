'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { SESSION_PROFILE_KEY } from '@/hooks/use-session-profile'

/**
 * App-wide client providers. Currently just TanStack Query, mounted once so the
 * cache survives client-side navigation across the authenticated shell.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  // Drop the cached session/profile whenever the auth state actually changes
  // (sign in, sign out, profile update) so the shared `session-profile` query
  // refetches instead of serving a stale user.
  useEffect(() => {
    const supabase = createClient()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        void client.invalidateQueries({ queryKey: SESSION_PROFILE_KEY })
      }
    })
    return () => subscription.unsubscribe()
  }, [client])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
