-- Seed US Federal 2024 tax brackets, Social Security, and Medicare rates
-- All monetary values in cents, rates in basis points (1% = 100)

BEGIN;

-- US Federal jurisdiction
INSERT INTO pay_tax_jurisdictions (country_code, state_code, name, jurisdiction_type, currency, tax_year)
VALUES ('US', NULL, 'United States Federal', 'federal', 'USD', 2024)
ON CONFLICT DO NOTHING;

-- Get the federal jurisdiction ID
DO $$
DECLARE
  fed_id UUID;
BEGIN
  SELECT id INTO fed_id FROM pay_tax_jurisdictions WHERE country_code = 'US' AND state_code IS NULL AND tax_year = 2024;

  -- Federal Income Tax Brackets 2024 - Single
  INSERT INTO pay_tax_brackets (jurisdiction_id, filing_status, bracket_min, bracket_max, rate) VALUES
  (fed_id, 'single', 0, 1150000, 1000),           -- 10% on $0 - $11,500
  (fed_id, 'single', 1150000, 4672500, 1200),      -- 12% on $11,500 - $46,725
  (fed_id, 'single', 4672500, 10050000, 2200),     -- 22% on $46,725 - $100,500
  (fed_id, 'single', 10050000, 19155000, 2400),    -- 24% on $100,500 - $191,550
  (fed_id, 'single', 19155000, 24375000, 3200),    -- 32% on $191,550 - $243,750
  (fed_id, 'single', 24375000, 60900000, 3500),    -- 35% on $243,750 - $609,000
  (fed_id, 'single', 60900000, NULL, 3700);        -- 37% on $609,000+

  -- Federal Income Tax Brackets 2024 - Married Filing Jointly
  INSERT INTO pay_tax_brackets (jurisdiction_id, filing_status, bracket_min, bracket_max, rate) VALUES
  (fed_id, 'married', 0, 2300000, 1000),           -- 10% on $0 - $23,000
  (fed_id, 'married', 2300000, 9445000, 1200),     -- 12% on $23,000 - $94,450
  (fed_id, 'married', 9445000, 20100000, 2200),    -- 22% on $94,450 - $201,000
  (fed_id, 'married', 20100000, 38310000, 2400),   -- 24% on $201,000 - $383,100
  (fed_id, 'married', 38310000, 48750000, 3200),   -- 32% on $383,100 - $487,500
  (fed_id, 'married', 48750000, 73160000, 3500),   -- 35% on $487,500 - $731,600
  (fed_id, 'married', 73160000, NULL, 3700);       -- 37% on $731,600+

  -- Federal Income Tax Brackets 2024 - Head of Household
  INSERT INTO pay_tax_brackets (jurisdiction_id, filing_status, bracket_min, bracket_max, rate) VALUES
  (fed_id, 'head_of_household', 0, 1640000, 1000),          -- 10% on $0 - $16,400
  (fed_id, 'head_of_household', 1640000, 6385000, 1200),    -- 12% on $16,400 - $63,850
  (fed_id, 'head_of_household', 6385000, 10075000, 2200),   -- 22% on $63,850 - $100,750
  (fed_id, 'head_of_household', 10075000, 19155000, 2400),  -- 24% on $100,750 - $191,550
  (fed_id, 'head_of_household', 19155000, 24375000, 3200),  -- 32% on $191,550 - $243,750
  (fed_id, 'head_of_household', 24375000, 60900000, 3500),  -- 35% on $243,750 - $609,000
  (fed_id, 'head_of_household', 60900000, NULL, 3700);      -- 37% on $609,000+

  -- Social Security (OASDI) - 6.2% employee, 6.2% employer, wage base $168,600
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (fed_id, 'Social Security (Employee)', 'employee', 620, 16860000, 'OASDI employee share 6.2% up to wage base'),
  (fed_id, 'Social Security (Employer)', 'employer', 620, 16860000, 'OASDI employer share 6.2% up to wage base');

  -- Medicare - 1.45% employee, 1.45% employer, no wage base (additional 0.9% above $200k handled separately)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (fed_id, 'Medicare (Employee)', 'employee', 145, NULL, 'Medicare employee share 1.45% (no cap)'),
  (fed_id, 'Medicare (Employer)', 'employer', 145, NULL, 'Medicare employer share 1.45% (no cap)');

  -- Additional Medicare - 0.9% employee only above $200,000
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (fed_id, 'Additional Medicare (Employee)', 'employee', 90, 20000000, 'Additional 0.9% on wages above $200,000');

  -- FUTA (Federal Unemployment) - 6.0% employer, wage base $7,000 (usually offset by state credit to 0.6%)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (fed_id, 'FUTA (Employer)', 'employer', 60, 700000, 'Federal unemployment 0.6% (after state credit) on first $7,000');

END $$;

COMMIT;
