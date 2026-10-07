-- =============================================
-- SIGOP — 021 Function hardening (security advisor findings)
-- Run in the Supabase SQL Editor AFTER 020_auth_hardening.sql
--
--   * pin search_path on the functions the advisor flagged as mutable
--     (005 was never applied to the remote project)
--   * anon can no longer execute SECURITY DEFINER functions through
--     /rest/v1/rpc; trigger functions are not callable by API roles at all
-- Not touched: the `unaccent` extension stays in `public` — moving it would
-- break search_offenders. Idempotent.
-- =============================================

ALTER FUNCTION public.set_updated_at()           SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_version()        SET search_path = public, pg_temp;
ALTER FUNCTION public.search_offenders(text)     SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_internal_number() SET search_path = public, pg_temp;

-- Helpers used by RLS and the app: signed-in users only.
REVOKE EXECUTE ON FUNCTION public.my_role()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_unit()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_offenders(text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_role()                 TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.my_unit()                 TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.search_offenders(text)    TO authenticated, service_role;

-- Trigger functions: Postgres does not check EXECUTE when a trigger fires.
REVOKE EXECUTE ON FUNCTION public.set_incident_agent_name()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_incidents_agent_name() FROM PUBLIC, anon, authenticated;
