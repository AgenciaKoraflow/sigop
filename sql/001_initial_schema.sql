-- =============================================
-- SIGOP — Initial schema
-- Run in the Supabase SQL Editor
-- Naming standard: English (snake_case)
-- =============================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- =============================================
-- TABLE: units
-- =============================================
CREATE TABLE units (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  code       TEXT UNIQUE,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: profiles (extends auth.users)
-- =============================================
CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  badge_number TEXT UNIQUE,
  role         TEXT NOT NULL DEFAULT 'agent'
               CHECK (role IN ('agent', 'supervisor', 'administrator')),
  is_active    BOOLEAN DEFAULT TRUE,
  photo_url    TEXT,
  unit_id      UUID REFERENCES units(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: incidents
-- =============================================
CREATE TABLE incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_number  TEXT UNIQUE,
  type             TEXT NOT NULL CHECK (type IN (
                     'theft','robbery','vandalism','in_flagrante','suspicious','other'
                   )),
  subtype          TEXT,
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                     'open','in_progress','closed','archived'
                   )),
  occurred_at      TIMESTAMPTZ NOT NULL,
  address_street   TEXT,
  address_number   TEXT,
  address_district TEXT,
  address_city     TEXT,
  address_state    TEXT,
  address_zip      TEXT,
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  gmaps_link       TEXT,
  unit_id          UUID REFERENCES units(id),
  created_by       UUID NOT NULL REFERENCES profiles(id),
  updated_by       UUID REFERENCES profiles(id),
  version          INTEGER NOT NULL DEFAULT 1,
  synced_at        TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: offenders
-- =============================================
CREATE TABLE offenders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            TEXT,
  social_name          TEXT,
  nickname             TEXT,
  birth_date           DATE,
  cpf                  TEXT,
  rg                   TEXT,
  gender               TEXT,
  height_m             NUMERIC(4,2),
  weight_kg            NUMERIC(5,2),
  skin_color           TEXT,
  eye_color            TEXT,
  hair_color           TEXT,
  distinguishing_marks TEXT,
  physical_description TEXT,
  main_photo_url       TEXT,
  created_by           UUID NOT NULL REFERENCES profiles(id),
  updated_by           UUID REFERENCES profiles(id),
  version              INTEGER NOT NULL DEFAULT 1,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: stops (field stops / approaches)
-- =============================================
CREATE TABLE stops (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL CHECK (type IN ('stop','in_flagrante')),
  description      TEXT NOT NULL,
  stopped_at       TIMESTAMPTZ NOT NULL,
  outcome          TEXT CHECK (outcome IN (
                     'released','detained','referred_to_police_station','items_seized','other'
                   )),
  notes            TEXT,
  address_street   TEXT,
  address_district TEXT,
  address_city     TEXT,
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  incident_id      UUID REFERENCES incidents(id),
  created_by       UUID NOT NULL REFERENCES profiles(id),
  updated_by       UUID REFERENCES profiles(id),
  unit_id          UUID REFERENCES units(id),
  version          INTEGER NOT NULL DEFAULT 1,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: incident_offenders (N:N)
-- =============================================
CREATE TABLE incident_offenders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  offender_id UUID NOT NULL REFERENCES offenders(id) ON DELETE CASCADE,
  role        TEXT CHECK (role IN ('suspect','perpetrator','victim','witness')),
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(incident_id, offender_id)
);

-- =============================================
-- TABLE: stop_offenders (N:N)
-- =============================================
CREATE TABLE stop_offenders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id     UUID NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  offender_id UUID NOT NULL REFERENCES offenders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stop_id, offender_id)
);

-- =============================================
-- TABLE: photos
-- =============================================
CREATE TABLE photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path   TEXT NOT NULL,
  public_url     TEXT,
  thumbnail_path TEXT,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('incident','stop','offender')),
  entity_id      UUID NOT NULL,
  description    TEXT,
  sort_order     INTEGER DEFAULT 0,
  size_bytes     INTEGER,
  mime_type      TEXT,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: audit_log (immutable)
-- =============================================
CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL,
  entity_id         UUID NOT NULL,
  operation         TEXT NOT NULL CHECK (operation IN (
                      'create','update','delete','sync','conflict_resolved'
                    )),
  previous_version  INTEGER,
  new_version       INTEGER,
  previous_data     JSONB,
  new_data          JSONB,
  source_ip         TEXT,
  user_agent        TEXT,
  performed_by      UUID REFERENCES profiles(id),
  performed_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Performance indexes
-- =============================================
CREATE INDEX idx_incidents_created_by  ON incidents(created_by);
CREATE INDEX idx_incidents_unit        ON incidents(unit_id);
CREATE INDEX idx_incidents_type        ON incidents(type);
CREATE INDEX idx_incidents_status      ON incidents(status);
CREATE INDEX idx_incidents_occurred_at ON incidents(occurred_at DESC);
CREATE INDEX idx_incidents_deleted_at  ON incidents(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_stops_created_by      ON stops(created_by);
CREATE INDEX idx_stops_incident        ON stops(incident_id);
CREATE INDEX idx_offenders_full_name   ON offenders USING gin(to_tsvector('portuguese', coalesce(full_name,'')));
CREATE INDEX idx_offenders_nickname    ON offenders(nickname);
CREATE INDEX idx_photos_entity         ON photos(entity_type, entity_id);
CREATE INDEX idx_audit_log_entity      ON audit_log(entity_type, entity_id);
