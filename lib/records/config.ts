import type { SyncStatus } from '@/types/app.types'
import {
  INCIDENT_TYPE_LABELS,
  STATUS_LABELS,
  STOP_TYPE_LABELS,
} from '@/lib/dashboard/labels'

/**
 * Shared configuration for the operational listing screens (incidents / stops).
 *
 * Both `/ocorrencias` and `/abordagens` render the same `RecordsListView`; this
 * module is the single place that describes how each variant maps to its
 * Supabase table, columns, filter options and display copy.
 *
 * Identifiers stay in English to match the schema; user-facing copy stays in
 * Portuguese.
 */

export type RecordVariant = 'incident' | 'stop'
export type SortColumn = 'internalNumber' | 'type' | 'secondary' | 'date' | 'address'
export type SortDirection = 'asc' | 'desc'
export type PeriodKey = 'today' | 'week' | 'month' | 'custom'

/** Rows per page in the table view. */
export const PAGE_SIZE = 20

/** Result of a stop, mirrored from `StopOutcome` in app.types. */
export const STOP_OUTCOME_LABELS: Record<string, string> = {
  released: 'Liberado',
  detained: 'Detido',
  referred_to_police_station: 'Conduzido à DP',
  items_seized: 'Apreensão de itens',
  other: 'Outro',
}

/** A single row in either listing, normalised from a server row or a local draft. */
export interface RecordListItem {
  id: string
  variant: RecordVariant
  /** `OC-…` for incidents, `AB-…` for stops. */
  internalNumber: string
  /** `incidents.type` / `stops.type`. */
  type: string
  /** `incidents.status` or `stops.outcome` — the second badge column. */
  secondary: string | null
  description: string
  district: string | null
  city: string | null
  /** `occurred_at` / `stopped_at` (falls back to `created_at`). */
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
  /** Status (incidents) / outcome (stops). */
  secondary?: string
  sort: { column: SortColumn; direction: SortDirection }
  page: number
}

interface SelectOption {
  value: string
  label: string
}

export interface RecordConfig {
  variant: RecordVariant
  title: string
  newHref: string
  newLabel: string
  detailBase: string
  emptyLabel: string
  searchPlaceholder: string
  table: 'incidents' | 'stops'
  dateColumn: 'occurred_at' | 'stopped_at'
  secondaryColumn: 'status' | 'outcome'
  hasInternalNumber: boolean
  selectColumns: string
  searchColumns: string[]
  sortColumnMap: Record<SortColumn, string>
  typeLabels: Record<string, string>
  typeOptions: SelectOption[]
  secondaryFilterLabel: string
  secondaryLabels: Record<string, string>
  secondaryOptions: SelectOption[]
}

const toOptions = (
  labels: Record<string, string>,
  order: string[],
): SelectOption[] => order.map((value) => ({ value, label: labels[value] ?? value }))

export const RECORD_CONFIG: Record<RecordVariant, RecordConfig> = {
  incident: {
    variant: 'incident',
    title: 'Ocorrências',
    newHref: '/ocorrencias/nova',
    newLabel: 'Nova Ocorrência',
    detailBase: '/ocorrencias',
    emptyLabel: 'Nenhuma ocorrência encontrada',
    searchPlaceholder: 'Buscar por número interno, descrição ou bairro',
    table: 'incidents',
    dateColumn: 'occurred_at',
    secondaryColumn: 'status',
    hasInternalNumber: true,
    selectColumns:
      'id,internal_number,type,status,description,address_district,address_city,occurred_at',
    searchColumns: ['internal_number', 'description', 'address_district'],
    sortColumnMap: {
      internalNumber: 'internal_number',
      type: 'type',
      secondary: 'status',
      date: 'occurred_at',
      address: 'address_district',
    },
    typeLabels: INCIDENT_TYPE_LABELS,
    typeOptions: toOptions(INCIDENT_TYPE_LABELS, [
      'theft',
      'robbery',
      'vandalism',
      'in_flagrante',
      'suspicious',
      'other',
    ]),
    secondaryFilterLabel: 'Status',
    secondaryLabels: STATUS_LABELS,
    secondaryOptions: toOptions(STATUS_LABELS, [
      'open',
      'in_progress',
      'closed',
      'archived',
    ]),
  },
  stop: {
    variant: 'stop',
    title: 'Abordagens',
    newHref: '/abordagens/nova',
    newLabel: 'Nova Abordagem',
    detailBase: '/abordagens',
    emptyLabel: 'Nenhuma abordagem encontrada',
    searchPlaceholder: 'Buscar por descrição ou bairro',
    table: 'stops',
    dateColumn: 'stopped_at',
    secondaryColumn: 'outcome',
    hasInternalNumber: false,
    selectColumns:
      'id,type,outcome,description,address_district,address_city,stopped_at',
    searchColumns: ['description', 'address_district'],
    sortColumnMap: {
      internalNumber: 'id',
      type: 'type',
      secondary: 'outcome',
      date: 'stopped_at',
      address: 'address_district',
    },
    typeLabels: STOP_TYPE_LABELS,
    typeOptions: toOptions(STOP_TYPE_LABELS, ['stop', 'in_flagrante']),
    secondaryFilterLabel: 'Resultado',
    secondaryLabels: STOP_OUTCOME_LABELS,
    secondaryOptions: toOptions(STOP_OUTCOME_LABELS, [
      'released',
      'detained',
      'referred_to_police_station',
      'items_seized',
      'other',
    ]),
  },
}

/** Pill classes for the stop-outcome / fallback secondary badge. */
export function outcomeBadgeClass(outcome: string | null): string {
  switch (outcome) {
    case 'detained':
    case 'referred_to_police_station':
      return 'bg-status-in-flagrante-bg text-status-in-flagrante-text'
    case 'items_seized':
      return 'bg-status-in-progress-bg text-status-in-progress-text'
    case 'released':
      return 'bg-status-closed-bg text-status-closed-text'
    default:
      return 'bg-content-bg text-ink-secondary'
  }
}
