-- =============================================
-- SIGOP — 033 Provisional credentials vault (bulk access export)
-- Run in the Supabase SQL Editor AFTER 032_session_alive.sql
-- Naming standard: English (snake_case)
--
-- Why: the admin needs a spreadsheet of the accesses created in a period
-- (system link, login, provisional password). Supabase only keeps the bcrypt
-- hash, so the provisional password is stored here — ENCRYPTED by the server
-- (AES-256-GCM, key in PROVISIONAL_CREDENTIALS_KEY, never in the database) —
-- and deleted the moment the user sets a permanent password
-- (change-password / reset-password routes) or the account is removed.
--
-- Only the service role can touch the table (RLS on, no policies, no grants).
-- Idempotent.
-- =============================================

CREATE TABLE IF NOT EXISTS public.provisional_credentials (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_enc TEXT NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provisional_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provisional_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.provisional_credentials TO service_role;

-- The export is itself an auditable event (it hands out credentials in bulk).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN ('incident', 'offender', 'user_password', 'credentials_export'));
