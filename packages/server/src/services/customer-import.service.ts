import { isValidPhoneNumber } from 'libphonenumber-js';
import { countryNameToIso2 } from '@daystream/shared';
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
 *
 * When `businessId` is provided, also batch-checks emails against existing customers so
 * duplicates surface in the dry-run preview, not just at commit time (customers-page-
 * requirements.md §A1's acceptance criterion — the preview must show duplicate-email rows).
 */
export async function validateRows(
  rows: ImportRow[],
  mapping: ColumnMapping,
  businessId?: string,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const mappedRows = rows.map((row) => applyMapping(row, mapping));

  for (let i = 0; i < mappedRows.length; i++) {
    const rowNum = i + 2; // +2 for 1-indexed + header row
    const mapped = mappedRows[i];

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

    // Validate phone against the row's country, when both are present.
    if (mapped.phone && mapped.phone.trim() !== '' && mapped.country) {
      const iso2 = countryNameToIso2(mapped.country);
      if (iso2 && !isValidPhoneNumber(mapped.phone, iso2 as any)) {
        errors.push({ row: rowNum, field: 'phone', message: `Invalid phone number for ${mapped.country}` });
      }
    }
  }

  // Batch duplicate-email check against existing customers in this business.
  if (businessId) {
    const emails = mappedRows.map((m) => m.email?.trim().toLowerCase()).filter((e): e is string => !!e);
    if (emails.length > 0) {
      const { rows: existing } = await adminPool.query(
        'SELECT LOWER(email) AS email FROM cus_customers WHERE business_id = $1 AND LOWER(email) = ANY($2)',
        [businessId, emails],
      );
      const existingEmails = new Set(existing.map((r) => r.email));
      for (let i = 0; i < mappedRows.length; i++) {
        const email = mappedRows[i].email?.trim().toLowerCase();
        if (email && existingEmails.has(email)) {
          errors.push({ row: i + 2, field: 'email', message: 'Duplicate email in business' });
        }
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
export async function validateImport(
  csvText: string,
  mapping: ColumnMapping,
  businessId?: string,
): Promise<{ valid: boolean; total: number; errors: ValidationError[] }> {
  const { rows } = parseCSV(csvText);
  const errors = await validateRows(rows, mapping, businessId);
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
  const errors = await validateRows(rows, mapping, businessId);

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
interface ExportFilters {
  lifecycle_stage?: string;
  search?: string;
  ref?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_from?: string;
  created_to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export async function exportCustomers(
  businessId: string,
  filters?: ExportFilters,
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

  const containsFilters: [string | undefined, string][] = [
    [filters?.ref, 'reference_number'],
    [filters?.first_name, 'first_name'],
    [filters?.last_name, 'last_name'],
    [filters?.email, 'email'],
    [filters?.phone, 'phone'],
  ];
  for (const [value, column] of containsFilters) {
    if (value) {
      conditions.push(`${column} ILIKE $${paramIndex}`);
      params.push(`%${value}%`);
      paramIndex++;
    }
  }

  if (filters?.created_from) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.created_from);
  }
  if (filters?.created_to) {
    conditions.push(`created_at < ($${paramIndex++}::date + INTERVAL '1 day')`);
    params.push(filters.created_to);
  }

  const sortWhitelist = ['first_name', 'last_name', 'email', 'phone', 'reference_number', 'created_at', 'lifecycle_stage'];
  const sort = sortWhitelist.includes(filters?.sort || '') ? filters!.sort : 'last_name';
  const order = filters?.order === 'desc' ? 'DESC' : 'ASC';

  const where = conditions.join(' AND ');
  const { rows } = await adminPool.query(
    `SELECT * FROM cus_customers WHERE ${where} ORDER BY ${sort} ${order}${sort !== 'first_name' ? ', first_name' : ''}`,
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
