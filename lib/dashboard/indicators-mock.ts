import { differenceInCalendarDays } from 'date-fns'
import { INCIDENT_TYPE_LABELS } from '@/lib/dashboard/labels'
import {
  DAILY_SERIES_MAX_DAYS,
  resolveRange,
  type DashboardIndicators,
  type GeoBreakdown,
  type IndicatorFilters,
  type WeekdayHourCell,
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
  theft: 30,
  stop: 22,
  vandalism: 16,
  suspicious: 13,
  robbery: 9,
  in_flagrante: 6,
  other: 4,
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
  { fullName: 'Carla Menezes', badgeNumber: '10432' },
  { fullName: 'Bruno Tavares', badgeNumber: '10871' },
  { fullName: 'Patrícia Gomes', badgeNumber: '09218' },
  { fullName: 'Rodrigo Faria', badgeNumber: '11004' },
  { fullName: 'Helena Prado', badgeNumber: '07655' },
]

const GEO_SEEDS = {
  contractor: [
    { name: 'ICOMON_CENTRO', detail: null, weight: 30 },
    { name: 'ICOMON_LESTE', detail: null, weight: 22 },
    { name: 'ABILITY_OS', detail: null, weight: 17 },
    { name: 'ICOMON_ABCD', detail: null, weight: 12 },
    { name: 'ABILITY_SJ', detail: null, weight: 7 },
  ],
  municipality: [
    { name: 'SAO PAULO', detail: null, weight: 41 },
    { name: 'OSASCO', detail: null, weight: 17 },
    { name: 'SANTO ANDRE', detail: null, weight: 12 },
    { name: 'SAO JOSE DOS CAMPOS', detail: null, weight: 9 },
    { name: 'DIADEMA', detail: null, weight: 6 },
  ],
  territorialArea: [
    { name: 'SPO_CT', detail: 'SAO PAULO', weight: 16 },
    { name: 'SPO_PE', detail: 'SAO PAULO', weight: 13 },
    { name: 'OCO_CT', detail: 'OSASCO', weight: 11 },
    { name: 'SAD_VA', detail: 'SANTO ANDRE', weight: 9 },
    { name: 'SPO_TA', detail: 'SAO PAULO', weight: 8 },
    { name: 'SJC_CT', detail: 'SAO JOSE DOS CAMPOS', weight: 6 },
  ],
}

const pct = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 100) : 0

function mockGeo(
  seeds: { name: string; detail: string | null; weight: number }[],
  prefix: string,
  total: number,
): GeoBreakdown {
  const entries = seeds.map((seed, i) => {
    const count = Math.max(1, Math.round((seed.weight / 100) * total))
    return {
      id: `demo-${prefix}-${i + 1}`,
      name: seed.name,
      detail: seed.detail,
      count,
      pct: pct(count, total),
    }
  })
  const assigned = entries.reduce((sum, e) => sum + e.count, 0)
  return { entries, unassigned: Math.max(total - assigned, 0) }
}

