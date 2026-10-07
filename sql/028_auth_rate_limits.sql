-- =============================================
-- SIGOP — 028 Auth rate limits + reset-code binding
-- Run in the Supabase SQL Editor AFTER 027. Idempotent.
--
-- 1. auth_rate_limits: atomic fixed-window counters used by the password
--    reset / change endpoints. Keys are HMACs (no raw e-mail or IP is stored).
-- 2. auth_rate_limit_hit(): bumps an ORDERED list of buckets in one atomic
--    statement per bucket (INSERT .. ON CONFLICT DO UPDATE), narrow -> wide.
--    It stops at the first denied bucket, so a caller that is already blocked
--    on its own IP / IP+identifier buckets can no longer drain the shared
--    per-identifier bucket. That ordering is what stops an attacker from
--    locking the victim out of the e-mail's shared budget from one machine.
-- 3. password_reset_codes.binding_hash: the code is only redeemable from the
--    browser that requested it (HttpOnly cookie). Third parties cannot burn
--    the victim's 5 attempts, and a code requested by an attacker for the
--    victim's address is useless to the attacker's own session at the token step.
-- =============================================

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket       TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auth_rate_limit_hit(
  p_buckets TEXT[],
  p_limits  INTEGER[],
  p_windows INTEGER[]
)
RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  i       INTEGER;
  v_epoch DOUBLE PRECISION := extract(epoch FROM clock_timestamp());
  v_start TIMESTAMPTZ;
  v_hits  INTEGER;
BEGIN
  IF p_buckets IS NULL
     OR coalesce(array_length(p_buckets, 1), 0) = 0
     OR array_length(p_buckets, 1) <> coalesce(array_length(p_limits, 1), -1)
     OR array_length(p_buckets, 1) <> coalesce(array_length(p_windows, 1), -1) THEN
    RAISE EXCEPTION 'auth_rate_limit_hit: mismatched arguments';
  END IF;

  FOR i IN 1 .. array_length(p_buckets, 1) LOOP
    IF p_windows[i] < 1 OR p_limits[i] < 0 THEN
      RAISE EXCEPTION 'auth_rate_limit_hit: invalid limit or window';
    END IF;

    v_start := to_timestamp(floor(v_epoch / p_windows[i]) * p_windows[i]);

    INSERT INTO public.auth_rate_limits AS r (bucket, window_start, hits)
    VALUES (p_buckets[i], v_start, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
    RETURNING r.hits INTO v_hits;

    IF v_hits > p_limits[i] THEN
      -- Opportunistic cleanup keeps the table small without a scheduler.
      IF random() < 0.01 THEN
        DELETE FROM public.auth_rate_limits WHERE window_start < now() - INTERVAL '2 days';
        DELETE FROM public.password_reset_codes WHERE created_at < now() - INTERVAL '7 days';
      END IF;
      RETURN QUERY SELECT FALSE,
        GREATEST(1, ceil(extract(epoch FROM (v_start + make_interval(secs => p_windows[i]) - clock_timestamp()))))::INTEGER;
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT TRUE, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_rate_limit_hit(TEXT[], INTEGER[], INTEGER[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_rate_limit_hit(TEXT[], INTEGER[], INTEGER[]) TO service_role;

-- ---------------------------------------------
-- Reset codes bound to the requesting browser.
-- ---------------------------------------------
ALTER TABLE public.password_reset_codes ADD COLUMN IF NOT EXISTS binding_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_password_reset_binding
  ON public.password_reset_codes (email, binding_hash, created_at DESC)
  WHERE binding_hash IS NOT NULL;

-- Old rows (no binding) can no longer be redeemed: drop them from circulation.
UPDATE public.password_reset_codes
   SET consumed_at = now()
 WHERE binding_hash IS NULL AND consumed_at IS NULL;
