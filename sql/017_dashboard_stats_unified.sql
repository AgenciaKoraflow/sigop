-- =============================================
-- SIGOP — 017 dashboard_stats(): single "ocorrências" model
-- Run in the Supabase SQL Editor AFTER 016_dashboard_stats_top_offenders.sql
-- Naming standard: English (snake_case)
--
-- Since 010 an abordagem is just `incidents.type = 'stop'`, but the "Painel"
-- (/dashboard) payload still reported ocorrências and abordagens as two
-- parallel things. This rewrite drops that split and adds the indicators the
-- current model can answer:
--
-- Removed keys: `stops_total`, `stops_flagrante`, `in_flagrante`,
--   `daily[].stops`, `agent_productivity[].stops_created` (all derivable from
--   `by_type`, which already carries 'stop' and 'in_flagrante').
--
-- New keys:
--   `previous_total`       same-length range right before the selected one
--   `monthly`              month buckets (last 24 months of the range) for
--                          ranges too long for the 92-day `daily` series
--   `by_weekday_hour`      day-of-week x hour counts (America/Sao_Paulo)
--   `by_contractor`, `by_municipality`, `by_territorial_area`  (top 10 each)
--   `without_contractor`, `without_municipality`, `without_territorial_area`
--   `with_offenders`       incidents with at least one suspect / perpetrator
--   `offenders_involved`   distinct offenders linked as suspect / perpetrator
--   `repeat_offenders`     of those, linked to 2+ incidents in the range
--   `agent_productivity[].last_occurred_at`
--   `recent_incidents[].territorial_area / municipality / address_city`
--
-- Unchanged: `total`, `first_occurred_at`, `by_type`, `top_offenders`.
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
  result       JSON;
  v_daily_lo   TIMESTAMPTZ;
  v_monthly_lo TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_tz         CONSTANT TEXT := 'America/Sao_Paulo';
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('supervisor', 'administrator') THEN
    RAISE EXCEPTION 'insufficient_privilege'
      USING ERRCODE = '42501',
            HINT = 'dashboard_stats requires the supervisor or administrator role';
  END IF;

  v_daily_lo   := GREATEST(p_date_start, p_date_end - INTERVAL '92 days');
  v_monthly_lo := GREATEST(p_date_start, p_date_end - INTERVAL '24 months');
  v_prev_start := p_date_start - (p_date_end - p_date_start);

  WITH scoped AS (
    -- `local_ts` is the v_tz wall-clock time, used for every day / month /
    -- weekday / hour bucket below.
    SELECT
      i.id,
      i.type,
      i.occurred_at,
      i.created_by,
      i.internal_number,
      i.municipality_id,
      i.territorial_area_id,
      i.address_city,
      i.agent_name,
      (i.occurred_at AT TIME ZONE v_tz) AS local_ts
    FROM incidents i
    WHERE i.deleted_at IS NULL
      AND i.occurred_at BETWEEN p_date_start AND p_date_end
      AND (p_unit_id IS NULL OR i.unit_id = p_unit_id)
  ),
  -- One row per (offender, incident); victim / witness links are not counted.
  links AS (
    SELECT DISTINCT io.offender_id, s.id AS incident_id, s.occurred_at
    FROM incident_offenders io
    JOIN scoped s      ON s.id = io.incident_id
    JOIN offenders off ON off.id = io.offender_id AND off.deleted_at IS NULL
    WHERE COALESCE(io.role, 'suspect') IN ('suspect', 'perpetrator')
  ),
  offender_totals AS (
    SELECT
      offender_id,
      COUNT(*)         AS incident_count,
      MAX(occurred_at) AS last_occurred_at
    FROM links
    GROUP BY offender_id
  )
  SELECT json_build_object(
    'total',             (SELECT COUNT(*) FROM scoped),
    'first_occurred_at', (SELECT MIN(occurred_at) FROM scoped),

    'previous_total', (
      SELECT COUNT(*) FROM incidents pv
      WHERE pv.deleted_at IS NULL
        AND pv.occurred_at >= v_prev_start
        AND pv.occurred_at <  p_date_start
        AND (p_unit_id IS NULL OR pv.unit_id = p_unit_id)
    ),

    'by_type', (
      SELECT COALESCE(json_object_agg(t.type, t.cnt), '{}'::json)
      FROM (SELECT type, COUNT(*) AS cnt FROM scoped GROUP BY type) t
    ),

    'daily', (
      SELECT COALESCE(
        json_agg(json_build_object('day', d.day, 'incidents', d.incidents) ORDER BY d.day),
        '[]'::json
      )
      FROM (
        SELECT gs::date AS day, COUNT(s.id) AS incidents
        FROM generate_series(
          date_trunc('day', v_daily_lo AT TIME ZONE v_tz),
          date_trunc('day', p_date_end AT TIME ZONE v_tz),
          INTERVAL '1 day'
        ) AS gs
        LEFT JOIN scoped s
          ON s.local_ts >= gs AND s.local_ts < gs + INTERVAL '1 day'
        GROUP BY gs
      ) d
    ),

    'monthly', (
      SELECT COALESCE(
        json_agg(json_build_object('month', m.month, 'incidents', m.incidents) ORDER BY m.month),
        '[]'::json
      )
      FROM (
        SELECT gs::date AS month, COUNT(s.id) AS incidents
        FROM generate_series(
          date_trunc('month', v_monthly_lo AT TIME ZONE v_tz),
          date_trunc('month', p_date_end   AT TIME ZONE v_tz),
          INTERVAL '1 month'
        ) AS gs
        LEFT JOIN scoped s
          ON s.local_ts >= gs AND s.local_ts < gs + INTERVAL '1 month'
        GROUP BY gs
      ) m
    ),

    -- dow: 0 = Sunday ... 6 = Saturday. Only non-empty cells are returned.
    'by_weekday_hour', (
      SELECT COALESCE(
        json_agg(json_build_object('dow', w.dow, 'hour', w.hour, 'count', w.cnt)),
        '[]'::json
      )
      FROM (
        SELECT
          EXTRACT(DOW  FROM local_ts)::int AS dow,
          EXTRACT(HOUR FROM local_ts)::int AS hour,
          COUNT(*) AS cnt
        FROM scoped
        GROUP BY 1, 2
      ) w
    ),

    -- Contratada is an attribute of the AT (see 011), so it is reached
    -- through `territorial_area_id`.
    'by_contractor', (
      SELECT COALESCE(
        json_agg(json_build_object('id', c.id, 'name', c.name, 'count', c.cnt)
                 ORDER BY c.cnt DESC, c.name),
        '[]'::json
      )
      FROM (
        SELECT ct.id, ct.name, COUNT(*) AS cnt
        FROM scoped s
        JOIN territorial_areas ta ON ta.id = s.territorial_area_id
        JOIN contractors ct       ON ct.id = ta.contractor_id
        GROUP BY ct.id, ct.name
        ORDER BY cnt DESC, ct.name
        LIMIT 10
      ) c
    ),
    'without_contractor', (
      SELECT COUNT(*)
      FROM scoped s
      LEFT JOIN territorial_areas ta ON ta.id = s.territorial_area_id
      WHERE ta.contractor_id IS NULL
    ),

    'by_municipality', (
      SELECT COALESCE(
        json_agg(json_build_object('id', c.id, 'name', c.name, 'count', c.cnt)
                 ORDER BY c.cnt DESC, c.name),
        '[]'::json
      )
      FROM (
        SELECT m.id, m.name, COUNT(*) AS cnt
        FROM scoped s
        LEFT JOIN territorial_areas ta ON ta.id = s.territorial_area_id
        JOIN municipalities m ON m.id = COALESCE(s.municipality_id, ta.municipality_id)
        GROUP BY m.id, m.name
        ORDER BY cnt DESC, m.name
        LIMIT 10
      ) c
    ),
    'without_municipality', (
      SELECT COUNT(*)
      FROM scoped s
      LEFT JOIN territorial_areas ta ON ta.id = s.territorial_area_id
      WHERE COALESCE(s.municipality_id, ta.municipality_id) IS NULL
    ),

    'by_territorial_area', (
      SELECT COALESCE(
        json_agg(json_build_object('id', c.id, 'name', c.name,
                                   'municipality', c.municipality, 'count', c.cnt)
                 ORDER BY c.cnt DESC, c.name),
        '[]'::json
      )
      FROM (
        SELECT
          ta.id,
          COALESCE(NULLIF(ta.code, ''), ta.name) AS name,
          m.name AS municipality,
          COUNT(*) AS cnt
        FROM scoped s
        JOIN territorial_areas ta ON ta.id = s.territorial_area_id
        LEFT JOIN municipalities m ON m.id = ta.municipality_id
        GROUP BY ta.id, ta.code, ta.name, m.name
        ORDER BY cnt DESC, 2
        LIMIT 10
      ) c
    ),
    'without_territorial_area', (
      SELECT COUNT(*) FROM scoped WHERE territorial_area_id IS NULL
    ),

    'with_offenders',     (SELECT COUNT(DISTINCT incident_id) FROM links),
    'offenders_involved', (SELECT COUNT(*) FROM offender_totals),
    'repeat_offenders',   (SELECT COUNT(*) FROM offender_totals WHERE incident_count >= 2),

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
          ot.incident_count,
          ot.last_occurred_at
        FROM offender_totals ot
        JOIN offenders off ON off.id = ot.offender_id
        ORDER BY ot.incident_count DESC, ot.last_occurred_at DESC
        LIMIT 10
      ) o
    ),

    'agent_productivity', (
      SELECT COALESCE(
        json_agg(row_to_json(a) ORDER BY a.incidents_created DESC, a.last_occurred_at DESC),
        '[]'::json
      )
      FROM (
        SELECT
          s.created_by AS id,
          COALESCE(p.full_name, MAX(s.agent_name)) AS full_name,
          p.badge_number,
          COUNT(*)           AS incidents_created,
          MAX(s.occurred_at) AS last_occurred_at
        FROM scoped s
        LEFT JOIN profiles p ON p.id = s.created_by
        GROUP BY s.created_by, p.full_name, p.badge_number
      ) a
    ),

    'recent_incidents', (
      SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.occurred_at DESC), '[]'::json)
      FROM (
        SELECT
          s.id,
          s.internal_number,
          s.type,
          s.occurred_at,
          COALESCE(p.full_name, s.agent_name)    AS agent_name,
          COALESCE(NULLIF(ta.code, ''), ta.name) AS territorial_area,
          m.name                                 AS municipality,
          s.address_city
        FROM scoped s
        LEFT JOIN profiles p           ON p.id = s.created_by
        LEFT JOIN territorial_areas ta ON ta.id = s.territorial_area_id
        LEFT JOIN municipalities m     ON m.id = COALESCE(s.municipality_id, ta.municipality_id)
        ORDER BY s.occurred_at DESC
        LIMIT 10
      ) x
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
