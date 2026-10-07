import { z } from 'zod'

/**
 * Password rules shared by the browser forms and the Route Handlers
 * (isomorphic — no server-only imports here).
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt limit used by Supabase Auth

/** Flag in `auth.users.raw_app_meta_data` — only writable with the service role. */
export const MUST_CHANGE_PASSWORD_FLAG = 'must_change_password'

/** Provisional password handed to new users: `sigop@<current year>`. */
export function generateProvisionalPassword(date: Date = new Date()): string {
  return `sigop@${date.getFullYear()}`
}

/** True for any `sigop@YYYY` — never accepted as a permanent password. */
export function isProvisionalPassword(password: string): boolean {
  return /^sigop@\d{4}$/i.test(password.trim())
}

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa de ao menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX, `Máximo de ${PASSWORD_MAX} caracteres`)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Use letras e números na senha',
  })
  .refine((value) => !isProvisionalPassword(value), {
    message: 'Escolha uma senha diferente da senha provisória',
  })

export const RESET_CODE_LENGTH = 6

export const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido').max(254)
export const resetCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`), `O código tem ${RESET_CODE_LENGTH} dígitos`)

export const forgotPasswordSchema = z.object({ email: emailSchema })
export const verifyCodeSchema = z.object({ email: emailSchema, code: resetCodeSchema })
export const resetPasswordSchema = z.object({
  email: emailSchema,
  token: z.string().min(20).max(128),
  password: newPasswordSchema,
})
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual').max(PASSWORD_MAX),
  password: newPasswordSchema,
})
