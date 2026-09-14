import { createClient } from './client'

/** Sign the current user out. */
export async function signOut(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
}
