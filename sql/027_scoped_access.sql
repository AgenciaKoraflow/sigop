-- =============================================
-- SIGOP — 027 Scoped access (F-03): authorship / supervision / unit in the database
-- Run in the Supabase SQL Editor AFTER 026_signup_lockdown.sql
-- Naming standard: English (snake_case)
--
-- Finding F-03: any signed-in user could read AND edit the full offender record
-- (CPF, RG, birth date...) and read every incident / photo / link, because the
-- policies were `auth.uid() IS NOT NULL`. 022 closed the column-level holes
-- (created_by, deleted_at...) but deliberately left the registry shared.
--
-- Access model (enforced here, never in the frontend):
--   administrator  every unit
--   supervisor     own unit + units granted in `supervisor_units` (explicit)
--   agent          own unit
--   unit_id NULL   (no unit) => visible ONLY to its author and administrators;
--                  a record without a unit is never shared (fail closed)
--
--                      read                          create             edit
--   incidents          author | supervisor in scope  author, unit :=     author (while open) |
--                      | admin                       caller's unit      supervisor in scope | admin
--   offenders          author | same unit | sup.      author, unit :=    author | supervisor in
--                      in scope | admin              caller's unit      scope | admin
--   incident_offenders incident AND offender both    incident editable  (no UPDATE/DELETE)
--                      readable                      AND offender readable
--   photos             parent entity readable |      parent editable    (no UPDATE)
--                      own upload                    (or not yet synced)
--   storage objects    own folder | photo row readable
--
-- Never changeable through the API by the record owner: id, created_by,
-- created_at, deleted_at, unit_id (administrator may re-assign unit_id), and on
-- profiles: role, is_active, unit_id, email, deleted_at (not even by an admin on
-- their OWN row). Offender identity fields (full_name, social_name, cpf, rg,
-- birth_date) are editable by the author only in the first 24 h, afterwards by
-- supervisors in scope / administrators; every change is logged (field names
-- only, never values) in audit_log.
--
-- The service role (Route Handlers, SQL editor, migrations) has auth.uid() NULL
-- and is untouched. Idempotent.
--
-- !! DEPLOY NOTE: at the time of writing `units` was empty and no profile /
-- incident had a unit. Until units exist and users are assigned to them, agents
-- see only their OWN records and supervisors only their own + admin's. Create the
-- units and set profiles.unit_id first (the backfill below then fills
-- incidents / offenders from the author's unit).
-- =============================================

-- ---------------------------------------------
-- 1. Schema: offenders.unit_id and explicit multi-unit supervision
-- ---------------------------------------------
ALTER TABLE public.offenders ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.units(id);
CREATE INDEX IF NOT EXISTS idx_offenders_unit ON public.offenders(unit_id);

CREATE TABLE IF NOT EXISTS public.supervisor_units (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_id    UUID NOT NULL REFERENCES public.units(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, unit_id)
);
ALTER TABLE public.supervisor_units ENABLE ROW LEVEL SECURITY;

-- Backfill from the author's unit (no-op while profiles have no unit).
UPDATE public.incidents i SET unit_id = p.unit_id
  FROM public.profiles p
 WHERE i.unit_id IS NULL AND p.id = i.created_by AND p.unit_id IS NOT NULL;
UPDATE public.offenders o SET unit_id = p.unit_id
  FROM public.profiles p
 WHERE o.unit_id IS NULL AND p.id = o.created_by AND p.unit_id IS NOT NULL;

-- ---------------------------------------------
-- 2. Scope helper. SECURITY DEFINER so it can read profiles / supervisor_units
--    without recursing through their own policies.
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_unit(p_unit UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.my_role() IS NULL            THEN FALSE   -- inactive / deleted / no profile
    WHEN public.my_role() = 'administrator'  THEN TRUE
    WHEN p_unit IS NULL                      THEN FALSE
    WHEN p_unit = public.my_unit()           THEN TRUE
    WHEN public.my_role() = 'supervisor'     THEN EXISTS (
      SELECT 1 FROM public.supervisor_units su
       WHERE su.user_id = auth.uid() AND su.unit_id = p_unit)
    ELSE FALSE
  END
$$;

-- May the caller attach a photo to this entity? TRUE when the entity does not
-- exist yet (offline queue uploads photos before the row syncs) or the caller
-- may edit it. Definer: it must see rows the caller cannot read.
CREATE OR REPLACE FUNCTION public.can_attach_to(p_type TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_author UUID;
  v_unit   UUID;
  v_found  BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR public.my_role() IS NULL THEN RETURN FALSE; END IF;

  IF p_type = 'incident' THEN
    SELECT TRUE, created_by, unit_id INTO v_found, v_author, v_unit
      FROM public.incidents WHERE id = p_id AND deleted_at IS NULL;
  ELSIF p_type = 'offender' THEN
    SELECT TRUE, created_by, unit_id INTO v_found, v_author, v_unit
      FROM public.offenders WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    RETURN FALSE;
  END IF;

  IF NOT COALESCE(v_found, FALSE) THEN
    -- Not a live row. A soft-deleted one must not be reusable as a target.
    RETURN NOT EXISTS (
      SELECT 1 FROM public.incidents WHERE id = p_id AND p_type = 'incident'
      UNION ALL
      SELECT 1 FROM public.offenders WHERE id = p_id AND p_type = 'offender');
  END IF;

  RETURN v_author = auth.uid()
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(v_unit));
END;
$$;

REVOKE ALL ON FUNCTION public.can_see_unit(UUID)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_attach_to(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_unit(UUID)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_attach_to(TEXT, UUID) TO authenticated, service_role;

-- ---------------------------------------------
-- 3. supervisor_units: readable by the supervisor concerned and administrators;
--    written only with the service role / SQL editor (no INSERT/UPDATE/DELETE
--    privilege or policy for API roles => nobody can grant themselves a unit).
-- ---------------------------------------------
REVOKE ALL ON public.supervisor_units FROM anon, authenticated;
GRANT SELECT ON public.supervisor_units TO authenticated;

DROP POLICY IF EXISTS "supervisor_units_select" ON public.supervisor_units;
CREATE POLICY "supervisor_units_select" ON public.supervisor_units
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.my_role() = 'administrator');

DROP POLICY IF EXISTS "supervisor_units_account_usable" ON public.supervisor_units;
CREATE POLICY "supervisor_units_account_usable" ON public.supervisor_units
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.account_usable()) WITH CHECK (public.account_usable());

-- ---------------------------------------------
-- 4. Write guards (triggers). Extend the 022 functions.
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
    NEW.unit_id         := public.my_unit();   -- a record is born in the author's unit
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

  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND COALESCE(public.my_role(), '') <> 'administrator' THEN
    RAISE EXCEPTION 'protected_column'
      USING ERRCODE = '42501',
            HINT = 'unit_id can only be re-assigned by an administrator';
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
  -- reaches this point). The change is audited without storing the values.
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

    INSERT INTO public.audit_log (entity_type, entity_id, operation, previous_version, new_version,
                                  previous_data, new_data, performed_by)
    VALUES ('offender', OLD.id, 'update', OLD.version, OLD.version + 1,
            NULL, jsonb_build_object('identity_fields_changed', to_jsonb(v_changed)), auth.uid());
  END IF;

  IF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_incident_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_offender_write() FROM PUBLIC, anon, authenticated;

