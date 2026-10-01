-- =============================================
-- SIGOP — 014 Repair the "create profile on sign-up" trigger
-- Run in the Supabase SQL Editor AFTER 013_incidents_agent_name.sql
-- Naming standard: English (snake_case)
--
-- Symptom: creating a login (POST /api/usuarios -> auth.admin.createUser) fails
-- with `500 Database error creating new user`. That message means the
-- AFTER INSERT trigger on auth.users raised, rolling back the new user.
--
-- The Auth service inserts as `supabase_auth_admin`, whose search_path does not
-- include `public`. handle_new_user() therefore only works while its
-- search_path is pinned — and CREATE OR REPLACE FUNCTION silently drops a pin
-- that was applied with a separate ALTER FUNCTION (005/006). Re-running
-- 002_triggers_functions.sql is enough to break sign-ups again.
--
-- Fix: schema-qualify the table and declare the search_path inside the
-- CREATE itself, so no later re-run can strip it. Idempotent.
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent'),
    NEW.email
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auth_create_profile ON auth.users;
CREATE TRIGGER tr_auth_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Rows created while the function body lacked `email` (002 version).
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;
