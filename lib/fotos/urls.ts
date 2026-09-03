import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Only the storage surface is used here, and it is identical across every
 * `Database` generic — so accept any Supabase client (typed or untyped).
 */
type StorageCapableClient = Pick<SupabaseClient, 'storage'>

/**
 * Signed-URL helper for operational photos.
 *
 * The `operational-photos` bucket is **private** (RLS: any authenticated user
 * may read). `getPublicUrl` therefore produces links that 400 for everyone, so
 * every read path must exchange the stored `storage_path` for a short-lived
 * signed URL before handing it to an `<img>`.
 *
 * Identifiers stay in English to match the rest of the codebase.
 */

export const PHOTO_BUCKET = 'operational-photos'

/** How long a generated signed URL stays valid, in seconds (1 hour). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Resolve a batch of storage paths to signed URLs in a single request.
 * Returns a `Map` keyed by the original path; paths that fail to sign are
 * simply omitted, so callers should treat a missing entry as "no photo".
 */
export async function signPhotoUrls(
  supabase: StorageCapableClient,
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const unique = Array.from(
    new Set(paths.filter((path): path is string => Boolean(path))),
  )
  if (unique.length === 0) return resolved

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return resolved

  for (const entry of data) {
    if (entry.path && entry.signedUrl) {
      resolved.set(entry.path, entry.signedUrl)
    }
  }
  return resolved
}

/** Single-path convenience wrapper around {@link signPhotoUrls}. */
export async function signPhotoUrl(
  supabase: StorageCapableClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null
  const map = await signPhotoUrls(supabase, [path])
  return map.get(path) ?? null
}