export function buildMockIndicators(filters: IndicatorFilters): DashboardIndicators {
  const { start, end } = resolveRange(filters)
  const now = Date.now()
  const rand = mulberry32(42)

  // Cap the daily series the same way the RPC does.
  const spanDays = Math.min(
    Math.max(differenceInCalendarDays(end, start) + 1, 14),
    DAILY_SERIES_MAX_DAYS,
  )
  const seriesStart = end.getTime() - (spanDays - 1) * DAY_MS

  const points = Array.from({ length: spanDays }, (_, i) => {
    const day = new Date(seriesStart + i * DAY_MS)
    const weekday = day.getDay()
    const weekendDip = weekday === 0 || weekday === 6 ? 0.55 : 1
    return {
      bucket: day.toISOString().slice(0, 10),
      incidents: Math.round((2 + rand() * 7) * weekendDip),
    }
  })

  const totalIncidents = points.reduce((sum, d) => sum + d.incidents, 0)

  const weightSum = Object.values(TYPE_WEIGHTS).reduce((a, b) => a + b, 0)
  const byType = Object.entries(TYPE_WEIGHTS)
    .map(([type, weight]) => {
      const count = Math.max(1, Math.round((weight / weightSum) * totalIncidents))
      return {
        type,
        label: INCIDENT_TYPE_LABELS[type] ?? type,
        count,
        pct: pct(count, totalIncidents),
      }
    })
    .sort((a, b) => b.count - a.count)

  // Night-heavy pattern, busier Thursday–Saturday.
  const weekdayHour: WeekdayHourCell[] = []
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const night = hour >= 19 || hour <= 2 ? 1 : hour >= 8 && hour <= 17 ? 0.45 : 0.15
      const weekend = dow >= 4 ? 1.4 : 1
      const count = Math.round(rand() * 6 * night * weekend)
      if (count > 0) weekdayHour.push({ dow, hour, count })
    }
  }

  const topOffenders = OFFENDER_SEEDS.map((seed, i) => ({
    id: `demo-off-${i + 1}`,
    fullName: seed.fullName,
    nickname: seed.nickname,
    incidentCount: Math.max(1, Math.round(9 - i * 1.5 + rand() * 2)),
    lastOccurredAt: new Date(now - (i * 2 + rand() * 3) * DAY_MS).toISOString(),
  })).sort((a, b) => b.incidentCount - a.incidentCount)

  const agentShares = [0.34, 0.25, 0.19, 0.13, 0.09]
  const agentProductivity = AGENT_SEEDS.map((seed, i) => {
    const incidentsCreated = Math.max(1, Math.round(totalIncidents * agentShares[i]))
    return {
      id: `demo-agent-${i + 1}`,
      fullName: seed.fullName,
      badgeNumber: seed.badgeNumber,
      incidentsCreated,
      pct: pct(incidentsCreated, totalIncidents),
      lastOccurredAt: new Date(now - (i * 5 + rand() * 4) * 60 * 60 * 1000).toISOString(),
    }
  })

  const areas = GEO_SEEDS.territorialArea
  const recentIncidents = Array.from({ length: 5 }, (_, i) => {
    const type = byType[i % byType.length]
    const area = areas[i % areas.length]
    return {
      id: `demo-recent-${i + 1}`,
      internalNumber: `OC-2026-${String(41 - i).padStart(6, '0')}`,
      type: type.type,
      typeLabel: type.label,
      occurredAt: new Date(now - (i * 6 + rand() * 4) * 60 * 60 * 1000).toISOString(),
      agentName: AGENT_SEEDS[i % AGENT_SEEDS.length].fullName,
      location: `${area.name} · ${area.detail}`,
    }
  })

  const peak = points.reduce((best, p) => (p.incidents > best.incidents ? p : best), points[0])

  return {
    kpis: {
      totalIncidents,
      previousTotal:
        filters.period === 'all' ? null : Math.round(totalIncidents * 0.88),
      avgIncidentsPerDay: Math.round((totalIncidents / spanDays) * 10) / 10,
      peakDay: { day: peak.bucket, count: peak.incidents },
      offendersInvolved: 14,
      repeatOffenders: topOffenders.filter((o) => o.incidentCount >= 2).length,
      incidentsWithOffender: Math.round(totalIncidents * 0.37),
      activeAgents: agentProductivity.length,
    },
    volume: { granularity: 'day', points },
    byType,
    weekdayHour,
    geography: {
      contractor: mockGeo(GEO_SEEDS.contractor, 'ct', totalIncidents),
      municipality: mockGeo(GEO_SEEDS.municipality, 'mun', totalIncidents),
      territorialArea: mockGeo(GEO_SEEDS.territorialArea, 'at', totalIncidents),
    },
    topOffenders,
    agentProductivity,
    recentIncidents,
    isLegacyPayload: false,
    isMock: true,
    generatedAt: new Date().toISOString(),
  }
}
