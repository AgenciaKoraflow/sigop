-- =============================================
-- SIGOP — test for 027_scoped_access.sql
-- Run AFTER 027 in the SQL Editor (or psql). Everything is rolled back: the DO
-- block always ends with an exception that carries the report. Any line starting
-- with FAIL means the bypass works.
--
-- Callers are impersonated exactly as PostgREST does it: `SET LOCAL ROLE
-- authenticated|anon` + the `request.jwt.claims` setting that auth.uid() reads.
-- Existing profiles are temporarily re-roled inside the transaction.
-- =============================================
DO $$
DECLARE
  rep TEXT := '';
  n   INT;
  v   TEXT;
  -- actors (existing profiles; roles/units are rewritten inside this rolled-back txn)
  a1  CONSTANT UUID := 'c3e254bc-e2c3-44e6-a749-be7b5f2b0c6a';  -- agent, unit A
  a2  CONSTANT UUID := 'f0ad9456-84ab-40d6-8095-1846555c8c3c';  -- agent, unit A (colleague)
  a3  CONSTANT UUID := '903a67f4-1cd3-484d-95fd-6fc0c61dcc37';  -- agent, unit B
  s1  CONSTANT UUID := '23021897-57b4-4d27-82a5-f9cff5d56431';  -- supervisor A (+ C granted)
  s2  CONSTANT UUID := '626313b1-8cfd-4a34-a8ab-18534bcf789f';  -- supervisor B
  adm CONSTANT UUID := '30d421f0-b375-4b08-b7de-9ebf48dc13ce';  -- administrator
  ina CONSTANT UUID := '4551fd03-9df2-40ba-bbb4-8f055d665927';  -- soft-deleted, inactive
  uA UUID := gen_random_uuid();
  uB UUID := gen_random_uuid();
  uC UUID := gen_random_uuid();
  iA1 UUID := gen_random_uuid(); iA2 UUID := gen_random_uuid(); iB UUID := gen_random_uuid(); iC UUID := gen_random_uuid();
  oA1 UUID := gen_random_uuid(); oA2 UUID := gen_random_uuid(); oB UUID := gen_random_uuid();
  newO UUID := gen_random_uuid();
  pA2 TEXT; pA1 TEXT;
