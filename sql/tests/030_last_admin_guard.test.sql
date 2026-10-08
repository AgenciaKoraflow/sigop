-- =============================================
-- SIGOP — test for 030_last_admin_guard.sql
-- Run in the SQL editor / psql on a DEV or BRANCH database (as postgres).
-- Everything happens inside one transaction that is ROLLED BACK at the end;
-- any failed expectation aborts with an exception. Final notice: 'ALL PASSED'.
--
-- Sequential cases only. The concurrent case is lib/usuarios/last-admin.integration.test.ts.
-- =============================================
BEGIN;

-- Fixtures bypass the sign-up triggers (session_replication_role = replica
-- disables every trigger, including the guard under test).
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET role = 'agent' WHERE role = 'administrator';

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'adm1@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'adm2@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'agent@test.invalid', 'authenticated', 'authenticated');
INSERT INTO public.profiles (id, full_name, role, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Admin 1', 'administrator', 'adm1@test.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'Admin 2', 'administrator', 'adm2@test.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'Agent',   'agent',         'agent@test.invalid');

-- Start every scenario with exactly ONE admin (a2 parked as supervisor).
UPDATE public.profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-0000000000a2';
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE _t (name text, ok boolean) ON COMMIT DROP;

-- expect(sql, must_fail): runs a statement, records whether the guard fired as expected.
CREATE OR REPLACE FUNCTION pg_temp.expect(p_name text, p_sql text, p_must_fail boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_failed boolean := FALSE;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'last_active_administrator';
    IF NOT v_failed THEN RAISE; END IF;
  END;
  INSERT INTO _t VALUES (p_name, v_failed = p_must_fail);
END $$;

-- ===== 1 admin (a1) =====
SELECT pg_temp.expect('1 admin: demote',        $q$UPDATE public.profiles SET role='agent' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
SELECT pg_temp.expect('1 admin: deactivate',    $q$UPDATE public.profiles SET is_active=FALSE WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
SELECT pg_temp.expect('1 admin: soft delete',   $q$UPDATE public.profiles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
SELECT pg_temp.expect('1 admin: delete row',    $q$DELETE FROM public.profiles WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
SELECT pg_temp.expect('1 admin: delete auth user (cascade)', $q$DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
SELECT pg_temp.expect('1 admin: ban login',     $q$UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, FALSE); -- auth.users is not guarded; see below
UPDATE auth.users SET banned_until = NULL WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('1 admin: edit name is fine', $q$UPDATE public.profiles SET full_name='Admin One' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, FALSE);
SELECT pg_temp.expect('1 admin: demoting a non-admin is fine', $q$UPDATE public.profiles SET role='agent' WHERE id='00000000-0000-0000-0000-0000000000a2'$q$, FALSE);
SELECT pg_temp.expect('1 admin: promote agent is fine', $q$UPDATE public.profiles SET role='administrator' WHERE id='00000000-0000-0000-0000-0000000000b1'$q$, FALSE);

-- ===== 2 admins (a1, b1) =====
SELECT pg_temp.expect('2 admins: a1 demotes b1',  $q$UPDATE public.profiles SET role='agent' WHERE id='00000000-0000-0000-0000-0000000000b1'$q$, FALSE);
-- back to one admin (a1): the second demotion must now fail
SELECT pg_temp.expect('2 admins, 2nd demotion refused', $q$UPDATE public.profiles SET role='agent' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);

-- ===== banned peer does not count as usable =====
UPDATE public.profiles SET role='administrator' WHERE id='00000000-0000-0000-0000-0000000000b1';
UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('only other admin is banned: demote refused', $q$UPDATE public.profiles SET role='agent' WHERE id='00000000-0000-0000-0000-0000000000a1'$q$, TRUE);
UPDATE auth.users SET banned_until = NULL WHERE id = '00000000-0000-0000-0000-0000000000b1';

-- ===== admin acting on another admin / hard delete when 2 exist =====
SELECT pg_temp.expect('admin deletes other admin when 2 exist', $q$DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-0000000000b1'$q$, FALSE);

DO $$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN SELECT * FROM _t LOOP
    RAISE NOTICE '% : %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
    IF NOT r.ok THEN bad := bad + 1; END IF;
  END LOOP;
  IF bad > 0 THEN RAISE EXCEPTION '% expectation(s) failed', bad; END IF;
  RAISE NOTICE 'ALL PASSED';
END $$;

ROLLBACK;
