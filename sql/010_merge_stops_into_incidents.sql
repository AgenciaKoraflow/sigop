-- =============================================
-- 010 — Merge "Abordagens" (stops) into "Ocorrências" (incidents)
-- =============================================
-- Abordagem stops being a parallel module: it becomes just another
-- `incidents.type` value ('stop'). The `stops`/`stop_offenders` tables had 0
-- rows in production at the time of this migration, so this is a pure schema
-- change — no data to carry over. A flagrante abordagem is represented by the
-- already-existing `type = 'in_flagrante'`, same as a flagrante ocorrência.
-- =============================================

-- 1. Allow 'stop' as an incident type.
ALTER TABLE incidents DROP CONSTRAINT incidents_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_type_check CHECK (type IN (
  'theft','robbery','vandalism','in_flagrante','suspicious','other','stop'
));

-- 2. Photos are no longer attached to a 'stop' entity type.
ALTER TABLE photos DROP CONSTRAINT photos_entity_type_check;
ALTER TABLE photos ADD CONSTRAINT photos_entity_type_check CHECK (entity_type IN (
  'incident','offender'
));

-- 3. Drop the now-unused stops tables (policies, triggers and indexes on them
--    are dropped automatically along with the tables).
DROP TABLE stop_offenders;
DROP TABLE stops;

-- 4. Rewrite dashboard_stats() to source its "abordagem" numbers from
--    `incidents WHERE type = 'stop'` / `incident_offenders` instead of the
--    dropped tables. JSON key names are unchanged so the TS client needs no
--    changes. `stops_flagrante` is now always 0: a flagrante abordagem is a
--    `type = 'in_flagrante'` incident, already counted in `in_flagrante` —
--    keeping a non-zero `stops_flagrante` here would double-count it.
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

  v_series_lo := GREATEST(p_date_start, p_date_end - INTERVAL '92 days');

  SELECT json_build_object(
    'total',        COUNT(*),
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
      SELECT COUNT(*) FROM incidents s
      WHERE s.deleted_at IS NULL
        AND s.type = 'stop'
        AND s.occurred_at BETWEEN p_date_start AND p_date_end
        AND (p_unit_id IS NULL OR s.unit_id = p_unit_id)
    ),
    'stops_flagrante', 0,

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
          (SELECT COUNT(*) FROM incidents s2
             WHERE s2.deleted_at IS NULL
               AND s2.type = 'stop'
               AND (p_unit_id IS NULL OR s2.unit_id = p_unit_id)
               AND s2.occurred_at >= gs
               AND s2.occurred_at <  gs + INTERVAL '1 day') AS stops
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
          COUNT(io.id)        AS stop_count,
          MAX(st.occurred_at) AS last_stopped_at
        FROM incident_offenders io
        JOIN incidents st  ON st.id = io.incident_id AND st.deleted_at IS NULL AND st.type = 'stop'
        JOIN offenders off ON off.id = io.offender_id AND off.deleted_at IS NULL
        WHERE st.occurred_at BETWEEN p_date_start AND p_date_end
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
          (SELECT COUNT(*) FROM incidents sc
             WHERE sc.created_by = p.id AND sc.deleted_at IS NULL
               AND sc.type = 'stop'
               AND sc.occurred_at BETWEEN p_date_start AND p_date_end
               AND (p_unit_id IS NULL OR sc.unit_id = p_unit_id)) AS stops_created
        FROM profiles p
        WHERE (p_unit_id IS NULL OR p.unit_id = p_unit_id)
      ) a
      WHERE a.incidents_created > 0 OR a.stops_created > 0
    ),

    'recent_incidents', (
      SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.occurred_at DESC), '[]'::json)
      FROM (
        SELECT
          i3.id,
          i3.internal_number,
          i3.type,
          i3.occurred_at,
          p.full_name AS agent_name
        FROM incidents i3
        LEFT JOIN profiles p ON p.id = i3.created_by
        WHERE i3.deleted_at IS NULL
          AND i3.occurred_at BETWEEN p_date_start AND p_date_end
          AND (p_unit_id IS NULL OR i3.unit_id = p_unit_id)
        ORDER BY i3.occurred_at DESC
        LIMIT 10
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
