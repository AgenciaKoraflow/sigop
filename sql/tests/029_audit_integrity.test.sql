-- =============================================
-- SIGOP — test for 029_audit_integrity.sql
-- Run AFTER 029 in the SQL Editor (or psql). Everything is rolled back: the DO
-- block always ends with an exception carrying the report. Any line starting
-- with FAIL means the audit log can still be forged / rewritten.
--
-- Callers are impersonated exactly as PostgREST does it: SET LOCAL ROLE +
-- request.jwt.claims (what auth.uid() reads).
-- =============================================
DO $$
DECLARE
  rep TEXT := '';
  n   INT;
  a1  CONSTANT UUID := 'c3e254bc-e2c3-44e6-a749-be7b5f2b0c6a';  -- agent, unit A
  a2  CONSTANT UUID := 'f0ad9456-84ab-40d6-8095-1846555c8c3c';  -- agent, unit A (colleague)
  s1  CONSTANT UUID := '23021897-57b4-4d27-82a5-f9cff5d56431';  -- supervisor A
  uA  UUID := gen_random_uuid();
  iA1 UUID := gen_random_uuid();
  oA1 UUID := gen_random_uuid();
  victim_row UUID := gen_random_uuid();
  before_cnt INT;
  r   RECORD;
BEGIN
  -- ---------- setup (postgres; auth.uid() NULL) ----------
  INSERT INTO units (id, name, code) VALUES (uA, 'A', 'tA');
  UPDATE profiles SET unit_id = uA, role = 'agent',      is_active = true WHERE id IN (a1, a2);
  UPDATE profiles SET unit_id = uA, role = 'supervisor', is_active = true WHERE id = s1;

  -- ---------- A. agent tries to forge rows through the API ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated', 'app_metadata', '{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- A1. fabricate an event attributed to self
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by)
    VALUES ('incident', victim_row, 'delete', a1);
    rep := rep || E'FAIL 01 agent inserted a fabricated audit row\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 01 agent INSERT into audit_log refused\n'; END;

  -- A2. attribute the event to someone else
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by)
    VALUES ('incident', victim_row, 'delete', a2);
    rep := rep || E'FAIL 02 agent inserted a row attributed to another user\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 02 impersonated performed_by refused\n'; END;

  -- A3. no performed_by at all / unknown entity_type / bogus operation
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation) VALUES ('incident', victim_row, 'create');
    rep := rep || E'FAIL 03 insert without performed_by accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 03 anonymous-attribution insert refused\n'; END;
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by)
    VALUES ('whatever', victim_row, 'update', a1);
    rep := rep || E'FAIL 04 arbitrary entity_type accepted\n';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN rep := rep || E'PASS 04 arbitrary entity_type refused\n'; END;
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by)
    VALUES ('incident', victim_row, 'teleport', a1);
    rep := rep || E'FAIL 05 arbitrary operation accepted\n';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN rep := rep || E'PASS 05 arbitrary operation refused\n'; END;
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by)
    VALUES ('user_password', a2, 'update', a1);
    rep := rep || E'FAIL 06 forged password-change event accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 06 forged password-change event refused\n'; END;

  -- A4. tamper with / erase history
  BEGIN
    UPDATE audit_log SET performed_by = a1;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || CASE WHEN n = 0 THEN E'PASS 07 UPDATE touched 0 rows\n' ELSE E'FAIL 07 UPDATE changed '||n||E' rows\n' END;
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 07 UPDATE on audit_log refused\n'; END;
  BEGIN
    DELETE FROM audit_log;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || CASE WHEN n = 0 THEN E'PASS 08 DELETE touched 0 rows\n' ELSE E'FAIL 08 DELETE removed '||n||E' rows\n' END;
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 08 DELETE on audit_log refused\n'; END;
  BEGIN
    TRUNCATE audit_log;
    rep := rep || E'FAIL 09 TRUNCATE succeeded\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 09 TRUNCATE refused\n'; END;

  -- A5. calling the trigger functions as RPC to forge rows
  BEGIN
    PERFORM public.audit_incident_change();
    rep := rep || E'FAIL 10 audit trigger function callable by authenticated\n';
  EXCEPTION WHEN insufficient_privilege OR undefined_function OR feature_not_supported THEN
    rep := rep || E'PASS 10 audit trigger functions not callable via RPC\n'; END;

  -- anon: no access at all
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    INSERT INTO audit_log (entity_type, entity_id, operation, performed_by) VALUES ('incident', victim_row, 'create', a1);
    rep := rep || E'FAIL 11 anon inserted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 11 anon INSERT refused\n'; END;
  RESET ROLE;

  -- ---------- B. legitimate actions ARE recorded, faithfully ----------
  SELECT count(*) INTO before_cnt FROM audit_log;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated', 'app_metadata', '{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO incidents (id, type, description, occurred_at, created_by, unit_id) VALUES (iA1, 'theft', 'x', now(), a1, uA);
  UPDATE incidents SET description = 'changed' WHERE id = iA1;
  UPDATE incidents SET description = 'changed' WHERE id = iA1;      -- no-op: must NOT log
  INSERT INTO offenders (id, full_name, cpf, rg, created_by, unit_id) VALUES (oA1, 'Ana', '11111111111', '1', a1, uA);
  UPDATE offenders SET nickname = 'nick' WHERE id = oA1;
  UPDATE offenders SET cpf = '22222222222' WHERE id = oA1;
  RESET ROLE;

  SELECT count(*) INTO n FROM audit_log WHERE entity_id = iA1 AND entity_type = 'incident' AND operation = 'create' AND performed_by = a1;
  rep := rep || CASE WHEN n = 1 THEN E'PASS 12 incident create audited with real author\n' ELSE E'FAIL 12 create rows='||n||E'\n' END;
  SELECT * INTO r FROM audit_log WHERE entity_id = iA1 AND operation = 'update';
  rep := rep || CASE WHEN r.performed_by = a1 AND r.previous_data = '{"description":"x"}'::jsonb
                       AND r.new_data = '{"description":"changed"}'::jsonb
                     THEN E'PASS 13 incident update audited with before/after of the changed column only\n'
                     ELSE E'FAIL 13 update row: '||coalesce(r::text,'null')||E'\n' END;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = iA1 AND operation = 'update';
  rep := rep || CASE WHEN n = 1 THEN E'PASS 14 no-op update not logged (no event that did not happen)\n' ELSE E'FAIL 14 update rows='||n||E'\n' END;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = oA1 AND entity_type = 'offender' AND operation = 'update'
     AND new_data = '{"identity_fields_changed":["cpf"]}'::jsonb AND performed_by = a1;
  rep := rep || CASE WHEN n = 1 THEN E'PASS 15 offender identity change: field names only, no values\n' ELSE E'FAIL 15 rows='||n||E'\n' END;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = oA1 AND operation = 'update' AND new_data = '{"fields_changed":["nickname"]}'::jsonb;
  rep := rep || CASE WHEN n = 1 THEN E'PASS 15b offender non-identity change logged\n' ELSE E'FAIL 15b rows='||n||E'\n' END;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = oA1 AND operation = 'update' AND new_data::text LIKE '%2222%';
  rep := rep || CASE WHEN n = 0 THEN E'PASS 16 no CPF value leaked into the log\n' ELSE E'FAIL 16 CPF in audit_log\n' END;

  -- failed writes leave no trace
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated', 'app_metadata', '{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE incidents SET description = 'hack' WHERE id = iA1;          -- a2 is not the author: RLS -> 0 rows
  RESET ROLE;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = iA1 AND performed_by = a2;
  rep := rep || CASE WHEN n = 0 THEN E'PASS 17 rejected edit by another user left no audit row\n' ELSE E'FAIL 17 phantom row\n' END;

  -- soft delete (service role path: auth.uid() NULL, updated_by carries the admin)
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE incidents SET deleted_at = now(), updated_by = s1 WHERE id = iA1;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = iA1 AND operation = 'delete' AND performed_by = s1;
  rep := rep || CASE WHEN n = 1 THEN E'PASS 18 soft delete audited, attributed to updated_by\n' ELSE E'FAIL 18 delete rows='||n||E'\n' END;

  -- ---------- C. service role: still append-only, performed_at forced ----------
  INSERT INTO audit_log (entity_type, entity_id, operation, performed_by, performed_at)
  VALUES ('user_password', a1, 'update', a1, '2001-01-01');
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = a1 AND entity_type = 'user_password' AND performed_at > now() - interval '1 minute';
  rep := rep || CASE WHEN n >= 1 THEN E'PASS 19 performed_at cannot be back-dated\n' ELSE E'FAIL 19 back-dated row\n' END;
  BEGIN
    UPDATE audit_log SET operation = 'create' WHERE entity_id = iA1;
    rep := rep || E'FAIL 20 service role rewrote history\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 20 UPDATE blocked even for the table owner / service role\n'; END;
  BEGIN
    DELETE FROM audit_log WHERE entity_id = iA1;
    rep := rep || E'FAIL 21 service role deleted history\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 21 DELETE blocked even for the table owner / service role\n'; END;

  -- ---------- D. supervisor can still read ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated', 'app_metadata', '{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = iA1;
  rep := rep || CASE WHEN n >= 1 THEN E'PASS 22 supervisor reads the log\n' ELSE E'FAIL 22 supervisor cannot read\n' END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated', 'app_metadata', '{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM audit_log;
  rep := rep || CASE WHEN n = 0 THEN E'PASS 23 agent cannot read the log\n' ELSE E'FAIL 23 agent read '||n||E' rows\n' END;
  RESET ROLE;

  RAISE EXCEPTION E'REPORT (rolled back)\n%', rep;
END $$;
