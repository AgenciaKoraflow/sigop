-- =============================================
-- SIGOP — Row Level Security (RLS) policies
-- Run in the Supabase SQL Editor AFTER 001_initial_schema.sql and 002_triggers_functions.sql
-- Naming standard: English (snake_case)
--
-- Note: identifiers were translated to match the English schema in 001/002.
--   perfis      -> profiles   | unidades   -> units
--   ocorrencias -> incidents  | meliantes  -> offenders
--   abordagens  -> stops      | fotos      -> photos
--   ocorrencia_meliante -> incident_offenders
--   abordagem_meliante  -> stop_offenders
--   auditoria   -> audit_log
--   papel       -> role       | unidade_id -> unit_id
--   criado_por  -> created_by | deletado_em -> deleted_at
--   roles: agente/supervisor/administrador -> agent/supervisor/administrator
--   incident status: encerrada/arquivada  -> closed/archived
-- =============================================

-- =============================================
-- ENABLE RLS ON EVERY TABLE
-- =============================================
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE units              ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE offenders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stops              ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_offenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_offenders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- =============================================
-- HELPER FUNCTIONS: role and unit of the current user
-- SECURITY DEFINER so they bypass RLS on profiles and avoid recursive policy checks.
-- =============================================
CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION my_unit()
RETURNS UUID AS $$
  SELECT unit_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================
-- PROFILES
-- =============================================
-- Agent: read own profile
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Supervisor / administrator: read profiles of their own unit
CREATE POLICY "profiles_select_unit" ON profiles
  FOR SELECT USING (
    my_role() IN ('supervisor', 'administrator')
    AND unit_id = my_unit()
  );

-- Administrator: full access
CREATE POLICY "profiles_admin_all" ON profiles
  FOR ALL USING (my_role() = 'administrator');

-- =============================================
-- UNITS
-- =============================================
CREATE POLICY "units_select_all" ON units
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "units_insert_admin" ON units
  FOR INSERT WITH CHECK (my_role() = 'administrator');

CREATE POLICY "units_update_admin" ON units
  FOR UPDATE USING (my_role() = 'administrator');

-- =============================================
-- INCIDENTS
-- Agents can see every record (so they can follow up on a colleague's incident).
-- =============================================
CREATE POLICY "incidents_select_all_agents" ON incidents
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND deleted_at IS NULL
  );

CREATE POLICY "incidents_insert" ON incidents
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

CREATE POLICY "incidents_update_agent" ON incidents
  FOR UPDATE USING (
    auth.uid() IS NOT NULL
    AND status NOT IN ('closed', 'archived')
  );

CREATE POLICY "incidents_update_supervisor" ON incidents
  FOR UPDATE USING (
    my_role() IN ('supervisor', 'administrator')
  );

-- Soft delete is an UPDATE (sets deleted_at); only administrators may do it.
CREATE POLICY "incidents_delete_admin" ON incidents
  FOR UPDATE USING (my_role() = 'administrator')
  WITH CHECK (my_role() = 'administrator');

-- =============================================
-- OFFENDERS
-- =============================================
CREATE POLICY "offenders_select" ON offenders
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND deleted_at IS NULL
  );

CREATE POLICY "offenders_insert" ON offenders
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

CREATE POLICY "offenders_update" ON offenders
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- =============================================
-- STOPS
-- =============================================
CREATE POLICY "stops_select" ON stops
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND deleted_at IS NULL
  );

CREATE POLICY "stops_insert" ON stops
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

CREATE POLICY "stops_update" ON stops
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- =============================================
-- PHOTOS
-- =============================================
CREATE POLICY "photos_select" ON photos
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "photos_insert" ON photos
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

CREATE POLICY "photos_delete" ON photos
  FOR DELETE USING (
    created_by = auth.uid()
    OR my_role() IN ('supervisor', 'administrator')
  );

-- =============================================
-- N:N LINK TABLES
-- =============================================
CREATE POLICY "incident_offenders_select" ON incident_offenders
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "incident_offenders_insert" ON incident_offenders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "stop_offenders_select" ON stop_offenders
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "stop_offenders_insert" ON stop_offenders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- AUDIT LOG (read-only for supervisor / administrator)
-- =============================================
CREATE POLICY "audit_log_select" ON audit_log
  FOR SELECT USING (my_role() IN ('supervisor', 'administrator'));

CREATE POLICY "audit_log_insert" ON audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- NEVER create an UPDATE or DELETE policy on audit_log — the log is immutable.
