import { z } from 'zod'
import type { IncidentType, IncidentStatus } from '@/types/app.types'

/**
 * Shared schema, constants and helpers for the incident form
 * (`components/ocorrencias/FormOcorrencia.tsx`).
 *
 * Identifiers stay in English to match the Supabase schema; user-facing copy
 * stays in Portuguese.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const INCIDENT_DESCRIPTION_MIN = 20
export const INCIDENT_DESCRIPTION_MAX = 2000
export const MAX_PHOTOS_PER_INCIDENT = 10
export const AUTOSAVE_DELAY_MS = 30_000
/** Occurrences may be logged up to 24h ahead (clock skew / scheduled entries). */
export const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** Incident type options, each with the emoji requested by the spec. */
export const INCIDENT_TYPE_OPTIONS: {
  value: IncidentType
  label: string
  emoji: string
}[] = [
  { value: 'theft', label: 'Furto', emoji: '🔒' },
  { value: 'robbery', label: 'Roubo', emoji: '💸' },
  { value: 'vandalism', label: 'Vandalismo', emoji: '🔨' },
  { value: 'in_flagrante', label: 'Flagrante', emoji: '⚠️' },
  { value: 'suspicious', label: 'Suspeito', emoji: '👁️' },
  { value: 'other', label: 'Outros', emoji: '📋' },
]

export const INCIDENT_STATUS_OPTIONS: { value: IncidentStatus; label: string }[] = [
  { value: 'open', label: 'Aberta' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'closed', label: 'Encerrada' },
  { value: 'archived', label: 'Arquivada' },
]

/** `incident_offenders.role` — check constraint values + Portuguese labels. */
export type OffenderRole = 'suspect' | 'perpetrator' | 'victim' | 'witness'

export const OFFENDER_ROLE_OPTIONS: { value: OffenderRole; label: string }[] = [
  { value: 'suspect', label: 'Suspeito' },
  { value: 'perpetrator', label: 'Autor' },
  { value: 'victim', label: 'Vítima' },
  { value: 'witness', label: 'Testemunha' },
]

