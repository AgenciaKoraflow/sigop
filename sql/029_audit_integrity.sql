-- =============================================
-- SIGOP — 029 Audit log integrity
-- Run in the Supabase SQL Editor AFTER 028_auth_rate_limits.sql
-- Naming standard: English (snake_case)
--
-- Finding: any signed-in user could INSERT arbitrary rows into audit_log through
-- PostgREST, choosing entity_type / entity_id / operation (the 020 policy only
-- pinned performed_by). Anyone could fabricate "X deleted incident Y" for
-- themselves, or plant noise to bury real events.
--
-- Model after this migration:
--   * Nobody but the database itself writes the log. `authenticated` / `anon`
--     have SELECT only (supervisor/administrator by policy); no INSERT policy.
--   * Business events (incident / offender create, update, soft delete) are
--     recorded by AFTER triggers from the real OLD/NEW row, so an entry exists
--     iff the change happened, and performed_by comes from auth.uid() (or, for
--     service-role writes, updated_by/created_by set by the server) — never
--     from a client-supplied value.
--   * Server-side events with no table change (password changes) are inserted by
--     Route Handlers with the service role (auth.uid() NULL).
--   * entity_type / operation are constrained by CHECKs; performed_at is always
--     now().
--   * Append-only for EVERYONE: UPDATE / DELETE / TRUNCATE are rejected by
--     triggers, so even service_role cannot rewrite history by accident.
--     (A deliberate retention job must DISABLE the triggers explicitly.)
--
-- Idempotent.
-- =============================================

-- ---------------------------------------------
-- 1. Privileges and policies: no client write path.
-- ---------------------------------------------
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
-- service_role keeps INSERT / SELECT; its UPDATE / DELETE are stopped by triggers below.

-- ---------------------------------------------
-- 2. Closed vocabularies.
-- ---------------------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN ('incident', 'offender', 'user_password'));

-- operation was already constrained in 001 (create, update, delete, sync,
-- conflict_resolved); re-assert it by name so it cannot silently drift.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_operation_check
  CHECK (operation IN ('create', 'update', 'delete', 'sync', 'conflict_resolved'));

-- ---------------------------------------------
-- 3. Row guard on insert + immutability.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.performed_at := NOW();
  -- Defence in depth: a request that carries a user identity can only ever
  -- attribute the row to that identity.
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_log_before_insert ON public.audit_log;
CREATE TRIGGER tr_audit_log_before_insert
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_before_insert();

DROP TRIGGER IF EXISTS tr_audit_log_no_change ON public.audit_log;
CREATE TRIGGER tr_audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

DROP TRIGGER IF EXISTS tr_audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER tr_audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_immutable();

REVOKE EXECUTE ON FUNCTION public.audit_log_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_immutable()     FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------
-- 4. offenders guard: stop writing audit_log from the caller's privileges.
--    Same body as 027 minus the INSERT (the audit trigger below records it).
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_offender_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.deleted_at := NULL;
    NEW.version    := 1;
    NEW.updated_by := NULL;
    NEW.unit_id    := public.my_unit();
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

  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND COALESCE(public.my_role(), '') <> 'administrator' THEN
    RAISE EXCEPTION 'protected_column'
      USING ERRCODE = '42501',
            HINT = 'unit_id can only be re-assigned by an administrator';
  END IF;

  -- Identity fields: the author may fix typos for 24 h; after that only a
  -- supervisor in scope / administrator (the UPDATE policy already limits who
  -- reaches this point). The change is audited by tr_offenders_audit.
  IF NEW.full_name   IS DISTINCT FROM OLD.full_name   THEN v_changed := array_append(v_changed, 'full_name'::text);   END IF;
  IF NEW.social_name IS DISTINCT FROM OLD.social_name THEN v_changed := array_append(v_changed, 'social_name'::text); END IF;
  IF NEW.cpf         IS DISTINCT FROM OLD.cpf         THEN v_changed := array_append(v_changed, 'cpf'::text);         END IF;
  IF NEW.rg          IS DISTINCT FROM OLD.rg          THEN v_changed := array_append(v_changed, 'rg'::text);          END IF;
  IF NEW.birth_date  IS DISTINCT FROM OLD.birth_date  THEN v_changed := array_append(v_changed, 'birth_date'::text);  END IF;

  IF cardinality(v_changed) > 0 THEN
    IF NOT (COALESCE(public.my_role(), '') IN ('supervisor', 'administrator')
            OR (OLD.created_by = auth.uid() AND OLD.created_at > NOW() - INTERVAL '24 hours')) THEN
      RAISE EXCEPTION 'identity_field_locked'
        USING ERRCODE = '42501',
              HINT = 'identity fields are editable by the author for 24 h, then by a supervisor or administrator';
    END IF;
  END IF;

  IF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_offender_write() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------
