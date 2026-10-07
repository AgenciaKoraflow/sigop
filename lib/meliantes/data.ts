import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { RemotePhoto } from '@/components/fotos/PhotoGallery'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { fromOffenderPayload, type OffenderFormValues } from './form'

/**
 * Data layer for the "Suspeitos" (offenders) screens.
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
  /** Linked live incidents of any type ("checagem" is just `type = 'stop'`). */
  incidentCount: number
  lastOccurredAt: string | null
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
  incident_count: number | string | null
}

function toSearchResult(row: SearchRow): OffenderSearchResult {
  return {
    id: row.id,
    fullName: row.full_name,
    socialName: row.social_name,
    nickname: row.nickname,
    cpf: row.cpf,
    // Resolved afterwards by `loadOffenderPhotoUrls` (private bucket).
    mainPhotoUrl: null,
    incidentCount: Number(row.incident_count ?? 0),
    lastOccurredAt: null,
  }
}

/** Offender ids per `incident_offenders` lookup — keeps the `in.(…)` filter URL short. */
const STATS_CHUNK_SIZE = 100

interface IncidentStats {
  count: number
  lastOccurredAt: string | null
}

/**
 * Count and latest date of the live incidents linked to each offender. The
 * RPC's own `stop_count`/`last_stopped_at` columns date from when checagens
 * were a separate `stops` table, so they are ignored in favour of this.
 */
async function loadIncidentStats(
  supabase: SupabaseClient,
  offenderIds: string[],
): Promise<Map<string, IncidentStats>> {
  const stats = new Map<string, IncidentStats>()

  const chunks: string[][] = []
  for (let start = 0; start < offenderIds.length; start += STATS_CHUNK_SIZE) {
    chunks.push(offenderIds.slice(start, start + STATS_CHUNK_SIZE))
  }

  const responses = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('incident_offenders')
        .select('offender_id, incidents ( occurred_at, deleted_at )')
        .in('offender_id', chunk),
    ),
  )

  for (const { data, error } of responses) {
    if (error) throw new Error(error.message)
    for (const link of (data ?? []) as unknown as RawIncidentStatsLink[]) {
      if (!link.incidents || link.incidents.deleted_at) continue
      const current = stats.get(link.offender_id) ?? { count: 0, lastOccurredAt: null }
      const occurredAt = link.incidents.occurred_at
      const isLatest =
        occurredAt !== null &&
        (current.lastOccurredAt === null ||
          new Date(occurredAt).getTime() > new Date(current.lastOccurredAt).getTime())
      stats.set(link.offender_id, {
        count: current.count + 1,
        lastOccurredAt: isLatest ? occurredAt : current.lastOccurredAt,
      })
    }
  }

  return stats
}

/**
 * Signed URL of each offender's main photo (lowest `sort_order`), keyed by
 * offender id. The bucket is private, so `offenders.main_photo_url` and the
 * RPC's `main_photo_url` are not displayable — thumbnails must come from here.
 * Never throws: offenders without a resolvable photo are simply absent.
 */
export async function loadOffenderPhotoUrls(
  supabase: SupabaseClient,
  offenderIds: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const ids = Array.from(new Set(offenderIds.filter(Boolean)))
  if (ids.length === 0) return urls

  const chunks: string[][] = []
  for (let start = 0; start < ids.length; start += STATS_CHUNK_SIZE) {
    chunks.push(ids.slice(start, start + STATS_CHUNK_SIZE))
  }

  try {
    const responses = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from('photos')
          .select('entity_id, storage_path, sort_order')
          .eq('entity_type', 'offender')
          .in('entity_id', chunk)
          .order('sort_order', { ascending: true }),
      ),
    )

    const pathByOffender = new Map<string, string>()
    for (const { data } of responses) {
      for (const row of (data ?? []) as unknown as RawOffenderPhotoRow[]) {
        if (row.storage_path && !pathByOffender.has(row.entity_id)) {
          pathByOffender.set(row.entity_id, row.storage_path)
        }
      }
    }

    const signed = await signPhotoUrls(supabase, Array.from(pathByOffender.values()))
    pathByOffender.forEach((path, offenderId) => {
      const url = signed.get(path)
      if (url) urls.set(offenderId, url)
    })
  } catch {
    // Offline / storage failure — callers fall back to the initials avatar.
  }

  return urls
}

