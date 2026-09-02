import type { SupabaseClient } from '@supabase/supabase-js'
import {
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { loadPendingSnapshot } from '@/lib/sync/pendentes'
import {
  INCIDENT_TYPE_LABELS,
  STATUS_LABELS,
} from '@/lib/dashboard/labels'
import type { IncidentStatus } from '@/types/app.types'
import { buildMockIndicators } from './indicators-mock'

/**
 * Data layer for the operational-indicators dashboard (`app/(app)/dashboard`).
 *
 * Everything comes from a single `dashboard_stats()` RPC call (see
 * `sql/002_triggers_functions.sql`); the sync banners are read from the local
 * IndexedDB queue via {@link loadPendingSnapshot}.
 *
 * Reads go through an untyped client on purpose — the generated `Database`
 * types collapse `.rpc()` args to unusable unions here (see the
 * `supabase-typed-writes-never` note).
 */

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Period filter
// ---------------------------------------------------------------------------
export type DashboardPeriod = 'all' | 'week' | 'month' | 'year' | 'custom'

export interface IndicatorFilters {
  period: DashboardPeriod
  /** ISO `yyyy-MM-dd`, only when `period === 'custom'`. */
  customFrom?: string
  customTo?: string
  /** Unit id to scope the numbers to — administrators only. */
  unitId?: string
}

export const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
  { value: 'custom', label: 'Personalizado' },
]

/** Resolve a filter into an absolute `[start, end]` range. */
export function resolveRange(filters: IndicatorFilters): { start: Date; end: Date } {
  const now = new Date()
  switch (filters.period) {
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now) }
    case 'month':
      return { start: startOfMonth(now), end: endOfDay(now) }
    case 'year':
      return { start: startOfYear(now), end: endOfDay(now) }
    case 'custom':
      return {
        start: filters.customFrom
          ? startOfDay(new Date(filters.customFrom))
          : startOfMonth(now),
        end: filters.customTo ? endOfDay(new Date(filters.customTo)) : endOfDay(now),
      }
    case 'all':
    default:
      return { start: new Date('2000-01-01T00:00:00Z'), end: endOfDay(now) }
  }
}

export function periodLabel(filters: IndicatorFilters): string {
  const option = PERIOD_OPTIONS.find((o) => o.value === filters.period)
  if (filters.period === 'custom' && filters.customFrom && filters.customTo) {
    return `${filters.customFrom} a ${filters.customTo}`
  }
  return option?.label ?? 'Todos'
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface DailyVolumePoint {
  day: string
  incidents: number
  stops: number
}

export interface TypeBreakdownEntry {
  type: string
  label: string
  count: number
  /** Share of the incident total, 0–100. */
  pct: number
}

export interface StatusBreakdownEntry {
  status: IncidentStatus
  label: string
  count: number
}

export interface TopOffenderRow {
  id: string
  fullName: string | null
  nickname: string | null
  stopCount: number
  lastStoppedAt: string | null
}

export interface AgentProductivityRow {
  id: string
  fullName: string | null
  badgeNumber: string | null
  incidentsCreated: number
  stopsCreated: number
}

export interface StaleIncidentRow {
  id: string
  internalNumber: string | null
  type: string
  typeLabel: string
  status: IncidentStatus
  occurredAt: string
  agentName: string | null
  daysOpen: number
}

export interface DashboardKpiSet {
  totalIncidents: number
  /** `open` + `in_progress`. */
  pending: number
  closed: number
  totalStops: number
  /** Flagrant incidents + flagrant stops. */
  flagrante: number
  /** `closed / totalIncidents`, 0–100. */
  closureRate: number
}

export interface SyncAlertCounts {
  conflicts: number
  errors: number
}

export interface DashboardIndicators {
  kpis: DashboardKpiSet
  daily: DailyVolumePoint[]
  byType: TypeBreakdownEntry[]
  byStatus: StatusBreakdownEntry[]
  topOffenders: TopOffenderRow[]
  agentProductivity: AgentProductivityRow[]
  staleIncidents: StaleIncidentRow[]
  syncAlerts: SyncAlertCounts
  /** Demo dataset — the database has no records for this range. */
  isMock: boolean
  generatedAt: string
}

// ---------------------------------------------------------------------------
// RPC row shape (snake_case, straight off `dashboard_stats()`)
// ---------------------------------------------------------------------------
interface StatsPayload {
  total: number
  open: number
  in_progress: number
  closed: number
  archived: number
  in_flagrante: number
  by_type: Record<string, number>
  stops_total: number
  stops_flagrante: number
  daily: { day: string; incidents: number; stops: number }[]
  top_offenders: {
    id: string
    full_name: string | null
    nickname: string | null
    stop_count: number | string
    last_stopped_at: string | null
  }[]
  agent_productivity: {
    id: string
    full_name: string | null
    badge_number: string | null
    incidents_created: number | string
    stops_created: number | string
  }[]
  stale_incidents: {
    id: string
    internal_number: string | null
    type: string
    status: string
    occurred_at: string
    agent_name: string | null
    days_open: number | string
  }[]
}

const STATUS_ORDER: IncidentStatus[] = ['open', 'in_progress', 'closed', 'archived']

function toIndicators(payload: StatsPayload, syncAlerts: SyncAlertCounts): DashboardIndicators {
  const total = Number(payload.total ?? 0)
  const closed = Number(payload.closed ?? 0)

  const byType: TypeBreakdownEntry[] = Object.entries(payload.by_type ?? {})
    .map(([type, count]) => ({
      type,
      label: INCIDENT_TYPE_LABELS[type] ?? type,
      count: Number(count),
      pct: total > 0 ? Math.round((Number(count) / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const byStatus: StatusBreakdownEntry[] = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: Number(
      status === 'open'
        ? payload.open
        : status === 'in_progress'
          ? payload.in_progress
          : status === 'closed'
            ? payload.closed
            : payload.archived,
    ),
  })).filter((entry) => entry.count > 0)

  return {
    kpis: {
      totalIncidents: total,
      pending: Number(payload.open ?? 0) + Number(payload.in_progress ?? 0),
      closed,
      totalStops: Number(payload.stops_total ?? 0),
      flagrante: Number(payload.in_flagrante ?? 0) + Number(payload.stops_flagrante ?? 0),
      closureRate: total > 0 ? Math.round((closed / total) * 100) : 0,
    },
    daily: (payload.daily ?? []).map((d) => ({
      day: d.day,
      incidents: Number(d.incidents),
      stops: Number(d.stops),
    })),
    byType,
    byStatus,
    topOffenders: (payload.top_offenders ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      nickname: row.nickname,
      stopCount: Number(row.stop_count ?? 0),
      lastStoppedAt: row.last_stopped_at,
    })),
    agentProductivity: (payload.agent_productivity ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      badgeNumber: row.badge_number,
      incidentsCreated: Number(row.incidents_created ?? 0),
      stopsCreated: Number(row.stops_created ?? 0),
    })),
    staleIncidents: (payload.stale_incidents ?? []).map((row) => ({
      id: row.id,
      internalNumber: row.internal_number,
      type: row.type,
      typeLabel: INCIDENT_TYPE_LABELS[row.type] ?? row.type,
      status: row.status as IncidentStatus,
      occurredAt: row.occurred_at,
      agentName: row.agent_name,
      daysOpen: Number(row.days_open ?? 0),
    })),
    syncAlerts,
    isMock: false,
    generatedAt: new Date().toISOString(),
  }
}

