-- A business created from the Businesses screen was given no chart of accounts, so its
-- sales, refunds and payroll had no accounts to post to and were silently left out of the
-- ledger. New businesses now get the standard chart when they are created; this gives it to
-- the ones that already exist without it. seed_chart_of_accounts() skips accounts that are
-- already there, so it is safe for every business and safe to run again.

SELECT seed_chart_of_accounts(b.id)
  FROM sys_businesses b
 WHERE NOT EXISTS (SELECT 1 FROM fin_chart_of_accounts c WHERE c.business_id = b.id AND c.code = '1100');
