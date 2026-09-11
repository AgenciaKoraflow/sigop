'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useOnlineStatus } from './use-online-status'
import { fetchRecordsPage, type RecordsPage } from '@/lib/records/data'
import type { RecordFilters } from '@/lib/records/config'

/**
 * Paginated listing data for `/ocorrencias`.
 *
 * The query key carries the full filter set plus the connection flag, so the
 * cache keeps one entry per page/filter combination and refetches when the
 * device comes back online. `keepPreviousData` keeps the current page visible
 * while the next one loads.
 */
export function useRecords(filters: RecordFilters) {
  const { isOnline } = useOnlineStatus()

  return useQuery<RecordsPage>({
    queryKey: ['records', filters, isOnline],
    queryFn: () => fetchRecordsPage(filters, isOnline),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: isOnline ? 1 : 0,
  })
}
