-- Inbox (THE-18, David 2026-11-04: option A, notifications by role and channel, segments,
-- column order per business).
--
-- One conversation per person per business. A message is inbound, outbound, an internal note or
-- an automatic message (booking notifications and the like, recorded so staff see what was sent).
-- Channels: email (replies are sent with the business's email settings), in_app (the customer
-- writes and reads in their portal); sms and whatsapp come with their providers (THE-19).
--
-- usr_notifications: in-app notifications for staff (the bell). inbox_user_prefs: what each user
-- switched off for themselves. Settings: inbox.notifications (which roles and channels get each
-- event), inbox.unanswered_hours, people.column_order (one order for People, Leads and the Inbox).

BEGIN;

CREATE TABLE IF NOT EXISTS inbox_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assignee_user_id UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  unread BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  last_preview TEXT,
  last_channel VARCHAR(16),
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_list ON inbox_conversations (business_id, status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('in', 'out', 'note', 'auto', 'event')),
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('email', 'in_app', 'sms', 'whatsapp', 'internal')),
  subject TEXT,
  body TEXT NOT NULL,
  sender_user_id UUID REFERENCES usr_users(id) ON DELETE SET NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'failed', 'received')),
  failure_reason TEXT,
  mentions UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_msg_conv ON inbox_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS usr_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  business_id UUID REFERENCES sys_businesses(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usr_notifications_user ON usr_notifications (user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS inbox_user_prefs (
  user_id UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  event VARCHAR(40) NOT NULL,
  in_app BOOLEAN NOT NULL DEFAULT true,
  email BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event)
);

CREATE TABLE IF NOT EXISTS inbox_summary_log (
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  PRIMARY KEY (business_id, day)
);

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
  ('inbox.notifications', 'notifications', 'json', '{}', 'Inbox notifications: which roles get each event, by in-app and email'),
  ('inbox.unanswered_hours', 'notifications', 'number', '4', 'Hours after which an unanswered conversation is reported'),
  ('people.column_order', 'general', 'json', '[]', 'Column order for the People, Leads and Inbox lists (one order for the business)')
ON CONFLICT (key) DO NOTHING;

-- Unanswered reminders and the daily summary: one platform sweep every 15 minutes.
INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at)
VALUES ('platform', NULL, NULL, 'inbox_reminders', '00:00', 'UTC', 'every_15min', true, NOW())
ON CONFLICT (job_type) WHERE scope_level = 'platform' DO NOTHING;

COMMIT;
