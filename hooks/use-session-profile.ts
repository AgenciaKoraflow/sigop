'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/app.types'

/**
 * The signed-in user plus their profile row, fetched once and shared across the
 * app via a single TanStack Query cache entry.
 *
 * Before this hook existed, `useCurrentUser` and `usePermissions` each ran their
 * own `auth.getUser()` (a network round-trip to the Supabase Auth server) plus a
 * `profiles` query on every mount, uncached — so opening a detail screen fired
 * four or more auth/profile requests. Now:
 *   - `getSession()` reads the cookie/local storage with no network call; the
 *     middleware already revalidates the token on every request.
 *   - one query key (`session-profile`) backs both hooks.
 */
export interface SessionProfile {
  id: string
  fullName: string
  role: UserRole
  photoUrl: string | null
}

export const SESSION_PROFILE_KEY = ['session-profile'] as const

async function fetchSessionProfile(): Promise<SessionProfile | null> {
  const supabase = createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const authUser = session?.user
  if (!authUser) return null

  const { data } = await supabase
    .from('profiles')
    .select('full_name, role, photo_url')
    .eq('id', authUser.id)
    .single()

  const profile = data as
    | { full_name: string; role: string; photo_url: string | null }
    | null
  if (!profile) return null

  return {
    id: authUser.id,
    fullName: profile.full_name,
    role: profile.role as UserRole,
    photoUrl: profile.photo_url,
  }
}

export function useSessionProfile() {
  return useQuery({
    queryKey: SESSION_PROFILE_KEY,
    queryFn: fetchSessionProfile,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}
