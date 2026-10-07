import { z } from 'zod'

/**
 * Password rules shared by the browser forms and the Route Handlers
 * (isomorphic — no server-only imports here).
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72 // bcrypt limit used by Supabase Auth

/** Flag in `auth.users.raw_app_meta_data` — only writable with the service role. */
export const MUST_CHANGE_PASSWORD_FLAG = 'must_change_password'

const PROVISIONAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const PROVISIONAL_LENGTH = 14

/**
 * Random provisional password (CSPRNG, no ambiguous characters). Never derived
 * from the date or any other guessable input. Always holds letters and digits so
 * it satisfies the same rules as a permanent password.
 */
export function generateProvisionalPassword(): string {
  const limit = 256 - (256 % PROVISIONAL_ALPHABET.length) // rejection sampling: no modulo bias
  let out = ''
  while (out.length < PROVISIONAL_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]
      if (byte < limit && out.length < PROVISIONAL_LENGTH) {
        out += PROVISIONAL_ALPHABET[byte % PROVISIONAL_ALPHABET.length]
      }
    }
  }
  return /[A-Za-z]/.test(out) && /\d/.test(out) ? out : generateProvisionalPassword()
}

/** True for guessable, project-derived passwords (legacy `sigop@YYYY` and kin). */
export function isProvisionalPassword(password: string): boolean {
  return /sigop/i.test(password.trim())
}

/** Password an admin may assign: min length, letters + digits, nothing guessable. */
export const assignedPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa de ao menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX, `Máximo de ${PASSWORD_MAX} caracteres`)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: 'Use letras e números na senha',
  })
  .refine((value) => !isProvisionalPassword(value), {
    message: 'Senha previsível: não use "sigop" na senha. Gere uma senha aleatória.',
  })

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
