'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/app.types'

/**
 * The signed-in user's profile, shaped for the layout shell (sidebar footer,
 * topbar identity block).
 *
 * Identifiers stay in English to match the rest of the codebase; the labels
 * exposed to the UI stay in Portuguese.
 */
export interface CurrentUser {
  id: string
  fullName: string
  role: UserRole
  photoUrl: string | null
}

const ROLE_LABELS: Record<UserRole, string> = {
  agent: 'Agente',
  supervisor: 'Supervisor',
  administrator: 'Administrador',
}

/** Human-readable Portuguese label for a role. */
export function roleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : '—'
}

/** Up to two uppercase initials from a full name. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '--'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      const supabase = createClient()
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        if (active) setLoading(false)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('full_name, role, photo_url')
        .eq('id', authUser.id)
        .single()

      const profile = data as
        | { full_name: string; role: string; photo_url: string | null }
        | null

      if (active) {
        if (profile) {
          setUser({
            id: authUser.id,
            fullName: profile.full_name,
            role: profile.role as UserRole,
            photoUrl: profile.photo_url,
          })
        }
        setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  return { user, loading }
}
