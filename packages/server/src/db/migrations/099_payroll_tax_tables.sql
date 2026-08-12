-- Payroll Tax Tables: jurisdiction-based tax brackets, employer taxes, and employee tax profiles

BEGIN;

-- ============================================================
-- 1. Tax Jurisdictions (countries, states, provinces)
-- ============================================================

CREATE TABLE IF NOT EXISTS pay_tax_jurisdictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(2) NOT NULL,
  state_code VARCHAR(10),
  name VARCHAR(200) NOT NULL,
  jurisdiction_type VARCHAR(20) NOT NULL CHECK (jurisdiction_type IN ('federal', 'state', 'local')),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  tax_year INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(country_code, state_code, jurisdiction_type, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_tax_jurisdictions_country ON pay_tax_jurisdictions(country_code, tax_year);

-- ============================================================
-- 2. Income Tax Brackets (progressive rates)
-- ============================================================

CREATE TABLE IF NOT EXISTS pay_tax_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id UUID NOT NULL REFERENCES pay_tax_jurisdictions(id) ON DELETE CASCADE,
  filing_status VARCHAR(30) NOT NULL DEFAULT 'single',
  bracket_min INTEGER NOT NULL DEFAULT 0,
  bracket_max INTEGER,
  rate INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_brackets_jurisdiction ON pay_tax_brackets(jurisdiction_id, filing_status);

-- ============================================================
-- 3. Flat Rate Taxes (Social Security, Medicare, unemployment, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS pay_flat_taxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id UUID NOT NULL REFERENCES pay_tax_jurisdictions(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  tax_type VARCHAR(30) NOT NULL CHECK (tax_type IN ('employee', 'employer', 'both')),
  rate INTEGER NOT NULL,
  wage_base INTEGER,
  description VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flat_taxes_jurisdiction ON pay_flat_taxes(jurisdiction_id);

-- ============================================================
-- 4. Employee Tax Profiles (per staff member)
-- ============================================================

CREATE TABLE IF NOT EXISTS pay_employee_tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES usr_users(id) ON DELETE CASCADE,
  country_code VARCHAR(2) NOT NULL DEFAULT 'US',
  state_code VARCHAR(10),
  filing_status VARCHAR(30) NOT NULL DEFAULT 'single',
  allowances INTEGER NOT NULL DEFAULT 0,
  additional_withholding INTEGER NOT NULL DEFAULT 0,
  exempt BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_tax_profiles_business ON pay_employee_tax_profiles(business_id);

COMMIT;
