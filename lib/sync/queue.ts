import { v4 as uuidv4 } from 'uuid'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  getDB,
  listPendingQueue,
  updateQueueStatus,
  removeFromQueue,
  listPendingPhotos,
  deletePendingPhoto,
  countPending,
  enqueueSync,
  saveSetting,
  deleteDraftIncident,
  deleteDraftStop,
} from '@/lib/db'
import type { SyncQueueItem, SyncPriority } from '@/lib/db/schema'
import { detectConflict } from '@/lib/sync/conflict'

/**
 * The generated `Database` types currently collapse write methods to `never`
 * under this project's `@supabase/ssr` + `supabase-js` pairing, so the sync
 * engine talks to an untyped client. Reads stay typed at the call sites that
 * need them; the queue only performs writes with runtime-validated payloads.
 */
type UntypedSupabase = SupabaseClient

/**
 * Supabase synchronisation engine for SIGOP offline support.
 *
 * Identifiers are kept in English to match the rest of the codebase and the
 * Supabase schema (see the naming note in `sql/003_rls_policies.sql`).
 */

// Progressive backoff in ms: 1s, 5s, 30s, 5min, 30min
const BACKOFF = [1000, 5000, 30000, 300000, 1800000]

function computeNextAttempt(attempts: number): string {
  const delay = BACKOFF[Math.min(attempts, BACKOFF.length - 1)]
  return new Date(Date.now() + delay).toISOString()
}

