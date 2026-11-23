-- Spec 51, gap 14 (owner, 22 Nov 2026): the tip pool. A tip on an order with no staff member on it
-- goes to the business's tip pool (a share with no user), owed to staff as a whole until the owner
-- or a manager shares it out: by hand, or among the staff clocked in that day (by hours or evenly).
-- A shared pool share is 'allocated'; its parts become ordinary staff shares.
BEGIN;
ALTER TABLE fin_tip_shares ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE fin_tip_shares DROP CONSTRAINT IF EXISTS fin_tip_shares_status_check;
ALTER TABLE fin_tip_shares ADD CONSTRAINT fin_tip_shares_status_check
  CHECK (status IN ('owed', 'handed_over', 'paid', 'pool', 'allocated'));
-- a pool share has no user; a staff share has one
ALTER TABLE fin_tip_shares ADD CONSTRAINT fin_tip_shares_pool_user_check
  CHECK ((user_id IS NULL) = (status IN ('pool', 'allocated')));
-- the pool share a staff share was shared out from
ALTER TABLE fin_tip_shares ADD COLUMN IF NOT EXISTS from_pool_share_id UUID REFERENCES fin_tip_shares(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fin_tip_shares_pool ON fin_tip_shares (business_id, created_at) WHERE status = 'pool';
COMMIT;