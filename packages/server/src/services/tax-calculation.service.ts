import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface TaxCalculationResult {
  incomeTax: number;           // Progressive bracket tax amount (cents)
  flatTaxes: { name: string; amount: number; type: string }[];  // Each flat tax (SS, Medicare, etc.)
  totalEmployeeWithholding: number;  // Total employee-side deductions
  totalEmployerCost: number;         // Total employer-side taxes
  effectiveRate: number;             // Effective tax rate in basis points
}

interface TaxProfile {
  country_code: string;
  state_code?: string;
  filing_status: string;
  allowances: number;
  additional_withholding: number;
  exempt: boolean;
}

/**
 * Calculate all tax withholdings for a given gross pay amount.
 * Annualizes the pay based on frequency, applies brackets, then de-annualizes.
 *
 * @param grossPay - Gross pay for the period (cents)
 * @param profile - Employee's tax profile (country, filing status, etc.)
 * @param payFrequency - How often they're paid: weekly, biweekly, semi_monthly, monthly
 * @param ytdGross - Year-to-date gross (cents) - for wage base calculations
 */
export async function calculateTaxes(
  grossPay: number,
  profile: TaxProfile,
  payFrequency: string,
  ytdGross: number = 0,
): Promise<TaxCalculationResult> {
  if (profile.exempt || grossPay <= 0) {
    return { incomeTax: 0, flatTaxes: [], totalEmployeeWithholding: 0, totalEmployerCost: 0, effectiveRate: 0 };
  }

  const periodsPerYear = getPeriodsPerYear(payFrequency);
  const annualizedGross = grossPay * periodsPerYear;

  // Get the tax year
  const taxYear = new Date().getFullYear();

  // Find applicable jurisdiction
  const { rows: jurisdictions } = await adminPool.query(
    `SELECT id FROM pay_tax_jurisdictions
     WHERE country_code = $1 AND (state_code = $2 OR (state_code IS NULL AND $2 IS NULL))
       AND jurisdiction_type = 'federal' AND tax_year = $3 AND active = true`,
    [profile.country_code, profile.state_code || null, taxYear],
  );

  if (jurisdictions.length === 0) {
    // Try without state (federal only)
    const { rows: fedOnly } = await adminPool.query(
      `SELECT id FROM pay_tax_jurisdictions
       WHERE country_code = $1 AND state_code IS NULL
         AND jurisdiction_type = 'federal' AND tax_year = $2 AND active = true`,
      [profile.country_code, taxYear],
    );
    if (fedOnly.length === 0) {
      logger.warn(`[Tax] No tax jurisdiction found for ${profile.country_code} ${taxYear}`);
      return { incomeTax: 0, flatTaxes: [], totalEmployeeWithholding: 0, totalEmployerCost: 0, effectiveRate: 0 };
    }
    jurisdictions.push(fedOnly[0]);
  }

  const jurisdictionId = jurisdictions[0].id;

  // 1. Calculate progressive income tax
  const incomeTax = await calculateProgressiveTax(jurisdictionId, profile.filing_status, annualizedGross, periodsPerYear, profile.allowances);

  // Add additional withholding
  const adjustedIncomeTax = incomeTax + profile.additional_withholding;

  // 2. Calculate flat taxes (Social Security, Medicare, etc.)
  const { rows: flatTaxes } = await adminPool.query(
    'SELECT name, tax_type, rate, wage_base FROM pay_flat_taxes WHERE jurisdiction_id = $1',
    [jurisdictionId],
  );

  const flatTaxResults: { name: string; amount: number; type: string }[] = [];
  let totalEmployeeFlat = 0;
  let totalEmployerFlat = 0;

  for (const tax of flatTaxes) {
    // Check wage base - if YTD already exceeds, no more tax
    let taxableAmount = grossPay;
    if (tax.wage_base) {
      const remaining = Math.max(0, tax.wage_base - ytdGross);
      taxableAmount = Math.min(grossPay, remaining);
      if (taxableAmount <= 0) continue;
    }

    // Special handling for Additional Medicare (applies only above threshold)
    if (tax.name.includes('Additional Medicare')) {
      const threshold = tax.wage_base || 20000000;
      if (ytdGross + grossPay <= threshold) continue;
      taxableAmount = Math.max(0, (ytdGross + grossPay) - threshold);
      if (ytdGross >= threshold) taxableAmount = grossPay;
    }

    const amount = Math.round(taxableAmount * tax.rate / 10000);

    if (tax.tax_type === 'employee' || tax.tax_type === 'both') {
      totalEmployeeFlat += amount;
      flatTaxResults.push({ name: tax.name, amount, type: 'employee' });
    }
    if (tax.tax_type === 'employer' || tax.tax_type === 'both') {
      totalEmployerFlat += amount;
      flatTaxResults.push({ name: tax.name, amount, type: 'employer' });
    }
  }

  const totalEmployeeWithholding = adjustedIncomeTax + totalEmployeeFlat;
  const totalEmployerCost = totalEmployerFlat;
  const effectiveRate = grossPay > 0 ? Math.round((totalEmployeeWithholding / grossPay) * 10000) : 0;

  return {
    incomeTax: adjustedIncomeTax,
    flatTaxes: flatTaxResults,
    totalEmployeeWithholding,
    totalEmployerCost,
    effectiveRate,
  };
}

