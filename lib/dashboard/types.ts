import type { SyncStatus } from '@/types/app.types'

/** A record shown in the "Atividade recente" feed. */
export interface ActivityItem {
  id: string
  /** Internal code, e.g. `OC-2024-000042`. */
  internalNumber: string
  /** `incidents.type`. */
  entityType: string
  street: string | null
  district: string | null
  city: string | null
  /** `occurred_at` (falls back to `created_at`). */
  occurredAt: string
  thumbnailUrl: string | null
  /** Set only for records still living in the local offline store. */
  syncStatus: SyncStatus | null
  href: string
}

export interface DashboardData {
  items: ActivityItem[]
  /** Demo payload — the database has no records and there is no local cache. */
  isDemo: boolean
  /** Served from the local IndexedDB cache (offline). */
  fromCache: boolean
  /** ISO timestamp the payload was produced or cached. */
  generatedAt: string
}

/** Quick filter for the recent-activity feed. */
export type RangeKey = 'today' | '7d' | '30d'
