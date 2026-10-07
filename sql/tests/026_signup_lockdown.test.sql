-- =============================================
-- SIGOP — test for 026_signup_lockdown.sql
-- Run AFTER 026 in the SQL Editor (or psql). Everything is rolled back: the DO
-- block always ends with an exception that carries the report, so no row
-- survives. Any line starting with FAIL means the bypass works.
-- =============================================
DO $$
DECLARE
  rep TEXT := '';
  v_id UUID;
  v_role TEXT;
  v_meta JSONB;
  base CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  tok  CONSTANT TEXT := repeat('ab', 32);
  tok2 CONSTANT TEXT := repeat('cd', 32);
BEGIN
  -- helper pattern: attempt an insert, record PASS if refused, FAIL if accepted.
  -- 1. public sign-up, self-declared admin in user_metadata
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'p1@t.invalid',
            '{"provider":"email"}', '{"role":"administrator","full_name":"x"}');
    rep := rep || E'FAIL 1 public signup accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 1 public signup refused\n'; END;

  -- 2. self-declared admin in app_metadata (not reachable publicly, still refused)
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'p2@t.invalid',
            '{"provider":"email","role":"administrator"}', '{}');
    rep := rep || E'FAIL 2 app_metadata role accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 2 app_metadata role without ticket refused\n'; END;

  -- 3. guessed token, no ticket
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'p3@t.invalid',
            '{"provider":"email"}', jsonb_build_object('provision_token', tok));
    rep := rep || E'FAIL 3 token without ticket accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 3 token without ticket refused\n'; END;

  -- 4. legitimate admin-flow user: ticket(agent) + attacker-style role=administrator in metadata
  INSERT INTO public.user_provisioning_tickets (token_hash, email, role)
  VALUES (sha256(convert_to(tok, 'UTF8')), 'ok@t.invalid', 'agent');
  v_id := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_id, base, 'authenticated', 'authenticated', 'ok@t.invalid',
          '{"provider":"email","must_change_password":true}',
          jsonb_build_object('role','administrator','full_name','Ok','provision_token', tok));
  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = v_id;
  rep := rep || CASE WHEN v_role = 'agent' THEN E'PASS 4a ticket role wins over metadata role\n'
                     ELSE E'FAIL 4a profile role=' || coalesce(v_role,'null') || E'\n' END;
  rep := rep || CASE WHEN NOT (v_meta ? 'provision_token') AND NOT (v_meta ? 'role')
                     THEN E'PASS 4b token and role stripped from stored metadata\n'
                     ELSE E'FAIL 4b metadata not sanitised\n' END;
  rep := rep || CASE WHEN (SELECT is_active FROM public.profiles WHERE id = v_id) IS NOT FALSE
                     THEN E'PASS 4c provisioned profile created (activation then gated by must_change_password flag)\n'
                     ELSE E'FAIL 4c\n' END;

  -- 5. replay of a consumed token
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'ok@t.invalid',
            '{"provider":"email"}', jsonb_build_object('provision_token', tok));
    rep := rep || E'FAIL 5 token replay accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 5 consumed token cannot be replayed\n'; END;

  -- 6. ticket for another e-mail
  INSERT INTO public.user_provisioning_tickets (token_hash, email, role)
  VALUES (sha256(convert_to(tok2, 'UTF8')), 'victim@t.invalid', 'administrator');
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'attacker@t.invalid',
            '{"provider":"email"}', jsonb_build_object('provision_token', tok2));
    rep := rep || E'FAIL 6 ticket reused for a different e-mail\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 6 ticket bound to its e-mail\n'; END;

  -- 7. expired ticket
  UPDATE public.user_provisioning_tickets SET expires_at = now() - interval '1 second'
  WHERE email = 'victim@t.invalid';
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), base, 'authenticated', 'authenticated', 'victim@t.invalid',
            '{"provider":"email"}', jsonb_build_object('provision_token', tok2));
    rep := rep || E'FAIL 7 expired ticket accepted\n';
  EXCEPTION WHEN insufficient_privilege THEN rep := rep || E'PASS 7 expired ticket refused\n'; END;

  -- 8. tickets are invisible/unwritable through the API roles
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM 1 FROM public.user_provisioning_tickets LIMIT 1;
      rep := rep || 'FAIL 8 ' || v_role || E' can read tickets\n';
    EXCEPTION WHEN insufficient_privilege THEN rep := rep || 'PASS 8 ' || v_role || E' cannot read tickets\n';
    END;
    RESET ROLE;
  END LOOP;

  RAISE EXCEPTION E'REPORT (rolled back)\n%', rep;
END $$;