async function readSyncAlerts(): Promise<SyncAlertCounts> {
  try {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    const snapshot = await loadPendingSnapshot(isOnline)
    return { conflicts: snapshot.conflicts.length, errors: snapshot.counts.errors }
  } catch {
    return { conflicts: 0, errors: 0 }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function fetchDashboardIndicators(
  filters: IndicatorFilters,
): Promise<DashboardIndicators> {
  const { start, end } = resolveRange(filters)
  const syncAlerts = await readSyncAlerts()

  const { data, error } = await untyped().rpc('dashboard_stats', {
    p_unit_id: filters.unitId ?? null,
    p_date_start: start.toISOString(),
    p_date_end: end.toISOString(),
  })
  if (error) throw new Error(error.message)

  const payload = data as StatsPayload | null
  if (!payload) throw new Error('dashboard_stats retornou vazio')

  const hasRealData =
    Number(payload.total ?? 0) > 0 || Number(payload.stops_total ?? 0) > 0

  if (!hasRealData) {
    return { ...buildMockIndicators(filters), syncAlerts }
  }

  return toIndicators(payload, syncAlerts)
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvSection(title: string, header: string[], rows: unknown[][]): string {
  return [
    title,
    header.join(';'),
    ...rows.map((row) => row.map(csvCell).join(';')),
  ].join('\n')
}

/** Build the multi-section CSV for the "Exportar → CSV" action. */
export function buildIndicatorsCsv(
  data: DashboardIndicators,
  filters: IndicatorFilters,
): string {
  const k = data.kpis
  return [
    `Dashboard operacional SIGOP;Período: ${periodLabel(filters)};Gerado em: ${new Date(
      data.generatedAt,
    ).toLocaleString('pt-BR')}`,
    '',
    csvSection(
      'Indicadores',
      ['Indicador', 'Valor'],
      [
        ['Total de ocorrências', k.totalIncidents],
        ['Pendentes (aberta + em andamento)', k.pending],
        ['Encerradas', k.closed],
        ['Total de abordagens', k.totalStops],
        ['Flagrantes registrados', k.flagrante],
        ['Taxa de encerramento (%)', k.closureRate],
      ],
    ),
    '',
    csvSection(
      'Distribuição por tipo',
      ['Tipo', 'Quantidade', 'Proporção (%)'],
      data.byType.map((t) => [t.label, t.count, t.pct]),
    ),
    '',
    csvSection(
      'Status atual',
      ['Status', 'Quantidade'],
      data.byStatus.map((s) => [s.label, s.count]),
    ),
    '',
    csvSection(
      'Volume por dia',
      ['Dia', 'Ocorrências', 'Abordagens'],
      data.daily.map((d) => [d.day, d.incidents, d.stops]),
    ),
    '',
    csvSection(
      'Top meliantes',
      ['Nome', 'Apelido', 'Total de abordagens', 'Última abordagem'],
      data.topOffenders.map((o) => [
        o.fullName ?? '—',
        o.nickname ?? '—',
        o.stopCount,
        o.lastStoppedAt ? new Date(o.lastStoppedAt).toLocaleString('pt-BR') : '—',
      ]),
    ),
    '',
    csvSection(
      'Produtividade por agente',
      ['Nome', 'Matrícula', 'Ocorrências criadas', 'Abordagens criadas'],
      data.agentProductivity.map((a) => [
        a.fullName ?? '—',
        a.badgeNumber ?? '—',
        a.incidentsCreated,
        a.stopsCreated,
      ]),
    ),
    '',
    csvSection(
      'Ocorrências sem encerramento > 7 dias',
      ['Número', 'Tipo', 'Data', 'Agente', 'Dias em aberto'],
      data.staleIncidents.map((s) => [
        s.internalNumber ?? s.id.slice(0, 8),
        s.typeLabel,
        new Date(s.occurredAt).toLocaleString('pt-BR'),
        s.agentName ?? '—',
        s.daysOpen,
      ]),
    ),
    '',
  ].join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // Prepend a BOM so Excel opens UTF-8 accents correctly.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
