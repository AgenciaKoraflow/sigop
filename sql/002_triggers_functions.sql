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

DROP TRIGGER IF EXISTS tr_incidents_internal_number ON incidents;
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

DROP TRIGGER IF EXISTS tr_incidents_updated_at ON incidents;
CREATE TRIGGER tr_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_stops_updated_at ON stops;
CREATE TRIGGER tr_stops_updated_at
  BEFORE UPDATE ON stops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_offenders_updated_at ON offenders;
CREATE TRIGGER tr_offenders_updated_at
  BEFORE UPDATE ON offenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON profiles;
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

DROP TRIGGER IF EXISTS tr_incidents_version ON incidents;
CREATE TRIGGER tr_incidents_version
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION increment_version();

DROP TRIGGER IF EXISTS tr_stops_version ON stops;
CREATE TRIGGER tr_stops_version
  BEFORE UPDATE ON stops
  FOR EACH ROW EXECUTE FUNCTION increment_version();

DROP TRIGGER IF EXISTS tr_offenders_version ON offenders;
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

DROP TRIGGER IF EXISTS tr_auth_create_profile ON auth.users;
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
-- Powers app/(app)/dashboard — the operational-indicators screen. Returns the
-- incident KPIs plus a daily volume series, per-type / per-status breakdowns,
-- the most-stopped offenders, agent productivity and incidents left open for
-- more than 7 days. Restricted to the supervisor / administrator roles.
-- =============================================
CREATE OR REPLACE FUNCTION dashboard_stats(
  p_unit_id    UUID DEFAULT NULL,
  p_date_start TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_date_end   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result      JSON;
  v_series_lo TIMESTAMPTZ;
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('supervisor', 'administrator') THEN
    RAISE EXCEPTION 'insufficient_privilege'
      USING ERRCODE = '42501',
            HINT = 'dashboard_stats requires the supervisor or administrator role';
  END IF;

  -- Bound the daily volume series to at most the last 92 days of the range.
  v_series_lo := GREATEST(p_date_start, p_date_end - INTERVAL '92 days');

  SELECT json_build_object(
    'total',        COUNT(*),
    'open',         COUNT(*) FILTER (WHERE i.status = 'open'),
    'in_progress',  COUNT(*) FILTER (WHERE i.status = 'in_progress'),
    'closed',       COUNT(*) FILTER (WHERE i.status = 'closed'),
    'archived',     COUNT(*) FILTER (WHERE i.status = 'archived'),
    'in_flagrante', COUNT(*) FILTER (WHERE i.type = 'in_flagrante'),

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
    ),

    'stops_total', (
      SELECT COUNT(*) FROM stops s
      WHERE s.deleted_at IS NULL
        AND s.stopped_at BETWEEN p_date_start AND p_date_end
        AND (p_unit_id IS NULL OR s.unit_id = p_unit_id)
    ),
    'stops_flagrante', (
      SELECT COUNT(*) FROM stops s
      WHERE s.deleted_at IS NULL
        AND s.type = 'in_flagrante'
        AND s.stopped_at BETWEEN p_date_start AND p_date_end
        AND (p_unit_id IS NULL OR s.unit_id = p_unit_id)
    ),

    'daily', (
      SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
      FROM (
        SELECT
          gs::date AS day,
          (SELECT COUNT(*) FROM incidents i2
             WHERE i2.deleted_at IS NULL
               AND (p_unit_id IS NULL OR i2.unit_id = p_unit_id)
               AND i2.occurred_at >= gs
               AND i2.occurred_at <  gs + INTERVAL '1 day') AS incidents,
          (SELECT COUNT(*) FROM stops s2
             WHERE s2.deleted_at IS NULL
               AND (p_unit_id IS NULL OR s2.unit_id = p_unit_id)
               AND s2.stopped_at >= gs
               AND s2.stopped_at <  gs + INTERVAL '1 day') AS stops
        FROM generate_series(
          date_trunc('day', v_series_lo),
          date_trunc('day', p_date_end),
          INTERVAL '1 day'
        ) AS gs
      ) d
    ),

    'top_offenders', (
      SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.stop_count DESC), '[]'::json)
      FROM (
        SELECT
          off.id,
          off.full_name,
          off.nickname,
          COUNT(so.id)       AS stop_count,
          MAX(st.stopped_at) AS last_stopped_at
        FROM stop_offenders so
        JOIN stops st      ON st.id = so.stop_id AND st.deleted_at IS NULL
        JOIN offenders off ON off.id = so.offender_id AND off.deleted_at IS NULL
        WHERE st.stopped_at BETWEEN p_date_start AND p_date_end
          AND (p_unit_id IS NULL OR st.unit_id = p_unit_id)
        GROUP BY off.id, off.full_name, off.nickname
        ORDER BY stop_count DESC
        LIMIT 10
      ) o
    ),

    'agent_productivity', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.incidents_created DESC, a.stops_created DESC), '[]'::json)
      FROM (
        SELECT
          p.id,
          p.full_name,
          p.badge_number,
          (SELECT COUNT(*) FROM incidents ic
             WHERE ic.created_by = p.id AND ic.deleted_at IS NULL
               AND ic.occurred_at BETWEEN p_date_start AND p_date_end
               AND (p_unit_id IS NULL OR ic.unit_id = p_unit_id)) AS incidents_created,
          (SELECT COUNT(*) FROM stops sc
             WHERE sc.created_by = p.id AND sc.deleted_at IS NULL
               AND sc.stopped_at BETWEEN p_date_start AND p_date_end
               AND (p_unit_id IS NULL OR sc.unit_id = p_unit_id)) AS stops_created
        FROM profiles p
        WHERE (p_unit_id IS NULL OR p.unit_id = p_unit_id)
      ) a
      WHERE a.incidents_created > 0 OR a.stops_created > 0
    ),

    'stale_incidents', (
      SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.occurred_at ASC), '[]'::json)
      FROM (
        SELECT
          i3.id,
          i3.internal_number,
          i3.type,
          i3.status,
          i3.occurred_at,
          p.full_name AS agent_name,
          FLOOR(EXTRACT(EPOCH FROM (NOW() - i3.occurred_at)) / 86400)::int AS days_open
        FROM incidents i3
        LEFT JOIN profiles p ON p.id = i3.created_by
        WHERE i3.deleted_at IS NULL
          AND i3.status IN ('open', 'in_progress')
          AND i3.occurred_at < NOW() - INTERVAL '7 days'
          AND (p_unit_id IS NULL OR i3.unit_id = p_unit_id)
        ORDER BY i3.occurred_at ASC
        LIMIT 100
      ) x
    )
  ) INTO result
  FROM incidents i
  WHERE i.deleted_at IS NULL
    AND i.occurred_at BETWEEN p_date_start AND p_date_end
    AND (p_unit_id IS NULL OR i.unit_id = p_unit_id);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
