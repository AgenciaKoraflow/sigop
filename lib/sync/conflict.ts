import { createClient } from '@/lib/supabase/client'

/**
 * Optimistic-concurrency conflict detection.
 *
 * Every syncable table carries a monotonically increasing `version` column.
 * A conflict exists when the server version has moved ahead of the version the
 * client last saw locally.
 */

export interface ConflictInfo {
  localId: string
  localVersion: number
  remoteVersion: number
  localData: Record<string, unknown>
  remoteData: Record<string, unknown>
  detectedAt: string
}

type VersionedTable = 'incidents' | 'stops' | 'offenders'

export async function detectConflict(
  localId: string,
  localVersion: number,
  table: VersionedTable,
  localData: Record<string, unknown> = {},
): Promise<ConflictInfo | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', localId)
    .single()

  if (error || !data) return null

  const remote = data as Record<string, unknown>
  const remoteVersion = (remote.version as number) ?? 0

  if (remoteVersion > localVersion) {
    return {
      localId,
      localVersion,
      remoteVersion,
      localData,
      remoteData: remote,
      detectedAt: new Date().toISOString(),
    }
  }

  return null
}
