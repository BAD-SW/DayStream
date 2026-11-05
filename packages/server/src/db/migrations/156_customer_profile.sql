-- Customer profile (Linear THE-16): address and home location on the person, tasks,
-- documents, and "send personal data" exports.
--
-- Files (documents, profile photos, exports) are kept under the storage root's
-- private/ prefix and are only served through authenticated, business-scoped API
-- routes, never through the public /storage route.

BEGIN;

-- Address and home location (one of the business's own locations).
ALTER TABLE cus_customers
  ADD COLUMN IF NOT EXISTS address_line VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS home_location_id UUID REFERENCES sys_locations(id) ON DELETE SET NULL,
  -- Profile photo, stored privately (avatar_url stays for photos coming from elsewhere).
  ADD COLUMN IF NOT EXISTS photo_path VARCHAR(500);

-- Tasks about a person. Several staff members may be assigned to one task.
CREATE TABLE IF NOT EXISTS cus_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
  business_id UUID NOT NULL REFERENCES sys_businesses(id),
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  event_id UUID REFERENCES evt_events(id) ON DELETE SET NULL,
  send_reminder BOOLEAN NOT NULL DEFAULT false,
  -- When the reminder email to the customer was queued (it is sent when the task is created).
  reminder_queued_at TIMESTAMPTZ,
  reminder_skipped_reason VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES usr_users(id),
  created_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cus_tasks_customer ON cus_tasks(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_cus_tasks_business ON cus_tasks(business_id, status, due_at);

CREATE TABLE IF NOT EXISTS cus_task_staff (
  task_id UUID NOT NULL REFERENCES cus_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES usr_users(id),
  PRIMARY KEY (task_id, user_id)
);

-- Documents kept on a person (questionnaires, waivers, certificates).
CREATE TABLE IF NOT EXISTS cus_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
  business_id UUID NOT NULL REFERENCES sys_businesses(id),
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES usr_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES usr_users(id)
);
CREATE INDEX IF NOT EXISTS idx_cus_documents_customer ON cus_documents(customer_id) WHERE deleted_at IS NULL;

-- "Send personal data": a password-protected file, downloadable from an emailed link
-- for 24 hours. Only the hash of the link token is stored; the password is never stored.
CREATE TABLE IF NOT EXISTS cus_data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES sys_tenants(id),
  business_id UUID NOT NULL REFERENCES sys_businesses(id),
  customer_id UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  storage_path VARCHAR(500) NOT NULL,
  sent_to VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_by UUID REFERENCES usr_users(id),
  downloaded_at TIMESTAMPTZ,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cus_data_exports_customer ON cus_data_exports(customer_id);

COMMIT;
