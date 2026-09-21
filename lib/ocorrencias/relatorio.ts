import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/fotos/compress'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { offenderRoleLabel } from '@/lib/ocorrencias/form'
import {
  getContractorNameForTerritorialArea,
  getMunicipalityName,
  getTerritorialAreaName,
} from '@/lib/ocorrencias/data'

/**
 * Data layer for the per-incident PDF report
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

/** Longest edge, in pixels, of the photos embedded in the PDF. */
const REPORT_PHOTO_MAX_EDGE = 1000
const REPORT_PHOTO_QUALITY = 0.78
const REPORT_PHOTO_MAX_MB = 0.6

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
  agentBadge: string | null
  photos: ReportPhoto[]
  offenders: ReportOffender[]
  generatedAt: string
  generatedBy: string | null
  /** Optional brand mark (`data:` URI) — `null` falls back to the vector mark. */
  logoSrc: string | null
}

export class ReportForbiddenError extends Error {
  constructor() {
    super('Apenas administradores podem exportar o relatório.')
    this.name = 'ReportForbiddenError'
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
async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const original = await response.blob()
    const compressed = await compressImage(original, {
      maxWidth: REPORT_PHOTO_MAX_EDGE,
      maxHeight: REPORT_PHOTO_MAX_EDGE,
      quality: REPORT_PHOTO_QUALITY,
      maxSizeMB: REPORT_PHOTO_MAX_MB,
    })
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
export async function loadIncidentReport(incidentId: string): Promise<IncidentReport> {
  const supabase = untyped()

  // Defence in depth: the button is admin-only, but the generator re-checks.
  const { data: authData } = await supabase.auth.getUser()
  const authUserId = authData.user?.id
  if (!authUserId) throw new ReportForbiddenError()

  const { data: me } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', authUserId)
    .maybeSingle()
  const requester = me as { full_name: string | null; role: string | null } | null
  if (requester?.role !== 'administrator') throw new ReportForbiddenError()

  const { data: incidentRow, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', incidentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const incident = incidentRow as Record<string, unknown> | null
  if (!incident) throw new Error('Ocorrência não encontrada.')

  const municipalityId = clean(incident.municipality_id)
  const territorialAreaId = clean(incident.territorial_area_id)
  const createdBy = clean(incident.created_by)

  const [agentRes, linkRes, photoRes, municipality, territorialArea, contractor, logoSrc] =
    await Promise.all([
      createdBy
        ? supabase.from('profiles').select('full_name, badge_number').eq('id', createdBy).maybeSingle()
        : Promise.resolve({ data: null }),
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
      municipalityId ? getMunicipalityName(municipalityId).catch(() => null) : null,
      territorialAreaId ? getTerritorialAreaName(territorialAreaId).catch(() => null) : null,
      territorialAreaId
        ? getContractorNameForTerritorialArea(territorialAreaId).catch(() => null)
        : null,
      loadOptionalLogo(),
    ])

  const agent = agentRes.data as { full_name: string | null; badge_number: string | null } | null

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
        const src = url ? await imageToDataUri(url) : null
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
        push('Descrição física', clean(raw.physical_description))

        return {
          id,
          name: clean(raw.full_name) ?? clean(raw.nickname) ?? 'Sem nome',
          nickname: clean(raw.full_name) ? clean(raw.nickname) : null,
          roleLabel: offenderRoleLabel(link.role),
          photoSrc: url ? await imageToDataUri(url) : null,
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
    description: clean(incident.description) ?? '',
    occurredAt: String(incident.occurred_at),
    address,
    municipality,
    territorialArea,
    contractor,
    agentName: agent?.full_name ?? null,
    agentBadge: agent?.badge_number ?? null,
    photos: photos.filter((photo): photo is ReportPhoto => photo !== null),
    offenders,
    generatedAt: new Date().toISOString(),
    generatedBy: requester?.full_name ?? null,
    logoSrc,
  }
}
