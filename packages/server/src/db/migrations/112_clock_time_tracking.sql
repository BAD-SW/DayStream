-- Clock in/out time tracking (EU working-time compliance + optional hourly-pay source).
--
-- An append-only EVENT LOG of clock punches: clock_in, break_start, break_end,
-- clock_out. A staff member's current state is derived from their latest event;
-- worked hours = clocked spans minus break spans. Live punches are made at a
-- shared screen authenticated by staff number (stf_profiles.staff_ref) + a 4-digit
-- PIN (hashed below). Managers/owners may add/edit/delete entries as corrections
-- (recorded with source = 'manual').
BEGIN;

-- 4-digit clock PIN, bcrypt-hashed. NULL = no PIN set yet (cannot clock until set).
ALTER TABLE stf_profiles
  ADD COLUMN IF NOT EXISTS clock_pin_hash VARCHAR(255);

-- Hours basis for HOURLY compensation rules only: whether that staff member's
-- payable hours come from their scheduled shifts or their clocked time. NULL for
-- non-hourly rules (flat-rate / commission / salary never use hours).
ALTER TABLE fin_compensation_rules
  ADD COLUMN IF NOT EXISTS hours_basis VARCHAR(20)
    CHECK (hours_basis IN ('scheduled', 'clocked'));

-- Clock event log.
CREATE TABLE IF NOT EXISTS clk_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  event_type  VARCHAR(20) NOT NULL
    CHECK (event_type IN ('clock_in', 'break_start', 'break_end', 'clock_out')),
  event_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'clock' = live punch at the shared screen; 'manual' = manager/owner correction.
  source      VARCHAR(10) NOT NULL DEFAULT 'clock'
    CHECK (source IN ('clock', 'manual')),
  created_by  UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- State derivation and daily rollups both scan a user's events in time order.
CREATE INDEX IF NOT EXISTS clk_events_user_time_idx
  ON clk_events (user_id, event_at);
CREATE INDEX IF NOT EXISTS clk_events_business_time_idx
  ON clk_events (business_id, event_at);

COMMIT;
