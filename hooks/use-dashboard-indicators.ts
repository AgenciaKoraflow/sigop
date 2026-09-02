'use client'

import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  fetchDashboardIndicators,
  type DashboardIndicators,
  type IndicatorFilters,
} from '@/lib/dashboard/indicators'
import { useOnlineStatus } from './use-online-status'

const TWO_MINUTES = 2 * 60 * 1000

/**
 * Operational-indicators payload for `app/(app)/dashboard`.
 *
 * Hits the `dashboard_stats()` RPC (2-minute `staleTime`); the query key
 * carries the active filters so changing the period / unit refetches.
 */
export function useDashboardIndicators(filters: IndicatorFilters) {
  const { isOnline } = useOnlineStatus()

  return useQuery<DashboardIndicators>({
    queryKey: [
      'dashboard-indicators',
      filters.period,
      filters.customFrom ?? null,
      filters.customTo ?? null,
      filters.unitId ?? null,
      isOnline,
    ],
    queryFn: () => fetchDashboardIndicators(filters),
    enabled:
      filters.period !== 'custom' ||
      Boolean(filters.customFrom && filters.customTo),
    staleTime: TWO_MINUTES,
    gcTime: 15 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

// ---------------------------------------------------------------------------
// Units (for the administrator "Unidade" filter)
// ---------------------------------------------------------------------------
export interface UnitOption {
  id: string
  name: string
  code: string | null
}

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

async function fetchUnits(): Promise<UnitOption[]> {
  const { data, error } = await untyped()
    .from('units')
    .select('id,name,code')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as UnitOption[]
}

export function useUnits(enabled: boolean) {
  return useQuery<UnitOption[]>({
    queryKey: ['units', 'active'],
    queryFn: fetchUnits,
    enabled,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
