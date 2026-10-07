-- =============================================
-- SIGOP — 022 Authorization hardening (RLS / PostgREST / SECURITY DEFINER)
-- Run in the Supabase SQL Editor AFTER 021_function_hardening.sql
-- Naming standard: English (snake_case)
--
-- Findings fixed (threat model: a signed-in user skips the UI and calls
-- PostgREST / RPC directly with their own JWT):
--   A1  incidents UPDATE had no ownership: any user could edit any open incident,
--       move `created_by`, or set `deleted_at` (soft delete) -> BOLA / mass assignment
--   A2  offenders UPDATE had no WITH CHECK / immutable columns: `created_by`,
--       `deleted_at` could be rewritten by any user
--   A3  INSERT accepted privileged columns (internal_number, deleted_at, version)
--   A4  incident_offenders / photos INSERT let anyone attach rows to a colleague's
--       incident; photos.storage_path could point into another user's folder
--   A5  search_offenders() was SECURITY DEFINER and returned full offender rows
--       (CPF, RG, birth date) without the account_usable() gate -> a deactivated
--       user or one stuck on the provisional password could still read PII
--   A6  dashboard_stats() skipped the must_change_password gate
--   A7  SECURITY DEFINER functions had `search_path = public` (no pg_temp last):
--       a temp table named `profiles` could shadow the real one
--   A8  anon / authenticated held every table privilege (incl. TRUNCATE, which
--       is not subject to RLS); anon could EXECUTE the offender RPCs and the
--       trigger functions
--   A9  lookup tables (municipalities, territorial_areas, contractors) missed the
--       account_usable() RESTRICTIVE gate
--
-- Deliberately NOT changed: offenders stay editable by any active user (shared
-- registry, CPF de-duplication reuses existing records); the app has no
-- photo UPDATE / incident_offenders UPDATE policy and still has none.
-- Soft delete stays service-role only (/api/**/DELETE). Idempotent.
-- =============================================

-- ---------------------------------------------
-- A1-A3. Protected columns, enforced in the database.
--   auth.uid() IS NULL  => service role / SQL editor / migrations: untouched.
--   sigop.skip_row_touch is only ever set by sync_incidents_agent_name() (013);
--   set_config() is not reachable through PostgREST.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_incident_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('sigop.skip_row_touch', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.internal_number := NULL;      -- always generated (tr_incidents_internal_number)
    NEW.deleted_at      := NULL;
    NEW.version         := 1;
    NEW.updated_by      := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.created_by      IS DISTINCT FROM OLD.created_by
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
     OR NEW.internal_number IS DISTINCT FROM OLD.internal_number
     OR NEW.agent_name      IS DISTINCT FROM OLD.agent_name
     OR NEW.deleted_at      IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'protected_column'
      USING ERRCODE = '42501',
            HINT = 'id, created_by, created_at, internal_number, agent_name and deleted_at are immutable for API callers';
  END IF;

  IF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    NEW.updated_by := auth.uid();     -- cannot be spoofed
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_offender_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.deleted_at := NULL;
    NEW.version    := 1;
    NEW.updated_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'protected_column'
      USING ERRCODE = '42501',
            HINT = 'id, created_by, created_at and deleted_at are immutable for API callers';
  END IF;

  IF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_incidents_a_guard ON public.incidents;
CREATE TRIGGER tr_incidents_a_guard
  BEFORE INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.guard_incident_write();

DROP TRIGGER IF EXISTS tr_offenders_a_guard ON public.offenders;
CREATE TRIGGER tr_offenders_a_guard
  BEFORE INSERT OR UPDATE ON public.offenders
  FOR EACH ROW EXECUTE FUNCTION public.guard_offender_write();

-- ---------------------------------------------
-- A1. incidents UPDATE: the author, or a supervisor / administrator.
--     Soft delete is service-role only, so the old *_delete_admin policy (an
--     UPDATE policy in disguise) goes away.
-- ---------------------------------------------
DROP POLICY IF EXISTS "incidents_update_agent"      ON public.incidents;
DROP POLICY IF EXISTS "incidents_update_supervisor" ON public.incidents;
DROP POLICY IF EXISTS "incidents_delete_admin"      ON public.incidents;
DROP POLICY IF EXISTS "incidents_update_own_or_supervisor" ON public.incidents;

CREATE POLICY "incidents_update_own_or_supervisor" ON public.incidents
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      my_role() IN ('supervisor', 'administrator')
      OR (created_by = auth.uid() AND status NOT IN ('closed', 'archived'))
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      my_role() IN ('supervisor', 'administrator')
      OR (created_by = auth.uid() AND status NOT IN ('closed', 'archived'))
    )
  );

