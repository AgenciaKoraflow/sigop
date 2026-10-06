import type { SupabaseClient } from '@supabase/supabase-js'
import { endOfDay, parseISO, startOfDay } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { compressImage, type CompressionOptions } from '@/lib/fotos/compress'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { offenderRoleLabel } from '@/lib/ocorrencias/form'
import {
  getContractorNameForTerritorialArea,
  getMunicipalityName,
  getTerritorialAreaName,
} from '@/lib/ocorrencias/data'

/**
 * Data layer for the incident PDF reports — single incident and bulk export
 * (`components/ocorrencias/relatorio/RelatorioOcorrenciaPdf.tsx`).
 *
 * Sensitive-data rule: offenders are read through an explicit **allow-list** of
 * columns (`OFFENDER_REPORT_COLUMNS`). CPF, RG, birth date, gender, weight and
 * any other column never reach the report code path — do not switch this to
 * `select('*')`.
 *
 * Identifiers stay in English to match the rest of the codebase.
 */

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

/** Photos embedded in the single-incident PDF (longest edge in pixels). */
const REPORT_PHOTO_OPTIONS: CompressionOptions = {
  maxWidth: 1000,
  maxHeight: 1000,
  quality: 0.78,
  maxSizeMB: 0.6,
}

/** Bulk export embeds many incidents, so its photos are compressed harder. */
const BULK_REPORT_PHOTO_OPTIONS: CompressionOptions = {
  maxWidth: 800,
  maxHeight: 800,
  quality: 0.7,
  maxSizeMB: 0.3,
}

/** Hard cap of incidents per bulk PDF — everything is rendered in the browser. */
export const BULK_REPORT_MAX_INCIDENTS = 200

/** Incidents prepared in parallel (photo download + compression) in a bulk export. */
const BULK_REPORT_CONCURRENCY = 3

/** The only offender columns allowed into the report. */
const OFFENDER_REPORT_COLUMNS =
  'id, full_name, nickname, height_m, skin_color, eye_color, hair_color, distinguishing_marks, physical_description, main_photo_url, deleted_at'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface ReportPhoto {
  id: string
  /** `data:` URI, already downscaled. */
  src: string
  description: string | null
}

export interface ReportOffender {
  id: string
  name: string
  nickname: string | null
  roleLabel: string
  photoSrc: string | null
  /** Non-sensitive physical traits, already formatted as `[label, value]`. */
  traits: [string, string][]
}

export interface IncidentReport {
  internalNumber: string
  type: string
  subtype: string | null
  description: string
  occurredAt: string
  address: string
  municipality: string | null
  territorialArea: string | null
  contractor: string | null
  agentName: string | null
  photos: ReportPhoto[]
  offenders: ReportOffender[]
  generatedAt: string
  generatedBy: string | null
  /** Optional brand mark (`data:` URI) — `null` falls back to the vector mark. */
  logoSrc: string | null
}

export interface BulkReportFilters {
  /** First day of the period, `yyyy-MM-dd` (local time). */
  from: string
  /** Last day of the period, `yyyy-MM-dd` (local time, inclusive). */
  to: string
  /** `incidents.type`; omit for every type. */
  type?: string
}

export interface BulkIncidentReport {
  from: string
  to: string
  /** `null` means "all types". */
  type: string | null
  /** Ordered by `occurredAt`, oldest first. */
  reports: IncidentReport[]
  generatedAt: string
  generatedBy: string | null
  logoSrc: string | null
}

export class ReportForbiddenError extends Error {
  constructor() {
    super('Apenas administradores podem exportar o relatório.')
    this.name = 'ReportForbiddenError'
  }
}

export class ReportEmptyError extends Error {
  constructor() {
    super('Nenhuma ocorrência encontrada para o período e tipo selecionados.')
    this.name = 'ReportEmptyError'
  }
}

export class ReportTooLargeError extends Error {
  constructor(total: number) {
    super(
      `Foram encontradas ${total} ocorrências; o limite por exportação é ${BULK_REPORT_MAX_INCIDENTS}. Reduza o período ou filtre por tipo.`,
    )
    this.name = 'ReportTooLargeError'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler imagem'))
    reader.readAsDataURL(blob)
  })
}

/** Download a (signed) image URL, downscale it and return a `data:` URI. */
async function imageToDataUri(url: string, options: CompressionOptions): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const original = await response.blob()
    const compressed = await compressImage(original, options)
    return await blobToDataUri(compressed)
  } catch {
    return null
  }
}

/** Optional `public/logo-relatorio.png`; absent file simply means "no logo". */
async function loadOptionalLogo(): Promise<string | null> {
  try {
    const response = await fetch('/logo-relatorio.png')
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return null
    return await blobToDataUri(await response.blob())
  } catch {
    return null
  }
}