-- 5. Business-event auditing from the real row change.
--    SECURITY DEFINER so the insert works although callers have no INSERT
--    privilege; the function is a trigger (not callable via RPC) and every
--    value comes from OLD / NEW / auth.uid().
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_incident_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev  JSONB := '{}'::jsonb;
  v_next  JSONB := '{}'::jsonb;
  v_key   TEXT;
  v_old   JSONB;
  v_new   JSONB;
  v_actor UUID := COALESCE(auth.uid(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, operation, new_version, performed_by)
    VALUES ('incident', NEW.id, 'create', NEW.version, v_actor);
    RETURN NULL;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.audit_log (entity_type, entity_id, operation, previous_version, new_version, performed_by)
    VALUES ('incident', NEW.id, 'delete', OLD.version, NEW.version, v_actor);
    RETURN NULL;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF v_key IN ('updated_at', 'version', 'updated_by') THEN CONTINUE; END IF;
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      v_prev := v_prev || jsonb_build_object(v_key, v_old -> v_key);
      v_next := v_next || jsonb_build_object(v_key, v_new -> v_key);
    END IF;
  END LOOP;

  IF v_next <> '{}'::jsonb THEN
    INSERT INTO public.audit_log (entity_type, entity_id, operation, previous_version, new_version,
                                  previous_data, new_data, performed_by)
    VALUES ('incident', NEW.id, 'update', OLD.version, NEW.version, v_prev, v_next, v_actor);
  END IF;
  RETURN NULL;
END;
$$;

-- Offender rows hold PII: only field NAMES are logged, never values.
CREATE OR REPLACE FUNCTION public.audit_offender_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fields   TEXT[] := ARRAY[]::TEXT[];
  v_identity TEXT[] := ARRAY[]::TEXT[];
  v_key      TEXT;
  v_old      JSONB;
  v_new      JSONB;
  v_data     JSONB := '{}'::jsonb;
  v_actor    UUID := COALESCE(auth.uid(), NEW.updated_by, NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, operation, new_version, performed_by)
    VALUES ('offender', NEW.id, 'create', NEW.version, v_actor);
    RETURN NULL;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.audit_log (entity_type, entity_id, operation, previous_version, new_version, performed_by)
    VALUES ('offender', NEW.id, 'delete', OLD.version, NEW.version, v_actor);
    RETURN NULL;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
    IF v_key IN ('updated_at', 'version', 'updated_by') THEN CONTINUE; END IF;
    IF v_old -> v_key IS DISTINCT FROM v_new -> v_key THEN
      v_fields := array_append(v_fields, v_key);
      IF v_key IN ('full_name', 'social_name', 'cpf', 'rg', 'birth_date') THEN
        v_identity := array_append(v_identity, v_key);
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_fields) = 0 THEN
    RETURN NULL;
  END IF;
  IF cardinality(v_identity) > 0 THEN
    v_data := jsonb_build_object('identity_fields_changed', to_jsonb(v_identity));
  END IF;
  IF cardinality(v_fields) > cardinality(v_identity) THEN
    v_data := v_data || jsonb_build_object('fields_changed', to_jsonb(v_fields));
  END IF;

  INSERT INTO public.audit_log (entity_type, entity_id, operation, previous_version, new_version,
                                new_data, performed_by)
  VALUES ('offender', NEW.id, 'update', OLD.version, NEW.version, v_data, v_actor);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_incident_change()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_offender_change()  FROM PUBLIC, anon, authenticated;

-- AFTER triggers: they see the final row (guards / version bump already applied)
-- and only run when the write really happened.
DROP TRIGGER IF EXISTS tr_incidents_audit ON public.incidents;
CREATE TRIGGER tr_incidents_audit
  AFTER INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.audit_incident_change();

DROP TRIGGER IF EXISTS tr_offenders_audit ON public.offenders;
CREATE TRIGGER tr_offenders_audit
  AFTER INSERT OR UPDATE ON public.offenders
  FOR EACH ROW EXECUTE FUNCTION public.audit_offender_change();
