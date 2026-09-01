import type { IncidentStatus, SyncStatus } from '@/types/app.types'

/** A record shown in the "Atividade recente" feed — an incident or a stop. */
export type ActivityKind = 'incident' | 'stop'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Internal code, e.g. `OC-2024-000042` (incidents) or `AB-1A2B3C` (stops). */
  internalNumber: string
  /** `incidents.type` or `stops.type`. */
  entityType: string
  /** Operational status — incidents only; `null` for stops. */
  status: IncidentStatus | null
  district: string | null
  city: string | null
  /** `occurred_at` / `stopped_at` (falls back to `created_at`). */
  occurredAt: string
  thumbnailUrl: string | null
  /** Set only for records still living in the local offline store. */
  syncStatus: SyncStatus | null
  href: string
}

export interface DashboardKpis {
  /** Incidents in the last 30 days. */
  totalIncidents: number
  /** Incidents currently `in_progress`. */
  inProgress: number
  /** Incidents `closed` in the last 30 days. */
  closed: number
  /** Stops in the last 30 days. */
  stops: number
}

export interface DashboardData {
  kpis: DashboardKpis
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
