-- Phase 31: Prospect Management
-- Territory assignment, prospect categories, and prospects table

BEGIN;

-- 1. Territory fields on tenants
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_lat DOUBLE PRECISION;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_lng DOUBLE PRECISION;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_radius_km INTEGER DEFAULT 25;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_address VARCHAR(500);

-- 2. Prospect categories (Google Places types to search)
CREATE TABLE IF NOT EXISTS sys_prospect_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_type VARCHAR(100) NOT NULL UNIQUE,
  label VARCHAR(200) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default wellness/recovery categories
INSERT INTO sys_prospect_categories (google_type, label) VALUES
  ('spa', 'Spa'),
  ('gym', 'Gym / Fitness Center'),
  ('yoga_studio', 'Yoga Studio'),
  ('physiotherapist', 'Physiotherapist'),
  ('health', 'Health & Wellness'),
  ('beauty_salon', 'Beauty Salon'),
  ('hair_care', 'Hair Care'),
  ('massage', 'Massage Therapy'),
  ('pilates_studio', 'Pilates Studio'),
  ('personal_trainer', 'Personal Trainer')
ON CONFLICT (google_type) DO NOTHING;

-- 3. Prospects table
CREATE TABLE IF NOT EXISTS prp_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  google_place_id VARCHAR(300),
  name VARCHAR(300) NOT NULL,
  address VARCHAR(500),
  phone VARCHAR(50),
  website VARCHAR(500),
  category VARCHAR(100),
  rating NUMERIC(2,1),
  review_count INTEGER DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'demo_scheduled', 'signed', 'declined', 'dismissed')),
  notes TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'manual')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_status_change TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prp_prospects_tenant ON prp_prospects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prp_prospects_status ON prp_prospects(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_prp_prospects_google_id ON prp_prospects(tenant_id, google_place_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prp_prospects_unique_place ON prp_prospects(tenant_id, google_place_id) WHERE google_place_id IS NOT NULL;

-- 4. Prospect generation log (track when lists were generated/refreshed)
CREATE TABLE IF NOT EXISTS prp_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  new_count INTEGER NOT NULL DEFAULT 0,
  total_returned INTEGER NOT NULL DEFAULT 0,
  inactive_marked INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prp_generation_log_tenant ON prp_generation_log(tenant_id);

COMMIT;
