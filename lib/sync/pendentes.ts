import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  discardPendingPhoto,
  discardQueueItem,
  enqueueSync,
  getDB,
  listAllQueue,
  listDraftIncidents,
  listDraftStops,
  listPendingPhotos,
  readSetting,
  removeFromQueue,
} from '@/lib/db'
import type { PendingPhoto, SyncQueueItem } from '@/lib/db/schema'
import type { EntityType, Operation, SyncStatus } from '@/types/app.types'
import { createQueueItem, LAST_SYNC_SETTING_KEY, processQueue } from '@/lib/sync/queue'
import { detectConflict, type ConflictInfo } from '@/lib/sync/conflict'

/**
 * Read/aggregation layer behind the "Sincronização pendente" screen
 * (`components/sync/TelaPendentes.tsx`).
 *
 * Everything here reads straight from IndexedDB (the sync queue + photo blobs +
 * entity drafts). Conflict detection additionally hits the server to compare
 * the optimistic-concurrency `version` column.
 *
 * Identifiers stay in English to match the rest of the codebase; user-facing
 * copy stays in Portuguese.
 */

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Shapes consumed by the UI
// ---------------------------------------------------------------------------
export type PendingGroupKey = 'incident' | 'stop' | 'offender' | 'link' | 'photo'

export interface PendingItemView {
  /** Local id (queue item id, or photo id). */
  id: string
  kind: PendingGroupKey
  operation: Operation
  status: SyncStatus
  attempts: number
  lastError: string | null
  nextAttemptAt: string | null
  createdAt: string
  /** Only set for photos while an upload is in flight. */
  progress: number | null
  /** Route to the entity's detail screen, when one exists. */
  editHref: string | null
}

export interface PendingGroupView {
  key: PendingGroupKey
  label: string
  items: PendingItemView[]
}

export interface ConflictFieldDiff {
  field: string
  label: string
  local: string
  remote: string
}

export interface ConflictView {
  id: string
  table: 'incidents' | 'stops'
  entityType: Extract<EntityType, 'incident' | 'stop'>
  title: string
  localVersion: number
  remoteVersion: number
  detectedAt: string
  localData: Record<string, unknown>
  remoteData: Record<string, unknown>
  diffs: ConflictFieldDiff[]
}

