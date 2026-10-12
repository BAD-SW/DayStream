-- Phase 46: People Foundation
-- One person record for leads and customers. Extends the Phase 05 tables; renames nothing.
-- See .kiro/specs/46-people-foundation/design.md section 2.

-- ============================================================
-- 1. cus_customers: partial details, source, owner, activity, merge
-- ============================================================

-- A person may be known by phone only. Names stay NOT NULL (empty string when unknown) so the
-- many existing queries that concatenate first and last name never produce NULL.
ALTER TABLE cus_customers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE cus_customers ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE cus_customers ALTER COLUMN last_name SET DEFAULT '';

ALTER TABLE cus_customers
  ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source_detail VARCHAR(200),
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES usr_users(id),
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES usr_users(id),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS email_deliverability VARCHAR(20) NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS phone_deliverability VARCHAR(20) NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES cus_customers(id),
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

-- What to show when a name is asked for: the name, else the email, else the phone.
ALTER TABLE cus_customers
  ADD COLUMN IF NOT EXISTS display_name TEXT GENERATED ALWAYS AS (
    COALESCE(NULLIF(BTRIM(first_name || ' ' || last_name), ''), email, phone)
  ) STORED;

ALTER TABLE cus_customers
  ADD CONSTRAINT chk_cus_customers_source CHECK (source IN (
    'manual', 'import', 'booking_widget', 'online_registration', 'lead_form',
    'inbound_message', 'referral', 'walk_in', 'api', 'unknown')),
  ADD CONSTRAINT chk_cus_customers_email_deliverability CHECK (email_deliverability IN ('ok', 'bounced', 'complained', 'invalid')),
  ADD CONSTRAINT chk_cus_customers_phone_deliverability CHECK (phone_deliverability IN ('ok', 'invalid', 'blocked'));

-- Status gains 'merged'.
ALTER TABLE cus_customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE cus_customers
  ADD CONSTRAINT customers_status_check CHECK (status IN ('active', 'archived', 'anonymized', 'merged'));

-- At least one way to reach the person, except for anonymised and merged records.
ALTER TABLE cus_customers
  ADD CONSTRAINT chk_cus_customers_contact_point
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR status IN ('anonymized', 'merged'));

-- Email is unique per business ignoring case. Stop if existing data would break that, so the
-- duplicates can be merged first instead of the migration failing half-way.
DO $$
DECLARE dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT business_id, LOWER(email) FROM cus_customers
    WHERE email IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'People Foundation: % email(s) exist more than once in a business when letter case is ignored. Merge them, then run the migration again.', dup_count;
  END IF;
END $$;

-- The original UNIQUE (business_id, email) stays: existing code and tests name it in
-- ON CONFLICT clauses, and it allows any number of people without an email. The index below
-- adds the case-insensitive rule on top of it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cus_customers_business_email
  ON cus_customers (business_id, LOWER(email))
  WHERE email IS NOT NULL AND status <> 'merged';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cus_customers_business_user
  ON cus_customers (business_id, user_id)
  WHERE user_id IS NOT NULL AND status <> 'merged';

