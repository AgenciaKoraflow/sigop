import { z } from 'zod'
import { CPF_REGEX, maskCpf } from '@/lib/abordagens/form'

/**
 * Shared schema, constants and helpers for the offender ("meliante") registry
 * form (`components/meliantes/FormMeliante.tsx`).
 *
 * Identifiers stay in English to match the Supabase schema (`offenders`);
 * user-facing copy stays in Portuguese.
 */

export { CPF_REGEX, maskCpf }

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
  social_name: optionalText,
  nickname: optionalText,
  cpf: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || CPF_REGEX.test(value), 'CPF no formato 999.999.999-99'),
  rg: optionalText,
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
  gender: optionalText,
  height_m: optionalText,
  weight_kg: optionalText,
  skin_color: optionalText,
  eye_color: optionalText,
  hair_color: optionalText,
  distinguishing_marks: optionalText,
  physical_description: optionalText,
})

export type OffenderFormValues = z.infer<typeof offenderFormSchema>

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
export const emptyOffenderForm = (): OffenderFormValues => ({
  full_name: '',
  social_name: '',
  nickname: '',
  cpf: '',
  rg: '',
  birth_date: '',
  gender: '',
  height_m: '',
  weight_kg: '',
  skin_color: '',
  eye_color: '',
  hair_color: '',
  distinguishing_marks: '',
  physical_description: '',
})

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
    social_name: nullIfEmpty(values.social_name),
    nickname: nullIfEmpty(values.nickname),
    cpf: nullIfEmpty(values.cpf),
    rg: nullIfEmpty(values.rg),
    birth_date: nullIfEmpty(values.birth_date),
    gender: nullIfEmpty(values.gender),
    height_m: toNumberOrNull(values.height_m),
    weight_kg: toNumberOrNull(values.weight_kg),
    skin_color: nullIfEmpty(values.skin_color),
    eye_color: nullIfEmpty(values.eye_color),
    hair_color: nullIfEmpty(values.hair_color),
    distinguishing_marks: nullIfEmpty(values.distinguishing_marks),
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
    social_name: str('social_name'),
    nickname: str('nickname'),
    cpf: str('cpf'),
    rg: str('rg'),
    birth_date: str('birth_date').slice(0, 10),
    gender: str('gender'),
    height_m: str('height_m'),
    weight_kg: str('weight_kg'),
    skin_color: str('skin_color'),
    eye_color: str('eye_color'),
    hair_color: str('hair_color'),
    distinguishing_marks: str('distinguishing_marks'),
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
