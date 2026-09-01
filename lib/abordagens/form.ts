import { z } from 'zod'
import type { StopType, StopOutcome } from '@/types/app.types'
import { toDatetimeLocal } from '@/lib/ocorrencias/form'

/**
 * Shared schema, constants and helpers for the field-stop ("abordagem") form
 * (`components/abordagens/FormAbordagem.tsx`).
 *
 * Identifiers stay in English to match the Supabase schema (`stops`,
 * `stop_offenders`, `offenders`); user-facing copy stays in Portuguese.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const STOP_DESCRIPTION_MIN = 20
export const STOP_DESCRIPTION_MAX = 2000
export const MAX_PHOTOS_PER_STOP = 10
export const AUTOSAVE_DELAY_MS = 30_000
/** Stops may be logged up to 24h ahead (clock skew / late entries). */
export const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** CPF display mask, e.g. `123.456.789-00`. */
export const CPF_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/

export const STOP_TYPE_OPTIONS: {
  value: StopType
  label: string
  emoji: string
  hint: string
}[] = [
  {
    value: 'stop',
    label: 'Abordagem simples',
    emoji: '🤝',
    hint: 'Abordagem de rotina. Identificar o abordado é opcional.',
  },
  {
    value: 'in_flagrante',
    label: 'Flagrante',
    emoji: '⚠️',
    hint: 'Prisão em flagrante. Identificação completa do conduzido é obrigatória.',
  },
]

export const STOP_OUTCOME_OPTIONS: { value: StopOutcome; label: string }[] = [
  { value: 'released', label: 'Liberado' },
  { value: 'detained', label: 'Detido' },
  { value: 'referred_to_police_station', label: 'Encaminhado à DP' },
  { value: 'items_seized', label: 'Apreensão de objetos' },
  { value: 'other', label: 'Outros' },
]

export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Feminino' },
  { value: 'other', label: 'Outro' },
  { value: 'undeclared', label: 'Não informado' },
]

export function stopOutcomeLabel(outcome: string | null | undefined): string {
  return STOP_OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? '—'
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------
export function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const optionalText = z.string().trim().optional().or(z.literal(''))

const subjectSchema = z.object({
  full_name: optionalText,
  social_name: optionalText,
  nickname: optionalText,
  cpf: optionalText,
  rg: optionalText,
  birth_date: optionalText,
  gender: optionalText,
  height_m: optionalText,
  weight_kg: optionalText,
  physical_description: optionalText,
  distinguishing_marks: optionalText,
  notes: optionalText,
})

export const stopFormSchema = z
  .object({
    type: z.enum(['stop', 'in_flagrante'], {
      required_error: 'Selecione o tipo de abordagem',
    }),
    /** `datetime-local` string, e.g. `2026-09-01T14:30`. */
    stopped_at: z.string().min(1, 'Informe a data e hora da abordagem'),
    outcome: z.enum([
      'released',
      'detained',
      'referred_to_police_station',
      'items_seized',
      'other',
    ]),
    description: z
      .string()
      .trim()
      .min(
        STOP_DESCRIPTION_MIN,
        `A descrição deve ter no mínimo ${STOP_DESCRIPTION_MIN} caracteres`,
      )
      .max(
        STOP_DESCRIPTION_MAX,
        `A descrição deve ter no máximo ${STOP_DESCRIPTION_MAX} caracteres`,
      ),
    notes: optionalText,
    address_zip: optionalText,
    address_street: optionalText,
    address_number: optionalText,
    address_district: optionalText,
    address_city: optionalText,
    address_state: optionalText,
    gmaps_link: optionalText,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    link_incident: z.boolean(),
    incident_id: z.string().nullable(),
    incident_number: optionalText,
    /** Set when the flagrante is linked to an offender that already exists. */
    subject_existing_id: z.string().nullable(),
    subject_existing_label: optionalText,
    subject: subjectSchema,
  })
  .refine(
    (data) => {
      const when = new Date(data.stopped_at).getTime()
      if (Number.isNaN(when)) return false
      return when <= Date.now() + FUTURE_TOLERANCE_MS
    },
    { path: ['stopped_at'], message: 'A data não pode estar mais de 24h no futuro' },
  )
  .superRefine((data, ctx) => {
    if (data.type !== 'in_flagrante') return
    // When an existing offender is linked, the manual identity fields are moot.
    if (data.subject_existing_id) return

    if (!data.subject.full_name || data.subject.full_name.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject', 'full_name'],
        message: 'Nome completo é obrigatório no flagrante',
      })
    }
    if (!data.subject.cpf || !CPF_REGEX.test(data.subject.cpf.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject', 'cpf'],
        message: 'CPF obrigatório no formato 999.999.999-99',
      })
    }
    if (!data.subject.rg || data.subject.rg.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject', 'rg'],
        message: 'RG é obrigatório no flagrante',
      })
    }
  })

