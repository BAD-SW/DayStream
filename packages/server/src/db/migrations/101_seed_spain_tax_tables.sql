-- Seed Spain 2024 IRPF tax brackets and Seguridad Social contributions
-- All monetary values in cents (EUR), rates in basis points (1% = 100)

BEGIN;

-- Spain Federal jurisdiction (national IRPF rates - state portion varies by autonomous community)
INSERT INTO pay_tax_jurisdictions (country_code, state_code, name, jurisdiction_type, currency, tax_year)
VALUES ('ES', NULL, 'Spain National (IRPF)', 'federal', 'EUR', 2024)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  es_id UUID;
BEGIN
  SELECT id INTO es_id FROM pay_tax_jurisdictions WHERE country_code = 'ES' AND state_code IS NULL AND tax_year = 2024;

  -- Spain IRPF 2024 brackets (national portion - general rates)
  -- Filing status 'single' used as default (Spain doesn't use married/single the same way)
  INSERT INTO pay_tax_brackets (jurisdiction_id, filing_status, bracket_min, bracket_max, rate) VALUES
  (es_id, 'single', 0, 1240000, 1900),             -- 19% on €0 - €12,450
  (es_id, 'single', 1240000, 2020000, 2400),       -- 24% on €12,450 - €20,200
  (es_id, 'single', 2020000, 3520000, 3000),       -- 30% on €20,200 - €35,200
  (es_id, 'single', 3520000, 6000000, 3700),       -- 37% on €35,200 - €60,000
  (es_id, 'single', 6000000, 30000000, 4500),      -- 45% on €60,000 - €300,000
  (es_id, 'single', 30000000, NULL, 4700);          -- 47% on €300,000+

  -- Seguridad Social - Employee contributions
  -- Common contingencies: 4.7% employee
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Contingencias Comunes (Employee)', 'employee', 470, NULL, 'Common contingencies 4.7%');

  -- Unemployment: 1.55% employee (general contract)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Desempleo (Employee)', 'employee', 155, NULL, 'Unemployment insurance 1.55%');

  -- Professional training: 0.1% employee
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Formación (Employee)', 'employee', 10, NULL, 'Professional training 0.1%');

  -- MEI (Intergenerational Equity Mechanism): 0.12% employee (2024)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'MEI (Employee)', 'employee', 12, NULL, 'Intergenerational equity mechanism 0.12%');

  -- Seguridad Social - Employer contributions
  -- Common contingencies: 23.6% employer
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Contingencias Comunes (Employer)', 'employer', 2360, NULL, 'Common contingencies 23.6%');

  -- Unemployment: 5.5% employer (general contract)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Desempleo (Employer)', 'employer', 550, NULL, 'Unemployment insurance 5.5%');

  -- Work accidents: ~1.5% employer (average, varies by activity)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Accidentes (Employer)', 'employer', 150, NULL, 'Work accident insurance ~1.5% (varies)');

  -- Professional training: 0.6% employer
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'Seguridad Social - Formación (Employer)', 'employer', 60, NULL, 'Professional training 0.6%');

  -- FOGASA: 0.2% employer
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'FOGASA (Employer)', 'employer', 20, NULL, 'Wage guarantee fund 0.2%');

  -- MEI: 0.58% employer (2024)
  INSERT INTO pay_flat_taxes (jurisdiction_id, name, tax_type, rate, wage_base, description) VALUES
  (es_id, 'MEI (Employer)', 'employer', 58, NULL, 'Intergenerational equity mechanism 0.58%');

END $$;

COMMIT;
