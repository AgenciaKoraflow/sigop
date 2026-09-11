import type { SyncStatus } from '@/types/app.types'
import { INCIDENT_TYPE_LABELS } from '@/lib/dashboard/labels'
import { INCIDENT_TYPE_OPTIONS } from '@/lib/ocorrencias/form'

/**
 * Configuration for the operational listing screen (`/ocorrencias`), rendered
 * by `RecordsListView`. "Abordagem" is just one more `incidents.type` value,
 * so there is a single record shape here — no per-module variant.
 *
 * Identifiers stay in English to match the schema; user-facing copy stays in
 * Portuguese.
 */

export type SortColumn = 'internalNumber' | 'type' | 'date' | 'address'
export type SortDirection = 'asc' | 'desc'
export type PeriodKey = 'today' | 'week' | 'month' | 'custom'

/** Rows per page in the table view. */
export const PAGE_SIZE = 20

/** A single row in the listing, normalised from a server row or a local draft. */
export interface RecordListItem {
  id: string
  /** `OC-…`. */
  internalNumber: string
  /** `incidents.type`. */
  type: string
  description: string
  street: string | null
  district: string | null
  city: string | null
  occurredAt: string
  thumbnailUrl: string | null
  /** Set only for records still living in the local offline store. */
  syncStatus: SyncStatus | null
  isLocal: boolean
  href: string
}

export interface RecordFilters {
  search: string
  period?: PeriodKey
  customFrom?: string
  customTo?: string
  type?: string
  sort: { column: SortColumn; direction: SortDirection }
  page: number
}

interface SelectOption {
  value: string
  label: string
}

export const RECORD_CONFIG = {
  title: 'Ocorrências',
  newHref: '/ocorrencias/nova',
  newLabel: 'Nova Ocorrência',
  detailBase: '/ocorrencias',
  emptyLabel: 'Nenhuma ocorrência encontrada',
  searchPlaceholder: 'Buscar por número interno, descrição ou bairro',
  table: 'incidents' as const,
  dateColumn: 'occurred_at' as const,
  selectColumns:
    'id,internal_number,type,description,address_street,address_district,address_city,occurred_at',
  searchColumns: ['internal_number', 'description', 'address_district'],
  sortColumnMap: {
    internalNumber: 'internal_number',
    type: 'type',
    date: 'occurred_at',
    address: 'address_district',
  } as Record<SortColumn, string>,
  typeLabels: INCIDENT_TYPE_LABELS,
  typeOptions: INCIDENT_TYPE_OPTIONS.map(
    (option): SelectOption => ({ value: option.value, label: option.label }),
  ),
}
