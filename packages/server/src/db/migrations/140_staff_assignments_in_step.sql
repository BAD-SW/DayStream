-- Who provides which service, and where, lives in two pairs of tables: the staff module's
-- (stf_service_assignments, stf_location_assignments) and the booking engine's (svc_staff,
-- sys_location_staff). Until now nothing kept them in step, so an assignment made on a staff
-- member's page did not make them bookable, and one made on a service's page did not show on
-- the staff member's page. The code now writes both; this brings existing rows into line.
-- Safe to run again.

-- Staff module → booking engine
INSERT INTO svc_staff (service_id, user_id, variant_id, is_primary)
SELECT a.service_id, sp.user_id, a.variant_id, a.is_primary
  FROM stf_service_assignments a
  JOIN stf_profiles sp ON sp.id = a.staff_id AND sp.user_id IS NOT NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM svc_staff x
    WHERE x.service_id = a.service_id AND x.user_id = sp.user_id AND x.variant_id IS NOT DISTINCT FROM a.variant_id);

INSERT INTO sys_location_staff (location_id, staff_id)
SELECT a.location_id, a.staff_id FROM stf_location_assignments a
ON CONFLICT (location_id, staff_id) DO NOTHING;

-- Booking engine → staff module
INSERT INTO stf_service_assignments (staff_id, service_id, variant_id, is_primary)
SELECT sp.id, x.service_id, x.variant_id, x.is_primary
  FROM svc_staff x
  JOIN stf_profiles sp ON sp.user_id = x.user_id
 WHERE NOT EXISTS (
   SELECT 1 FROM stf_service_assignments a
    WHERE a.staff_id = sp.id AND a.service_id = x.service_id AND a.variant_id IS NOT DISTINCT FROM x.variant_id);

INSERT INTO stf_location_assignments (staff_id, location_id, is_primary)
SELECT x.staff_id, x.location_id, false FROM sys_location_staff x
ON CONFLICT (staff_id, location_id) DO NOTHING;
