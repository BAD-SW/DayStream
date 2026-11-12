-- Migration 174: a calendar colour per service that the business owner can change (decision CAL-11, 10 Nov 2026).
-- NULL = the default palette colour (assigned by name in the calendar).
ALTER TABLE svc_services ADD COLUMN IF NOT EXISTS calendar_color VARCHAR(7);
