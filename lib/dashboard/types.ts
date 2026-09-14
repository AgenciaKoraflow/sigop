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
  href: string
}

export interface DashboardData {
  items: ActivityItem[]
  /** Demo payload — the database has no records. */
  isDemo: boolean
  /** ISO timestamp the payload was produced. */
  generatedAt: string
}

/** Quick filter for the recent-activity feed. */
export type RangeKey = 'today' | '7d' | '30d'
