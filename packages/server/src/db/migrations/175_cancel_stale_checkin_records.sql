-- A reset booking kept its check-in record, so the customer could not be checked in again
-- ("Already checked in for this booking"). Cancel the records of bookings that are back to confirmed.
BEGIN;
UPDATE apt_check_in_records r SET status = 'cancelled'
 WHERE r.status IN ('checked_in', 'in_progress')
   AND EXISTS (SELECT 1 FROM apt_bookings b WHERE b.id = r.booking_id AND b.status IN ('confirmed', 'pending'));
COMMIT;