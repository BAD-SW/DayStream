-- The general "Staff" job role is retired: Technician is the same permissions plus service charts.
-- Existing general-staff logins become technicians (the permission set they hold does not change).
BEGIN;
UPDATE usr_users SET role = 'technician', updated_at = NOW() WHERE role = 'business_staff';
COMMIT;