/**
 * Calculate progressive (bracketed) income tax.
 * Annualizes gross, applies brackets, then returns per-period amount.
 */
async function calculateProgressiveTax(
  jurisdictionId: string,
  filingStatus: string,
  annualizedGross: number,
  periodsPerYear: number,
  allowances: number,
): Promise<number> {
  // Standard deduction / allowance reduction (simplified)
  // US: each allowance ~$4,300 reduction in taxable income for 2024
  const allowanceValue = 430000; // $4,300 in cents
  const taxableIncome = Math.max(0, annualizedGross - (allowances * allowanceValue));

  // Get brackets sorted by min
  const { rows: brackets } = await adminPool.query(
    `SELECT bracket_min, bracket_max, rate FROM pay_tax_brackets
     WHERE jurisdiction_id = $1 AND filing_status = $2
     ORDER BY bracket_min ASC`,
    [jurisdictionId, filingStatus],
  );

  if (brackets.length === 0) return 0;

  let annualTax = 0;
  let remainingIncome = taxableIncome;

  for (const bracket of brackets) {
    if (remainingIncome <= 0) break;

    const bracketSize = bracket.bracket_max
      ? bracket.bracket_max - bracket.bracket_min
      : remainingIncome; // No cap on last bracket

    const taxableInBracket = Math.min(remainingIncome, bracketSize);
    annualTax += Math.round(taxableInBracket * bracket.rate / 10000);
    remainingIncome -= taxableInBracket;
  }

  // Convert annual tax to per-period
  return Math.round(annualTax / periodsPerYear);
}

/**
 * Get the number of pay periods per year based on frequency.
 */
function getPeriodsPerYear(frequency: string): number {
  switch (frequency) {
    case 'weekly': return 52;
    case 'biweekly': return 26;
    case 'semi_monthly': return 24;
    case 'monthly': return 12;
    default: return 12;
  }
}

/**
 * Get or create an employee's tax profile.
 */
export async function getEmployeeTaxProfile(businessId: string, userId: string): Promise<TaxProfile | null> {
  const { rows } = await adminPool.query(
    'SELECT * FROM pay_employee_tax_profiles WHERE business_id = $1 AND user_id = $2',
    [businessId, userId],
  );
  if (rows.length === 0) return null;
  return {
    country_code: rows[0].country_code,
    state_code: rows[0].state_code,
    filing_status: rows[0].filing_status,
    allowances: rows[0].allowances,
    additional_withholding: rows[0].additional_withholding,
    exempt: rows[0].exempt,
  };
}

/**
 * Create or update an employee's tax profile.
 */
export async function upsertEmployeeTaxProfile(businessId: string, userId: string, profile: Partial<TaxProfile>) {
  const { rows } = await adminPool.query(
    `INSERT INTO pay_employee_tax_profiles (business_id, user_id, country_code, state_code, filing_status, allowances, additional_withholding, exempt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (business_id, user_id) DO UPDATE SET
       country_code = COALESCE($3, pay_employee_tax_profiles.country_code),
       state_code = $4,
       filing_status = COALESCE($5, pay_employee_tax_profiles.filing_status),
       allowances = COALESCE($6, pay_employee_tax_profiles.allowances),
       additional_withholding = COALESCE($7, pay_employee_tax_profiles.additional_withholding),
       exempt = COALESCE($8, pay_employee_tax_profiles.exempt),
       updated_at = NOW()
     RETURNING *`,
    [businessId, userId, profile.country_code || 'US', profile.state_code || null, profile.filing_status || 'single', profile.allowances ?? 0, profile.additional_withholding ?? 0, profile.exempt ?? false],
  );
  return rows[0];
}
