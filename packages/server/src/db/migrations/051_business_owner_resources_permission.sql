-- Migration 051: Add resources:* permission to Business Owner role.

BEGIN;

UPDATE usr_roles
SET permissions = '["services:*","bookings:*","staff:*","reports:*","settings:*","customers:*","resources:*"]'
WHERE name = 'Business Owner' AND is_system = true;

COMMIT;