// =============================================
// Build a queue item (use this from forms)
// =============================================
export function createQueueItem(
  entityType: SyncQueueItem['entity_type'],
  operation: SyncQueueItem['operation'],
  payload: Record<string, unknown>,
  priority: SyncPriority = 1,
): SyncQueueItem {
  return {
    id: (payload.id as string) ?? uuidv4(),
    entity_type: entityType,
    operation,
    payload,
    status: 'pending',
    priority,
    sync_attempts: 0,
    last_error: null,
    next_attempt_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// =============================================
// Process the whole queue
// =============================================

/** Guards against overlapping drains (visibility + online + form flush racing). */
let draining = false

/**
 * A queue item left in `syncing` means a previous drain was interrupted
 * (tab closed / reloaded mid-flush). `listPendingQueue` ignores that status,
 * so the item would be stranded forever — reset it back to `pending`.
 */
async function reviveStrandedItems(): Promise<void> {
  const db = await getDB()
  const all = await db.getAll('sync_queue')
  await Promise.all(
    all
      .filter((item) => item.status === 'syncing')
      .map((item) =>
        db.put('sync_queue', { ...item, status: 'pending', next_attempt_at: null }),
      ),
  )
}

/**
 * Drop the local entity draft once its queued write has landed on the server.
 * Left behind, the draft keeps feeding `loadConflicts` a stale `remote_version`
 * (the server `version` bumps on every write, including our own), which shows
 * up as a phantom conflict and blocks the next edit.
 *
 * The draft is kept only if it was touched locally *after* this queue item was
 * created — i.e. there are newer unsynced edits to preserve.
 */
async function clearSyncedDraft(item: SyncQueueItem): Promise<void> {
  const db = await getDB()
  if (item.entity_type === 'incident') {
    const draft = await db.get('draft_incidents', item.id)
    if (draft && draft.updated_at <= item.created_at) {
      await deleteDraftIncident(item.id)
      await db.delete('offline_settings', `incident:offenders:${item.id}`)
    }
  } else if (item.entity_type === 'stop') {
    const draft = await db.get('draft_stops', item.id)
    if (draft && draft.updated_at <= item.created_at) {
      await deleteDraftStop(item.id)
    }
  }
}

export async function processQueue(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (draining) return
  draining = true

  try {
    await runQueueDrain()
  } finally {
    draining = false
  }
}

async function runQueueDrain(): Promise<void> {
  const supabase = createClient() as unknown as UntypedSupabase
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await reviveStrandedItems()

  const items = await listPendingQueue()

  for (const item of items) {
    // Respect the backoff window
    if (item.next_attempt_at && new Date(item.next_attempt_at) > new Date()) continue

    await updateQueueStatus(item.id, 'syncing')

    try {
      await syncItem(item, supabase)
      await removeFromQueue(item.id)
      await clearSyncedDraft(item)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      const nextAttemptAt = computeNextAttempt(item.sync_attempts + 1)
      await updateQueueStatus(item.id, 'error', message)

      // Persist the backoff timestamp on top of the status update
      const db = await getDB()
      const current = await db.get('sync_queue', item.id)
      if (current) {
        await db.put('sync_queue', { ...current, next_attempt_at: nextAttemptAt })
      }
    }
  }

  // Upload photos captured offline
  await processPendingPhotos(supabase, user.id)

  // Record the last drain that left nothing behind — the "Pendentes" screen
  // shows this as the last successful synchronisation timestamp.
  const remaining = await countPending()
  if (remaining.total === 0 && remaining.errors === 0 && remaining.photos === 0) {
    await saveSetting(LAST_SYNC_SETTING_KEY, new Date().toISOString())
  }
}

/** `offline_settings` key holding the ISO timestamp of the last clean sync. */
export const LAST_SYNC_SETTING_KEY = 'sync:last_success_at'

/** Thrown when the server copy moved ahead of the baseline the edit started from. */
export class SyncConflictError extends Error {
  constructor(message = 'Conflito: este registro foi alterado no servidor. Abra "Pendentes" para resolver.') {
    super(message)
    this.name = 'SyncConflictError'
  }
}

/**
 * True when every field we are about to write already holds that value on the
 * server row — i.e. this "update" is a replay of a write that already landed
 * (the server `version` bumps on our own writes too, so a bare version check
 * would flag it as a phantom conflict).
 */
function remoteAlreadyMatches(
  payload: Record<string, unknown>,
  remote: Record<string, unknown>,
): boolean {
  const skip = new Set(['id', 'version', 'updated_at', 'updated_by', 'synced_at'])
  return Object.entries(payload).every(([key, value]) => {
    if (skip.has(key)) return true
    return JSON.stringify(value ?? null) === JSON.stringify(remote[key] ?? null)
  })
}

/**
 * Guard an `update` against a stale write. The draft carries `remote_version` —
 * the server `version` seen when editing began. If the server has moved past it,
 * another device won the race; we refuse the write and let the "Pendentes"
 * screen surface the conflict for manual resolution.
 *
 * Exception: if the server row already equals the payload we're about to send,
 * our own earlier write is what moved the version — that's not a conflict.
 */
async function assertNoConflict(
  table: 'incidents' | 'stops' | 'offenders',
  store: 'draft_incidents' | 'draft_stops',
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = await getDB()
  const draft = store === 'draft_incidents'
    ? await db.get('draft_incidents', id)
    : await db.get('draft_stops', id)
  const baseline = draft?.remote_version
  if (baseline == null) return // no known baseline — cannot tell, let it through

  const conflict = await detectConflict(id, baseline, table, payload)
  if (!conflict) return
  if (remoteAlreadyMatches(payload, conflict.remoteData)) return
  throw new SyncConflictError()
}

async function syncItem(item: SyncQueueItem, supabase: UntypedSupabase): Promise<void> {
  const { entity_type, operation, payload } = item

  if (entity_type === 'incident') {
    if (operation === 'create') {
      const { error } = await supabase
        .from('incidents')
        .upsert(payload, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    } else if (operation === 'update') {
      const { id, ...data } = payload
      await assertNoConflict('incidents', 'draft_incidents', id as string, data)
      const { error } = await supabase.from('incidents').update(data).eq('id', id as string)
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entity_type === 'stop') {
    if (operation === 'create') {
      const { error } = await supabase.from('stops').upsert(payload, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    } else if (operation === 'update') {
      const { id, ...data } = payload
      await assertNoConflict('stops', 'draft_stops', id as string, data)
      const { error } = await supabase.from('stops').update(data).eq('id', id as string)
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entity_type === 'offender') {
    if (operation === 'create') {
      const { error } = await supabase.from('offenders').upsert(payload, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    } else if (operation === 'update') {
      const { id, ...data } = payload
      const { error } = await supabase.from('offenders').update(data).eq('id', id as string)
      if (error) throw new Error(error.message)
    }
    return
  }

  if (entity_type === 'link') {
    const table =
      (payload.table as string) === 'stop_offenders' ? 'stop_offenders' : 'incident_offenders'
    const data = { ...payload }
    delete data.table
    const { error } = await supabase.from(table).upsert(data)
    if (error && !error.message.includes('duplicate')) throw new Error(error.message)
    return
  }
}

async function processPendingPhotos(supabase: UntypedSupabase, userId: string): Promise<void> {
  const photos = await listPendingPhotos()
  const pending = photos.filter((p) => p.status === 'pending' || p.status === 'error')

  for (const photo of pending) {
    try {
      // RLS expects: operational-photos/<auth.uid()>/<entity>/<file>
      const objectPath = `${userId}/${photo.entity_type}/${photo.entity_id}/${photo.id}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('operational-photos')
        .upload(objectPath, photo.blob, {
          contentType: photo.mime_type,
          upsert: true,
        })
      if (uploadError) throw new Error(uploadError.message)

      // `operational-photos` is a private bucket — there is no usable public
      // URL. Readers exchange `storage_path` for a signed URL at display time
      // (see `lib/fotos/urls.ts`).
      const { error: dbError } = await supabase.from('photos').upsert(
        {
          id: photo.id,
          storage_path: objectPath,
          public_url: null,
          entity_type: photo.entity_type,
          entity_id: photo.entity_id,
          description: photo.description,
          sort_order: photo.position,
          size_bytes: photo.size_bytes,
          mime_type: photo.mime_type,
          created_by: userId,
        },
        { onConflict: 'id' },
      )
      if (dbError) throw new Error(dbError.message)

      await deletePendingPhoto(photo.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload error'
      const db = await getDB()
      const current = await db.get('pending_photos', photo.id)
      if (current) {
        await db.put('pending_photos', {
          ...current,
          status: 'error',
          last_error: message,
          sync_attempts: current.sync_attempts + 1,
        })
      }
    }
  }
}

// Re-export helpers used by the sync indicator / callers
export { countPending, enqueueSync }