-- profiles: nobody changes the columns that define authorization on their OWN
-- row (an administrator edits other users; the app does it via the service role).
CREATE OR REPLACE FUNCTION public.guard_profile_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'profiles are created by the Auth trigger only'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'protected_column' USING ERRCODE = '42501';
  END IF;

  IF OLD.id = auth.uid()
     AND (NEW.role       IS DISTINCT FROM OLD.role
          OR NEW.is_active  IS DISTINCT FROM OLD.is_active
          OR NEW.unit_id    IS DISTINCT FROM OLD.unit_id
          OR NEW.email      IS DISTINCT FROM OLD.email
          OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'protected_column'
      USING ERRCODE = '42501',
            HINT = 'role, is_active, unit_id, email and deleted_at cannot be changed on your own profile';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_profile_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_profiles_a_guard ON public.profiles;
CREATE TRIGGER tr_profiles_a_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_write();

-- ---------------------------------------------
-- 5. incidents
-- ---------------------------------------------
DROP POLICY IF EXISTS "incidents_select_all_agents"          ON public.incidents;
DROP POLICY IF EXISTS "incidents_select_scoped"              ON public.incidents;
DROP POLICY IF EXISTS "incidents_insert"                     ON public.incidents;
DROP POLICY IF EXISTS "incidents_update_own_or_supervisor"   ON public.incidents;
DROP POLICY IF EXISTS "incidents_update_scoped"              ON public.incidents;

CREATE POLICY "incidents_select_scoped" ON public.incidents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id))
    )
  );

CREATE POLICY "incidents_insert" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.my_role() IS NOT NULL
    AND created_by = auth.uid()
    AND unit_id IS NOT DISTINCT FROM public.my_unit()
    AND status NOT IN ('closed', 'archived')
  );

CREATE POLICY "incidents_update_scoped" ON public.incidents
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (created_by = auth.uid() AND status NOT IN ('closed', 'archived'))
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id))
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      (created_by = auth.uid() AND status NOT IN ('closed', 'archived'))
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id))
    )
  );

