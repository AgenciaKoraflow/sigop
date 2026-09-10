import type { ActivityItem, DashboardData } from './types'

/**
 * Demo dataset used only while the database is empty and there is no local
 * cache, so the dashboard renders something meaningful during development.
 * Remove the fallback in `data.ts` once real records exist.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

interface Seed {
  kind: ActivityItem['kind']
  internalNumber: string
  entityType: string
  street: string
  district: string
  city: string
  ago: number
  syncStatus: ActivityItem['syncStatus']
}

const SEEDS: Seed[] = [
  { kind: 'incident', internalNumber: 'OC-2026-000042', entityType: 'theft', street: 'Rua da Penha', district: 'Centro', city: 'Sorocaba', ago: 2 * HOUR, syncStatus: null },
  { kind: 'stop', internalNumber: 'AB-2026-000018', entityType: 'stop', street: 'Av. Dom Aguirre', district: 'Vila Haro', city: 'Sorocaba', ago: 5 * HOUR, syncStatus: 'pending' },
  { kind: 'incident', internalNumber: 'OC-2026-000041', entityType: 'in_flagrante', street: 'Rua Pará', district: 'Jardim Europa', city: 'Sorocaba', ago: 9 * HOUR, syncStatus: 'draft' },
  { kind: 'incident', internalNumber: 'OC-2026-000039', entityType: 'vandalism', street: 'Rua Ipanema', district: 'Éden', city: 'Sorocaba', ago: 1 * DAY + 3 * HOUR, syncStatus: null },
  { kind: 'stop', internalNumber: 'AB-2026-000015', entityType: 'in_flagrante', street: 'Rua Comendador Oetterer', district: 'Além Ponte', city: 'Sorocaba', ago: 3 * DAY, syncStatus: 'synced' },
  { kind: 'incident', internalNumber: 'OC-2026-000034', entityType: 'robbery', street: 'Av. Ipanema', district: 'Santa Rosália', city: 'Sorocaba', ago: 8 * DAY, syncStatus: null },
  { kind: 'incident', internalNumber: 'OC-2026-000028', entityType: 'suspicious', street: 'Estrada da Aparecidinha', district: 'Aparecidinha', city: 'Sorocaba', ago: 20 * DAY, syncStatus: null },
]

export function buildMockDashboard(): DashboardData {
  const now = Date.now()
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const items: ActivityItem[] = SEEDS.map((seed, index) => ({
    id: `demo-${index + 1}`,
    kind: seed.kind,
    internalNumber: seed.internalNumber,
    entityType: seed.entityType,
    street: seed.street,
    district: seed.district,
    city: seed.city,
    occurredAt: new Date(now - seed.ago).toISOString(),
    thumbnailUrl: null,
    syncStatus: seed.syncStatus,
    href:
      seed.kind === 'incident'
        ? `/ocorrencias/demo-${index + 1}`
        : `/abordagens/demo-${index + 1}`,
  }))

  return {
    kpis: {
      totalIncidents: items.filter((i) => i.kind === 'incident').length,
      today: items.filter(
        (i) => i.kind === 'incident' && new Date(i.occurredAt).getTime() >= startOfToday,
      ).length,
      flagrante: items.filter((i) => i.entityType === 'in_flagrante').length,
      stops: items.filter((i) => i.kind === 'stop').length,
    },
    items,
    isDemo: true,
    fromCache: false,
    generatedAt: new Date(now).toISOString(),
  }
}