export function offenderRoleLabel(role: string | null | undefined): string {
  return OFFENDER_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? 'Sem papel'
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const optionalText = z.string().trim().optional().or(z.literal(''))

export const incidentFormSchema = z
  .object({
    type: z.enum(
      ['theft', 'robbery', 'vandalism', 'in_flagrante', 'suspicious', 'other'],
      { required_error: 'Selecione o tipo de ocorrência' },
    ),
    subtype: z.string().trim().max(120, 'Máximo de 120 caracteres').optional().or(z.literal('')),
    /** `datetime-local` string, e.g. `2026-09-01T14:30`. */
    occurred_at: z.string().min(1, 'Informe a data e hora da ocorrência'),
    status: z.enum(['open', 'in_progress', 'closed', 'archived']),
    description: z
      .string()
      .trim()
      .min(INCIDENT_DESCRIPTION_MIN, `A descrição deve ter no mínimo ${INCIDENT_DESCRIPTION_MIN} caracteres`)
      .max(INCIDENT_DESCRIPTION_MAX, `A descrição deve ter no máximo ${INCIDENT_DESCRIPTION_MAX} caracteres`),
    address_zip: optionalText,
    address_street: optionalText,
    address_number: optionalText,
    address_district: optionalText,
    address_city: optionalText,
    address_state: optionalText,
    gmaps_link: optionalText,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  })
  .refine(
    (data) => {
      const when = new Date(data.occurred_at).getTime()
      if (Number.isNaN(when)) return false
      return when <= Date.now() + FUTURE_TOLERANCE_MS
    },
    { path: ['occurred_at'], message: 'A data não pode estar mais de 24h no futuro' },
  )
  .refine((data) => hasLocation(data), {
    path: ['address_street'],
    message: 'Preencha ao menos um endereço ou as coordenadas de GPS',
  })

export type IncidentFormValues = z.infer<typeof incidentFormSchema>

export function hasLocation(data: {
  latitude: number | null
  longitude: number | null
  address_street?: string
  address_district?: string
  address_city?: string
}): boolean {
  const hasCoords = data.latitude != null && data.longitude != null
  const hasAddress = Boolean(
    (data.address_street && data.address_street.trim()) ||
      (data.address_district && data.address_district.trim()) ||
      (data.address_city && data.address_city.trim()),
  )
  return hasCoords || hasAddress
}

// ---------------------------------------------------------------------------
// Linked offenders (kept out of the incident payload, synced separately)
// ---------------------------------------------------------------------------
export interface LinkedOffender {
  /** `incident_offenders` row id (generated on the client). */
  linkId: string
  offenderId: string
  role: OffenderRole | null
  fullName: string | null
  nickname: string | null
  photoUrl: string | null
  /** `true` when the offender itself was created locally and still needs sync. */
  isNew: boolean
  /** Minimal offender payload, present only when `isNew`. */
  draft?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Form <-> payload mapping
// ---------------------------------------------------------------------------
export const emptyIncidentForm = (): IncidentFormValues => ({
  type: 'theft',
  subtype: '',
  occurred_at: toDatetimeLocal(new Date()),
  status: 'open',
  description: '',
  address_zip: '',
  address_street: '',
  address_number: '',
  address_district: '',
  address_city: '',
  address_state: '',
  gmaps_link: '',
  latitude: null,
  longitude: null,
})

const nullIfEmpty = (value: string | undefined | null) => {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Build the row payload persisted to IndexedDB and pushed through the sync queue. */
export function toIncidentPayload(
  id: string,
  values: IncidentFormValues,
  createdBy: string | null,
): Record<string, unknown> {
  return {
    id,
    type: values.type,
    subtype: nullIfEmpty(values.subtype),
    description: values.description.trim(),
    status: values.status,
    occurred_at: new Date(values.occurred_at).toISOString(),
    address_street: nullIfEmpty(values.address_street),
    address_number: nullIfEmpty(values.address_number),
    address_district: nullIfEmpty(values.address_district),
    address_city: nullIfEmpty(values.address_city),
    address_state: nullIfEmpty(values.address_state),
    address_zip: nullIfEmpty(values.address_zip),
    latitude: values.latitude,
    longitude: values.longitude,
    gmaps_link: nullIfEmpty(values.gmaps_link),
    ...(createdBy ? { created_by: createdBy } : {}),
  }
}

/** Rehydrate the form from a row payload (local draft or server row). */
export function fromIncidentPayload(payload: Record<string, unknown>): IncidentFormValues {
  const str = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : '')
  const num = (key: string) =>
    payload[key] === null || payload[key] === undefined ? null : Number(payload[key])

  const occurredRaw = payload.occurred_at
  return {
    type: (payload.type as IncidentFormValues['type']) ?? 'theft',
    subtype: str('subtype'),
    occurred_at:
      typeof occurredRaw === 'string' && occurredRaw
        ? toDatetimeLocal(new Date(occurredRaw))
        : toDatetimeLocal(new Date()),
    status: (payload.status as IncidentFormValues['status']) ?? 'open',
    description: str('description'),
    address_zip: str('address_zip'),
    address_street: str('address_street'),
    address_number: str('address_number'),
    address_district: str('address_district'),
    address_city: str('address_city'),
    address_state: str('address_state'),
    gmaps_link: str('gmaps_link'),
    latitude: num('latitude'),
    longitude: num('longitude'),
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// ---------------------------------------------------------------------------
// CEP mask + ViaCEP lookup
// ---------------------------------------------------------------------------
export function maskCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export interface ViaCepAddress {
  address_street: string
  address_district: string
  address_city: string
  address_state: string
}

export async function fetchViaCep(rawCep: string): Promise<ViaCepAddress> {
  const cep = rawCep.replace(/\D/g, '')
  if (cep.length !== 8) throw new Error('Informe um CEP com 8 dígitos')

  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
  if (!response.ok) throw new Error('Não foi possível consultar o CEP agora')

  const data = (await response.json()) as {
    erro?: boolean
    logradouro?: string
    bairro?: string
    localidade?: string
    uf?: string
  }
  if (data.erro) throw new Error('CEP não encontrado')

  return {
    address_street: data.logradouro ?? '',
    address_district: data.bairro ?? '',
    address_city: data.localidade ?? '',
    address_state: data.uf ?? '',
  }
}

// ---------------------------------------------------------------------------
// Google Maps URL -> coordinates
// ---------------------------------------------------------------------------
const GMAPS_COORD_PATTERNS: RegExp[] = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&](?:q|query|ll|sll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
  /\/(-?\d+\.\d+),(-?\d+\.\d+)/,
  /(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/,
]

export function parseGoogleMapsUrl(input: string): { lat: number; lng: number } | null {
  const text = input.trim()
  if (!text) return null

  for (const pattern of GMAPS_COORD_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const lat = Number(match[1])
    const lng = Number(match[2])
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng }
    }
  }
  return null
}

export function formatCoord(value: number | null): string {
  return value == null ? '—' : value.toFixed(6)
}

// ---------------------------------------------------------------------------
// IndexedDB keys for the separately-stored offender links
// ---------------------------------------------------------------------------
export const offendersSettingKey = (incidentId: string) => `incident:offenders:${incidentId}`
