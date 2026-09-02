import { differenceInCalendarDays } from 'date-fns'
import { INCIDENT_TYPE_LABELS, STATUS_LABELS } from '@/lib/dashboard/labels'
import type { IncidentStatus } from '@/types/app.types'
import {
  resolveRange,
  type DashboardIndicators,
  type IndicatorFilters,
} from './indicators'

/**
 * Deterministic demo dataset for the operational dashboard, shown only while
 * the database has no records for the selected range so the screen renders
 * something meaningful during development.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Small deterministic PRNG so the mock is stable across renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TYPE_WEIGHTS: Record<string, number> = {
  theft: 32,
  robbery: 14,
  vandalism: 20,
  in_flagrante: 9,
  suspicious: 18,
  other: 7,
}

const OFFENDER_SEEDS = [
  { fullName: 'Marcos Antônio Pereira', nickname: 'Marquinho' },
  { fullName: 'Jefferson da Silva Rocha', nickname: 'JB' },
  { fullName: 'Rafael Augusto Lima', nickname: 'Fael' },
  { fullName: 'Diego Nunes Cardoso', nickname: null },
  { fullName: 'Anderson Souza Matos', nickname: 'Peixe' },
  { fullName: 'Luiz Fernando Alves', nickname: 'LF' },
]

const AGENT_SEEDS = [
  { fullName: 'Sd. Carla Menezes', badgeNumber: '10432' },
  { fullName: 'Sd. Bruno Tavares', badgeNumber: '10871' },
  { fullName: 'Cb. Patrícia Gomes', badgeNumber: '09218' },
  { fullName: 'Sd. Rodrigo Faria', badgeNumber: '11004' },
  { fullName: 'Sgt. Helena Prado', badgeNumber: '07655' },
]

export function buildMockIndicators(filters: IndicatorFilters): DashboardIndicators {
  const { start, end } = resolveRange(filters)
  const now = Date.now()
  const rand = mulberry32(42)

  // Cap the daily series the same way the RPC does (92 days).
  const spanDays = Math.min(
    Math.max(differenceInCalendarDays(end, start) + 1, 14),
    92,
  )
  const seriesStart = end.getTime() - (spanDays - 1) * DAY_MS

  const daily = Array.from({ length: spanDays }, (_, i) => {
    const day = new Date(seriesStart + i * DAY_MS)
    const weekday = day.getDay()
    const weekendDip = weekday === 0 || weekday === 6 ? 0.55 : 1
    return {
      day: day.toISOString().slice(0, 10),
      incidents: Math.round((2 + rand() * 7) * weekendDip),
      stops: Math.round((1 + rand() * 5) * weekendDip),
    }
  })

  const totalIncidents = daily.reduce((sum, d) => sum + d.incidents, 0)
  const totalStops = daily.reduce((sum, d) => sum + d.stops, 0)

  const weightSum = Object.values(TYPE_WEIGHTS).reduce((a, b) => a + b, 0)
  const byType = Object.entries(TYPE_WEIGHTS)
    .map(([type, weight]) => {
      const count = Math.max(1, Math.round((weight / weightSum) * totalIncidents))
      return {
        type,
        label: INCIDENT_TYPE_LABELS[type] ?? type,
        count,
        pct: totalIncidents > 0 ? Math.round((count / totalIncidents) * 100) : 0,
      }
    })
    .sort((a, b) => b.count - a.count)

  const closed = Math.round(totalIncidents * 0.62)
  const inProgress = Math.round(totalIncidents * 0.18)
  const open = Math.max(totalIncidents - closed - inProgress - 2, 1)
  const archived = Math.max(totalIncidents - closed - inProgress - open, 0)

  const statusCounts: Record<IncidentStatus, number> = {
    open,
    in_progress: inProgress,
    closed,
    archived,
  }
  const byStatus = (Object.keys(statusCounts) as IncidentStatus[])
    .map((status) => ({ status, label: STATUS_LABELS[status], count: statusCounts[status] }))
    .filter((entry) => entry.count > 0)

  const flagranteType = byType.find((t) => t.type === 'in_flagrante')?.count ?? 0

  const topOffenders = OFFENDER_SEEDS.map((seed, i) => ({
    id: `demo-off-${i + 1}`,
    fullName: seed.fullName,
    nickname: seed.nickname,
    stopCount: Math.max(2, Math.round(9 - i * 1.3 + rand() * 2)),
    lastStoppedAt: new Date(now - (i * 2 + rand() * 3) * DAY_MS).toISOString(),
  })).sort((a, b) => b.stopCount - a.stopCount)

  const agentProductivity = AGENT_SEEDS.map((seed, i) => ({
    id: `demo-agent-${i + 1}`,
    fullName: seed.fullName,
    badgeNumber: seed.badgeNumber,
    incidentsCreated: Math.max(1, Math.round(totalIncidents / (4 + i) + rand() * 3)),
    stopsCreated: Math.max(0, Math.round(totalStops / (5 + i) + rand() * 2)),
  })).sort((a, b) => b.incidentsCreated - a.incidentsCreated)

  const staleIncidents = Array.from({ length: 5 }, (_, i) => {
    const daysOpen = 8 + i * 4 + Math.round(rand() * 3)
    const type = byType[i % byType.length]
    return {
      id: `demo-stale-${i + 1}`,
      internalNumber: `OC-2026-${String(41 - i).padStart(6, '0')}`,
      type: type.type,
      typeLabel: type.label,
      status: (i % 2 === 0 ? 'open' : 'in_progress') as IncidentStatus,
      occurredAt: new Date(now - daysOpen * DAY_MS).toISOString(),
      agentName: AGENT_SEEDS[i % AGENT_SEEDS.length].fullName,
      daysOpen,
    }
  })

  return {
    kpis: {
      totalIncidents,
      pending: open + inProgress,
      closed,
      totalStops,
      flagrante: flagranteType + Math.round(totalStops * 0.12),
      closureRate: totalIncidents > 0 ? Math.round((closed / totalIncidents) * 100) : 0,
    },
    daily,
    byType,
    byStatus,
    topOffenders,
    agentProductivity,
    staleIncidents,
    syncAlerts: { conflicts: 0, errors: 0 },
    isMock: true,
    generatedAt: new Date().toISOString(),
  }
}
