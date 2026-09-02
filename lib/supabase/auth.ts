import { createClient } from './client'
import { countPending } from '@/lib/db'

/**
 * Sign the current user out.
 *
 * If there is still unsynced work in IndexedDB (queued entities, errored
 * items or photos waiting to upload) the sign-out is held back and
 * `hasPendingItems` is returned so the caller can warn the user before they
 * lose that data. When nothing is pending the Supabase session is cleared
 * immediately.
 */
export async function signOut(): Promise<{ hasPendingItems: boolean }> {
  const pending = await countPending()
  const hasPendingItems =
    pending.total > 0 || pending.errors > 0 || pending.photos > 0

  if (!hasPendingItems) {
    const supabase = createClient()
    await supabase.auth.signOut()
  }

  return { hasPendingItems }
}

/** Clear the Supabase session unconditionally (used by "sign out anyway"). */
export async function forceSignOut(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
}
