'use client'

import { useQuery } from '@tanstack/react-query'
import { useOnlineStatus } from './use-online-status'
import {
  fetchDashboardOnline,
  fetchDashboardOffline,
} from '@/lib/dashboard/data'
import type { DashboardData } from '@/lib/dashboard/types'

const FIVE_MINUTES = 5 * 60 * 1000

/**
 * Dashboard payload for the operational panel.
 *
 * Online it hits Supabase (5-minute `staleTime`) and refreshes the IndexedDB
 * snapshot; offline it reads that snapshot back. The query key flips with the
 * connection so returning online triggers a fresh fetch.
 */
export function useDashboardData() {
  const { isOnline } = useOnlineStatus()

  return useQuery<DashboardData>({
    queryKey: ['dashboard', isOnline ? 'online' : 'offline'],
    queryFn: isOnline ? fetchDashboardOnline : fetchDashboardOffline,
    staleTime: FIVE_MINUTES,
    gcTime: 30 * 60 * 1000,
    retry: isOnline ? 1 : 0,
    refetchOnWindowFocus: false,
  })
}
