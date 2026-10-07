-- =============================================
-- SIGOP — 020 Auth hardening
-- Run in the Supabase SQL Editor AFTER 019_password_reset.sql
-- Naming standard: English (snake_case)
--
-- Fixes raised by the auth/authz audit:
--   C1  public sign-up could self-assign `administrator` through
--       raw_user_meta_data.role  -> trigger now ignores user-controlled metadata
--   A1  deactivated / deleted users kept their privileges until the JWT expired
--       -> my_role()/my_unit() return NULL for them; session revocation helper
--   A3  must_change_password was only enforced in the frontend
--       -> RESTRICTIVE policies block data access until the password is changed
--   M6  audit_log accepted rows attributed to anyone
--
-- ALSO (Dashboard, not SQL): Authentication > Providers > Email > turn OFF
-- "Allow new users to sign up". Idempotent.
-- =============================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------------------------------------------
-- C1. Profile trigger: role is never taken from user_metadata.
--     Accounts are created by POST /api/usuarios, which sets the real role with
--     the service role right after createUser. Anything else becomes 'agent'.
--     raw_app_meta_data is only writable with the service role, so it is the one
--     trusted source for an initial role.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := COALESCE(NEW.raw_app_meta_data->>'role', 'agent');
BEGIN
  IF v_role NOT IN ('agent', 'supervisor', 'administrator') THEN
    v_role := 'agent';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(left(NEW.raw_user_meta_data->>'full_name', 180), ''), NEW.email),
    v_role,
    NEW.email
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auth_create_profile ON auth.users;
CREATE TRIGGER tr_auth_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Nobody can reach the trigger function through the API.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------
-- A1. Inactive / soft-deleted users have no role and no unit, so every policy
--     built on my_role()/my_unit() stops matching immediately.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid()
    AND COALESCE(is_active, TRUE)
    AND deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.my_unit()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT unit_id FROM public.profiles
  WHERE id = auth.uid()
    AND COALESCE(is_active, TRUE)
    AND deleted_at IS NULL
$$;

-- TRUE when the caller's account is usable: active, not deleted, and not stuck
-- on the provisional password (the flag lives in app_metadata, which the user
-- cannot edit).
CREATE OR REPLACE FUNCTION public.account_usable()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'must_change_password')::boolean, FALSE) = FALSE
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND COALESCE(is_active, TRUE)
        AND deleted_at IS NULL
    )
$$;

REVOKE ALL ON FUNCTION public.account_usable() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_usable() TO authenticated, service_role;

-- RESTRICTIVE policies are ANDed with the existing permissive ones, for every
-- command. profiles is deliberately left out: the app must still read the
-- caller's own profile to render /trocar-senha.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'units', 'incidents', 'offenders', 'stops', 'incident_offenders',
    'stop_offenders', 'photos', 'audit_log'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_account_usable', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (public.account_usable()) WITH CHECK (public.account_usable())',
        t || '_account_usable', t
      );
    END IF;
  END LOOP;
END $$;

-- Same gate for the photo bucket.
DROP POLICY IF EXISTS "storage_account_usable" ON storage.objects;
CREATE POLICY "storage_account_usable" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'operational-photos' OR public.account_usable())
  WITH CHECK (bucket_id <> 'operational-photos' OR public.account_usable());

-- ---------------------------------------------
-- A1. Session revocation: deleting auth.sessions cascades to refresh_tokens, so
--     the user cannot mint new access tokens (and getUser() rejects the old
--     token's session). Server-only: called with the service role.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  DELETE FROM auth.sessions WHERE user_id = p_user;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(UUID) TO service_role;

-- ---------------------------------------------
-- M6. audit_log: a caller can only write entries attributed to themselves.
-- ---------------------------------------------
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND performed_by = auth.uid()
    AND entity_type <> 'user_password'
  );
