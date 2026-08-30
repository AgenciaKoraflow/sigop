-- =============================================
-- SIGOP — Supabase Storage (photo bucket)
-- Run in the Supabase SQL Editor AFTER 003_rls_policies.sql
-- Naming standard: English (snake_case) — see 003 header note.
--   Portuguese draft -> English:
--     bucket 'fotos-operacionais' -> 'operational-photos'
--     table perfis -> profiles | column papel -> role
--     role 'administrador' -> 'administrator'
--   Reuses the SECURITY DEFINER helper my_role() defined in 003.
-- =============================================

-- =============================================
-- PRIVATE BUCKET FOR OPERATIONAL PHOTOS
-- =============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'operational-photos',
  'operational-photos',
  false,
  5242880,  -- 5 MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- STORAGE POLICIES (storage.objects)
-- Files are expected under a top-level folder named after the uploader's uid:
--   operational-photos/<auth.uid()>/<entity>/<file>
-- =============================================

-- Any authenticated user can upload
CREATE POLICY "storage_insert_authenticated" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'operational-photos'
    AND auth.uid() IS NOT NULL
  );

-- Any authenticated user can read photos
CREATE POLICY "storage_select_authenticated" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'operational-photos'
    AND auth.uid() IS NOT NULL
  );

-- Only the owner (uid folder) or a supervisor / administrator can delete
CREATE POLICY "storage_delete_own_or_supervisor" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'operational-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR my_role() IN ('supervisor', 'administrator')
    )
  );