export interface PendingSnapshot {
  groups: PendingGroupView[]
  counts: {
    /** Queue items + photos that are waiting or in-flight (not errored). */
    pending: number
    /** Queue items + photos in error. */
    errors: number
    /** Photos specifically (pending or errored). */
    photos: number
  }
  conflicts: ConflictView[]
  lastSuccessfulSync: string | null
  /** `true` when nothing is queued and there are no conflicts. */
  isEmpty: boolean
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
const GROUP_LABELS: Record<PendingGroupKey, string> = {
  incident: 'Ocorrências',
  stop: 'Abordagens',
  offender: 'Meliantes',
  link: 'Vínculos',
  photo: 'Fotos',
}

const GROUP_ORDER: PendingGroupKey[] = ['incident', 'stop', 'photo', 'offender', 'link']

const FIELD_LABELS: Record<string, string> = {
  type: 'Tipo',
  subtype: 'Subtipo',
  status: 'Status',
  description: 'Descrição',
  occurred_at: 'Data da ocorrência',
  stopped_at: 'Data da abordagem',
  outcome: 'Resultado',
  address_street: 'Logradouro',
  address_number: 'Número',
  address_district: 'Bairro',
  address_city: 'Cidade',
  address_state: 'UF',
  address_zip: 'CEP',
  latitude: 'Latitude',
  longitude: 'Longitude',
  gmaps_link: 'Link do Google Maps',
}

const IGNORED_DIFF_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'synced_at',
  'deleted_at',
  'version',
  'created_by',
  'updated_by',
  'unit_id',
  'internal_number',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function editHrefFor(entityType: EntityType, id: string): string | null {
  switch (entityType) {
    case 'incident':
      return `/ocorrencias/${id}`
    case 'stop':
      return `/abordagens/${id}`
    case 'offender':
      return `/meliantes/${id}`
    default:
      return null
  }
}

function queueItemToView(item: SyncQueueItem): PendingItemView {
  return {
    id: item.id,
    kind: item.entity_type as PendingGroupKey,
    operation: item.operation,
    status: item.status,
    attempts: item.sync_attempts,
    lastError: item.last_error,
    nextAttemptAt: item.next_attempt_at,
    createdAt: item.created_at,
    progress: null,
    editHref: editHrefFor(item.entity_type, item.id),
  }
}

function photoToView(photo: PendingPhoto): PendingItemView {
  return {
    id: photo.id,
    kind: 'photo',
    operation: 'upload',
    status: photo.status,
    attempts: photo.sync_attempts,
    lastError: photo.last_error,
    nextAttemptAt: null,
    createdAt: photo.created_at,
    progress: photo.status === 'syncing' ? 60 : null,
    editHref: editHrefFor(photo.entity_type, photo.entity_id),
  }
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 120)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildDiffs(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): ConflictFieldDiff[] {
  const keys = Object.keys(local)
    .concat(Object.keys(remote).filter((key) => !(key in local)))
    .filter((key) => !IGNORED_DIFF_KEYS.has(key))

  const diffs: ConflictFieldDiff[] = []
  for (const key of keys) {
    const l = local[key] ?? null
    const r = remote[key] ?? null
    if (JSON.stringify(l) === JSON.stringify(r)) continue
    diffs.push({
      field: key,
      label: FIELD_LABELS[key] ?? key,
      local: stringifyValue(l),
      remote: stringifyValue(r),
    })
  }
  return diffs
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------
async function loadConflicts(isOnline: boolean): Promise<ConflictView[]> {
  if (!isOnline) return []

  const [incidents, stops] = await Promise.all([listDraftIncidents(), listDraftStops()])
  const candidates: {
    draftId: string
    table: 'incidents' | 'stops'
    entityType: 'incident' | 'stop'
    localVersion: number
    payload: Record<string, unknown>
  }[] = []

  for (const draft of incidents) {
    if (draft.operation !== 'update') continue
    candidates.push({
      draftId: draft.id,
      table: 'incidents',
      entityType: 'incident',
      localVersion: draft.remote_version ?? draft.local_version,
      payload: draft.payload,
    })
  }
  for (const draft of stops) {
    if (draft.operation !== 'update') continue
    candidates.push({
      draftId: draft.id,
      table: 'stops',
      entityType: 'stop',
      localVersion: draft.remote_version ?? draft.local_version,
      payload: draft.payload,
    })
  }

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      let info: ConflictInfo | null = null
      try {
        info = await detectConflict(
          candidate.draftId,
          candidate.localVersion,
          candidate.table,
          candidate.payload,
        )
      } catch {
        info = null
      }
      if (!info) return null

      const title =
        candidate.table === 'incidents'
          ? `Ocorrência ${String(info.remoteData.internal_number ?? candidate.draftId.slice(0, 8))}`
          : `Abordagem ${String(info.remoteData.internal_number ?? candidate.draftId.slice(0, 8))}`

      const view: ConflictView = {
        id: candidate.draftId,
        table: candidate.table,
        entityType: candidate.entityType,
        title,
        localVersion: info.localVersion,
        remoteVersion: info.remoteVersion,
        detectedAt: info.detectedAt,
        localData: candidate.payload,
        remoteData: info.remoteData,
        diffs: buildDiffs(candidate.payload, info.remoteData),
      }
      return view
    }),
  )

  return results.filter((value): value is ConflictView => value !== null)
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------
export async function loadPendingSnapshot(isOnline: boolean): Promise<PendingSnapshot> {
  const [queue, photos, lastSyncRaw, conflicts] = await Promise.all([
    listAllQueue(),
    listPendingPhotos(),
    readSetting(LAST_SYNC_SETTING_KEY),
    loadConflicts(isOnline),
  ])

  const activePhotos = photos.filter(
    (photo) => photo.status !== 'synced',
  )

  const byGroup = new Map<PendingGroupKey, PendingItemView[]>()
  for (const item of queue) {
    const key = item.entity_type as PendingGroupKey
    const list = byGroup.get(key) ?? []
    list.push(queueItemToView(item))
    byGroup.set(key, list)
  }
  if (activePhotos.length > 0) {
    byGroup.set(
      'photo',
      activePhotos
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(photoToView),
    )
  }

  const groups: PendingGroupView[] = GROUP_ORDER.filter((key) => byGroup.has(key)).map(
    (key) => ({
      key,
      label: GROUP_LABELS[key],
      items: byGroup.get(key) ?? [],
    }),
  )

  const queuePending = queue.filter((i) => i.status !== 'error').length
  const queueErrors = queue.filter((i) => i.status === 'error').length
  const photosPending = activePhotos.filter((p) => p.status !== 'error').length
  const photosErrors = activePhotos.filter((p) => p.status === 'error').length

  return {
    groups,
    counts: {
      pending: queuePending + photosPending,
      errors: queueErrors + photosErrors,
      photos: activePhotos.length,
    },
    conflicts,
    lastSuccessfulSync: typeof lastSyncRaw === 'string' ? lastSyncRaw : null,
    isEmpty: queue.length === 0 && activePhotos.length === 0 && conflicts.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------
export async function discardPendingItem(item: PendingItemView): Promise<void> {
  if (item.kind === 'photo') {
    await discardPendingPhoto(item.id)
    return
  }
  await discardQueueItem(item.id)
}

// ---------------------------------------------------------------------------
// Conflict resolution — writes an audit entry, then clears the local state
// ---------------------------------------------------------------------------
async function writeConflictAudit(
  conflict: ConflictView,
  resolution: 'keep_local' | 'use_server',
  performedBy: string | null,
): Promise<void> {
  const supabase = untyped()
  const { error } = await supabase.from('audit_log').insert({
    entity_type: conflict.entityType,
    entity_id: conflict.id,
    operation: 'conflict_resolved',
    previous_version: conflict.localVersion,
    new_version: conflict.remoteVersion,
    previous_data: conflict.localData,
    new_data: conflict.remoteData,
    performed_by: performedBy,
    user_agent:
      resolution === 'keep_local'
        ? 'sigop/pendentes: manter versão local'
        : 'sigop/pendentes: usar versão do servidor',
  })
  if (error) throw new Error(error.message)
}

/**
 * "Manter versão local": keep the local draft, re-enqueue it as an update so the
 * next sync overwrites the server, and drop the conflict from the screen.
 */
export async function resolveConflictKeepLocal(
  conflict: ConflictView,
  performedBy: string | null,
): Promise<void> {
  await writeConflictAudit(conflict, 'keep_local', performedBy)

  const db = await getDB()
  const store = conflict.table === 'incidents' ? 'draft_incidents' : 'draft_stops'
  const draft = await db.get(store, conflict.id)
  if (draft) {
    await db.put(store, {
      ...draft,
      status: 'pending',
      last_error: null,
      next_attempt_at: null,
      remote_version: conflict.remoteVersion,
    })
  }

  await enqueueSync(
    createQueueItem(
      conflict.entityType,
      'update',
      { ...conflict.localData, id: conflict.id },
      1,
    ),
  )

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void processQueue().catch(() => {})
  }
}

/**
 * "Usar versão do servidor": discard the local draft and its queue unit so the
 * detail screen falls back to the authoritative server copy.
 */
export async function resolveConflictUseServer(
  conflict: ConflictView,
  performedBy: string | null,
): Promise<void> {
  await writeConflictAudit(conflict, 'use_server', performedBy)

  const db = await getDB()
  const store = conflict.table === 'incidents' ? 'draft_incidents' : 'draft_stops'
  await Promise.all([db.delete(store, conflict.id), removeFromQueue(conflict.id)])
}
