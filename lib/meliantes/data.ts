import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getDB } from '@/lib/db'
import type { RemotePhoto } from '@/components/fotos/PhotoGallery'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { fromOffenderPayload, type OffenderFormValues } from './form'

/**
 * Data layer for the "Meliantes" (offenders) screens.
 *
 * Reads go through an untyped client on purpose — the generated `Database`
 * types collapse `.rpc()` args and dynamic-table access to unusable unions in
 * this project (see the `supabase-typed-writes-never` note).
 */

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Search / listing
// ---------------------------------------------------------------------------
export interface OffenderSearchResult {
  id: string
  fullName: string | null
  socialName: string | null
  nickname: string | null
  cpf: string | null
  mainPhotoUrl: string | null
  stopCount: number
  incidentCount: number
  lastStoppedAt: string | null
}

/** Minimal offender identity emitted when one is picked in {@link BuscaMeliante}. */
export type SelectedOffender = Pick<
  OffenderSearchResult,
  'id' | 'fullName' | 'socialName' | 'nickname' | 'cpf' | 'mainPhotoUrl'
>

interface SearchRow {
  id: string
  full_name: string | null
  social_name: string | null
  nickname: string | null
  cpf: string | null
  main_photo_url: string | null
  stop_count: number | string | null
  incident_count: number | string | null
  last_stopped_at: string | null
}

function toSearchResult(row: SearchRow): OffenderSearchResult {
  return {
    id: row.id,
    fullName: row.full_name,
    socialName: row.social_name,
    nickname: row.nickname,
    cpf: row.cpf,
    mainPhotoUrl: row.main_photo_url,
    stopCount: Number(row.stop_count ?? 0),
    incidentCount: Number(row.incident_count ?? 0),
    lastStoppedAt: row.last_stopped_at,
  }
}

/**
 * Search offenders by name, social name, nickname or CPF (digits). An empty
 * term returns the most recently active offenders (drives the listing grid).
 */