-- ---------------------------------------------
-- A2. offenders UPDATE: any active user (shared registry) but never into / out
--     of the deleted state; immutable columns are handled by the trigger.
-- ---------------------------------------------
DROP POLICY IF EXISTS "offenders_update" ON public.offenders;
CREATE POLICY "offenders_update" ON public.offenders
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND my_role() IS NOT NULL AND deleted_at IS NULL)
  WITH CHECK (auth.uid() IS NOT NULL AND my_role() IS NOT NULL AND deleted_at IS NULL);

-- ---------------------------------------------
-- A4. incident_offenders / photos: only for incidents the caller may edit.
--     photos may be inserted before the incident row exists (offline queue),
--     so the rule is "no EXISTING incident that the caller cannot edit".
-- ---------------------------------------------
DROP POLICY IF EXISTS "incident_offenders_insert" ON public.incident_offenders;
CREATE POLICY "incident_offenders_insert" ON public.incident_offenders
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (created_by IS NULL OR created_by = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.incidents i
      WHERE i.id = incident_offenders.incident_id
        AND (i.created_by = auth.uid() OR my_role() IN ('supervisor', 'administrator'))
    )
  );

DROP POLICY IF EXISTS "photos_insert" ON public.photos;
CREATE POLICY "photos_insert" ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND storage_path LIKE auth.uid()::text || '/%'
    AND (
      entity_type <> 'incident'
      OR NOT EXISTS (
        SELECT 1 FROM public.incidents i
        WHERE i.id = photos.entity_id
          AND NOT (i.created_by = auth.uid() OR my_role() IN ('supervisor', 'administrator'))
      )
    )
  );

-- ---------------------------------------------
-- A9. Lookup tables join the account_usable() gate (020 left them out).
-- ---------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['municipalities', 'territorial_areas', 'contractors']
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

-- ---------------------------------------------
-- A5. search_offenders(): run as the caller so RLS (incl. the RESTRICTIVE
--     account_usable gate) applies. Same rows for a healthy account.
-- ---------------------------------------------
ALTER FUNCTION public.search_offenders(text) SECURITY INVOKER;

-- ---------------------------------------------
-- A6. dashboard_stats(): also require account_usable(). The body is patched in
--     place (017 is ~300 lines); the DO block fails loudly if 017's guard line
--     is not found.
-- ---------------------------------------------
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.dashboard_stats(uuid, timestamptz, timestamptz)'::regprocedure)
    INTO v_def;

  IF position('account_usable' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      $a$IF COALESCE(public.my_role(), '') NOT IN$a$,
      $b$IF NOT public.account_usable() OR COALESCE(public.my_role(), '') NOT IN$b$
    );
    IF position('account_usable' IN v_def) = 0 THEN
      RAISE EXCEPTION 'dashboard_stats(): role guard line not found, patch aborted';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- ---------------------------------------------
-- A7. search_path: `public, pg_temp` (pg_temp LAST) on every function that has a
--     pinned path without it.
-- ---------------------------------------------
ALTER FUNCTION public.dashboard_stats(uuid, timestamptz, timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION public.bump_password_reset_attempt(uuid)               SET search_path = public, pg_temp;
ALTER FUNCTION public.set_incident_agent_name()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_incidents_agent_name()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.find_offender_by_cpf(text)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.search_offenders_with_stats(text)               SET search_path = public, pg_temp;

-- ---------------------------------------------
-- A8. EXECUTE: signed-in users only for the RPCs; nobody for trigger functions.
-- ---------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_offender_by_cpf(text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_offenders_with_stats(text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.find_offender_by_cpf(text)           TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.search_offenders_with_stats(text)    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.generate_internal_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_version()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_incident_write()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_offender_write()     FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------
-- A8. Table privileges (defence in depth under RLS).
-- ---------------------------------------------
-- anon never touches application tables (sign-in goes through the Auth API).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- TRUNCATE is not subject to RLS; TRIGGER / REFERENCES are never needed.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;
-- Server-only tables.
REVOKE ALL ON public.login_events, public.password_reset_codes FROM authenticated;
-- The audit log is append-only.
REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated;
-- No DELETE policy exists on these; soft delete / admin removal is service-role.
REVOKE DELETE ON public.incidents, public.offenders, public.incident_offenders,
                 public.units, public.municipalities, public.territorial_areas,
                 public.contractors FROM authenticated;

-- Future tables / functions created by migrations must be opted in explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
