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
