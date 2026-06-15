import { adminPool } from '../db/pool';

interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
  description?: string;
}

interface CreateJournalEntryInput {
  businessId: string;
  entryDate: string;
  description: string;
  referenceType?: string;
  referenceId?: string;
  lines: JournalLine[];
  createdBy?: string;
}

/**
 * Create a journal entry (validates debits = credits).
 */
export async function createEntry(input: CreateJournalEntryInput) {
  // Validate balance
  const totalDebits = input.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredits = input.lines.reduce((sum, l) => sum + l.credit, 0);
  if (totalDebits !== totalCredits) {
    throw new Error(`Entry does not balance: debits (${totalDebits}) != credits (${totalCredits})`);
  }
  if (totalDebits === 0) {
    throw new Error('Entry must have non-zero amounts');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.businessId, input.entryDate, input.description, input.referenceType || null, input.referenceId || null, input.createdBy || null],
  );

  const entry = rows[0];

  for (const line of input.lines) {
    await adminPool.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1,$2,$3,$4,$5)`,
      [entry.id, line.account_id, line.debit, line.credit, line.description || null],
    );
  }

  return entry;
}

/**
 * Get journal entries (paginated, filterable).
 */
export async function getEntries(businessId: string, filters?: { dateFrom?: string; dateTo?: string; referenceType?: string; page?: number; limit?: number }) {
  const conditions = ['je.business_id = $1', 'je.is_void = false'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.dateFrom) { conditions.push(`je.entry_date >= $${idx++}`); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push(`je.entry_date <= $${idx++}`); params.push(filters.dateTo); }
  if (filters?.referenceType) { conditions.push(`je.reference_type = $${idx++}`); params.push(filters.referenceType); }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters?.limit || 50, 100);
  const page = filters?.page || 1;
  const offset = (page - 1) * limit;

  const { rows } = await adminPool.query(
    `SELECT je.* FROM journal_entries je WHERE ${where} ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  // Load lines for each entry
  for (const entry of rows) {
    const { rows: lines } = await adminPool.query(
      `SELECT jel.*, coa.name AS account_name, coa.code AS account_code
       FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE jel.journal_entry_id = $1`,
      [entry.id],
    );
    entry.lines = lines;
  }

  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total FROM journal_entries je WHERE ${where}`, params,
  );

  return { entries: rows, total: countRows[0].total, page, limit };
}

/**
 * Void a journal entry (creates a reversing entry).
 */
export async function voidEntry(id: string, businessId: string, userId: string): Promise<{ success: boolean; reversing_entry_id?: string; error?: string }> {
  const { rows } = await adminPool.query(
    'SELECT * FROM journal_entries WHERE id = $1 AND business_id = $2 AND is_void = false', [id, businessId],
  );
  if (rows.length === 0) return { success: false, error: 'Entry not found or already voided' };

  const original = rows[0];

  // Load original lines
  const { rows: originalLines } = await adminPool.query(
    'SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1', [id],
  );

  // Create reversing entry (swap debits and credits)
  const { rows: reversingRows } = await adminPool.query(
    `INSERT INTO journal_entries (business_id, entry_date, description, reference_type, reference_id, created_by)
     VALUES ($1, CURRENT_DATE, $2, 'void', $3, $4) RETURNING *`,
    [businessId, `VOID: ${original.description}`, id, userId],
  );

  const reversingEntry = reversingRows[0];

  for (const line of originalLines) {
    await adminPool.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
       VALUES ($1,$2,$3,$4,$5)`,
      [reversingEntry.id, line.account_id, line.credit, line.debit, `Reversal: ${line.description || ''}`],
    );
  }

  // Mark original as void
  await adminPool.query(
    'UPDATE journal_entries SET is_void = true, void_entry_id = $2 WHERE id = $1',
    [id, reversingEntry.id],
  );

  return { success: true, reversing_entry_id: reversingEntry.id };
}
