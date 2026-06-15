import { adminPool } from '../db/pool';
import { storage } from './storage.service';
import { logger } from '../middleware/logger';

interface TaxDocResult {
  generated: number;
  skipped: number;
  documents: any[];
}

/**
 * Generate tax documents for a business for a given tax year.
 */
export async function generateTaxDocuments(businessId: string, taxYear: number, userId?: string): Promise<TaxDocResult> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Aggregate payroll data per staff member for the year
  const { rows: staffData } = await adminPool.query(
    `SELECT pe.user_id, u.first_name, u.last_name, u.email, u.role,
            SUM(pe.gross_pay)::int AS total_compensation,
            SUM(pe.total_deductions)::int AS total_deductions
     FROM payroll_entries pe
     JOIN pay_periods pp ON pp.id = pe.pay_period_id
     JOIN users u ON u.id = pe.user_id
     WHERE pp.business_id = $1 AND pp.period_start >= $2 AND pp.period_end <= $3 AND pp.status = 'finalized'
     GROUP BY pe.user_id, u.first_name, u.last_name, u.email, u.role`,
    [businessId, yearStart, yearEnd],
  );

  const result: TaxDocResult = { generated: 0, skipped: 0, documents: [] };

  for (const staff of staffData) {
    // Skip if already generated for this year
    const { rows: existing } = await adminPool.query(
      "SELECT id FROM tax_documents WHERE business_id = $1 AND user_id = $2 AND tax_year = $3 AND status != 'corrected'",
      [businessId, staff.user_id, taxYear],
    );
    if (existing.length > 0) { result.skipped++; continue; }

    // Determine document type
    const isContractor = staff.role === 'contractor' || staff.role === 'freelance';
    const documentType = isContractor ? '1099_nec' : 'w2';

    // For 1099: skip if below $600 threshold
    if (isContractor && staff.total_compensation < 60000) { result.skipped++; continue; }

    // Get deduction breakdown for W-2
    let federalTax = 0, stateTax = 0, socialSecurity = 0, medicare = 0;
    if (!isContractor) {
      const { rows: deductions } = await adminPool.query(
        `SELECT pd.name, pd.deduction_type, pd.calculation_type, pd.value
         FROM payroll_deductions pd
         WHERE pd.user_id = $1 AND pd.business_id = $2 AND pd.deduction_type = 'tax' AND pd.status = 'active'`,
        [staff.user_id, businessId],
      );

      // Estimate tax amounts from configured rates applied to gross
      for (const ded of deductions) {
        const amount = ded.calculation_type === 'percentage'
          ? Math.round(staff.total_compensation * ded.value / 10000)
          : ded.value * 12; // fixed monthly × 12

        if (ded.name.toLowerCase().includes('federal') || ded.name.toLowerCase().includes('income')) federalTax += amount;
        else if (ded.name.toLowerCase().includes('state')) stateTax += amount;
        else if (ded.name.toLowerCase().includes('social')) socialSecurity += amount;
        else if (ded.name.toLowerCase().includes('medicare')) medicare += amount;
        else federalTax += amount; // default to federal
      }
    }

    const docData = {
      employee: { first_name: staff.first_name, last_name: staff.last_name, email: staff.email },
      compensation: staff.total_compensation,
      federal_tax: federalTax,
      state_tax: stateTax,
      social_security: socialSecurity,
      medicare: medicare,
    };

    const { rows: docRows } = await adminPool.query(
      `INSERT INTO tax_documents (business_id, user_id, tax_year, document_type, total_compensation, total_federal_tax, total_state_tax, total_social_security, total_medicare, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [businessId, staff.user_id, taxYear, documentType, staff.total_compensation, federalTax, stateTax, socialSecurity, medicare, JSON.stringify(docData)],
    );

    result.documents.push(docRows[0]);
    result.generated++;
  }

  logger.info('Tax documents generated', { businessId, taxYear, generated: result.generated, skipped: result.skipped });
  return result;
}

/**
 * Get tax documents for a business (filterable by year, type, user).
 */
export async function getTaxDocuments(businessId: string, filters?: { taxYear?: number; documentType?: string; userId?: string }) {
  const conditions = ['td.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.taxYear) { conditions.push(`td.tax_year = $${idx++}`); params.push(filters.taxYear); }
  if (filters?.documentType) { conditions.push(`td.document_type = $${idx++}`); params.push(filters.documentType); }
  if (filters?.userId) { conditions.push(`td.user_id = $${idx++}`); params.push(filters.userId); }

  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT td.*, u.first_name, u.last_name FROM tax_documents td
     JOIN users u ON u.id = td.user_id WHERE ${where} ORDER BY td.tax_year DESC, u.last_name`,
    params,
  );
  return rows;
}

/**
 * Issue a corrected tax document.
 */
export async function issueCorrection(originalId: string, businessId: string, correctedData: Record<string, any>): Promise<any> {
  const { rows: original } = await adminPool.query(
    'SELECT * FROM tax_documents WHERE id = $1 AND business_id = $2', [originalId, businessId],
  );
  if (original.length === 0) return null;

  const orig = original[0];

  // Mark original as corrected
  await adminPool.query("UPDATE tax_documents SET status = 'corrected' WHERE id = $1", [originalId]);

  // Create corrected version
  const { rows } = await adminPool.query(
    `INSERT INTO tax_documents (business_id, user_id, tax_year, document_type, total_compensation, total_federal_tax, total_state_tax, total_social_security, total_medicare, data, corrects_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [businessId, orig.user_id, orig.tax_year, orig.document_type,
     correctedData.total_compensation ?? orig.total_compensation,
     correctedData.total_federal_tax ?? orig.total_federal_tax,
     correctedData.total_state_tax ?? orig.total_state_tax,
     correctedData.total_social_security ?? orig.total_social_security,
     correctedData.total_medicare ?? orig.total_medicare,
     JSON.stringify(correctedData), originalId],
  );

  return rows[0];
}