CREATE INDEX IF NOT EXISTS idx_cus_customers_phone_e164 ON cus_customers (business_id, phone_e164);
CREATE INDEX IF NOT EXISTS idx_cus_customers_source ON cus_customers (business_id, source);
CREATE INDEX IF NOT EXISTS idx_cus_customers_owner ON cus_customers (business_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cus_customers_last_activity ON cus_customers (business_id, last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_cus_customers_merged_into ON cus_customers (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- Full-text search: email can now be NULL.
DROP INDEX IF EXISTS idx_customers_search;
CREATE INDEX idx_customers_search ON cus_customers
  USING GIN (to_tsvector('english',
    COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(phone, '')));

-- Reference numbers: the generator read every reference as 'CUST-<number>' and failed with a
-- cast error as soon as one in another format existed (the booking widget wrote 'CUS-<base36>').
-- Only well-formed references are counted now, and every entry point uses this function.
CREATE OR REPLACE FUNCTION generate_customer_reference(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM cus_customers
    WHERE business_id = p_business_id AND reference_number ~ '^CUST-[0-9]{1,9}$';

    RETURN 'CUST-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. Login date
-- ============================================================

ALTER TABLE usr_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ============================================================
-- 3. Consent: one store, with history
-- ============================================================

ALTER TABLE mkt_communication_preferences
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES sys_businesses(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE mkt_communication_preferences DROP CONSTRAINT IF EXISTS communication_preferences_channel_check;
ALTER TABLE mkt_communication_preferences
  ADD CONSTRAINT communication_preferences_channel_check
  CHECK (channel IN ('email', 'sms', 'whatsapp', 'in_app', 'push'));

UPDATE mkt_communication_preferences p
   SET business_id = c.business_id
  FROM cus_customers c
 WHERE c.id = p.customer_id AND p.business_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_comm_prefs_business ON mkt_communication_preferences (business_id);

CREATE TABLE IF NOT EXISTS cus_consent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
    business_id UUID NOT NULL REFERENCES sys_businesses(id),
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    channel VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    previous_state BOOLEAN,
    new_state BOOLEAN NOT NULL,
    method VARCHAR(30) NOT NULL CHECK (method IN (
        'form', 'portal', 'unsubscribe_link', 'staff_entry', 'import', 'keyword_reply', 'merge', 'migration')),
    evidence TEXT,
    actor_user_id UUID REFERENCES usr_users(id),
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cus_consent_events_customer ON cus_consent_events (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cus_consent_events_business ON cus_consent_events (business_id);

-- Bring the profile switches (cus_preferences) into the single store. Only values that differ
-- from the defaults need a row: marketing defaults to "not given", reminders default to "on".
-- Where both stores already hold a value, the more restrictive one wins.
INSERT INTO mkt_communication_preferences (tenant_id, business_id, customer_id, channel, category, opted_in, opted_in_at, source)
SELECT c.tenant_id, c.business_id, c.id, v.channel, 'marketing', true, p.updated_at, 'migration'
  FROM cus_preferences p
  JOIN cus_customers c ON c.id = p.customer_id
  CROSS JOIN LATERAL (VALUES
    ('email', p.email_marketing), ('sms', p.sms_marketing), ('push', p.push_notifications)
  ) AS v(channel, given)
 WHERE v.given = true
ON CONFLICT (tenant_id, customer_id, channel, category) DO NOTHING;

INSERT INTO mkt_communication_preferences (tenant_id, business_id, customer_id, channel, category, opted_in, opted_out_at, source)
SELECT c.tenant_id, c.business_id, c.id, v.channel, 'reminders', false, p.updated_at, 'migration'
  FROM cus_preferences p
  JOIN cus_customers c ON c.id = p.customer_id
  CROSS JOIN (VALUES ('email'), ('sms')) AS v(channel)
 WHERE p.booking_reminders = false
ON CONFLICT (tenant_id, customer_id, channel, category) DO UPDATE SET opted_in = false, opted_out_at = NOW();

UPDATE mkt_communication_preferences m
   SET opted_in = false, opted_out_at = COALESCE(m.opted_out_at, NOW())
  FROM cus_preferences p
 WHERE p.customer_id = m.customer_id AND m.category = 'marketing' AND m.opted_in = true
   AND ((m.channel = 'email' AND p.email_marketing = false AND m.source <> 'migration')
     OR (m.channel = 'sms' AND p.sms_marketing = false AND m.source <> 'migration')
     OR (m.channel = 'push' AND p.push_notifications = false AND m.source <> 'migration'));

INSERT INTO cus_consent_events (tenant_id, business_id, customer_id, channel, category, previous_state, new_state, method, evidence)
SELECT m.tenant_id, m.business_id, m.customer_id, m.channel, m.category, NULL, m.opted_in, 'migration',
       'Carried over from the previous preference settings'
  FROM mkt_communication_preferences m
 WHERE m.business_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM cus_consent_events e
                    WHERE e.customer_id = m.customer_id AND e.channel = m.channel AND e.category = m.category);

-- ============================================================
-- 4. Segments: fixed lists
-- ============================================================

ALTER TABLE cus_segments
  ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'dynamic',
  ADD COLUMN IF NOT EXISTS description VARCHAR(300);

ALTER TABLE cus_segments DROP CONSTRAINT IF EXISTS chk_cus_segments_kind;
ALTER TABLE cus_segments ADD CONSTRAINT chk_cus_segments_kind CHECK (kind IN ('dynamic', 'static'));

CREATE TABLE IF NOT EXISTS cus_segment_members (
    segment_id UUID NOT NULL REFERENCES cus_segments(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
    business_id UUID NOT NULL REFERENCES sys_businesses(id),
    added_by UUID REFERENCES usr_users(id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (segment_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cus_segment_members_customer ON cus_segment_members (customer_id);

-- ============================================================
-- 5. Possible duplicates
-- ============================================================

CREATE TABLE IF NOT EXISTS cus_duplicate_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
    business_id UUID NOT NULL REFERENCES sys_businesses(id),
    customer_id UUID NOT NULL REFERENCES cus_customers(id),
    other_customer_id UUID NOT NULL REFERENCES cus_customers(id),
    match_type VARCHAR(10) NOT NULL CHECK (match_type IN ('phone', 'email')),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, other_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cus_duplicate_flags_customer ON cus_duplicate_flags (customer_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cus_duplicate_flags_other ON cus_duplicate_flags (other_customer_id) WHERE status = 'open';

-- ============================================================
-- 6. Row-level security and grants for the new tables
-- ============================================================

ALTER TABLE cus_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cus_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cus_consent_events ON cus_consent_events FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_cus_consent_events ON cus_consent_events FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE cus_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE cus_segment_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cus_segment_members ON cus_segment_members FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_cus_segment_members ON cus_segment_members FOR ALL TO CURRENT_USER USING (true);

ALTER TABLE cus_duplicate_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE cus_duplicate_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cus_duplicate_flags ON cus_duplicate_flags FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_cus_duplicate_flags ON cus_duplicate_flags FOR ALL TO CURRENT_USER USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON cus_consent_events TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cus_segment_members TO daystream_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cus_duplicate_flags TO daystream_app;

-- ============================================================
-- 7. Backfill
-- ============================================================

-- Link each person to their login where one exists (same tenant, same email, customer login).
UPDATE cus_customers c
   SET user_id = u.id
  FROM usr_users u
 WHERE c.user_id IS NULL
   AND c.email IS NOT NULL
   AND u.tenant_id = c.tenant_id
   AND LOWER(u.email) = LOWER(c.email)
   AND u.persona = 'customer'
   AND NOT EXISTS (SELECT 1 FROM cus_customers o
                    WHERE o.business_id = c.business_id AND o.user_id = u.id);

-- Last visit: latest check-in. Last activity: latest of booking made and check-in.
UPDATE cus_customers c
   SET last_visit_at = v.last_visit
  FROM (SELECT customer_id, MAX(check_in_time) AS last_visit
          FROM apt_check_in_records WHERE customer_id IS NOT NULL GROUP BY customer_id) v
 WHERE v.customer_id = c.id AND c.last_visit_at IS NULL;

UPDATE cus_customers c
   SET last_activity_at = GREATEST(b.last_booking, c.last_visit_at)
  FROM (SELECT customer_id, MAX(created_at) AS last_booking
          FROM apt_bookings WHERE customer_id IS NOT NULL GROUP BY customer_id) b
 WHERE b.customer_id = c.id AND c.last_activity_at IS NULL;

UPDATE cus_customers SET last_activity_at = last_visit_at
 WHERE last_activity_at IS NULL AND last_visit_at IS NOT NULL;

-- When the person entered their current stage: the latest stage change on the timeline,
-- otherwise the day they were created.
UPDATE cus_customers c
   SET lifecycle_changed_at = COALESCE(
         (SELECT MAX(a.created_at) FROM cus_activities a
           WHERE a.customer_id = c.id AND a.activity_type = 'lifecycle'),
         c.created_at);
