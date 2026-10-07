-- Tests for sql/028_auth_rate_limits.sql. Run AFTER 028 (or paste 028 above this
-- block in the same statement). Everything is rolled back: the final RAISE
-- aborts the transaction and prints the report.
DO $$
DECLARE
  rep TEXT := '';
  r   RECORD;
  i   INTEGER;
  n   INTEGER;
  v_id UUID;
  b_victim   CONSTANT TEXT := 'bind-victim';
  b_attacker CONSTANT TEXT := 'bind-attacker';
BEGIN
  -- 1. a bucket allows exactly `limit` hits, then denies with a retry hint
  FOR i IN 1..3 LOOP
    SELECT * INTO r FROM public.auth_rate_limit_hit(ARRAY['t:a'], ARRAY[3], ARRAY[3600]);
    IF NOT r.allowed THEN rep := rep || E'FAIL 1a hit ' || i || E' denied early\n'; END IF;
  END LOOP;
  SELECT * INTO r FROM public.auth_rate_limit_hit(ARRAY['t:a'], ARRAY[3], ARRAY[3600]);
  rep := rep || CASE WHEN NOT r.allowed AND r.retry_after BETWEEN 1 AND 3600
    THEN E'PASS 1 limit enforced, retry_after=' || r.retry_after || E'\n'
    ELSE E'FAIL 1 4th hit allowed=' || r.allowed || E'\n' END;

  -- 2. narrow -> wide: a caller denied on its own bucket does NOT drain the
  --    shared per-address bucket (attacker from one IP cannot lock the victim)
  FOR i IN 1..20 LOOP  -- attacker IP+email bucket (limit 3), then shared e-mail bucket
    PERFORM public.auth_rate_limit_hit(
      ARRAY['t:ipe:attacker', 't:e:victim'], ARRAY[3, 10], ARRAY[3600, 3600]);
  END LOOP;
  SELECT hits INTO n FROM public.auth_rate_limits WHERE bucket = 't:e:victim';
  rep := rep || CASE WHEN n = 3
    THEN E'PASS 2 20 attacker requests consumed only 3 of the shared e-mail budget\n'
    ELSE E'FAIL 2 shared bucket drained to ' || coalesce(n::text, 'null') || E'\n' END;
  SELECT * INTO r FROM public.auth_rate_limit_hit(
    ARRAY['t:ipe:victim', 't:e:victim'], ARRAY[3, 10], ARRAY[3600, 3600]);
  rep := rep || CASE WHEN r.allowed THEN E'PASS 2b victim (other IP) still allowed\n'
    ELSE E'FAIL 2b victim blocked by attacker\n' END;

  -- 3. many IPs together CAN exhaust the shared bucket (documented residual risk)
  FOR i IN 1..4 LOOP
    PERFORM public.auth_rate_limit_hit(
      ARRAY['t:ipe:bot' || i, 't:e:victim'], ARRAY[3, 10], ARRAY[3600, 3600]);
  END LOOP;
  SELECT hits INTO n FROM public.auth_rate_limits WHERE bucket = 't:e:victim';
  rep := rep || E'INFO 3 shared e-mail bucket after 4 more IPs: ' || n || E'/10\n';

  -- 4. different buckets are independent
  SELECT * INTO r FROM public.auth_rate_limit_hit(ARRAY['t:other'], ARRAY[1], ARRAY[60]);
  rep := rep || CASE WHEN r.allowed THEN E'PASS 4 independent bucket allowed\n'
    ELSE E'FAIL 4\n' END;

  -- 5. window is aligned (fixed window) and invalid input is refused
  BEGIN
    PERFORM public.auth_rate_limit_hit(ARRAY['t:x'], ARRAY[1], ARRAY[0]);
    rep := rep || E'FAIL 5 zero window accepted\n';
  EXCEPTION WHEN raise_exception THEN rep := rep || E'PASS 5 zero window refused\n'; END;
  BEGIN
    PERFORM public.auth_rate_limit_hit(ARRAY['t:x', 't:y'], ARRAY[1], ARRAY[60]);
    rep := rep || E'FAIL 5b mismatched arrays accepted\n';
  EXCEPTION WHEN raise_exception THEN rep := rep || E'PASS 5b mismatched arrays refused\n'; END;

  -- 6. API roles can neither call the RPC nor read the counters
  DECLARE role_name TEXT; BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', role_name);
        PERFORM public.auth_rate_limit_hit(ARRAY['t:z'], ARRAY[1], ARRAY[60]);
        rep := rep || 'FAIL 6 ' || role_name || E' can call the RPC\n';
      EXCEPTION WHEN insufficient_privilege THEN
        rep := rep || 'PASS 6 ' || role_name || E' cannot call the RPC\n';
      END;
      RESET ROLE;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', role_name);
        PERFORM 1 FROM public.auth_rate_limits LIMIT 1;
        rep := rep || 'FAIL 6b ' || role_name || E' can read counters\n';
      EXCEPTION WHEN insufficient_privilege THEN
        rep := rep || 'PASS 6b ' || role_name || E' cannot read counters\n';
      END;
      RESET ROLE;
    END LOOP;
  END;

  -- 7. reset codes: attempts are capped at 5, atomically
  INSERT INTO public.password_reset_codes (email, code_hash, binding_hash, expires_at)
  VALUES ('v@t.invalid', 'aa', b_victim, now() + interval '10 minutes') RETURNING id INTO v_id;
  FOR i IN 1..5 LOOP
    SELECT public.bump_password_reset_attempt(v_id) INTO n;
    IF n IS DISTINCT FROM i THEN rep := rep || E'FAIL 7 attempt ' || i || ' returned ' || coalesce(n::text,'null') || E'\n'; END IF;
  END LOOP;
  SELECT public.bump_password_reset_attempt(v_id) INTO n;
  rep := rep || CASE WHEN n IS NULL THEN E'PASS 7 6th attempt refused\n' ELSE E'FAIL 7 6th attempt allowed\n' END;

  -- 8. expired / consumed / token-issued codes cannot be attempted
  INSERT INTO public.password_reset_codes (email, code_hash, binding_hash, expires_at)
  VALUES ('v@t.invalid', 'aa', b_victim, now() - interval '1 second') RETURNING id INTO v_id;
  rep := rep || CASE WHEN public.bump_password_reset_attempt(v_id) IS NULL
    THEN E'PASS 8a expired code refused\n' ELSE E'FAIL 8a expired code attempted\n' END;
  INSERT INTO public.password_reset_codes (email, code_hash, binding_hash, expires_at, consumed_at)
  VALUES ('v@t.invalid', 'aa', b_victim, now() + interval '10 minutes', now()) RETURNING id INTO v_id;
  rep := rep || CASE WHEN public.bump_password_reset_attempt(v_id) IS NULL
    THEN E'PASS 8b reused (consumed) code refused\n' ELSE E'FAIL 8b consumed code attempted\n' END;

  -- 9. binding: the attacker's browser sees none of the victim's live codes, so
  --    its attempts cannot burn them
  INSERT INTO public.password_reset_codes (email, code_hash, binding_hash, expires_at)
  VALUES ('v@t.invalid', 'bb', b_victim, now() + interval '10 minutes'),
         ('v@t.invalid', 'cc', b_attacker, now() + interval '10 minutes');
  SELECT count(*) INTO n FROM public.password_reset_codes
   WHERE email = 'v@t.invalid' AND binding_hash = b_attacker
     AND code_hash = 'bb';
  rep := rep || CASE WHEN n = 0 THEN E'PASS 9 attacker binding cannot reach the victim code row\n'
    ELSE E'FAIL 9 binding leaks\n' END;

  RAISE EXCEPTION E'REPORT (rolled back)\n%', rep;
END $$;
