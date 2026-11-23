-- Owner, 23 Nov 2026: a membership cancelled to end at the close of its period runs through the
-- period already paid for, then ends. Cancel set cancelled_at and stopped billing, but nothing ever
-- changed the status, so those memberships stayed "active" after their period. The daily Membership
-- Renewals run now ends them; this ends the ones already past their period.
BEGIN;
UPDATE mbr_enrollments
   SET status = 'cancelled', next_billing_date = NULL, updated_at = NOW()
 WHERE status IN ('active', 'paused') AND cancelled_at IS NOT NULL AND current_period_end < CURRENT_DATE;
COMMIT;
