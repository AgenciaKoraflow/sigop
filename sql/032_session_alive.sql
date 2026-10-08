-- =============================================
-- SIGOP — 032 Immediate access-token revocation
-- Run in the Supabase SQL Editor AFTER 031. Idempotent.
-- Naming standard: English (snake_case)
--
-- Problem: access tokens are stateless JWTs. Deleting auth.sessions (logout,
-- password change, deactivation, deletion — see revoke_user_sessions) stops
-- refresh and makes Auth's getUser() fail, but PostgREST/Storage keep accepting
-- the already-issued JWT until it expires (default 1h). A stolen token therefore
-- outlived the revocation.
--
-- Fix: every JWT issued by Auth carries `session_id`. RLS now also requires
-- that session to still exist, so revocation is effective on the next query.
-- A JWT without the claim (hand-built test claims, service-role) is not judged
-- here: real user tokens always have it, and service_role bypasses RLS anyway.
-- =============================================

CREATE OR REPLACE FUNCTION public.session_alive()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, auth, pg_temp
AS $$
  SELECT CASE
    WHEN NULLIF(auth.jwt() ->> 'session_id', '') IS NULL THEN TRUE
    ELSE EXISTS (
      SELECT 1 FROM auth.sessions
      WHERE id = (auth.jwt() ->> 'session_id')::uuid
        AND (not_after IS NULL OR not_after > now())
    )
  END
$$;

REVOKE ALL ON FUNCTION public.session_alive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_alive() TO authenticated, service_role;

-- Role / unit: a revoked session has no role, so every policy built on them
-- stops matching (including the profiles policies that account_usable skips).
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid()
    AND COALESCE(is_active, TRUE)
    AND deleted_at IS NULL
    AND public.session_alive()
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
    AND public.session_alive()
$$;

CREATE OR REPLACE FUNCTION public.account_usable()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.session_alive()
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
