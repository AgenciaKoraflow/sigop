import type { TourStatus } from './types'

/**
 * Remembers, per user and per browser, that a tour was finished or skipped so
 * it is not offered again. Only the status is stored — nothing sensitive — and
 * every access is guarded: storage can be missing, full or blocked (private
 * mode), and the app must keep working without it.
 */

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function tourStorageKey(userId: string, tourId: string, version: number): string {
  return `sigop:tour:${userId}:${tourId}:v${version}`
}

export function readTourStatus(
  storage: StorageLike | null,
  userId: string,
  tourId: string,
  version: number,
): TourStatus | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(tourStorageKey(userId, tourId, version))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const status = (parsed as { status?: unknown } | null)?.status
    return status === 'completed' || status === 'skipped' ? status : null
  } catch {
    return null
  }
}

export function writeTourStatus(
  storage: StorageLike | null,
  userId: string,
  tourId: string,
  version: number,
  status: TourStatus,
): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      tourStorageKey(userId, tourId, version),
      JSON.stringify({ status, at: new Date().toISOString() }),
    )
    return true
  } catch {
    return false
  }
}

/** `window.localStorage`, or null when unavailable (SSR, blocked storage). */
export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
