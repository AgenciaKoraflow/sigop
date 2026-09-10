-- =============================================
-- SIGOP — 007 Municipalities and territorial areas (AT)
-- Run in the Supabase SQL Editor AFTER 006_profiles_email.sql
-- Naming standard: English (snake_case) — see 003 header note.
--
-- Adds a two-level operational geography the incident form can point at:
--   municipalities        -> a city
--   territorial_areas (AT) -> a subdivision that belongs to one municipality
-- Both new incident columns are optional (the form leaves them blank by
-- default). Lookup tables are readable by any signed-in user and writable only
-- by administrators, mirroring `units`.
-- =============================================

-- ---------------------------------------------------------------------------
-- 1. Lookup tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS municipalities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  state      TEXT,                       -- UF, e.g. 'SP'
  code       TEXT UNIQUE,                -- optional IBGE / internal code
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name, state)
);

CREATE TABLE IF NOT EXISTS territorial_areas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (municipality_id, name)
);

CREATE INDEX IF NOT EXISTS idx_territorial_areas_municipality
  ON territorial_areas(municipality_id);

-- ---------------------------------------------------------------------------
-- 2. Incident columns (optional)
-- ---------------------------------------------------------------------------
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS municipality_id    UUID REFERENCES municipalities(id),
  ADD COLUMN IF NOT EXISTS territorial_area_id UUID REFERENCES territorial_areas(id);

CREATE INDEX IF NOT EXISTS idx_incidents_municipality
  ON incidents(municipality_id);
CREATE INDEX IF NOT EXISTS idx_incidents_territorial_area
  ON incidents(territorial_area_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security (mirrors the `units` policies in 003)
-- ---------------------------------------------------------------------------
ALTER TABLE municipalities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE territorial_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "municipalities_select_all" ON municipalities;
CREATE POLICY "municipalities_select_all" ON municipalities
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "municipalities_insert_admin" ON municipalities;
CREATE POLICY "municipalities_insert_admin" ON municipalities
  FOR INSERT WITH CHECK (my_role() = 'administrator');

DROP POLICY IF EXISTS "municipalities_update_admin" ON municipalities;
CREATE POLICY "municipalities_update_admin" ON municipalities
  FOR UPDATE USING (my_role() = 'administrator');

DROP POLICY IF EXISTS "territorial_areas_select_all" ON territorial_areas;
CREATE POLICY "territorial_areas_select_all" ON territorial_areas
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "territorial_areas_insert_admin" ON territorial_areas;
CREATE POLICY "territorial_areas_insert_admin" ON territorial_areas
  FOR INSERT WITH CHECK (my_role() = 'administrator');

DROP POLICY IF EXISTS "territorial_areas_update_admin" ON territorial_areas;
CREATE POLICY "territorial_areas_update_admin" ON territorial_areas
  FOR UPDATE USING (my_role() = 'administrator');

-- ---------------------------------------------------------------------------
-- 4. Seed data — municipalities and their territorial areas
--    (populated in 008_territorial_areas_seed.sql)
-- ---------------------------------------------------------------------------