/**
 * Search offenders by name, social name, nickname or CPF (digits). An empty
 * term returns the most recently active offenders (drives the listing grid).
 */
export async function searchOffenders(term: string): Promise<OffenderSearchResult[]> {
  const supabase = untyped()
  const { data, error } = await supabase.rpc('search_offenders_with_stats', {
    term: term.trim(),
  })
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as SearchRow[]).map(toSearchResult)
  if (rows.length === 0) return rows

  const offenderIds = rows.map((row) => row.id)
  const [photoUrls, stats] = await Promise.all([
    loadOffenderPhotoUrls(supabase, offenderIds),
    // Stats are secondary to the listing itself — keep the RPC's own count.
    loadIncidentStats(supabase, offenderIds).catch(() => null),
  ])

  return rows.map((row) => ({
    ...row,
    mainPhotoUrl: photoUrls.get(row.id) ?? null,
    incidentCount: stats ? (stats.get(row.id)?.count ?? 0) : row.incidentCount,
    lastOccurredAt: stats?.get(row.id)?.lastOccurredAt ?? null,
  }))
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

export interface OffenderIncidentHistoryItem {
  linkId: string
  incidentId: string
  internalNumber: string | null
  type: string | null
  role: string | null
  occurredAt: string | null
  description: string | null
  addressStreet: string | null
  addressDistrict: string | null
  addressCity: string | null
}

export interface OffenderDetail {
  offender: OffenderRecord
  incidents: OffenderIncidentHistoryItem[]
  photos: RemotePhoto[]
  values: OffenderFormValues
}

const byDateDesc = (a: string | null, b: string | null) =>
  new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime()

export async function getOffenderDetail(id: string): Promise<OffenderDetail | null> {
  const supabase = untyped()

  const { data: row, error } = await supabase
    .from('offenders')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw new Error(error.message)

  if (!row) return null

  const offender = row as unknown as OffenderRecord

  const [{ data: incidentLinks }, { data: photoRows }] = await Promise.all([
    supabase
      .from('incident_offenders')
      .select(
        'id, role, incident_id, incidents ( id, internal_number, type, occurred_at, description, address_street, address_district, address_city, deleted_at )',
      )
      .eq('offender_id', id),
    supabase
      .from('photos')
      .select('id, storage_path, description, sort_order')
      .eq('entity_type', 'offender')
      .eq('entity_id', id)
      .order('sort_order', { ascending: true }),
  ])

  const incidents: OffenderIncidentHistoryItem[] = ((incidentLinks ?? []) as unknown as RawIncidentLink[])
    .filter((link) => link.incidents && !link.incidents.deleted_at)
    .map((link) => ({
      linkId: link.id,
      incidentId: link.incident_id,
      internalNumber: link.incidents?.internal_number ?? null,
      type: link.incidents?.type ?? null,
      role: link.role ?? null,
      occurredAt: link.incidents?.occurred_at ?? null,
      description: link.incidents?.description ?? null,
      addressStreet: link.incidents?.address_street ?? null,
      addressDistrict: link.incidents?.address_district ?? null,
      addressCity: link.incidents?.address_city ?? null,
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
    incidents,
    photos,
    values: fromOffenderPayload(offender as unknown as Record<string, unknown>),
  }
}

// ---------------------------------------------------------------------------
// Delete — via the Route Handler (administrators only)
// ---------------------------------------------------------------------------
export async function deleteOffender(id: string): Promise<void> {
  const res = await fetch(`/api/meliantes/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Não foi possível excluir o suspeito.')
  }
}

// ---------------------------------------------------------------------------
// Raw join shapes
// ---------------------------------------------------------------------------
interface RawIncidentLink {
  id: string
  role: string | null
  incident_id: string
  incidents: {
    id: string
    internal_number: string | null
    type: string | null
    occurred_at: string | null
    description: string | null
    address_street: string | null
    address_district: string | null
    address_city: string | null
    deleted_at: string | null
  } | null
}

interface RawIncidentStatsLink {
  offender_id: string
  incidents: {
    occurred_at: string | null
    deleted_at: string | null
  } | null
}

interface RawOffenderPhotoRow {
  entity_id: string
  storage_path: string | null
}

interface RawPhotoRow {
  id: string
  storage_path: string | null
  description: string | null
  sort_order: number | null
}
