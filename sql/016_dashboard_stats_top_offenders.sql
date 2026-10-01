-- =============================================
-- SIGOP — 016 dashboard_stats(): top offenders across every incident type
-- Run in the Supabase SQL Editor AFTER 015_profiles_deleted_at.sql
-- Naming standard: English (snake_case)
--
-- Fixes on the "Painel" (/dashboard) numbers:
--
-- 1. `top_offenders` only counted links on `type = 'stop'` incidents (leftover
--    from 010, when it replaced the dropped `stop_offenders` table). Offenders
--    are linked to furto / roubo / flagrante / ... far more often than to an
--    abordagem, so the table came back empty. It now ranks by every incident
--    the offender is linked to as suspect / perpetrator (or with no role);
--    victim / witness links are not counted. Keys: `incident_count`,
--    `last_occurred_at`.
-- 2. `daily` bucketed by UTC day, so a record made after 21:00 (BRT) landed on
--    the next day, and the first bucket could include records from before the
--    selected range. Buckets are now America/Sao_Paulo days, clamped to the
--    range.
-- 3. New `first_occurred_at` so the client can compute "média/dia" for the
--    "Todos" period from the first real record instead of from 2000-01-01.
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
  v_tz        CONSTANT TEXT := 'America/Sao_Paulo';
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('supervisor', 'administrator') THEN
    RAISE EXCEPTION 'insufficient_privilege'
      USING ERRCODE = '42501',
            HINT = 'dashboard_stats requires the supervisor or administrator role';
  END IF;

  v_series_lo := GREATEST(p_date_start, p_date_end - INTERVAL '92 days');

  SELECT json_build_object(
    'total',             COUNT(*),
    'in_flagrante',      COUNT(*) FILTER (WHERE i.type = 'in_flagrante'),
    'first_occurred_at', MIN(i.occurred_at),

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

    -- `gs` is a local (v_tz) wall-clock midnight; `gs AT TIME ZONE v_tz` turns
    -- it back into the instant that day starts.
    'daily', (
      SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
      FROM (
        SELECT
          gs::date AS day,
          (SELECT COUNT(*) FROM incidents i2
             WHERE i2.deleted_at IS NULL
               AND (p_unit_id IS NULL OR i2.unit_id = p_unit_id)
               AND i2.occurred_at BETWEEN p_date_start AND p_date_end
               AND i2.occurred_at >= (gs AT TIME ZONE v_tz)
               AND i2.occurred_at <  ((gs + INTERVAL '1 day') AT TIME ZONE v_tz)) AS incidents,
          (SELECT COUNT(*) FROM incidents s2
             WHERE s2.deleted_at IS NULL
               AND s2.type = 'stop'
               AND (p_unit_id IS NULL OR s2.unit_id = p_unit_id)
               AND s2.occurred_at BETWEEN p_date_start AND p_date_end
               AND s2.occurred_at >= (gs AT TIME ZONE v_tz)
               AND s2.occurred_at <  ((gs + INTERVAL '1 day') AT TIME ZONE v_tz)) AS stops
        FROM generate_series(
          date_trunc('day', v_series_lo AT TIME ZONE v_tz),
          date_trunc('day', p_date_end  AT TIME ZONE v_tz),
          INTERVAL '1 day'
        ) AS gs
      ) d
    ),

    'top_offenders', (
      SELECT COALESCE(
        json_agg(row_to_json(o) ORDER BY o.incident_count DESC, o.last_occurred_at DESC),
        '[]'::json
      )
      FROM (
        SELECT
          off.id,
          COALESCE(NULLIF(off.full_name, ''), NULLIF(off.social_name, '')) AS full_name,
          off.nickname,
          COUNT(io.id)        AS incident_count,
          MAX(ic.occurred_at) AS last_occurred_at
        FROM incident_offenders io
        JOIN incidents ic  ON ic.id = io.incident_id AND ic.deleted_at IS NULL
        JOIN offenders off ON off.id = io.offender_id AND off.deleted_at IS NULL
        WHERE ic.occurred_at BETWEEN p_date_start AND p_date_end
          AND (p_unit_id IS NULL OR ic.unit_id = p_unit_id)
          AND COALESCE(io.role, 'suspect') IN ('suspect', 'perpetrator')
        GROUP BY off.id, off.full_name, off.social_name, off.nickname
        ORDER BY incident_count DESC, last_occurred_at DESC
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

REVOKE EXECUTE ON FUNCTION dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
