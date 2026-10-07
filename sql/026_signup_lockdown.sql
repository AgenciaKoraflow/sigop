-- =============================================
-- SIGOP — 026 Sign-up lockdown (database-level)
-- Run in the Supabase SQL Editor AFTER 025_upload_hardening.sql, and ONLY AFTER
-- the matching app release (POST /api/usuarios issuing provisioning tickets) is
-- deployed — until then the old route would be refused by this gate.
-- Naming standard: English (snake_case)
--
-- Problem: Auth had `disable_signup = false`, and the only thing between an
-- anonymous caller and an ACTIVE `agent` profile was the Dashboard toggle. Any
-- insert into auth.users (public sign-up, magic-link/OTP auto-create, Dashboard
-- "Add user", a future provider) produced a usable profile.
--
-- Fix: auth.users can only receive a row when an administrator first issued a
-- single-use "provisioning ticket" (service role only) for that e-mail. The
-- ticket carries the role, so no user-controlled metadata decides privileges.
-- This holds even if the Dashboard toggle is turned back on by mistake.
-- Idempotent.
-- =============================================

-- Tickets are written by POST /api/usuarios (service role) and read/consumed only
-- by the SECURITY DEFINER triggers below. No policy => no API access at all.
CREATE TABLE IF NOT EXISTS public.user_provisioning_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  BYTEA NOT NULL UNIQUE,
  email       TEXT  NOT NULL,
  role        TEXT  NOT NULL CHECK (role IN ('agent', 'supervisor', 'administrator')),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes',
  consumed_at TIMESTAMPTZ,
  user_id     UUID
);

ALTER TABLE public.user_provisioning_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_provisioning_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_provisioning_tickets TO service_role;

-- ---------------------------------------------
-- BEFORE INSERT on auth.users: no valid ticket => the insert is refused.
-- The token travels in user_metadata only because that is what createUser lets
-- us set at insert time; it is worthless without a matching, unexpired,
-- unconsumed ticket for the same e-mail, and it is stripped from the stored row.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_provisioned_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token  TEXT := NEW.raw_user_meta_data->>'provision_token';
  v_ticket UUID;
BEGIN
  IF v_token IS NOT NULL AND length(v_token) >= 32 THEN
    SELECT id INTO v_ticket
    FROM public.user_provisioning_tickets
    WHERE token_hash = sha256(convert_to(v_token, 'UTF8'))
      AND lower(email) = lower(COALESCE(NEW.email, ''))
      AND consumed_at IS NULL
      AND expires_at > now()
    FOR UPDATE;
  END IF;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'sign-up is disabled: users are created by an administrator only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_provisioning_tickets
  SET consumed_at = now(), user_id = NEW.id
  WHERE id = v_ticket;

  -- Never persist the token, and never persist a self-declared role.
  NEW.raw_user_meta_data := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) - 'provision_token' - 'role';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auth_00_enforce_provisioned_signup ON auth.users;
CREATE TRIGGER tr_auth_00_enforce_provisioned_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_provisioned_signup();

REVOKE ALL ON FUNCTION public.enforce_provisioned_signup() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------
-- AFTER INSERT: the profile role comes from the consumed ticket (trusted,
-- server-written) — not from user_metadata and not from app_metadata. A user
-- without a consumed ticket gets no profile at all (the BEFORE trigger already
-- refuses the insert; this is the second lock).
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.user_provisioning_tickets
  WHERE user_id = NEW.id AND consumed_at IS NOT NULL;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'no provisioning ticket for this user' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Housekeeping for the service role (called opportunistically by the route).
CREATE OR REPLACE FUNCTION public.purge_provisioning_tickets()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.user_provisioning_tickets WHERE created_at < now() - interval '1 day';
$$;
REVOKE ALL ON FUNCTION public.purge_provisioning_tickets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_provisioning_tickets() TO service_role;

-- ALSO (Dashboard, not SQL): Authentication > Sign In / Providers > turn OFF
-- "Allow new users to sign up" (disable_signup = true) and keep anonymous
-- sign-ins OFF. Defence in depth: this migration no longer depends on it.
