'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchRecordsPage, type RecordsPage } from '@/lib/records/data'
import type { RecordFilters } from '@/lib/records/config'

/**
 * Paginated listing data for `/ocorrencias`.
 *
 * The query key carries the full filter set, so the cache keeps one entry
 * per page/filter combination. `keepPreviousData` keeps the current page
 * visible while the next one loads.
 */
export function useRecords(filters: RecordFilters) {
  return useQuery<RecordsPage>({
    queryKey: ['records', filters],
    queryFn: () => fetchRecordsPage(filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
  })
}
