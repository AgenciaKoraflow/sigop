'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  getUserDashboard,
  listUsers,
  type DashboardPeriod,
  type UserDashboard,
  type UserFilters,
  type UsersPage,
} from '@/lib/usuarios/data'

/**
 * Paginated listing data for `/usuarios`. One cache entry per filter/page
 * combination; `keepPreviousData` keeps the current page visible while the next
 * loads.
 */
export function useUsers(filters: UserFilters) {
  return useQuery<UsersPage>({
    queryKey: ['users', filters],
    queryFn: () => listUsers(filters),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/** Everything the "Dashboard" tab of `/usuarios` shows, for one period. */
export function useUserDashboard(days: DashboardPeriod) {
  return useQuery<UserDashboard>({
    queryKey: ['users', 'dashboard', days],
    queryFn: () => getUserDashboard(days),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
