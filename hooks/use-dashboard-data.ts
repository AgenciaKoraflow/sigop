'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchDashboardData } from '@/lib/dashboard/data'
import type { DashboardData } from '@/lib/dashboard/types'

const FIVE_MINUTES = 5 * 60 * 1000

/** Dashboard payload for the operational panel — Supabase, 5-minute `staleTime`. */
export function useDashboardData() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    staleTime: FIVE_MINUTES,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
