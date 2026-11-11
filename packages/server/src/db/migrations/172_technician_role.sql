-- Spec 51, gap 2 follow-up: a generic "technician" job role (therapist, trainer, mechanic, detailer...),
-- so the role list suits any industry. Existing 'therapist' and 'trainer' logins keep working.
BEGIN;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'usr_users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%trainer%'
  LOOP
    EXECUTE format('ALTER TABLE usr_users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE usr_users ADD CONSTRAINT users_role_check CHECK (role IN (
  'system_admin', 'system_support',
  'tenant_owner', 'tenant_manager',
  'business_owner', 'business_manager', 'business_staff', 'technician',
  'customer',
  'super_admin', 'manager', 'reception', 'therapist', 'trainer'
));

COMMIT;