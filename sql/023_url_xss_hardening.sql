-- =============================================
-- SIGOP — 023 URL / XSS hardening (database-side URL allowlists)
-- Run in the Supabase SQL Editor AFTER 022_authz_hardening.sql
-- Naming standard: English (snake_case)
--
-- Finding: `incidents.gmaps_link` was free text rendered as <a href>. A signed-in
-- user calling PostgREST directly (skipping the form) could store
-- `javascript:...` and run script in a colleague's session (stored XSS).
-- Same class of risk for the legacy URL columns rendered as <img src>.
--
-- The UI validates too (lib/utils/safe-url.ts) but the database is the source
-- of truth. Idempotent. Existing offending values are nulled first so the
-- constraints can be validated.
-- =============================================

-- 1. Neutralize existing bad data.
UPDATE public.incidents
   SET gmaps_link = NULL
 WHERE gmaps_link IS NOT NULL
   AND gmaps_link !~* '^https://([a-z0-9-]+\.)*(google\.com|google\.com\.br|goo\.gl|g\.co)(/|\?|#|$)'
   AND gmaps_link !~* '^https://maps\.app\.goo\.gl(/|\?|#|$)';

UPDATE public.offenders
   SET main_photo_url = NULL
 WHERE main_photo_url IS NOT NULL
   AND main_photo_url !~* '^https://[^[:space:]]+$'
   AND main_photo_url !~ '^[A-Za-z0-9_-][A-Za-z0-9_./-]*$';

UPDATE public.profiles
   SET photo_url = NULL
 WHERE photo_url IS NOT NULL
   AND photo_url !~* '^https://[^[:space:]]+$'
   AND photo_url !~ '^[A-Za-z0-9_-][A-Za-z0-9_./-]*$';

-- 2. Constraints.
--    gmaps_link: https only, Google Maps hosts, no whitespace/control chars,
--    no userinfo ('@' before the first '/').
ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_gmaps_link_safe;
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_gmaps_link_safe CHECK (
    gmaps_link IS NULL
    OR (
      length(gmaps_link) <= 2048
      AND gmaps_link ~* '^https://([a-z0-9-]+\.)*(google\.com|google\.com\.br|goo\.gl|g\.co)(/|\?|#|$)'
      AND gmaps_link !~ '[[:space:][:cntrl:]]'
    )
  );

--    photo columns: https URL, or a bare storage path (no scheme / colon).
ALTER TABLE public.offenders DROP CONSTRAINT IF EXISTS offenders_main_photo_url_safe;
ALTER TABLE public.offenders
  ADD CONSTRAINT offenders_main_photo_url_safe CHECK (
    main_photo_url IS NULL
    OR main_photo_url ~* '^https://[^[:space:]]+$'
    OR main_photo_url ~ '^[A-Za-z0-9_-][A-Za-z0-9_./-]*$'
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_photo_url_safe;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_photo_url_safe CHECK (
    photo_url IS NULL
    OR photo_url ~* '^https://[^[:space:]]+$'
    OR photo_url ~ '^[A-Za-z0-9_-][A-Za-z0-9_./-]*$'
  );
