import { z } from 'zod'

/**
 * Shared schema, constants and helpers for the offender ("meliante") registry
 * form (`components/meliantes/FormMeliante.tsx`).
 *
 * Identifiers stay in English to match the Supabase schema (`offenders`);
 * user-facing copy stays in Portuguese.
 */

export const CPF_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/

export function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const OFFENDER_NAME_MIN = 3
export const MAX_PHOTOS_PER_OFFENDER = 10
export const AUTOSAVE_DELAY_MS = 30_000

export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Feminino' },
  { value: 'non_binary', label: 'Não binário' },
  { value: 'undeclared', label: 'Não informado' },
]

export const SKIN_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: 'white', label: 'Branca' },
  { value: 'black', label: 'Preta' },
  { value: 'brown', label: 'Parda' },
  { value: 'yellow', label: 'Amarela' },
  { value: 'indigenous', label: 'Indígena' },
  { value: 'undeclared', label: 'Não informado' },
]

export const EYE_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: 'brown', label: 'Castanhos' },
  { value: 'black', label: 'Pretos' },
  { value: 'blue', label: 'Azuis' },
  { value: 'green', label: 'Verdes' },
  { value: 'honey', label: 'Mel' },
  { value: 'gray', label: 'Cinzas' },
  { value: 'other', label: 'Outros' },
]

export const HAIR_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: 'black', label: 'Preto' },
  { value: 'brown', label: 'Castanho' },
  { value: 'blond', label: 'Loiro' },
  { value: 'red', label: 'Ruivo' },
  { value: 'gray', label: 'Grisalho' },
  { value: 'white', label: 'Branco' },
  { value: 'dyed', label: 'Tingido' },
  { value: 'shaved', label: 'Careca / raspado' },
  { value: 'other', label: 'Outros' },
]

const LABEL_MAPS: Record<string, { value: string; label: string }[]> = {
  gender: GENDER_OPTIONS,
  skin_color: SKIN_COLOR_OPTIONS,
  eye_color: EYE_COLOR_OPTIONS,
  hair_color: HAIR_COLOR_OPTIONS,
}

/** Portuguese label for a stored physical-characteristic value. */
export function characteristicLabel(
  field: 'gender' | 'skin_color' | 'eye_color' | 'hair_color',
  value: string | null | undefined,
): string {
  if (!value) return '—'
  return LABEL_MAPS[field].find((option) => option.value === value)?.label ?? value
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const optionalText = z.string().trim().optional().or(z.literal(''))

export const offenderFormSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(OFFENDER_NAME_MIN, `Informe o nome completo (mínimo ${OFFENDER_NAME_MIN} caracteres)`)
    .max(180, 'Máximo de 180 caracteres'),
  nickname: optionalText,
  cpf: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || CPF_REGEX.test(value), 'CPF no formato 999.999.999-99'),
  /** `<input type="date">` string, e.g. `1990-05-21`. */
  birth_date: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => {
      if (!value) return true
      const when = new Date(`${value}T00:00:00`).getTime()
      if (Number.isNaN(when)) return false
      return when <= Date.now()
    }, 'A data de nascimento não pode estar no futuro'),
  /** Free text shown as "Informações gerais" (description, prior charges, etc.). */
  physical_description: optionalText,
})

export type OffenderFormValues = z.infer<typeof offenderFormSchema>

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
export const emptyOffenderForm = (): OffenderFormValues => ({
  full_name: '',
  nickname: '',
  cpf: '',
  birth_date: '',
  physical_description: '',
})

// ---------------------------------------------------------------------------
// Form <-> payload mapping
// ---------------------------------------------------------------------------
const nullIfEmpty = (value: string | undefined | null) => {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Row payload for the `offenders` table (sync queue). */
export function toOffenderPayload(
  id: string,
  values: OffenderFormValues,
  userId: string | null,
  operation: 'create' | 'update',
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id,
    full_name: nullIfEmpty(values.full_name),
    nickname: nullIfEmpty(values.nickname),
    cpf: nullIfEmpty(values.cpf),
    birth_date: nullIfEmpty(values.birth_date),
    physical_description: nullIfEmpty(values.physical_description),
  }

  if (operation === 'create') {
    if (userId) base.created_by = userId
  } else if (userId) {
    base.updated_by = userId
  }

  return base
}

/** Rehydrate the form from a row payload (server row or queued draft). */
export function fromOffenderPayload(payload: Record<string, unknown>): OffenderFormValues {
  const str = (key: string) =>
    payload[key] === null || payload[key] === undefined ? '' : String(payload[key])

  return {
    ...emptyOffenderForm(),
    full_name: str('full_name'),
    nickname: str('nickname'),
    cpf: str('cpf'),
    birth_date: str('birth_date').slice(0, 10),
    physical_description: str('physical_description'),
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
/** Best available display name for an offender. */
export function offenderDisplayName(offender: {
  full_name?: string | null
  social_name?: string | null
  nickname?: string | null
}): string {
  return (
    offender.full_name?.trim() ||
    offender.social_name?.trim() ||
    offender.nickname?.trim() ||
    'Sem nome'
  )
}
