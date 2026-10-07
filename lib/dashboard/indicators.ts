import type { SupabaseClient } from '@supabase/supabase-js'
import {
  differenceInCalendarDays,
  endOfDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { csvCell, csvRow } from '@/lib/export/csv'
import { INCIDENT_TYPE_LABELS } from '@/lib/dashboard/labels'
import { buildMockIndicators } from './indicators-mock'

/**
 * Data layer for the operational-indicators dashboard (`app/(app)/dashboard`).
 *
 * Everything comes from a single `dashboard_stats()` RPC call (see
 * `sql/017_dashboard_stats_unified.sql`). There is one record kind —
 * ocorrências; an checagem is just the `stop` incident type.
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

/** Longest range the RPC returns day buckets for (see `v_daily_lo`). */
export const DAILY_SERIES_MAX_DAYS = 92

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
      // `parseISO` reads a date-only string as local midnight; `new Date()`
      // would read it as UTC and shift the whole range one day back in BRT.
      return {
        start: filters.customFrom
          ? startOfDay(parseISO(filters.customFrom))
          : startOfMonth(now),
        end: filters.customTo ? endOfDay(parseISO(filters.customTo)) : endOfDay(now),
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
export interface VolumePoint {
  /** ISO `yyyy-MM-dd` — the day, or the first day of the month. */
  bucket: string
  incidents: number
}

export interface VolumeSeries {
  granularity: 'day' | 'month'
  points: VolumePoint[]
}

export interface TypeBreakdownEntry {
  type: string
  label: string
  count: number
  /** Share of the incident total, 0–100. */
  pct: number
}

export interface WeekdayHourCell {
  /** 0 = Sunday … 6 = Saturday. */
  dow: number
  /** 0–23, America/Sao_Paulo. */
  hour: number
  count: number
}

export type GeoDimension = 'contractor' | 'municipality' | 'territorialArea'

export interface GeoEntry {
  id: string
  name: string
  /** Município the AT belongs to — territorial areas only. */
  detail: string | null
  count: number
  /** Share of the incident total, 0–100. */
  pct: number
}

export interface GeoBreakdown {
  entries: GeoEntry[]
  /** Incidents in the range with this dimension left blank. */
  unassigned: number
}

export interface TopOffenderRow {
  id: string
  fullName: string | null
  nickname: string | null
  /** Incidents (any type) the offender is linked to as suspect / perpetrator. */
  incidentCount: number
  lastOccurredAt: string | null
}

export interface AgentProductivityRow {
  id: string
  fullName: string | null
  badgeNumber: string | null
  incidentsCreated: number
  /** Share of the incident total, 0–100. */
  pct: number
  lastOccurredAt: string | null
}

export interface RecentIncidentRow {
  id: string
  internalNumber: string | null
  type: string
  typeLabel: string
  occurredAt: string
  agentName: string | null
  /** "AT · Município", falling back to the address city. */
  location: string | null
}

export interface DashboardKpiSet {
  totalIncidents: number
  /** Same-length range right before the selected one; `null` when not comparable. */
  previousTotal: number | null
  /** Average incidents per day across the selected range. */
  avgIncidentsPerDay: number
  /** Busiest day of the daily series. */
  peakDay: { day: string; count: number } | null
  /** Distinct offenders linked as suspect / perpetrator. */
  offendersInvolved: number | null
  /** Of those, linked to 2+ incidents in the range. */
  repeatOffenders: number | null
  /** Incidents with at least one suspect / perpetrator linked. */
  incidentsWithOffender: number | null
  /** Agents with at least one incident in the range. */
  activeAgents: number
}

export interface DashboardIndicators {
  kpis: DashboardKpiSet
  volume: VolumeSeries
  byType: TypeBreakdownEntry[]
  /** `null` while the database still runs a pre-`sql/017` `dashboard_stats()`. */
  weekdayHour: WeekdayHourCell[] | null
  geography: Record<GeoDimension, GeoBreakdown> | null
  topOffenders: TopOffenderRow[]
  agentProductivity: AgentProductivityRow[]
  recentIncidents: RecentIncidentRow[]
  /** The RPC is older than `sql/017` — some indicators are unavailable. */
  isLegacyPayload: boolean
  /** Demo dataset — the database has no records for this range. */
  isMock: boolean
  generatedAt: string
}

// ---------------------------------------------------------------------------
// RPC row shape (snake_case, straight off `dashboard_stats()`)
// ---------------------------------------------------------------------------
type Count = number | string

interface GeoPayloadRow {
  id: string
  name: string
  municipality?: string | null
  count: Count
}

/** Keys marked optional are absent before `sql/017`. */
interface StatsPayload {
  total: Count
  first_occurred_at?: string | null
  previous_total?: Count
  by_type: Record<string, Count>
  daily: { day: string; incidents: Count }[]
  monthly?: { month: string; incidents: Count }[]
  by_weekday_hour?: { dow: number; hour: number; count: Count }[]
  by_contractor?: GeoPayloadRow[]
  by_municipality?: GeoPayloadRow[]
  by_territorial_area?: GeoPayloadRow[]
  without_contractor?: Count
  without_municipality?: Count
  without_territorial_area?: Count
  with_offenders?: Count
  offenders_involved?: Count
  repeat_offenders?: Count
  top_offenders: {
    id: string
    full_name: string | null
    nickname: string | null
    incident_count?: Count
    last_occurred_at?: string | null
    /** Pre-`sql/016` keys (checagens only). */
    stop_count?: Count
    last_stopped_at?: string | null
  }[]
  agent_productivity: {
    id: string
    full_name: string | null
    badge_number: string | null
    incidents_created: Count
    last_occurred_at?: string | null
  }[]
  recent_incidents: {
    id: string
    internal_number: string | null
    type: string
    occurred_at: string
    agent_name: string | null
    territorial_area?: string | null
    municipality?: string | null
    address_city?: string | null
  }[]
}

const share = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 100) : 0

const optionalCount = (value: Count | undefined | null) =>
  value === undefined || value === null ? null : Number(value)

function toGeoBreakdown(
  rows: GeoPayloadRow[] | undefined,
  unassigned: Count | undefined,
  total: number,
): GeoBreakdown {
  return {
    entries: (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      detail: row.municipality ?? null,
      count: Number(row.count),
      pct: share(Number(row.count), total),
    })),
    unassigned: Number(unassigned ?? 0),
  }
}

