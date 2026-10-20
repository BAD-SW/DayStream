-- Email engine: make apt_notification_queue safely drainable by a background
-- dispatcher across multiple server instances.
--
-- The dispatcher claims due rows by atomically flipping them to 'processing'
-- (via UPDATE ... FOR UPDATE SKIP LOCKED), sends, then marks 'sent' or reverts to
-- 'pending'/'failed'. That needs a 'processing' status and a claim timestamp so a
-- crashed worker's stuck claims can be reclaimed. Adds a next-attempt column for
-- retry backoff.

BEGIN;

-- Allow the transient 'processing' status.
ALTER TABLE apt_notification_queue DROP CONSTRAINT IF EXISTS notification_queue_status_check;
ALTER TABLE apt_notification_queue
  ADD CONSTRAINT notification_queue_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'));

-- Claim bookkeeping for multi-instance safety + crash recovery.
ALTER TABLE apt_notification_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- The dispatcher selects pending rows due now (or whose retry backoff has elapsed).
CREATE INDEX IF NOT EXISTS idx_notification_queue_dispatch
  ON apt_notification_queue(status, scheduled_for)
  WHERE status = 'pending';

COMMIT;
