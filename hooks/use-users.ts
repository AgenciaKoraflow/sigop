'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listUsers, type UserFilters, type UsersPage } from '@/lib/usuarios/data'

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
