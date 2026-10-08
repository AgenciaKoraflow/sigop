-- =============================================
-- SIGOP — 031 Photo uploads go through the server only
-- Run in the Supabase SQL Editor AFTER 030_last_admin_guard.sql
-- Naming standard: English (snake_case)
--
-- Findings:
--   P1  Storage INSERT (025) pinned the object *name* but nothing checked the
--       *bytes*: Storage validates only the declared Content-Type, so
--       `<uid>/incident/<id>/<id>.jpg` could hold HTML/SVG/an executable sent
--       with `Content-Type: image/jpeg`.
--   P2  photos CHECKs from 025 were NOT VALID (never checked existing rows).
--   P3  photos.storage_path was not tied to entity_type / entity_id / id, so a
--       row could point at a valid-looking path of a different entity.
--
-- Fix: browsers can no longer INSERT into the bucket; `POST /api/fotos`
-- validates the real JPEG structure and writes with the service role.
-- Audit before applying: 60/60 rows already satisfied every constraint, so
-- VALIDATE needs no data repair. Idempotent.
-- =============================================

-- P1. No direct browser uploads. (Service role bypasses RLS.)
DROP POLICY IF EXISTS "storage_insert_own_folder" ON storage.objects;

-- P3. Path must be <created_by>/<entity_type>/<entity_id>/<photo id>.jpg
ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_storage_path_binds_row;
ALTER TABLE public.photos
  ADD CONSTRAINT photos_storage_path_binds_row CHECK (
    split_part(storage_path, '/', 1) = created_by::text
    AND split_part(storage_path, '/', 2) = entity_type
    AND split_part(storage_path, '/', 3) = entity_id::text
    AND split_part(storage_path, '/', 4) = id::text || '.jpg'
  ) NOT VALID;

-- P2. Enforce everything on the existing rows too.
ALTER TABLE public.photos VALIDATE CONSTRAINT photos_storage_path_shape;
ALTER TABLE public.photos VALIDATE CONSTRAINT photos_mime_type_allowed;
ALTER TABLE public.photos VALIDATE CONSTRAINT photos_size_bytes_range;
ALTER TABLE public.photos VALIDATE CONSTRAINT photos_public_url_safe;
ALTER TABLE public.photos VALIDATE CONSTRAINT photos_storage_path_binds_row;
