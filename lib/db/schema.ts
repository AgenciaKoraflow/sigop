import type { SyncStatus, EntityType, Operation } from '@/types/app.types'

/**
 * Local persistence schema for SIGOP offline support.
 *
 * Everything here lives in IndexedDB only. Nothing in this layer may be
 * written to localStorage — blobs are stored as `Blob`, never base64.
 *
 * Identifier and literal values are kept in English and aligned with the
 * Supabase schema (`SyncStatus`, `EntityType`, `Operation` from app.types).
 */

/** Priority buckets for the sync queue: lower runs first. */
export type SyncPriority = 1 | 2 | 3 // 1 = incidents, 2 = photos, 3 = links

/** Locally edited incident waiting to be synced to the server. */
export interface DraftIncident {
  id: string
  entity_type: 'incident'
  operation: Operation
  payload: Record<string, unknown>
  status: SyncStatus
  sync_attempts: number
  last_error: string | null
  next_attempt_at: string | null
  local_version: number
  remote_version: number | null
  created_at: string
  updated_at: string
}

/** Locally edited stop waiting to be synced to the server. */
export interface DraftStop {
  id: string
  entity_type: 'stop'
  operation: Operation
  payload: Record<string, unknown>
  status: SyncStatus
  sync_attempts: number
  last_error: string | null
  next_attempt_at: string | null
  local_version: number
  remote_version: number | null
  created_at: string
  updated_at: string
}

/** Photo captured offline, stored as a binary Blob until uploaded. */
export interface PendingPhoto {
  id: string
  entity_type: 'incident' | 'stop' | 'offender'
  entity_id: string
  blob: Blob // ALWAYS a Blob, never base64
  mime_type: string
  size_bytes: number
  description: string
  position: number
  status: SyncStatus
  sync_attempts: number
  last_error: string | null
  created_at: string
}

/** Unit of work processed by the background sync engine. */
export interface SyncQueueItem {
  id: string
  entity_type: EntityType
  operation: Operation
  payload: Record<string, unknown>
  status: SyncStatus
  priority: SyncPriority
  sync_attempts: number
  last_error: string | null
  next_attempt_at: string | null
  created_at: string
  updated_at: string
}

/** Read-only snapshot of server records for offline browsing. */
export interface RecentRecordCache {
  id: string
  type: 'incident' | 'stop'
  data: Record<string, unknown>
  cached_at: string
}

/** Arbitrary key/value configuration for the offline layer. */
export interface OfflineSetting {
  key: string
  value: unknown
}
