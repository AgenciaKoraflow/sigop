-- =============================================
-- SIGOP — 015 Soft delete for user profiles
-- Run in the Supabase SQL Editor AFTER 014_handle_new_user_fix.sql
-- Naming standard: English (snake_case)
--
-- DELETE /api/usuarios/[id] removes a user outright when nothing references
-- the profile. A user who already created incidents / offenders / photos /
-- audit entries cannot be dropped (those rows keep their author), so the
-- handler soft-deletes instead: the login is destroyed in Auth and the profile
-- is stamped with `deleted_at`, which hides it from /usuarios. Idempotent.
-- =============================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