function formatHeight(value: unknown): string | null {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return `${num.toFixed(2).replace('.', ',')} m`
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

interface RawLink {
  id: string
  role: string | null
  offenders: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
/**
 * Defence in depth: the buttons are admin-only, but the generators re-check.
 * Returns the requester's display name.
 */
async function requireAdmin(supabase: SupabaseClient): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser()
  const authUserId = authData.user?.id
  if (!authUserId) throw new ReportForbiddenError()

  const { data: me } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', authUserId)
    .maybeSingle()
  const requester = me as {
    full_name: string | null
    role: string | null
  } | null
  if (requester?.role !== 'administrator') throw new ReportForbiddenError()
  return requester.full_name
}

/** Cache a by-id lookup so a bulk export resolves each name only once. */
function memoize<T>(fn: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return (id) => {
    let hit = cache.get(id)
    if (!hit) {
      hit = fn(id)
      cache.set(id, hit)
    }
    return hit
  }
}

/** Everything shared by the incidents of one export. */
interface ReportContext {
  supabase: SupabaseClient
  generatedAt: string
  generatedBy: string | null
  logoSrc: string | null
  photoOptions: CompressionOptions
  municipalityName: (id: string) => Promise<string | null>
  territorialAreaName: (id: string) => Promise<string | null>
  contractorName: (territorialAreaId: string) => Promise<string | null>
  agentName: (profileId: string) => Promise<string | null>
}

async function createReportContext(
  supabase: SupabaseClient,
  photoOptions: CompressionOptions,
): Promise<ReportContext> {
  const [generatedBy, logoSrc] = await Promise.all([requireAdmin(supabase), loadOptionalLogo()])
  return {
    supabase,
    generatedAt: new Date().toISOString(),
    generatedBy,
    logoSrc,
    photoOptions,
    municipalityName: memoize((id) => getMunicipalityName(id).catch(() => null)),
    territorialAreaName: memoize((id) => getTerritorialAreaName(id).catch(() => null)),
    contractorName: memoize((id) => getContractorNameForTerritorialArea(id).catch(() => null)),
    agentName: memoize(async (id) => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', id)
        .maybeSingle()
      return (data as { full_name: string | null } | null)?.full_name ?? null
    }),
  }
}

export async function loadIncidentReport(incidentId: string): Promise<IncidentReport> {
  const supabase = untyped()
  const context = await createReportContext(supabase, REPORT_PHOTO_OPTIONS)

  const { data: incidentRow, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', incidentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const incident = incidentRow as Record<string, unknown> | null
  if (!incident) throw new Error('Ocorrência não encontrada.')

  return buildIncidentReport(incident, context)
}

/**
 * Every incident in a period (optionally of a single type), ready for
 * `RelatorioOcorrenciasLotePdf`. `onProgress` fires as each incident finishes.
 */
export async function loadBulkIncidentReport(
  filters: BulkReportFilters,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkIncidentReport> {
  const supabase = untyped()
  const context = await createReportContext(supabase, BULK_REPORT_PHOTO_OPTIONS)

  let query = supabase
    .from('incidents')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .gte('occurred_at', startOfDay(parseISO(filters.from)).toISOString())
    .lte('occurred_at', endOfDay(parseISO(filters.to)).toISOString())
  if (filters.type) query = query.eq('type', filters.type)

  const { data, count, error } = await query
    .order('occurred_at', { ascending: true })
    .range(0, BULK_REPORT_MAX_INCIDENTS - 1)
  if (error) throw new Error(error.message)

  const incidents = (data ?? []) as Record<string, unknown>[]
  const total = count ?? incidents.length
  if (incidents.length === 0) throw new ReportEmptyError()
  if (total > BULK_REPORT_MAX_INCIDENTS) throw new ReportTooLargeError(total)

  // Small worker pool: bounded memory/network while photos are compressed.
  const reports = new Array<IncidentReport>(incidents.length)
  let next = 0
  let done = 0
  onProgress?.(0, incidents.length)
  const worker = async () => {
    while (next < incidents.length) {
      const index = next++
      reports[index] = await buildIncidentReport(incidents[index], context)
      onProgress?.(++done, incidents.length)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BULK_REPORT_CONCURRENCY, incidents.length) }, worker),
  )

  return {
    from: filters.from,
    to: filters.to,
    type: filters.type ?? null,
    reports,
    generatedAt: context.generatedAt,
    generatedBy: context.generatedBy,
    logoSrc: context.logoSrc,
  }
}

