'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/app.types'

/**
 * Role-based permission flags for the current user.
 *
 * Identifiers are kept in English to match the rest of the codebase; the
 * user-facing copy that consumes this hook stays in Portuguese.
 */
interface Permissions {
  role: UserRole | null
  isAgent: boolean
  isSupervisor: boolean
  isAdmin: boolean
  canCreateIncident: boolean
  canEditIncident: boolean
  canCloseIncident: boolean
  canArchive: boolean
  canDelete: boolean
  canCreateStop: boolean
  canViewDashboard: boolean
  canResolveConflicts: boolean
  canExport: boolean
  canViewAuditLog: boolean
  canManageUsers: boolean
}

type RolePermissions = Omit<Permissions, 'role' | 'isAgent' | 'isSupervisor' | 'isAdmin'>

const PERMISSIONS_BY_ROLE: Record<UserRole, RolePermissions> = {
  agent: {
    canCreateIncident:   true,
    canEditIncident:     true,
    canCloseIncident:    false,
    canArchive:          false,
    canDelete:           false,
    canCreateStop:       true,
    canViewDashboard:    false,
    canResolveConflicts: false,
    canExport:           false,
    canViewAuditLog:     false,
    canManageUsers:      false,
  },
  supervisor: {
    canCreateIncident:   true,
    canEditIncident:     true,
    canCloseIncident:    true,
    canArchive:          false,
    canDelete:           false,
    canCreateStop:       true,
    canViewDashboard:    true,
    canResolveConflicts: true,
    canExport:           true,
    canViewAuditLog:     true,
    canManageUsers:      false,
  },
  administrator: {
    canCreateIncident:   true,
    canEditIncident:     true,
    canCloseIncident:    true,
    canArchive:          true,
    canDelete:           true,
    canCreateStop:       true,
    canViewDashboard:    true,
    canResolveConflicts: true,
    canExport:           true,
    canViewAuditLog:     true,
    canManageUsers:      true,
  },
}

export function usePermissions(): Permissions {
  const [role, setRole] = useState<UserRole | null>(null)

  useEffect(() => {
    let active = true

    async function loadRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const profile = data as { role: string } | null
      if (active && profile) setRole(profile.role as UserRole)
    }

    void loadRole()
    return () => {
      active = false
    }
  }, [])

  if (!role) {
    return {
      role: null,
      isAgent: false,
      isSupervisor: false,
      isAdmin: false,
      ...PERMISSIONS_BY_ROLE.agent,
    }
  }

  return {
    role,
    isAgent:      role === 'agent',
    isSupervisor: role === 'supervisor',
    isAdmin:      role === 'administrator',
    ...PERMISSIONS_BY_ROLE[role],
  }
}
