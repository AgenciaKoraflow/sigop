import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  DraftIncident,
  DraftStop,
  PendingPhoto,
  SyncQueueItem,
  RecentRecordCache,
  OfflineSetting,
} from './schema'

/**
 * IndexedDB access layer for SIGOP offline support.
 *
 * This module is the single source of truth for local persistence. It must
 * never fall back to localStorage — offline data (including photo blobs) lives
 * exclusively in IndexedDB.
 */

interface SigopDB extends DBSchema {
  draft_incidents: {
    key: string
    value: DraftIncident
    indexes: { 'by-status': string }
  }
  draft_stops: {
    key: string
    value: DraftStop
    indexes: { 'by-status': string }
  }
  sync_queue: {
    key: string
    value: SyncQueueItem
    indexes: { 'by-status': string; 'by-priority': number }
  }
  pending_photos: {
    key: string
    value: PendingPhoto
    indexes: { 'by-entity': string; 'by-status': string }
  }
  recent_records_cache: {
    key: string
    value: RecentRecordCache
    indexes: { 'by-type': string }
  }
  offline_settings: {
    key: string
    value: OfflineSetting
  }
}

const DB_NAME = 'sigop-offline'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<SigopDB>> | null = null

export function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is not available on the server')
  }
  if (!dbPromise) {
    dbPromise = openDB<SigopDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // draft_incidents
        const incidentStore = db.createObjectStore('draft_incidents', { keyPath: 'id' })
        incidentStore.createIndex('by-status', 'status')

        // draft_stops
        const stopStore = db.createObjectStore('draft_stops', { keyPath: 'id' })
        stopStore.createIndex('by-status', 'status')

        // sync_queue
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id' })
        queueStore.createIndex('by-status', 'status')
        queueStore.createIndex('by-priority', 'priority')

        // pending_photos
        const photoStore = db.createObjectStore('pending_photos', { keyPath: 'id' })
        photoStore.createIndex('by-entity', 'entity_id')
        photoStore.createIndex('by-status', 'status')

        // recent_records_cache
        const cacheStore = db.createObjectStore('recent_records_cache', { keyPath: 'id' })
        cacheStore.createIndex('by-type', 'type')

        // offline_settings
        db.createObjectStore('offline_settings', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

// =============================================
// Incident drafts
// =============================================
export async function saveDraftIncident(draft: DraftIncident) {
  const db = await getDB()
  await db.put('draft_incidents', draft)
}

export async function getDraftIncident(id: string) {
  const db = await getDB()
  return db.get('draft_incidents', id)
}

export async function listDraftIncidents() {
  const db = await getDB()
  return db.getAll('draft_incidents')
}

export async function deleteDraftIncident(id: string) {
  const db = await getDB()
  await db.delete('draft_incidents', id)
}

// =============================================
// Stop drafts
// =============================================
export async function saveDraftStop(draft: DraftStop) {
  const db = await getDB()
  await db.put('draft_stops', draft)
}

export async function getDraftStop(id: string) {
  const db = await getDB()
  return db.get('draft_stops', id)
}

export async function listDraftStops() {
  const db = await getDB()
  return db.getAll('draft_stops')
}

export async function deleteDraftStop(id: string) {
  const db = await getDB()
  await db.delete('draft_stops', id)
}

// =============================================
// Pending photos
// =============================================
export async function savePendingPhoto(photo: PendingPhoto) {
  const db = await getDB()
  await db.put('pending_photos', photo)
}

export async function listPendingPhotos() {
  const db = await getDB()
  return db.getAll('pending_photos')
}

export async function getPhotosByEntity(entityId: string) {
  const db = await getDB()
  return db.getAllFromIndex('pending_photos', 'by-entity', entityId)
}

export async function deletePendingPhoto(id: string) {
  const db = await getDB()
  await db.delete('pending_photos', id)
}

// =============================================
// Sync queue
// =============================================
export async function enqueueSync(item: SyncQueueItem) {
  const db = await getDB()
  await db.put('sync_queue', item)
}

export async function listPendingQueue() {
  const db = await getDB()
  const all = await db.getAll('sync_queue')
  return all
    .filter((i) => i.status === 'pending' || i.status === 'error')
    .sort((a, b) => a.priority - b.priority)
}

export async function updateQueueStatus(
  id: string,
  status: SyncQueueItem['status'],
  error?: string,
) {
  const db = await getDB()
  const item = await db.get('sync_queue', id)
  if (!item) return
  await db.put('sync_queue', {
    ...item,
    status,
    last_error: error ?? item.last_error,
    updated_at: new Date().toISOString(),
    sync_attempts:
      status === 'error' ? item.sync_attempts + 1 : item.sync_attempts,
  })
}

export async function removeFromQueue(id: string) {
  const db = await getDB()
  await db.delete('sync_queue', id)
}

/** Every queue unit, regardless of status — used by the "Pendentes" screen. */
export async function listAllQueue() {
  const db = await getDB()
  const all = await db.getAll('sync_queue')
  return all.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
}

/**
 * Clear the backoff window for a single queue item so the next `processQueue`
 * run picks it up immediately.
 */
export async function retryQueueItemNow(id: string) {
  const db = await getDB()
  const item = await db.get('sync_queue', id)
  if (!item) return
  await db.put('sync_queue', {
    ...item,
    status: 'pending',
    next_attempt_at: null,
    updated_at: new Date().toISOString(),
  })
}

/**
 * Reset the backoff of every errored queue item (and errored photo) back to
 * "pending, retry now". Drives the header's "Tentar novamente" button.
 */
export async function resetAllBackoff() {
  const db = await getDB()
  const now = new Date().toISOString()

  const queueTx = db.transaction('sync_queue', 'readwrite')
  const queueItems = await queueTx.store.getAll()
  await Promise.all(
    queueItems
      .filter((item) => item.status === 'error')
      .map((item) =>
        queueTx.store.put({
          ...item,
          status: 'pending',
          next_attempt_at: null,
          updated_at: now,
        }),
      ),
  )
  await queueTx.done

  const photoTx = db.transaction('pending_photos', 'readwrite')
  const photos = await photoTx.store.getAll()
  await Promise.all(
    photos
      .filter((photo) => photo.status === 'error')
      .map((photo) =>
        photoTx.store.put({ ...photo, status: 'pending', last_error: null }),
      ),
  )
  await photoTx.done
}

/**
 * Permanently drop a queued item and any local draft it shadows. Irreversible —
 * the caller is expected to have confirmed with the user first.
 */
export async function discardQueueItem(id: string) {
  const db = await getDB()
  await Promise.all([
    db.delete('sync_queue', id),
    db.delete('draft_incidents', id),
    db.delete('draft_stops', id),
    db.delete('offline_settings', `incident:offenders:${id}`),
  ])
}

/** Drop a single pending photo (used by the photo group's "Descartar"). */
export async function discardPendingPhoto(id: string) {
  const db = await getDB()
  await db.delete('pending_photos', id)
}

/** Clear the error state of a single pending photo so it uploads again. */
export async function retryPendingPhotoNow(id: string) {
  const db = await getDB()
  const photo = await db.get('pending_photos', id)
  if (!photo) return
  await db.put('pending_photos', { ...photo, status: 'pending', last_error: null })
}

// =============================================
// Recent records cache
// =============================================
export async function cacheRecords(records: RecentRecordCache[]) {
  const db = await getDB()
  const tx = db.transaction('recent_records_cache', 'readwrite')
  await Promise.all(records.map((r) => tx.store.put(r)))
  await tx.done
}

export async function listRecentCache(type?: 'incident' | 'stop') {
  const db = await getDB()
  if (type) return db.getAllFromIndex('recent_records_cache', 'by-type', type)
  return db.getAll('recent_records_cache')
}

export async function clearRecentCache() {
  const db = await getDB()
  await db.clear('recent_records_cache')
}

// =============================================
// Offline settings
// =============================================
export async function saveSetting(key: string, value: unknown) {
  const db = await getDB()
  await db.put('offline_settings', { key, value })
}

export async function readSetting(key: string) {
  const db = await getDB()
  const setting = await db.get('offline_settings', key)
  return setting?.value
}

// =============================================
// Counters for the sync indicator
// =============================================
export async function countPending() {
  const db = await getDB()
  const queue = await db.getAll('sync_queue')
  const photos = await db.getAll('pending_photos')
  return {
    total: queue.filter((i) => i.status === 'pending').length,
    errors: queue.filter((i) => i.status === 'error').length,
    photos: photos.filter((f) => f.status === 'pending' || f.status === 'error')
      .length,
  }
}
