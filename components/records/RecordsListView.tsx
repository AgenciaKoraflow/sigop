'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/hooks/use-permissions'
import { useRecords } from '@/hooks/use-records'
import {
  PAGE_SIZE,
  RECORD_CONFIG,
  type RecordFilters,
  type RecordVariant,
  type SortColumn,
} from '@/lib/records/config'
import { RecordFiltersBar, type ViewMode } from './RecordFiltersBar'
import { RecordsCards } from './RecordsCards'
import { RecordsPagination } from './RecordsPagination'
import { RecordsTable } from './RecordsTable'

const DEFAULT_FILTERS: RecordFilters = {
  search: '',
  period: undefined,
  customFrom: undefined,
  customTo: undefined,
  type: undefined,
  secondary: undefined,
  sort: { column: 'date', direction: 'desc' },
  page: 1,
}

export function RecordsListView({ variant }: { variant: RecordVariant }) {
  const cfg = RECORD_CONFIG[variant]
  const permissions = usePermissions()
  const canCreate =
    variant === 'incident'
      ? permissions.canCreateIncident
      : permissions.canCreateStop

  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('table')

  // Cards are the default below the tablet breakpoint.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setView('cards')
  }, [])

  // Debounce the search box into the query filters.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((current) =>
        current.search === search ? current : { ...current, search, page: 1 },
      )
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isFetching, isError } = useRecords(variant, filters)

  const patch = (next: Partial<RecordFilters>) =>
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }))

  const toggleSort = (column: SortColumn) =>
    setFilters((current) => ({
      ...current,
      page: 1,
      sort:
        current.sort.column === column
          ? {
              column,
              direction: current.sort.direction === 'asc' ? 'desc' : 'asc',
            }
          : { column, direction: column === 'date' ? 'desc' : 'asc' },
    }))

  const hasActiveFilters =
    !!filters.search ||
    !!filters.period ||
    !!filters.type ||
    !!filters.secondary

  const clearFilters = () => {
    setSearch('')
    setFilters({ ...DEFAULT_FILTERS })
  }

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil((data?.serverCount ?? 0) / PAGE_SIZE))
  const showPagination =
    !isLoading && (data?.items.length ?? 0) > 0 && totalPages > 1

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink">
          {cfg.title}{' '}
          <span className="font-semibold text-ink-muted">({total})</span>
        </h1>
        {canCreate && (
          <Button
            asChild
            variant="primary"
            size="lg"
            className="w-full justify-center sm:w-auto"
          >
            <Link href={cfg.newHref}>
              <Plus />
              {cfg.newLabel}
            </Link>
          </Button>
        )}
      </header>

      <RecordFiltersBar
        cfg={cfg}
        filters={filters}
        search={search}
        onSearch={setSearch}
        onPatch={patch}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
        view={view}
        onViewChange={setView}
      />

      {data?.fromCache && (
        <p className="flex items-center gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Sem conexão — exibindo apenas rascunhos locais.
        </p>
      )}

      {isError && !data && (
        <p className="rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          Não foi possível carregar os registros. Tente novamente em instantes.
        </p>
      )}

      {view === 'table' ? (
        <RecordsTable
          cfg={cfg}
          items={data?.items ?? []}
          loading={isLoading}
          sort={filters.sort}
          onToggleSort={toggleSort}
        />
      ) : (
        <RecordsCards cfg={cfg} items={data?.items ?? []} loading={isLoading} />
      )}

      {showPagination && (
        <RecordsPagination
          page={filters.page}
          totalPages={totalPages}
          isFetching={isFetching}
          onPage={(page) => patch({ page })}
        />
      )}
    </div>
  )
}
