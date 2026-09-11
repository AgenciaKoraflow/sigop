-- =============================================
-- SIGOP — 011 Contractors (Contratada)
-- Run in the Supabase SQL Editor AFTER 010_merge_stops_into_incidents.sql
-- Naming standard: English (snake_case) — see 003 header note.
--
-- Adds the "Contratada" dimension used by the incident form's 3-level
-- cascade: Contratada -> Município da AT -> AT. Contractor lives on
-- `territorial_areas`, NOT on `municipalities`: a município can have ATs
-- belonging to different contractors (e.g. São Paulo city is split across
-- several contractors, one per neighborhood cluster), so the AT is the
-- correct place to anchor the relationship. `contractor_id` is nullable —
-- pre-existing territorial areas that the 012 seed doesn't match simply stay
-- unassigned (still valid on historical incidents, just invisible to the new
-- cascade). No changes to `incidents` are needed: the form only ever
-- persists `territorial_area_id`, exactly as before.
-- =============================================

CREATE TABLE IF NOT EXISTS contractors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE territorial_areas
  ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES contractors(id);

CREATE INDEX IF NOT EXISTS idx_territorial_areas_contractor
  ON territorial_areas(contractor_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (mirrors `municipalities`/`units` in 001/007)
-- ---------------------------------------------------------------------------
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractors_select_all" ON contractors;
CREATE POLICY "contractors_select_all" ON contractors
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "contractors_insert_admin" ON contractors;
CREATE POLICY "contractors_insert_admin" ON contractors
  FOR INSERT WITH CHECK (my_role() = 'administrator');

DROP POLICY IF EXISTS "contractors_update_admin" ON contractors;
CREATE POLICY "contractors_update_admin" ON contractors
  FOR UPDATE USING (my_role() = 'administrator');
