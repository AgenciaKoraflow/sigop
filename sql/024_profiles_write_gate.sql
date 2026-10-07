-- =============================================
-- SIGOP — 024 profiles write gate
-- Run in the Supabase SQL Editor AFTER 023_url_xss_hardening.sql
-- Naming standard: English (snake_case)
--
-- 020 left `profiles` out of the account_usable() RESTRICTIVE gate so a user
-- stuck on the provisional password can still READ their own profile
-- (/trocar-senha). `profiles_admin_all` is FOR ALL, though, so an administrator
-- who has not yet changed the provisional password could still WRITE profiles
-- (role, is_active, ...) straight through PostgREST, skipping the first-login
-- gate that every other table and /api/** enforces.
--
-- Reads stay open; writes now require a usable account. The service role
-- (Route Handlers) bypasses RLS and is untouched. Idempotent.
-- =============================================
DO $$
DECLARE
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', 'profiles_account_usable_' || lower(c));
  END LOOP;
END $$;

CREATE POLICY "profiles_account_usable_insert" ON public.profiles
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.account_usable());

CREATE POLICY "profiles_account_usable_update" ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.account_usable())
  WITH CHECK (public.account_usable());

CREATE POLICY "profiles_account_usable_delete" ON public.profiles
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.account_usable());