export async function searchOffenders(term: string): Promise<OffenderSearchResult[]> {
  const { data, error } = await untyped().rpc('search_offenders_with_stats', {
    term: term.trim(),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as SearchRow[]).map(toSearchResult)
}

// ---------------------------------------------------------------------------
// CPF deduplication
// ---------------------------------------------------------------------------
export interface CpfMatch {
  id: string
  fullName: string | null
  socialName: string | null
  nickname: string | null
  cpf: string | null
}

/** Look for a live offender already registered with the given CPF. */
export async function findOffenderByCpf(cpf: string): Promise<CpfMatch | null> {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return null

  const { data, error } = await untyped().rpc('find_offender_by_cpf', {
    cpf_input: cpf,
  })
  if (error) throw new Error(error.message)

  const row = ((data ?? []) as Record<string, unknown>[])[0]
  if (!row) return null
  return {
    id: row.id as string,
    fullName: (row.full_name as string | null) ?? null,
    socialName: (row.social_name as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    cpf: (row.cpf as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export interface OffenderRecord {
  id: string
  full_name: string | null
  social_name: string | null
  nickname: string | null
  cpf: string | null
  rg: string | null
  birth_date: string | null
  gender: string | null
  height_m: number | null
  weight_kg: number | null
  skin_color: string | null
  eye_color: string | null
  hair_color: string | null
  distinguishing_marks: string | null
  physical_description: string | null
  main_photo_url: string | null
  created_at: string | null
  updated_at: string | null
}

export interface OffenderStopHistoryItem {
  linkId: string
  stopId: string
  type: string | null
  outcome: string | null
  stoppedAt: string | null
  description: string | null
}

export interface OffenderIncidentHistoryItem {
  linkId: string
  incidentId: string
  internalNumber: string | null
  type: string | null
  status: string | null
  role: string | null
  occurredAt: string | null
  description: string | null
}

export interface OffenderDetail {
  offender: OffenderRecord
  /** `true` when the record only exists locally (queued, not yet synced). */
  isLocalOnly: boolean
  stops: OffenderStopHistoryItem[]
  incidents: OffenderIncidentHistoryItem[]
  photos: RemotePhoto[]
  values: OffenderFormValues
}

const byDateDesc = (a: string | null, b: string | null) =>
  new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime()

/** Read a queued (not-yet-synced) offender payload straight from IndexedDB. */
async function readQueuedOffender(id: string): Promise<Record<string, unknown> | null> {
  try {
    const db = await getDB()
    const item = await db.get('sync_queue', id)
    if (item && item.entity_type === 'offender') return item.payload
  } catch {
    /* IndexedDB unavailable (SSR / private mode) — ignore. */
  }
  return null
}

export async function getOffenderDetail(id: string): Promise<OffenderDetail | null> {
  const supabase = untyped()

  const { data: row, error } = await supabase
    .from('offenders')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') {
    // Network / server error: still try the local queue before giving up.
    const queued = await readQueuedOffender(id)
    if (!queued) throw new Error(error.message)
    return buildLocalDetail(id, queued)
  }

  if (!row) {
    const queued = await readQueuedOffender(id)
    return queued ? buildLocalDetail(id, queued) : null
  }

  const offender = row as unknown as OffenderRecord

  const [{ data: stopLinks }, { data: incidentLinks }, { data: photoRows }] = await Promise.all([
    supabase
      .from('stop_offenders')
      .select('id, stop_id, stops ( id, type, outcome, stopped_at, description, deleted_at )')
      .eq('offender_id', id),
    supabase
      .from('incident_offenders')
      .select(
        'id, role, incident_id, incidents ( id, internal_number, type, status, occurred_at, description, deleted_at )',
      )
      .eq('offender_id', id),
    supabase
      .from('photos')
      .select('id, storage_path, description, sort_order')
      .eq('entity_type', 'offender')
      .eq('entity_id', id)
      .order('sort_order', { ascending: true }),
  ])

  const stops: OffenderStopHistoryItem[] = ((stopLinks ?? []) as unknown as RawStopLink[])
    .filter((link) => link.stops && !link.stops.deleted_at)
    .map((link) => ({
      linkId: link.id,
      stopId: link.stop_id,
      type: link.stops?.type ?? null,
      outcome: link.stops?.outcome ?? null,
      stoppedAt: link.stops?.stopped_at ?? null,
      description: link.stops?.description ?? null,
    }))
    .sort((a, b) => byDateDesc(a.stoppedAt, b.stoppedAt))

  const incidents: OffenderIncidentHistoryItem[] = ((incidentLinks ?? []) as unknown as RawIncidentLink[])
    .filter((link) => link.incidents && !link.incidents.deleted_at)
    .map((link) => ({
      linkId: link.id,
      incidentId: link.incident_id,
      internalNumber: link.incidents?.internal_number ?? null,
      type: link.incidents?.type ?? null,
      status: link.incidents?.status ?? null,
      role: link.role ?? null,
      occurredAt: link.incidents?.occurred_at ?? null,
      description: link.incidents?.description ?? null,
    }))
    .sort((a, b) => byDateDesc(a.occurredAt, b.occurredAt))

  const rawPhotos = (photoRows ?? []) as unknown as RawPhotoRow[]
  const signedUrls = await signPhotoUrls(
    supabase,
    rawPhotos.map((photo) => photo.storage_path),
  )
  const photos: RemotePhoto[] = rawPhotos
    .filter((photo) => photo.storage_path && signedUrls.has(photo.storage_path))
    .map((photo) => ({
      id: photo.id,
      url: signedUrls.get(photo.storage_path as string) as string,
      description: photo.description,
      sortOrder: photo.sort_order,
    }))

  return {
    offender,
    isLocalOnly: false,
    stops,
    incidents,
    photos,
    values: fromOffenderPayload(offender as unknown as Record<string, unknown>),
  }
}

function buildLocalDetail(id: string, payload: Record<string, unknown>): OffenderDetail {
  const str = (key: string) =>
    payload[key] === null || payload[key] === undefined ? null : String(payload[key])
  const num = (key: string) =>
    payload[key] === null || payload[key] === undefined ? null : Number(payload[key])

  const offender: OffenderRecord = {
    id,
    full_name: str('full_name'),
    social_name: str('social_name'),
    nickname: str('nickname'),
    cpf: str('cpf'),
    rg: str('rg'),
    birth_date: str('birth_date'),
    gender: str('gender'),
    height_m: num('height_m'),
    weight_kg: num('weight_kg'),
    skin_color: str('skin_color'),
    eye_color: str('eye_color'),
    hair_color: str('hair_color'),
    distinguishing_marks: str('distinguishing_marks'),
    physical_description: str('physical_description'),
    main_photo_url: str('main_photo_url'),
    created_at: null,
    updated_at: null,
  }

  return {
    offender,
    isLocalOnly: true,
    stops: [],
    incidents: [],
    photos: [],
    values: fromOffenderPayload(payload),
  }
}

// ---------------------------------------------------------------------------
// Raw join shapes
// ---------------------------------------------------------------------------
interface RawStopLink {
  id: string
  stop_id: string
  stops: {
    id: string
    type: string | null
    outcome: string | null
    stopped_at: string | null
    description: string | null
    deleted_at: string | null
  } | null
}

interface RawIncidentLink {
  id: string
  role: string | null
  incident_id: string
  incidents: {
    id: string
    internal_number: string | null
    type: string | null
    status: string | null
    occurred_at: string | null
    description: string | null
    deleted_at: string | null
  } | null
}

interface RawPhotoRow {
  id: string
  storage_path: string | null
  description: string | null
  sort_order: number | null
}
