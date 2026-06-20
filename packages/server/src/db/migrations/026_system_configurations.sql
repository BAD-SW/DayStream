-- System-level configurations (email, storage, notifications, etc.)
-- These are platform-wide settings, not per-tenant

CREATE TABLE IF NOT EXISTS system_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(100) NOT NULL UNIQUE,
  config_data JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick category lookup
CREATE INDEX IF NOT EXISTS idx_system_configurations_category ON system_configurations(category);

-- Seed default categories
INSERT INTO system_configurations (category, config_data) VALUES
  ('email', '{"smtp_host":"","smtp_port":587,"smtp_secure":false,"smtp_user":"","smtp_password":"","from_email":"","from_name":"DayStream","rate_limit_per_hour":100}'),
  ('storage', '{"storage_type":"local","local_path":"","s3_bucket":"","s3_region":"us-east-1","s3_access_key":"","s3_secret_key":""}'),
  ('notifications', '{"email_enabled":true,"sms_enabled":false,"push_enabled":false,"sms_provider":"none","twilio_account_sid":"","twilio_auth_token":"","twilio_from_number":"","push_vapid_public_key":"","push_vapid_private_key":""}')
ON CONFLICT (category) DO NOTHING;
