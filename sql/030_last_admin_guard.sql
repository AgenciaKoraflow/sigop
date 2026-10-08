-- =============================================
-- SIGOP — 030 last active administrator guard
-- Run in the Supabase SQL Editor AFTER 029_audit_integrity.sql
-- Naming standard: English (snake_case)
--
-- The system must never be left without a usable administrator. The Route
-- Handlers only blocked self-edits, so two administrators could demote /
-- deactivate / delete each other (or one could remove the last one) and nobody
-- could log in to /usuarios again. The rule is enforced here, in the database,
-- so it holds for EVERY writer: the service role (Route Handlers), PostgREST
-- under `profiles_admin_all`, and the SQL editor.
--
-- "Usable administrator" = role 'administrator', is_active, not soft-deleted,
-- and a login that exists and is not banned in auth.users.
--
-- Atomicity: any change that removes an administrator from that set first takes
-- a transaction-scoped advisory lock, then counts the OTHER usable
-- administrators. Two concurrent demotions serialise on the lock; the second
-- one re-counts after the first committed (READ COMMITTED gives every
-- statement inside the function a fresh snapshot) and is refused.
-- The lock is held until commit/rollback, so there is no window between the
-- check and the write.
--
-- Violation: SQLSTATE P0001, message 'last_active_administrator'.
-- Idempotent.
-- =============================================

CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was_admin  BOOLEAN;
  v_stays      BOOLEAN;
BEGIN
  v_was_admin := OLD.role = 'administrator'
                 AND COALESCE(OLD.is_active, TRUE)
                 AND OLD.deleted_at IS NULL;

  IF NOT v_was_admin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_stays := NEW.role = 'administrator'
               AND COALESCE(NEW.is_active, TRUE)
               AND NEW.deleted_at IS NULL;
    -- Same row, same id: still an administrator afterwards.
    IF v_stays AND NEW.id = OLD.id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- The row stops being a usable administrator (demoted, deactivated,
  -- soft-deleted, id changed or deleted). Serialise with every other such change.
  PERFORM pg_advisory_xact_lock(hashtext('sigop.last_active_administrator'));

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id <> OLD.id
      AND p.role = 'administrator'
      AND COALESCE(p.is_active, TRUE)
      AND p.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'last_active_administrator'
      USING ERRCODE = 'P0001',
            HINT = 'There must always be at least one active administrator. Promote or activate another one first.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_last_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_profiles_b_last_admin ON public.profiles;
CREATE TRIGGER tr_profiles_b_last_admin
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();
