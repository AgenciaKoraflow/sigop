-- =============================================
-- 018: login_events — one row per password sign-in
-- =============================================
-- Supabase Auth only keeps the LAST sign-in (auth.users.last_sign_in_at), so the
-- /usuarios dashboard (ranking de acessos, logins por dia) needs its own log.
-- Written by POST /api/auth/login-event (service-role); read by
-- GET /api/usuarios/stats (service-role). No client policy on purpose:
-- RLS enabled + no policies = browser clients can neither read nor write it.

CREATE TABLE IF NOT EXISTS login_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_at   ON login_events(logged_at DESC);

ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;

-- Backfill: one approximate event per user from their last known sign-in, so the
-- ranking does not start empty. Real counting starts when this migration ships.
INSERT INTO login_events (user_id, logged_at)
SELECT p.id, u.last_sign_in_at
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.last_sign_in_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM login_events e WHERE e.user_id = p.id);