BEGIN
  -- ---------- setup (as postgres; auth.uid() NULL so guards are inert) ----------
  INSERT INTO units (id, name, code) VALUES (uA,'A','tA'),(uB,'B','tB'),(uC,'C','tC');
  UPDATE profiles SET unit_id=uA, role='agent',      is_active=true  WHERE id IN (a1,a2);
  UPDATE profiles SET unit_id=uB, role='agent',      is_active=true  WHERE id = a3;
  UPDATE profiles SET unit_id=uA, role='supervisor', is_active=true  WHERE id = s1;
  UPDATE profiles SET unit_id=uB, role='supervisor', is_active=true  WHERE id = s2;
  UPDATE profiles SET unit_id=uA                                     WHERE id = ina;
  INSERT INTO supervisor_units (user_id, unit_id) VALUES (s1, uC);

  INSERT INTO incidents (id,type,description,occurred_at,created_by,unit_id) VALUES
    (iA1,'theft','x',now(),a1,uA),(iA2,'theft','x',now(),a2,uA),
    (iB ,'theft','x',now(),a3,uB),(iC ,'theft','x',now(),a3,uC);
  INSERT INTO offenders (id,full_name,cpf,rg,created_by,unit_id) VALUES
    (oA1,'Ana A1','11111111111','1',a1,uA),(oA2,'Bia A2','22222222222','2',a2,uA),
    (oB ,'Cris B','33333333333','3',a3,uB);
  UPDATE offenders SET created_at = now() - interval '3 days' WHERE id = oA2;   -- past the 24 h window
  INSERT INTO incident_offenders (incident_id, offender_id) VALUES (iA2,oA2),(iB,oB);
  pA1 := a1 || '/incident/' || iA1 || '/' || gen_random_uuid() || '.jpg';
  pA2 := a2 || '/incident/' || iA2 || '/' || gen_random_uuid() || '.jpg';
  INSERT INTO photos (storage_path,entity_type,entity_id,created_by) VALUES
    (pA1,'incident',iA1,a1),(pA2,'incident',iA2,a2);
  BEGIN
    INSERT INTO storage.objects (bucket_id,name,owner) VALUES ('operational-photos',pA1,a1),('operational-photos',pA2,a2);
  EXCEPTION WHEN OTHERS THEN rep := rep || E'NOTE storage.objects seed failed: ' || SQLERRM || E'\n';
  END;

  -- =============== AGENT a1 (unit A) ===============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM incidents WHERE id = iA1;
  rep := rep || CASE WHEN n=1 THEN E'PASS 01 agent reads own incident\n' ELSE E'FAIL 01 agent cannot read own incident\n' END;
  SELECT count(*) INTO n FROM incidents WHERE id IN (iA2,iB,iC);
  rep := rep || CASE WHEN n=0 THEN E'PASS 02 agent cannot read another agent''s incident (same unit) nor other units\n' ELSE E'FAIL 02 agent read '||n||E' foreign incidents\n' END;

  UPDATE incidents SET description='hacked' WHERE id IN (iA2,iB,iC);
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=0 THEN E'PASS 03 agent cannot edit another agent''s / other unit''s incident\n' ELSE E'FAIL 03 agent edited '||n||E' foreign incidents\n' END;

  UPDATE incidents SET description='mine' WHERE id = iA1;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 04 agent edits own incident\n' ELSE E'FAIL 04 agent cannot edit own incident\n' END;

  FOREACH v IN ARRAY ARRAY['created_by','unit_id','deleted_at','status'] LOOP
    BEGIN
      IF v='created_by'  THEN UPDATE incidents SET created_by = a2 WHERE id = iA1;
      ELSIF v='unit_id'  THEN UPDATE incidents SET unit_id = uB WHERE id = iA1;
      ELSIF v='deleted_at' THEN UPDATE incidents SET deleted_at = now() WHERE id = iA1;
      ELSE UPDATE incidents SET status = 'closed' WHERE id = iA1; END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      rep := rep || CASE WHEN n=0 THEN 'PASS 05 incident.'||v||E' change blocked (0 rows)\n' ELSE 'FAIL 05 incident.'||v||E' changed by agent\n' END;
    EXCEPTION WHEN insufficient_privilege THEN rep := rep || 'PASS 05 incident.'||v||E' change blocked (42501)\n';
    END;
  END LOOP;

  BEGIN
    INSERT INTO incidents (type,description,occurred_at,created_by,unit_id) VALUES ('theft','x',now(),a2,uA);
    rep := rep || E'FAIL 06 agent inserted an incident authored by someone else\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 06 insert with foreign created_by refused\n'; END;

  INSERT INTO incidents (id,type,description,occurred_at,created_by,unit_id) VALUES (newO,'theft','x',now(),a1,uB);
  RESET ROLE;
  SELECT unit_id::text INTO v FROM incidents WHERE id = newO;
  rep := rep || CASE WHEN v = uA::text THEN E'PASS 07 spoofed unit_id on insert overwritten with the caller''s unit\n' ELSE E'FAIL 07 unit_id spoof kept: '||coalesce(v,'null')||E'\n' END;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- offenders (PII)
  SELECT count(*) INTO n FROM offenders WHERE id IN (oA1,oA2);
  rep := rep || CASE WHEN n=2 THEN E'PASS 08 agent reads own + same-unit offenders\n' ELSE E'FAIL 08 agent sees '||n||E'/2 same-unit offenders\n' END;
  SELECT count(*) INTO n FROM offenders WHERE id = oB;
  rep := rep || CASE WHEN n=0 THEN E'PASS 09 agent cannot read an offender (CPF/RG) of another unit\n' ELSE E'FAIL 09 cross-unit offender readable\n' END;
  UPDATE offenders SET nickname='x' WHERE id IN (oA2,oB);
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=0 THEN E'PASS 10 agent cannot edit a colleague''s / other unit''s offender\n' ELSE E'FAIL 10 agent edited '||n||E' foreign offenders\n' END;
  UPDATE offenders SET nickname='ok' WHERE id = oA1;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 11 author edits own offender (non-identity field)\n' ELSE E'FAIL 11 author cannot edit own offender\n' END;
  UPDATE offenders SET cpf='99999999999' WHERE id = oA1;       -- inside the 24 h window
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 12 author fixes CPF inside the 24 h window\n' ELSE E'FAIL 12 author blocked inside window\n' END;
  FOREACH v IN ARRAY ARRAY['created_by','unit_id','deleted_at'] LOOP
    BEGIN
      IF v='created_by' THEN UPDATE offenders SET created_by = a2 WHERE id = oA1;
      ELSIF v='unit_id' THEN UPDATE offenders SET unit_id = uB WHERE id = oA1;
      ELSE UPDATE offenders SET deleted_at = now() WHERE id = oA1; END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      rep := rep || CASE WHEN n=0 THEN 'PASS 13 offender.'||v||E' change blocked (0 rows)\n' ELSE 'FAIL 13 offender.'||v||E' changed\n' END;
    EXCEPTION WHEN insufficient_privilege THEN rep := rep || 'PASS 13 offender.'||v||E' change blocked (42501)\n';
    END;
  END LOOP;
  BEGIN
    INSERT INTO offenders (full_name,created_by) VALUES ('x',a2);
    rep := rep || E'FAIL 14 offender inserted as another author\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 14 offender insert with foreign created_by refused\n'; END;
  INSERT INTO offenders (id,full_name,created_by,unit_id) VALUES (newO,'novo',a1,uB);
  RESET ROLE;
  SELECT unit_id::text INTO v FROM offenders WHERE id = newO;
  rep := rep || CASE WHEN v = uA::text THEN E'PASS 15 offender unit_id forced to the caller''s unit\n' ELSE E'FAIL 15 offender unit spoof kept\n' END;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- RPCs (SECURITY INVOKER => scoped)
  SELECT count(*) INTO n FROM search_offenders_with_stats('') WHERE id = oB;
  rep := rep || CASE WHEN n=0 THEN E'PASS 16 search RPC does not leak other-unit offenders\n' ELSE E'FAIL 16 search RPC leaked\n' END;
  SELECT count(*) INTO n FROM find_offender_by_cpf('333.333.333-33');
  rep := rep || CASE WHEN n=0 THEN E'PASS 17 CPF lookup RPC does not reveal other-unit offender\n' ELSE E'FAIL 17 CPF lookup leaked\n' END;

  -- links and photos
  SELECT count(*) INTO n FROM incident_offenders WHERE incident_id IN (iA2,iB);
  rep := rep || CASE WHEN n=0 THEN E'PASS 18 links of foreign incidents invisible\n' ELSE E'FAIL 18 foreign links visible\n' END;
  BEGIN
    INSERT INTO incident_offenders (incident_id, offender_id) VALUES (iA2, oA1);
    rep := rep || E'FAIL 19 agent linked a suspect to a colleague''s incident\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 19 cannot attach suspect to a colleague''s incident\n'; END;
  BEGIN
    INSERT INTO incident_offenders (incident_id, offender_id) VALUES (iA1, oB);
    rep := rep || E'FAIL 20 agent linked an invisible other-unit suspect\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 20 cannot link an other-unit suspect\n'; END;
  SELECT count(*) INTO n FROM photos WHERE entity_id = iA2;
  rep := rep || CASE WHEN n=0 THEN E'PASS 21 photos of a colleague''s incident invisible\n' ELSE E'FAIL 21 foreign photos visible\n' END;
  SELECT count(*) INTO n FROM photos WHERE entity_id = iA1;
  rep := rep || CASE WHEN n=1 THEN E'PASS 22 own photo visible\n' ELSE E'FAIL 22 own photo not visible\n' END;
  BEGIN
    INSERT INTO photos (storage_path,entity_type,entity_id,created_by)
    VALUES (a1||'/incident/'||iA2||'/'||gen_random_uuid()||'.jpg','incident',iA2,a1);
    rep := rep || E'FAIL 23 photo attached to a colleague''s incident\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 23 cannot attach a photo to a colleague''s incident\n'; END;
  BEGIN
    INSERT INTO photos (storage_path,entity_type,entity_id,created_by)
    VALUES (a1||'/incident/'||gen_random_uuid()||'/'||gen_random_uuid()||'.jpg','incident',gen_random_uuid(),a1);
    rep := rep || E'PASS 24 offline photo for a not-yet-synced incident still accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'FAIL 24 offline photo flow broken\n'; END;
  DELETE FROM photos WHERE entity_id = iA2;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=0 THEN E'PASS 25 cannot delete a colleague''s photo\n' ELSE E'FAIL 25 deleted a foreign photo\n' END;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='operational-photos' AND name IN (pA1,pA2);
  rep := rep || CASE WHEN n=1 THEN E'PASS 26 storage: only the own file is listable/signable\n' ELSE E'FAIL 26 storage objects visible: '||n||E'\n' END;

  -- privilege escalation
  BEGIN
    UPDATE profiles SET role='administrator' WHERE id = a1;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || CASE WHEN n=0 THEN E'PASS 27 agent cannot promote self (no policy)\n' ELSE E'FAIL 27 agent promoted self\n' END;
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 27 agent cannot promote self (42501)\n'; END;
  BEGIN
    INSERT INTO supervisor_units (user_id, unit_id) VALUES (a1, uB);
    rep := rep || E'FAIL 28 agent granted itself a unit\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 28 supervisor_units not writable via API\n'; END;
  BEGIN
    DELETE FROM incidents WHERE id = iA1;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || E'FAIL 29 hard delete allowed\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 29 hard delete of incidents refused\n'; END;
  RESET ROLE;

  -- =============== OFFENDER identity lock (past 24 h) ===============
  -- a2 is the author of oA2, created 3 days ago.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',a2,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE offenders SET cpf='00000000000' WHERE id = oA2;
    rep := rep || E'FAIL 30 author changed CPF after 24 h\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 30 author cannot change CPF after 24 h\n'; END;
  UPDATE offenders SET nickname='apelido' WHERE id = oA2;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 31 non-identity edit still allowed after 24 h\n' ELSE E'FAIL 31 non-identity edit blocked\n' END;
  RESET ROLE;

  -- =============== SUPERVISOR s1 (unit A + C) ===============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM incidents WHERE id IN (iA1,iA2,iC);
  rep := rep || CASE WHEN n=3 THEN E'PASS 32 supervisor reads own unit + explicitly granted unit\n' ELSE E'FAIL 32 supervisor sees '||n||E'/3\n' END;
  SELECT count(*) INTO n FROM incidents WHERE id = iB;
  rep := rep || CASE WHEN n=0 THEN E'PASS 33 supervisor cannot read an unauthorized unit\n' ELSE E'FAIL 33 supervisor read unit B\n' END;
  SELECT count(*) INTO n FROM offenders WHERE id = oB;
  rep := rep || CASE WHEN n=0 THEN E'PASS 34 supervisor cannot read unauthorized-unit offender PII\n' ELSE E'FAIL 34 supervisor read unit B offender\n' END;
  UPDATE incidents SET description='sup' WHERE id = iA2;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 35 supervisor edits an incident of their unit\n' ELSE E'FAIL 35 supervisor cannot edit own unit\n' END;
  UPDATE incidents SET description='sup' WHERE id = iB;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=0 THEN E'PASS 36 supervisor cannot edit an unauthorized unit\n' ELSE E'FAIL 36 supervisor edited unit B\n' END;
  BEGIN
    UPDATE incidents SET unit_id = uB WHERE id = iA2;
    rep := rep || E'FAIL 37 supervisor moved a record to another unit\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 37 supervisor cannot move a record to another unit\n'; END;
  UPDATE offenders SET cpf='12312312312' WHERE id = oA2;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 38 supervisor corrects identity data in their unit\n' ELSE E'FAIL 38 supervisor blocked\n' END;
  RESET ROLE;
  SELECT count(*) INTO n FROM audit_log WHERE entity_id = oA2 AND entity_type='offender' AND performed_by = s1
     AND new_data = '{"identity_fields_changed":["cpf"]}'::jsonb;
  rep := rep || CASE WHEN n=1 THEN E'PASS 39 identity change audited (field names only, no values)\n' ELSE E'FAIL 39 no audit row\n' END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',s1,'role','authenticated','app_metadata','{}'::json)::text, true);
  BEGIN
    UPDATE profiles SET role='administrator' WHERE id = s1;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || CASE WHEN n=0 THEN E'PASS 40 supervisor cannot promote self\n' ELSE E'FAIL 40 supervisor promoted self\n' END;
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 40 supervisor cannot promote self (42501)\n'; END;
  RESET ROLE;

  -- supervisor s2 (unit B only)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',s2,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM incidents WHERE id IN (iA1,iA2,iC);
  rep := rep || CASE WHEN n=0 THEN E'PASS 41 supervisor B sees nothing of units A/C\n' ELSE E'FAIL 41 supervisor B saw '||n||E'\n' END;
  SELECT count(*) INTO n FROM incidents WHERE id = iB;
  rep := rep || CASE WHEN n=1 THEN E'PASS 42 supervisor B sees unit B\n' ELSE E'FAIL 42 supervisor B blind to own unit\n' END;
  RESET ROLE;

  -- =============== ADMIN ===============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM incidents WHERE id IN (iA1,iA2,iB,iC);
  rep := rep || CASE WHEN n=4 THEN E'PASS 43 administrator reads every unit\n' ELSE E'FAIL 43 admin sees '||n||E'/4\n' END;
  SELECT count(*) INTO n FROM offenders WHERE id IN (oA1,oA2,oB);
  rep := rep || CASE WHEN n=3 THEN E'PASS 44 administrator reads every offender\n' ELSE E'FAIL 44 admin offenders '||n||E'/3\n' END;
  UPDATE incidents SET unit_id = uC WHERE id = iB;
  GET DIAGNOSTICS n = ROW_COUNT;
  rep := rep || CASE WHEN n=1 THEN E'PASS 45 administrator may re-assign unit\n' ELSE E'FAIL 45 admin cannot re-assign unit\n' END;
  BEGIN
    UPDATE profiles SET role='agent' WHERE id = adm;
    GET DIAGNOSTICS n = ROW_COUNT;
    rep := rep || CASE WHEN n=0 THEN E'PASS 46 admin cannot change own role via API\n' ELSE E'FAIL 46 admin changed own role\n' END;
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 46 admin cannot change own role via API (42501)\n'; END;
  BEGIN
    DELETE FROM offenders WHERE id = oA1;
    rep := rep || E'FAIL 47 admin hard-deleted via API\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 47 hard delete refused even for admin (soft delete = service role)\n'; END;
  RESET ROLE;

  -- =============== INACTIVE and must_change_password ===============
  PERFORM set_config('request.jwt.claims', json_build_object('sub',ina,'role','authenticated','app_metadata','{}'::json)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM incidents; SELECT n + count(*) INTO n FROM offenders;
  rep := rep || CASE WHEN n=0 THEN E'PASS 48 inactive/deleted user sees nothing\n' ELSE E'FAIL 48 inactive user sees '||n||E' rows\n' END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated','app_metadata',json_build_object('must_change_password',true))::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM incidents; SELECT n + count(*) INTO n FROM offenders; SELECT n + count(*) INTO n FROM photos;
  rep := rep || CASE WHEN n=0 THEN E'PASS 49 must_change_password user sees nothing\n' ELSE E'FAIL 49 must_change user sees '||n||E' rows\n' END;
  BEGIN
    INSERT INTO incidents (type,description,occurred_at,created_by) VALUES ('theft','x',now(),a1);
    rep := rep || E'FAIL 50 must_change user wrote\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 50 must_change_password user cannot write\n'; END;
  RESET ROLE;

  -- =============== anon (no JWT) ===============
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM 1 FROM offenders LIMIT 1;
    rep := rep || E'FAIL 51 anon reads offenders\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 51 anon has no access to offenders\n'; END;
  RESET ROLE;

  RAISE EXCEPTION E'REPORT (rolled back)\n%', rep;
END $$;