export type StopFormValues = z.infer<typeof stopFormSchema>
export type SubjectValues = StopFormValues['subject']

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
export const emptySubject = (): SubjectValues => ({
  full_name: '',
  social_name: '',
  nickname: '',
  cpf: '',
  rg: '',
  birth_date: '',
  gender: '',
  height_m: '',
  weight_kg: '',
  physical_description: '',
  distinguishing_marks: '',
  notes: '',
})

export const emptyStopForm = (): StopFormValues => ({
  type: 'stop',
  stopped_at: toDatetimeLocal(new Date()),
  outcome: 'released',
  description: '',
  notes: '',
  address_zip: '',
  address_street: '',
  address_number: '',
  address_district: '',
  address_city: '',
  address_state: '',
  gmaps_link: '',
  latitude: null,
  longitude: null,
  link_incident: false,
  incident_id: null,
  incident_number: '',
  subject_existing_id: null,
  subject_existing_label: '',
  subject: emptySubject(),
})

/** `true` when the user typed anything at all into the subject block. */
export function hasSubjectData(subject: SubjectValues): boolean {
  return Object.values(subject).some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
}

// ---------------------------------------------------------------------------
// Form <-> payload mapping
// ---------------------------------------------------------------------------
const nullIfEmpty = (value: string | undefined | null) => {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

const toNumberOrNull = (value: string | undefined | null) => {
  const trimmed = (value ?? '').trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Row payload for the `stops` table (IndexedDB draft + sync queue). */
export function toStopPayload(
  id: string,
  values: StopFormValues,
  createdBy: string | null,
): Record<string, unknown> {
  return {
    id,
    type: values.type,
    description: values.description.trim(),
    stopped_at: new Date(values.stopped_at).toISOString(),
    outcome: values.outcome,
    notes: nullIfEmpty(values.notes),
    address_street: nullIfEmpty(values.address_street),
    address_district: nullIfEmpty(values.address_district),
    address_city: nullIfEmpty(values.address_city),
    latitude: values.latitude,
    longitude: values.longitude,
    incident_id: values.link_incident ? values.incident_id ?? null : null,
    ...(createdBy ? { created_by: createdBy } : {}),
  }
}

/** Row payload for the `offenders` table (only for a brand-new subject). */
export function toOffenderPayload(
  id: string,
  subject: SubjectValues,
  createdBy: string | null,
): Record<string, unknown> {
  const marks = [subject.distinguishing_marks, subject.notes]
    .map((value) => (value ?? '').trim())
    .filter(Boolean)
    .join(' · ')

  return {
    id,
    full_name: nullIfEmpty(subject.full_name),
    social_name: nullIfEmpty(subject.social_name),
    nickname: nullIfEmpty(subject.nickname),
    cpf: nullIfEmpty(subject.cpf),
    rg: nullIfEmpty(subject.rg),
    birth_date: nullIfEmpty(subject.birth_date),
    gender: nullIfEmpty(subject.gender),
    height_m: toNumberOrNull(subject.height_m),
    weight_kg: toNumberOrNull(subject.weight_kg),
    physical_description: nullIfEmpty(subject.physical_description),
    distinguishing_marks: marks || null,
    ...(createdBy ? { created_by: createdBy } : {}),
  }
}

/** Rehydrate the stop-level fields from a row payload (draft or server row). */
export function fromStopPayload(payload: Record<string, unknown>): StopFormValues {
  const str = (key: string) =>
    typeof payload[key] === 'string' ? (payload[key] as string) : ''
  const num = (key: string) =>
    payload[key] === null || payload[key] === undefined ? null : Number(payload[key])

  const stoppedRaw = payload.stopped_at
  const incidentId = typeof payload.incident_id === 'string' ? payload.incident_id : null

  return {
    ...emptyStopForm(),
    type: (payload.type as StopType) ?? 'stop',
    stopped_at:
      typeof stoppedRaw === 'string' && stoppedRaw
        ? toDatetimeLocal(new Date(stoppedRaw))
        : toDatetimeLocal(new Date()),
    outcome: (payload.outcome as StopOutcome) ?? 'released',
    description: str('description'),
    notes: str('notes'),
    address_street: str('address_street'),
    address_district: str('address_district'),
    address_city: str('address_city'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    link_incident: Boolean(incidentId),
    incident_id: incidentId,
  }
}

// ---------------------------------------------------------------------------
// Companion data kept out of the `stops` payload, persisted separately
// ---------------------------------------------------------------------------
export interface StopFormExtras {
  /** Stable id generated for a would-be new offender. */
  subjectId: string
  subject: SubjectValues
  subjectExistingId: string | null
  subjectExistingLabel: string
  /** Link row id for `stop_offenders`. */
  linkId: string
  incidentNumber: string
  /** Compressed JPEG blob of the subject's photo, if captured. */
  subjectPhoto?: Blob | null
}

export const stopExtrasSettingKey = (stopId: string) => `stop:extras:${stopId}`