interface RangeInfo {
  /** Days the daily average is measured over. */
  rangeDays: number
  /** The range is too long for the 92-day `daily` series. */
  useMonthly: boolean
  /** The range before the selected one is a meaningful comparison. */
  comparable: boolean
}

function toIndicators(payload: StatsPayload, range: RangeInfo): DashboardIndicators {
  const total = Number(payload.total ?? 0)
  const isLegacyPayload = payload.by_weekday_hour === undefined

  const byType: TypeBreakdownEntry[] = Object.entries(payload.by_type ?? {})
    .map(([type, count]) => ({
      type,
      label: INCIDENT_TYPE_LABELS[type] ?? type,
      count: Number(count),
      pct: share(Number(count), total),
    }))
    .sort((a, b) => b.count - a.count)

  const daily: VolumePoint[] = (payload.daily ?? []).map((d) => ({
    bucket: d.day,
    incidents: Number(d.incidents),
  }))
  const volume: VolumeSeries =
    range.useMonthly && payload.monthly
      ? {
          granularity: 'month',
          points: payload.monthly.map((m) => ({
            bucket: m.month,
            incidents: Number(m.incidents),
          })),
        }
      : { granularity: 'day', points: daily }

  // The daily series only covers the tail of a long range, so its busiest day
  // would not be the range's.
  const peak = range.useMonthly
    ? null
    : daily.reduce<VolumePoint | null>(
        (best, point) => (point.incidents > (best?.incidents ?? 0) ? point : best),
        null,
      )

  const agentProductivity: AgentProductivityRow[] = (payload.agent_productivity ?? []).map(
    (row) => ({
      id: row.id,
      fullName: row.full_name,
      badgeNumber: row.badge_number,
      incidentsCreated: Number(row.incidents_created ?? 0),
      pct: share(Number(row.incidents_created ?? 0), total),
      lastOccurredAt: row.last_occurred_at ?? null,
    }),
  )

  return {
    kpis: {
      totalIncidents: total,
      previousTotal: range.comparable ? optionalCount(payload.previous_total) : null,
      avgIncidentsPerDay:
        range.rangeDays > 0 ? Math.round((total / range.rangeDays) * 10) / 10 : total,
      peakDay: peak ? { day: peak.bucket, count: peak.incidents } : null,
      offendersInvolved: optionalCount(payload.offenders_involved),
      repeatOffenders: optionalCount(payload.repeat_offenders),
      incidentsWithOffender: optionalCount(payload.with_offenders),
      activeAgents: agentProductivity.filter((a) => a.incidentsCreated > 0).length,
    },
    volume,
    byType,
    weekdayHour: payload.by_weekday_hour
      ? payload.by_weekday_hour.map((cell) => ({
          dow: Number(cell.dow),
          hour: Number(cell.hour),
          count: Number(cell.count),
        }))
      : null,
    geography: isLegacyPayload
      ? null
      : {
          contractor: toGeoBreakdown(payload.by_contractor, payload.without_contractor, total),
          municipality: toGeoBreakdown(
            payload.by_municipality,
            payload.without_municipality,
            total,
          ),
          territorialArea: toGeoBreakdown(
            payload.by_territorial_area,
            payload.without_territorial_area,
            total,
          ),
        },
    topOffenders: (payload.top_offenders ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      nickname: row.nickname,
      incidentCount: Number(row.incident_count ?? row.stop_count ?? 0),
      lastOccurredAt: row.last_occurred_at ?? row.last_stopped_at ?? null,
    })),
    agentProductivity,
    recentIncidents: (payload.recent_incidents ?? []).map((row) => ({
      id: row.id,
      internalNumber: row.internal_number,
      type: row.type,
      typeLabel: INCIDENT_TYPE_LABELS[row.type] ?? row.type,
      occurredAt: row.occurred_at,
      agentName: row.agent_name,
      location:
        [row.territorial_area, row.municipality].filter(Boolean).join(' · ') ||
        row.address_city ||
        null,
    })),
    isLegacyPayload,
    isMock: false,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function fetchDashboardIndicators(
  filters: IndicatorFilters,
): Promise<DashboardIndicators> {
  const { start, end } = resolveRange(filters)

  const { data, error } = await untyped().rpc('dashboard_stats', {
    p_unit_id: filters.unitId ?? null,
    p_date_start: start.toISOString(),
    p_date_end: end.toISOString(),
  })
  if (error) throw new Error(error.message)

  const payload = data as StatsPayload | null
  if (!payload) throw new Error('dashboard_stats retornou vazio')

  // Demo data is a development aid only — in production an empty period must
  // read as empty, never as made-up names and numbers.
  if (Number(payload.total ?? 0) === 0 && process.env.NODE_ENV !== 'production') {
    return buildMockIndicators(filters)
  }

  // "Todos" starts at 2000-01-01, which would flatten the daily average to ~0;
  // measure it from the first real record instead.
  const firstRecord =
    filters.period === 'all' && payload.first_occurred_at
      ? parseISO(payload.first_occurred_at)
      : null
  const rangeStart = firstRecord && firstRecord > start ? firstRecord : start
  const rangeDays = Math.max(differenceInCalendarDays(end, rangeStart) + 1, 1)

  return toIndicators(payload, {
    rangeDays,
    useMonthly: rangeDays > DAILY_SERIES_MAX_DAYS,
    comparable: filters.period !== 'all',
  })
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const GEO_SECTIONS: { key: GeoDimension; title: string; header: string }[] = [
  { key: 'contractor', title: 'Ocorrências por contratada', header: 'Contratada' },
  { key: 'municipality', title: 'Ocorrências por município da AT', header: 'Município' },
  { key: 'territorialArea', title: 'Ocorrências por AT', header: 'AT' },
]

function csvSection(title: string, header: string[], rows: unknown[][]): string {
  return [csvCell(title), csvRow(header), ...rows.map(csvRow)].join('\n')
}

const csvDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR') : '—'

/** Build the multi-section CSV for the "Exportar → CSV" action. */
export function buildIndicatorsCsv(
  data: DashboardIndicators,
  filters: IndicatorFilters,
): string {
  const k = data.kpis
  const sections = [
    csvSection(
      'Indicadores',
      ['Indicador', 'Valor'],
      [
        ['Ocorrências no período', k.totalIncidents],
        ['Ocorrências no período anterior', k.previousTotal ?? '—'],
        ['Média de ocorrências/dia', k.avgIncidentsPerDay],
        ['Suspeitos envolvidos', k.offendersInvolved ?? '—'],
        ['Suspeitos reincidentes no período', k.repeatOffenders ?? '—'],
        ['Ocorrências com suspeito vinculado', k.incidentsWithOffender ?? '—'],
        ['Agentes com registro', k.activeAgents],
      ],
    ),
    csvSection(
      'Ocorrências por tipo',
      ['Tipo', 'Quantidade', 'Proporção (%)'],
      data.byType.map((t) => [t.label, t.count, t.pct]),
    ),
    csvSection(
      data.volume.granularity === 'month' ? 'Ocorrências por mês' : 'Ocorrências por dia',
      [data.volume.granularity === 'month' ? 'Mês' : 'Dia', 'Ocorrências'],
      data.volume.points.map((p) => [
        data.volume.granularity === 'month' ? p.bucket.slice(0, 7) : p.bucket,
        p.incidents,
      ]),
    ),
  ]

  if (data.weekdayHour) {
    sections.push(
      csvSection(
        'Ocorrências por dia da semana e hora',
        ['Dia da semana', 'Hora', 'Ocorrências'],
        [...data.weekdayHour]
          .sort((a, b) => a.dow - b.dow || a.hour - b.hour)
          .map((c) => [WEEKDAY_LABELS[c.dow] ?? c.dow, `${c.hour}h`, c.count]),
      ),
    )
  }

  if (data.geography) {
    for (const section of GEO_SECTIONS) {
      const breakdown = data.geography[section.key]
      sections.push(
        csvSection(
          section.title,
          [section.header, 'Ocorrências', 'Proporção (%)'],
          [
            ...breakdown.entries.map((e) => [
              e.detail ? `${e.name} (${e.detail})` : e.name,
              e.count,
              e.pct,
            ]),
            ['Não informado', breakdown.unassigned, share(breakdown.unassigned, k.totalIncidents)],
          ],
        ),
      )
    }
  }

  sections.push(
    csvSection(
      'Top suspeitos',
      ['Nome', 'Apelido', 'Ocorrências', 'Última ocorrência'],
      data.topOffenders.map((o) => [
        o.fullName ?? '—',
        o.nickname ?? '—',
        o.incidentCount,
        csvDateTime(o.lastOccurredAt),
      ]),
    ),
    csvSection(
      'Registros por agente',
      ['Nome', 'Matrícula', 'Ocorrências', 'Proporção (%)', 'Último registro'],
      data.agentProductivity.map((a) => [
        a.fullName ?? '—',
        a.badgeNumber ?? '—',
        a.incidentsCreated,
        a.pct,
        csvDateTime(a.lastOccurredAt),
      ]),
    ),
    csvSection(
      'Últimas ocorrências',
      ['Número', 'Tipo', 'Data', 'Local', 'Agente'],
      data.recentIncidents.map((s) => [
        s.internalNumber ?? s.id.slice(0, 8),
        s.typeLabel,
        csvDateTime(s.occurredAt),
        s.location ?? '—',
        s.agentName ?? '—',
      ]),
    ),
  )

  return [
    csvRow([
      'Painel operacional SIGOP',
      `Período: ${periodLabel(filters)}`,
      `Gerado em: ${new Date(data.generatedAt).toLocaleString('pt-BR')}`,
    ]),
    '',
    sections.join('\n\n'),
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
