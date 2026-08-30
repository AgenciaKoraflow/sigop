-- =============================================
-- SIGOP — Triggers and functions
-- Run in the Supabase SQL Editor AFTER 001_initial_schema.sql
-- Naming standard: English (snake_case)
--
-- Note: identifiers were translated to match the English schema in 001.
--   ocorrencias -> incidents | abordagens -> stops
--   meliantes   -> offenders  | perfis     -> profiles
-- The user-facing incident code keeps the "OC-" prefix (OC-2024-000001).
-- =============================================

-- =============================================
-- TRIGGER: auto-increment internal_number
-- Generates OC-2024-000001
-- =============================================
CREATE SEQUENCE IF NOT EXISTS incidents_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_internal_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.internal_number IS NULL THEN
    NEW.internal_number := 'OC-' || to_char(NOW(), 'YYYY') || '-' ||
                           lpad(nextval('incidents_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_incidents_internal_number
  BEFORE INSERT ON incidents
  FOR EACH ROW EXECUTE FUNCTION generate_internal_number();

-- =============================================
-- TRIGGER: keep updated_at current automatically
-- =============================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tr_stops_updated_at
  BEFORE UPDATE ON stops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tr_offenders_updated_at
  BEFORE UPDATE ON offenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================
-- TRIGGER: increment version on updates
-- Ignores the columns maintained by other triggers (updated_at, version)
-- so a no-op UPDATE does not bump the version.
-- =============================================
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_incidents_version
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER tr_stops_version
  BEFORE UPDATE ON stops
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER tr_offenders_version
  BEFORE UPDATE ON offenders
  FOR EACH ROW EXECUTE FUNCTION increment_version();

-- =============================================
-- TRIGGER: create a profile when a user signs up
-- =============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_auth_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- FUNCTION: full-text search of offenders
-- =============================================
CREATE OR REPLACE FUNCTION search_offenders(term TEXT)
RETURNS SETOF offenders AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM offenders
  WHERE deleted_at IS NULL
    AND (
      full_name   ILIKE '%' || term || '%'
      OR nickname    ILIKE '%' || term || '%'
      OR social_name ILIKE '%' || term || '%'
    )
  ORDER BY full_name ASC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- FUNCTION: dashboard stats (for supervisor/administrator)
-- =============================================
CREATE OR REPLACE FUNCTION dashboard_stats(
  p_unit_id    UUID DEFAULT NULL,
  p_date_start TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_date_end   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total',       COUNT(*),
    'open',        COUNT(*) FILTER (WHERE status = 'open'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'closed',      COUNT(*) FILTER (WHERE status = 'closed'),
    'archived',    COUNT(*) FILTER (WHERE status = 'archived'),
    'by_type', (
      SELECT COALESCE(json_object_agg(type, cnt), '{}'::json)
      FROM (
        SELECT type, COUNT(*) AS cnt
        FROM incidents
        WHERE deleted_at IS NULL
          AND occurred_at BETWEEN p_date_start AND p_date_end
          AND (p_unit_id IS NULL OR unit_id = p_unit_id)
        GROUP BY type
      ) t
    )
  ) INTO result
  FROM incidents
  WHERE deleted_at IS NULL
    AND occurred_at BETWEEN p_date_start AND p_date_end
    AND (p_unit_id IS NULL OR unit_id = p_unit_id);

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
