-- =============================================
-- SIGOP — Profiles: mirror auth.users.email onto profiles
-- Run in the Supabase SQL Editor AFTER 002_triggers_functions.sql
-- Naming standard: English (snake_case)
--
-- The user-management screen (app/(app)/usuarios) lists users straight from
-- `profiles` via PostgREST, so the e-mail has to live here too (it is stored
-- only on `auth.users`, which the anon client cannot read).
-- =============================================

-- 1. Column ---------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill existing rows --------------------------------------------------
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;

-- 3. Keep the trigger in sync --------------------------------------------------
-- Same body as 002_triggers_functions.sql, now also seeding `email`.
--
-- IMPORTANT: CREATE OR REPLACE FUNCTION drops any `SET` config (proconfig) the
-- old definition had unless it is re-specified here — it does NOT carry over
-- from the previous version. 005_security_hardening.sql pinned this function's
-- search_path to `public, pg_temp` (required: SECURITY DEFINER + a role whose
-- own search_path excludes `public`, e.g. the Auth service's role, otherwise
-- the unqualified `profiles` reference fails with "relation does not exist").
-- Re-apply that pin in the same statement so replacing the body never silently
-- un-hardens it again.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent'),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION handle_new_user() SET search_path = public, pg_temp;

-- Trigger already exists (tr_auth_create_profile); CREATE OR REPLACE above is enough.
