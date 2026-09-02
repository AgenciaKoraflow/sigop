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
} from '@/lib/db'
import type { SyncQueueItem, SyncPriority } from '@/lib/db/schema'

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
export async function processQueue(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  const supabase = createClient() as unknown as UntypedSupabase
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const items = await listPendingQueue()

  for (const item of items) {
    // Respect the backoff window
    if (item.next_attempt_at && new Date(item.next_attempt_at) > new Date()) continue

    await updateQueueStatus(item.id, 'syncing')

    try {
      await syncItem(item, supabase)
      await removeFromQueue(item.id)
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

      const { data: urlData } = supabase.storage
        .from('operational-photos')
        .getPublicUrl(objectPath)

      const { error: dbError } = await supabase.from('photos').upsert(
        {
          id: photo.id,
          storage_path: objectPath,
          public_url: urlData.publicUrl,
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
