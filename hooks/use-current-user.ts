'use client'

import { useSessionProfile, type SessionProfile } from '@/hooks/use-session-profile'
import type { UserRole } from '@/types/app.types'

/**
 * The signed-in user's profile, shaped for the layout shell (sidebar footer,
 * topbar identity block).
 *
 * Identifiers stay in English to match the rest of the codebase; the labels
 * exposed to the UI stay in Portuguese.
 */
export type CurrentUser = SessionProfile

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
  const { data, isLoading } = useSessionProfile()
  return { user: data ?? null, loading: isLoading }
}
