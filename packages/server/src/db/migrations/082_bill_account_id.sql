-- Add expense account to bills for journal entry generation

BEGIN;

ALTER TABLE fin_bills ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES fin_chart_of_accounts(id);

COMMIT;
