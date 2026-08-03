-- Migration 072: Add requires_dedicated_staff flag to svc_services.
-- When true (default), staff cannot be double-booked during this service.
-- When false, staff can have overlapping appointments (e.g., tanning, sauna).

ALTER TABLE svc_services ADD COLUMN IF NOT EXISTS requires_dedicated_staff BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN svc_services.requires_dedicated_staff IS 'When true, staff is fully occupied for duration. When false, staff can supervise multiple concurrent sessions.';
