-- =============================================
-- incidents.agent_name
-- Denormalized copy of profiles.full_name for the agent who registered the
-- incident (created_by). Kept in sync by triggers so external monitoring
-- (dashboards, BI, n8n) can read the agent's name straight from incidents
-- without joining profiles.
-- =============================================

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Maintaining agent_name is not an edit of the incident: callers set
-- sigop.skip_row_touch (transaction-local) so version/updated_at stay put and
-- offline drafts don't see phantom sync conflicts.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('sigop.skip_row_touch', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('sigop.skip_row_touch', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fill agent_name from the creator's profile on insert / when created_by changes.
CREATE OR REPLACE FUNCTION set_incident_agent_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT full_name INTO NEW.agent_name
    FROM profiles
   WHERE id = NEW.created_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_incidents_agent_name ON incidents;
CREATE TRIGGER tr_incidents_agent_name
  BEFORE INSERT OR UPDATE OF created_by ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_incident_agent_name();

-- Propagate profile renames to the agent's incidents.
CREATE OR REPLACE FUNCTION sync_incidents_agent_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('sigop.skip_row_touch', 'on', true);
  UPDATE incidents
     SET agent_name = NEW.full_name
   WHERE created_by = NEW.id;
  PERFORM set_config('sigop.skip_row_touch', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_profiles_sync_incidents_agent_name ON profiles;
CREATE TRIGGER tr_profiles_sync_incidents_agent_name
  AFTER UPDATE OF full_name ON profiles
  FOR EACH ROW
  WHEN (OLD.full_name IS DISTINCT FROM NEW.full_name)
  EXECUTE FUNCTION sync_incidents_agent_name();

-- Backfill existing incidents without bumping version/updated_at.
SELECT set_config('sigop.skip_row_touch', 'on', true);
UPDATE incidents i
   SET agent_name = p.full_name
  FROM profiles p
 WHERE p.id = i.created_by
   AND i.agent_name IS DISTINCT FROM p.full_name;
SELECT set_config('sigop.skip_row_touch', 'off', true);
