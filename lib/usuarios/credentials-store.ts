import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptProvisionalPassword } from '@/lib/auth/credential-vault'

/**
 * Server-side persistence of provisional passwords (sql/033). Everything here is
 * best effort: a missing table/key must never block creating a user or changing
 * a password — the export just shows an empty password for that account.
 */

/** Stores (or replaces) the encrypted provisional password of a user. */
export async function saveProvisionalPassword(
  db: SupabaseClient,
  userId: string,
  password: string,
  createdBy: string,
): Promise<boolean> {
  try {
    const password_enc = await encryptProvisionalPassword(password, userId)
    const { error } = await db
      .from('provisional_credentials')
      .upsert({ user_id: userId, password_enc, created_by: createdBy, created_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[usuarios] could not store provisional password:', (err as Error).message)
    return false
  }
}

/** Drops the stored provisional password (permanent password set, or user gone). */
export async function clearProvisionalPassword(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.from('provisional_credentials').delete().eq('user_id', userId)
  if (error) console.error('[usuarios] could not clear provisional password:', error.message)
}