async function buildIncidentReport(
  incident: Record<string, unknown>,
  context: ReportContext,
): Promise<IncidentReport> {
  const { supabase, photoOptions } = context
  const incidentId = String(incident.id)

  const municipalityId = clean(incident.municipality_id)
  const territorialAreaId = clean(incident.territorial_area_id)
  const createdBy = clean(incident.created_by)

  const [agentName, linkRes, photoRes, municipality, territorialArea, contractor] =
    await Promise.all([
      createdBy ? context.agentName(createdBy) : null,
      supabase
        .from('incident_offenders')
        .select(`id, role, offenders ( ${OFFENDER_REPORT_COLUMNS} )`)
        .eq('incident_id', incidentId),
      supabase
        .from('photos')
        .select('id, storage_path, description, sort_order')
        .eq('entity_type', 'incident')
        .eq('entity_id', incidentId)
        .order('sort_order', { ascending: true }),
      municipalityId ? context.municipalityName(municipalityId) : null,
      territorialAreaId ? context.territorialAreaName(territorialAreaId) : null,
      territorialAreaId ? context.contractorName(territorialAreaId) : null,
    ])

  // Offenders -----------------------------------------------------------------
  const links = ((linkRes.data ?? []) as unknown as RawLink[]).filter(
    (link) => link.offenders && !link.offenders.deleted_at,
  )
  const offenderIds = links.map((link) => String(link.offenders?.id))

  const offenderPhotoRows =
    offenderIds.length > 0
      ? (((
          await supabase
            .from('photos')
            .select('entity_id, storage_path, sort_order')
            .eq('entity_type', 'offender')
            .in('entity_id', offenderIds)
            .order('sort_order', { ascending: true })
        ).data ?? []) as { entity_id: string; storage_path: string | null }[])
      : []

  // First stored photo per offender; `main_photo_url` only as a fallback.
  const offenderPhotoPath = new Map<string, string>()
  for (const row of offenderPhotoRows) {
    if (row.storage_path && !offenderPhotoPath.has(row.entity_id)) {
      offenderPhotoPath.set(row.entity_id, row.storage_path)
    }
  }
  for (const link of links) {
    const id = String(link.offenders?.id)
    const main = clean(link.offenders?.main_photo_url)
    if (main && !offenderPhotoPath.has(id) && !/^https?:/i.test(main)) {
      offenderPhotoPath.set(id, main)
    }
  }

  const incidentPhotoRows = (photoRes.data ?? []) as {
    id: string
    storage_path: string | null
    description: string | null
  }[]

  const signed = await signPhotoUrls(supabase, [
    ...incidentPhotoRows.map((photo) => photo.storage_path),
    ...Array.from(offenderPhotoPath.values()),
  ])

  const [photos, offenders] = await Promise.all([
    Promise.all(
      incidentPhotoRows.map(async (photo): Promise<ReportPhoto | null> => {
        const url = photo.storage_path ? signed.get(photo.storage_path) : null
        const src = url ? await imageToDataUri(url, photoOptions) : null
        return src ? { id: photo.id, src, description: clean(photo.description) } : null
      }),
    ),
    Promise.all(
      links.map(async (link): Promise<ReportOffender> => {
        const raw = link.offenders as Record<string, unknown>
        const id = String(raw.id)

        const path = offenderPhotoPath.get(id)
        const directUrl = clean(raw.main_photo_url)
        const url = path
          ? signed.get(path)
          : directUrl && /^https?:/i.test(directUrl)
            ? directUrl
            : null

        const traits: [string, string][] = []
        const push = (label: string, value: string | null) => {
          if (value) traits.push([label, value])
        }
        push('Altura', formatHeight(raw.height_m))
        push('Pele', clean(raw.skin_color))
        push('Olhos', clean(raw.eye_color))
        push('Cabelo', clean(raw.hair_color))
        push('Marcas', clean(raw.distinguishing_marks))
        push('Informações gerais', clean(raw.physical_description))

        return {
          id,
          name: clean(raw.full_name) ?? clean(raw.nickname) ?? 'Sem nome',
          nickname: clean(raw.full_name) ? clean(raw.nickname) : null,
          roleLabel: offenderRoleLabel(link.role),
          photoSrc: url ? await imageToDataUri(url, photoOptions) : null,
          traits,
        }
      }),
    ),
  ])

  const address = [
    incident.address_street,
    incident.address_number,
    incident.address_district,
    incident.address_city,
    incident.address_state,
  ]
    .map(clean)
    .filter(Boolean)
    .join(', ')

  return {
    internalNumber: clean(incident.internal_number) ?? `OC-${shortId(incidentId)}`,
    type: clean(incident.type) ?? 'other',
    subtype: clean(incident.subtype),
    // AI-refined text when available; the agent's original text otherwise.
    description: clean(incident.description_ai) ?? clean(incident.description) ?? '',
    occurredAt: String(incident.occurred_at),
    address,
    municipality,
    territorialArea,
    contractor,
    agentName,
    photos: photos.filter((photo): photo is ReportPhoto => photo !== null),
    offenders,
    generatedAt: context.generatedAt,
    generatedBy: context.generatedBy,
    logoSrc: context.logoSrc,
  }
}
