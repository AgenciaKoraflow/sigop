'use client'

import { useSessionProfile } from '@/hooks/use-session-profile'
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
  const { data } = useSessionProfile()
  const role = data?.role ?? null

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
