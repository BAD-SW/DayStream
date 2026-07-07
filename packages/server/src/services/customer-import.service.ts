import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { logger } from '../middleware/logger';

interface ColumnMapping {
  [csvColumn: string]: string; // maps CSV header → customer field
}

interface ImportRow {
  [key: string]: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: ValidationError[];
}

const REQUIRED_FIELDS = ['email', 'first_name', 'last_name'];
const VALID_FIELDS = [
  'email', 'first_name', 'last_name', 'phone', 'date_of_birth',
  'gender', 'preferred_language', 'country',
];

/**
 * Parse CSV text into rows.
 */
export function parseCSV(csvText: string): { headers: string[]; rows: ImportRow[] } {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseLine(lines[0]);
  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: ImportRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line (handles quoted fields).
 */
function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Validate import rows against schema.
 * Returns errors with row numbers and field details.
 */
export function validateRows(rows: ImportRow[], mapping: ColumnMapping): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +2 for 1-indexed + header row
    const mapped = applyMapping(rows[i], mapping);

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (!mapped[field] || mapped[field].trim() === '') {
        errors.push({ row: rowNum, field, message: `${field} is required` });
      }
    }

    // Validate email format
    if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) {
      errors.push({ row: rowNum, field: 'email', message: 'Invalid email format' });
    }

    // Validate date_of_birth format
    if (mapped.date_of_birth && mapped.date_of_birth.trim() !== '') {
      const date = new Date(mapped.date_of_birth);
      if (isNaN(date.getTime())) {
        errors.push({ row: rowNum, field: 'date_of_birth', message: 'Invalid date format' });
      }
    }
  }

  return errors;
}

/**
 * Apply column mapping to a row.
 */
function applyMapping(row: ImportRow, mapping: ColumnMapping): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [csvCol, field] of Object.entries(mapping)) {
    if (VALID_FIELDS.includes(field) && row[csvCol] !== undefined) {
      result[field] = row[csvCol];
    }
  }
  return result;
}

/**
 * Dry-run: validate CSV without importing.
 */
export function validateImport(
  csvText: string,
  mapping: ColumnMapping,
): { valid: boolean; total: number; errors: ValidationError[] } {
  const { rows } = parseCSV(csvText);
  const errors = validateRows(rows, mapping);
  return { valid: errors.length === 0, total: rows.length, errors };
}

/**
 * Execute import: validate and insert valid rows.
 */
export async function executeImport(
  csvText: string,
  mapping: ColumnMapping,
  businessId: string,
  tenantId: string,
  userId: string,
): Promise<ImportResult> {
  const { rows } = parseCSV(csvText);
  const errors = validateRows(rows, mapping);

  // Get row numbers with errors
  const errorRows = new Set(errors.map((e) => e.row));

  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    if (errorRows.has(rowNum)) {
      skipped++;
      continue;
    }

    const mapped = applyMapping(rows[i], mapping);

    try {
      // Check for duplicate email
      const { rows: existing } = await adminPool.query(
        'SELECT id FROM cus_customers WHERE business_id = $1 AND email = $2',
        [businessId, mapped.email],
      );

      if (existing.length > 0) {
        errors.push({ row: rowNum, field: 'email', message: 'Duplicate email in business' });
        skipped++;
        continue;
      }

      // Generate reference number
      const { rows: refRows } = await adminPool.query(
        'SELECT generate_customer_reference($1) AS ref',
        [businessId],
      );

      await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, date_of_birth, gender, preferred_language, country, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tenantId, businessId, refRows[0].ref,
          mapped.email, mapped.first_name, mapped.last_name,
          mapped.phone || null, mapped.date_of_birth || null,
          mapped.gender || null, mapped.preferred_language || 'en',
          mapped.country || null, userId,
        ],
      );

      imported++;
    } catch (err: any) {
      errors.push({ row: rowNum, field: 'general', message: err.message });
      skipped++;
    }
  }

  // Audit log
  await logAudit({
    tenantId,
    userId,
    action: 'customer.import',
    resourceType: 'customer',
    details: { total: rows.length, imported, skipped, errorCount: errors.length },
  });

  logger.info('Customer import complete', { businessId, total: rows.length, imported, skipped });

  return { total: rows.length, imported, skipped, errors };
}

/**
 * Export customers to CSV format.
 */
export async function exportCustomers(
  businessId: string,
  filters?: { lifecycle_stage?: string; search?: string },
  columns?: string[],
): Promise<string> {
  const conditions = ['business_id = $1', "status != 'anonymized'"];
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (filters?.lifecycle_stage) {
    conditions.push(`lifecycle_stage = $${paramIndex++}`);
    params.push(filters.lifecycle_stage);
  }

  if (filters?.search) {
    conditions.push(`(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT * FROM cus_customers WHERE ${where} ORDER BY last_name, first_name`,
    params,
  );

  const exportColumns = columns || ['reference_number', 'email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'lifecycle_stage', 'created_at'];

  // Build CSV
  const csvLines: string[] = [];
  csvLines.push(exportColumns.join(','));

  for (const row of rows) {
    const values = exportColumns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape if contains comma or quote
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvLines.push(values.join(','));
  }

  return csvLines.join('\n');
}

/**
 * Export customer data in GDPR format (JSON with all personal data).
 */
export async function exportGDPR(customerId: string, businessId: string): Promise<object | null> {
  const { rows: custRows } = await adminPool.query(
    'SELECT * FROM cus_customers WHERE id = $1 AND business_id = $2',
    [customerId, businessId],
  );

  if (custRows.length === 0) return null;

  const customer = custRows[0];

  // Get notes
  const { rows: notes } = await adminPool.query(
    'SELECT id, category, created_at FROM cus_notes WHERE customer_id = $1',
    [customerId],
  );

  // Get activities
  const { rows: activities } = await adminPool.query(
    'SELECT activity_type, description, created_at FROM cus_activities WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId],
  );

  // Get preferences
  const { rows: prefs } = await adminPool.query(
    'SELECT * FROM cus_preferences WHERE customer_id = $1',
    [customerId],
  );

  // Get tags
  const { rows: tags } = await adminPool.query(
    `SELECT t.name FROM cus_customer_tags ct JOIN cus_tags t ON t.id = ct.tag_id WHERE ct.customer_id = $1`,
    [customerId],
  );

  return {
    export_date: new Date().toISOString(),
    format: 'GDPR_DATA_EXPORT',
    personal_data: {
      reference_number: customer.reference_number,
      email: customer.email,
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone,
      date_of_birth: customer.date_of_birth,
      gender: customer.gender,
      preferred_language: customer.preferred_language,
      country: customer.country,
      created_at: customer.created_at,
    },
    preferences: prefs[0] || {},
    tags: tags.map((t) => t.name),
    notes_count: notes.length,
    activities,
  };
}
