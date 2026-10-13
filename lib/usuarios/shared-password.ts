import { PASSWORD_MIN } from '@/lib/auth/password'

/**
 * TEMPORARY: one provisional password for every new/reset user, used while
 * there is no e-mail delivery (Resend). Set `SHARED_PROVISIONAL_PASSWORD` in the
 * server environment to turn it on; remove the variable to go back to a random
 * password per user. The value never reaches the browser bundle — the admin
 * receives it from the API response (the browser only learns the mode via `SHARED_PASSWORD_MODE`).
 */
export function getSharedProvisionalPassword(): string | null {
  const value = process.env.SHARED_PROVISIONAL_PASSWORD?.trim()
  if (!value) return null
  if (value.length < PASSWORD_MIN) {
    console.error(`[usuarios] SHARED_PROVISIONAL_PASSWORD ignorada: mínimo de ${PASSWORD_MIN} caracteres.`)
    return null
  }
  return value
}

/** Client-side flag (inlined at build time, carries no secret). */
export const SHARED_PASSWORD_MODE = process.env.NEXT_PUBLIC_SHARED_PASSWORD_MODE === '1'
