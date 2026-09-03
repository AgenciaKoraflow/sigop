-- =============================================
-- SIGOP — 005 Security hardening
-- Run in the Supabase SQL Editor AFTER 004_storage.sql
-- Naming standard: English (snake_case) — see 003 header note.
-- =============================================
-- Raised by the acceptance test run (see TESTES.md, items 13 & 14):
--   * function_search_path_mutable advisor WARNs on every function
--   * storage INSERT policy did not restrict uploads to the caller's own folder
-- =============================================

-- ---------------------------------------------
-- 1. Pin a non-mutable search_path on every function.
--    Critical for the SECURITY DEFINER helpers my_role() / my_unit() that back
--    the RLS policies — a mutable search_path is a privilege-escalation vector.
-- ---------------------------------------------
ALTER FUNCTION public.my_role()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.my_unit()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()          SET search_path = public, pg_temp;
ALTER FUNCTION public.search_offenders(text)     SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_internal_number() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_version()        SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()           SET search_path = public, pg_temp;

-- ---------------------------------------------
-- 2. Tighten photo uploads: an authenticated user may only write into their own
--    uid folder (operational-photos/<auth.uid()>/...), matching the delete
--    policy and what lib/sync/queue.ts actually does.
-- ---------------------------------------------
DROP POLICY IF EXISTS "storage_insert_authenticated" ON storage.objects;

CREATE POLICY "storage_insert_own_folder" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'operational-photos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------
-- 3. Manual dashboard toggles (no SQL / MCP surface):
--    * Authentication > Policies > enable "Leaked password protection"
--      (auth_leaked_password_protection WARN).
--    * Authentication > URL Configuration > set Site URL to the production URL
--      before rollout (currently localhost).
--    * Consider moving the `unaccent` extension out of the public schema
--      (extension_in_public WARN) — low priority.
-- ---------------------------------------------