-- ---------------------------------------------
-- 6. offenders (PII)
-- ---------------------------------------------
DROP POLICY IF EXISTS "offenders_select"        ON public.offenders;
DROP POLICY IF EXISTS "offenders_select_scoped" ON public.offenders;
DROP POLICY IF EXISTS "offenders_insert"        ON public.offenders;
DROP POLICY IF EXISTS "offenders_update"        ON public.offenders;
DROP POLICY IF EXISTS "offenders_update_scoped" ON public.offenders;

CREATE POLICY "offenders_select_scoped" ON public.offenders
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (created_by = auth.uid() OR public.can_see_unit(unit_id))
  );

CREATE POLICY "offenders_insert" ON public.offenders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.my_role() IS NOT NULL
    AND created_by = auth.uid()
    AND unit_id IS NOT DISTINCT FROM public.my_unit()
  );

CREATE POLICY "offenders_update_scoped" ON public.offenders
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id))
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id))
    )
  );

-- search_offenders*/find_offender_by_cpf are SECURITY INVOKER (022 + live DB), so
-- they inherit the scoped SELECT policy above; nothing to change there.

-- ---------------------------------------------
-- 7. incident_offenders
-- ---------------------------------------------
DROP POLICY IF EXISTS "incident_offenders_select" ON public.incident_offenders;
DROP POLICY IF EXISTS "incident_offenders_insert" ON public.incident_offenders;

CREATE POLICY "incident_offenders_select" ON public.incident_offenders
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_offenders.incident_id)   -- RLS-filtered
    AND EXISTS (SELECT 1 FROM public.offenders o WHERE o.id = incident_offenders.offender_id) -- RLS-filtered
  );

CREATE POLICY "incident_offenders_insert" ON public.incident_offenders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.my_role() IS NOT NULL
    AND (created_by IS NULL OR created_by = auth.uid())
    AND public.can_attach_to('incident', incident_id)
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_offenders.incident_id)
    AND EXISTS (SELECT 1 FROM public.offenders o WHERE o.id = incident_offenders.offender_id)
  );

-- ---------------------------------------------
-- 8. photos
-- ---------------------------------------------
DROP POLICY IF EXISTS "photos_select" ON public.photos;
DROP POLICY IF EXISTS "photos_insert" ON public.photos;
DROP POLICY IF EXISTS "photos_delete" ON public.photos;

CREATE POLICY "photos_select" ON public.photos
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (entity_type = 'incident'
        AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = photos.entity_id))
    OR (entity_type = 'offender'
        AND EXISTS (SELECT 1 FROM public.offenders o WHERE o.id = photos.entity_id))
  );

CREATE POLICY "photos_insert" ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.my_role() IS NOT NULL
    AND created_by = auth.uid()
    AND storage_path LIKE auth.uid()::text || '/%'
    AND public.can_attach_to(entity_type, entity_id)
  );

CREATE POLICY "photos_delete" ON public.photos
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      public.my_role() IN ('supervisor', 'administrator')
      AND (
        (entity_type = 'incident' AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = photos.entity_id))
        OR (entity_type = 'offender' AND EXISTS (SELECT 1 FROM public.offenders o WHERE o.id = photos.entity_id))
      )
    )
  );

-- ---------------------------------------------
-- 9. storage.objects: the file follows the photo row (signed URLs need SELECT)
-- ---------------------------------------------
DROP POLICY IF EXISTS "storage_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_scoped"        ON storage.objects;
CREATE POLICY "storage_select_scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'operational-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.photos p WHERE p.storage_path = objects.name)   -- RLS-filtered
    )
  );

DROP POLICY IF EXISTS "storage_delete_own_or_supervisor" ON storage.objects;
CREATE POLICY "storage_delete_own_or_supervisor" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'operational-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (
        public.my_role() IN ('supervisor', 'administrator')
        AND EXISTS (SELECT 1 FROM public.photos p WHERE p.storage_path = objects.name)
      )
    )
  );

-- ---------------------------------------------
-- 10. profiles / units
-- ---------------------------------------------
DROP POLICY IF EXISTS "profiles_select_unit" ON public.profiles;
CREATE POLICY "profiles_select_unit" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('supervisor', 'administrator') AND public.can_see_unit(unit_id));

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated
  USING (public.my_role() = 'administrator')
  WITH CHECK (public.my_role() = 'administrator');

DROP POLICY IF EXISTS "units_select_all"    ON public.units;
DROP POLICY IF EXISTS "units_select_scoped" ON public.units;
CREATE POLICY "units_select_scoped" ON public.units
  FOR SELECT TO authenticated
  USING (public.can_see_unit(id));

DROP POLICY IF EXISTS "units_insert_admin" ON public.units;
CREATE POLICY "units_insert_admin" ON public.units
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'administrator');

DROP POLICY IF EXISTS "units_update_admin" ON public.units;
CREATE POLICY "units_update_admin" ON public.units
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'administrator')
  WITH CHECK (public.my_role() = 'administrator');
