import type { ActivityItem, DashboardData } from './types'

/**
 * Demo dataset used only while the database is empty and there is no local
 * cache, so the dashboard renders something meaningful during development.
 * Remove the fallback in `data.ts` once real records exist.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

interface Seed {
  internalNumber: string
  entityType: string
  street: string
  district: string
  city: string
  ago: number
  syncStatus: ActivityItem['syncStatus']
}

const SEEDS: Seed[] = [
  { internalNumber: 'OC-2026-000042', entityType: 'theft', street: 'Rua da Penha', district: 'Centro', city: 'Sorocaba', ago: 2 * HOUR, syncStatus: null },
  { internalNumber: 'OC-2026-000041', entityType: 'stop', street: 'Av. Dom Aguirre', district: 'Vila Haro', city: 'Sorocaba', ago: 5 * HOUR, syncStatus: 'pending' },
  { internalNumber: 'OC-2026-000040', entityType: 'in_flagrante', street: 'Rua Pará', district: 'Jardim Europa', city: 'Sorocaba', ago: 9 * HOUR, syncStatus: 'draft' },
  { internalNumber: 'OC-2026-000039', entityType: 'vandalism', street: 'Rua Ipanema', district: 'Éden', city: 'Sorocaba', ago: 1 * DAY + 3 * HOUR, syncStatus: null },
  { internalNumber: 'OC-2026-000037', entityType: 'stop', street: 'Rua Comendador Oetterer', district: 'Além Ponte', city: 'Sorocaba', ago: 3 * DAY, syncStatus: 'synced' },
  { internalNumber: 'OC-2026-000034', entityType: 'robbery', street: 'Av. Ipanema', district: 'Santa Rosália', city: 'Sorocaba', ago: 8 * DAY, syncStatus: null },
  { internalNumber: 'OC-2026-000028', entityType: 'suspicious', street: 'Estrada da Aparecidinha', district: 'Aparecidinha', city: 'Sorocaba', ago: 20 * DAY, syncStatus: null },
]

export function buildMockDashboard(): DashboardData {
  const now = Date.now()
  const items: ActivityItem[] = SEEDS.map((seed, index) => ({
    id: `demo-${index + 1}`,
    internalNumber: seed.internalNumber,
    entityType: seed.entityType,
    street: seed.street,
    district: seed.district,
    city: seed.city,
    occurredAt: new Date(now - seed.ago).toISOString(),
    thumbnailUrl: null,
    syncStatus: seed.syncStatus,
    href: `/ocorrencias/demo-${index + 1}`,
  }))

  return {
    items,
    isDemo: true,
    fromCache: false,
    generatedAt: new Date(now).toISOString(),
  }
}
