-- =============================================
-- SIGOP — 025 Upload / Storage hardening
-- Run in the Supabase SQL Editor AFTER 024_profiles_write_gate.sql
-- Naming standard: English (snake_case)
--
-- Findings (a signed-in user calling the Storage / PostgREST APIs directly,
-- skipping the app's compress-to-JPEG pipeline):
--   U1  storage INSERT only required "first folder = my uid": any file name,
--       extension or nesting depth (`<uid>/x.html`, `<uid>/../<other>/x.jpg`)
--       could be stored.
--   U2  the bucket accepted png/webp/heic although the app only ever uploads
--       JPEG, widening what a direct upload may contain.
--   U3  photos.storage_path / mime_type / size_bytes were unconstrained, so a
--       row could point at an arbitrary object (path traversal, other
--       user's folder, non-image) that read paths then sign URLs for.
--
-- Idempotent. CHECK constraints are NOT VALID so legacy rows do not block the
-- migration; they are enforced for every new/updated row.
-- =============================================

-- U2. Bucket: JPEG only, 5 MB.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg'],
       file_size_limit    = 5242880,
       public             = false
 WHERE id = 'operational-photos';

-- U1. Uploads must land at exactly
--     <auth.uid()>/<incident|offender>/<entity uuid>/<photo uuid>.jpg
DROP POLICY IF EXISTS "storage_insert_own_folder" ON storage.objects;
CREATE POLICY "storage_insert_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'operational-photos'
    AND auth.uid() IS NOT NULL
    AND name ~ (
      '^' || auth.uid()::text
      || '/(incident|offender)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    )
  );

-- U3. photos rows may only reference a well-formed object in the uploader's own
--     folder, with a JPEG mime type and a sane size.
ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_storage_path_shape;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_storage_path_shape CHECK (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(incident|offender)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  ) NOT VALID;

ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_mime_type_allowed;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_mime_type_allowed CHECK (
    mime_type IS NULL OR mime_type = 'image/jpeg'
  ) NOT VALID;

ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_size_bytes_range;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_size_bytes_range CHECK (
    size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 5242880)
  ) NOT VALID;

-- `public_url` is never rendered (read paths sign storage_path), but keep it
-- from carrying anything other than an https URL.
ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_public_url_safe;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_public_url_safe CHECK (
    public_url IS NULL OR public_url ~* '^https://[^[:space:]]+$'
  ) NOT VALID;
