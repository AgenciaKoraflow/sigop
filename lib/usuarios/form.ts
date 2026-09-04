import { z } from 'zod'
import type { UserRole } from '@/types/app.types'

/**
 * Shared schema, constants and helpers for the user-management form
 * (`components/usuarios/FormUsuario.tsx`).
 *
 * Identifiers stay in English to match the Supabase schema (`profiles`);
 * user-facing copy stays in Portuguese.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const USER_NAME_MIN = 3
export const USER_PASSWORD_MIN = 8

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'agent', label: 'Agente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'administrator', label: 'Administrador' },
]

export const USER_STATUS_OPTIONS: { value: 'active' | 'inactive'; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
]

/** Portuguese label for a stored role value. */
export function roleOptionLabel(role: string | null | undefined): string {
  if (!role) return '—'
  return USER_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
// Accepts a real string, `''`, `undefined`, or `null` — the API layer sends
// `null` for cleared fields (see `lib/usuarios/data.ts`), so the schema has to
// tolerate that too, not just the RHF-side `''`/`undefined`.
const optionalText = z.string().trim().optional().nullable().or(z.literal(''))
const roleEnum = z.enum(['agent', 'supervisor', 'administrator'], {
  errorMap: () => ({ message: 'Selecione um papel válido' }),
})

/** New user — needs login credentials. */
export const userCreateSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(USER_NAME_MIN, `Informe o nome completo (mínimo ${USER_NAME_MIN} caracteres)`)
    .max(180, 'Máximo de 180 caracteres'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z
    .string()
    .min(USER_PASSWORD_MIN, `A senha provisória precisa de ao menos ${USER_PASSWORD_MIN} caracteres`)
    .max(72, 'Máximo de 72 caracteres'),
  role: roleEnum,
  badge_number: optionalText,
  unit_id: optionalText,
})

/** Existing user — profile fields only, no credentials. */
export const userEditSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(USER_NAME_MIN, `Informe o nome completo (mínimo ${USER_NAME_MIN} caracteres)`)
    .max(180, 'Máximo de 180 caracteres'),
  role: roleEnum,
  badge_number: optionalText,
  unit_id: optionalText,
  is_active: z.boolean(),
})

export type UserCreateValues = z.infer<typeof userCreateSchema>
export type UserEditValues = z.infer<typeof userEditSchema>

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
export const emptyUserCreateForm = (): UserCreateValues => ({
  full_name: '',
  email: '',
  password: '',
  role: 'agent',
  badge_number: '',
  unit_id: '',
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Readable provisional password: two blocks + digits, no ambiguous chars. */
export function generateProvisionalPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const pick = (source: string, count: number) => {
    let out = ''
    const values = new Uint32Array(count)
    crypto.getRandomValues(values)
    for (let i = 0; i < count; i += 1) out += source[values[i] % source.length]
    return out
  }
  return `${pick(alphabet, 4)}-${pick(alphabet, 4)}-${pick(digits, 3)}`
}

/** `'' -> null`, trimmed otherwise. */
export function nullIfEmpty(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}
