import { adminPool } from '../db/pool';

/**
 * Import a bank statement from parsed CSV lines.
 */
export async function importStatement(businessId: string, accountName: string, statementDate: string, lines: Array<{ date: string; description: string; amount: number; reference?: string }>) {
  const { rows } = await adminPool.query(
    `INSERT INTO bank_statements (business_id, account_name, statement_date) VALUES ($1,$2,$3) RETURNING *`,
    [businessId, accountName, statementDate],
  );
  const statement = rows[0];

  for (const line of lines) {
    await adminPool.query(
      `INSERT INTO bank_statement_lines (statement_id, date, description, amount, reference) VALUES ($1,$2,$3,$4,$5)`,
      [statement.id, line.date, line.description, line.amount, line.reference || null],
    );
  }

  return { ...statement, line_count: lines.length };
}

/**
 * Get statement lines with reconciliation status.
 */
export async function getStatementLines(statementId: string) {
  const { rows } = await adminPool.query(
    `SELECT bsl.*, je.description AS matched_description
     FROM bank_statement_lines bsl
     LEFT JOIN journal_entries je ON je.id = bsl.matched_entry_id
     WHERE bsl.statement_id = $1 ORDER BY bsl.date`,
    [statementId],
  );
  return rows;
}

/**
 * Match a statement line to a journal entry.
 */
export async function matchLine(lineId: string, journalEntryId: string): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    "UPDATE bank_statement_lines SET reconciliation_status = 'matched', matched_entry_id = $2, reconciled_at = NOW() WHERE id = $1",
    [lineId, journalEntryId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Auto-suggest matches for unmatched lines.
 */
export async function suggestMatches(statementId: string, businessId: string) {
  const { rows: unmatchedLines } = await adminPool.query(
    "SELECT * FROM bank_statement_lines WHERE statement_id = $1 AND reconciliation_status = 'unmatched'",
    [statementId],
  );

  const suggestions: Array<{ line_id: string; suggested_entry_id: string; confidence: number }> = [];

  for (const line of unmatchedLines) {
    // Find journal entries with matching amount within ±2 days
    const { rows: candidates } = await adminPool.query(
      `SELECT je.id, je.description, je.entry_date,
              (SELECT SUM(jel.debit) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS total_debit
       FROM journal_entries je
       WHERE je.business_id = $1 AND je.is_void = false
         AND je.entry_date BETWEEN ($2::date - 2) AND ($2::date + 2)
         AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bsl WHERE bsl.matched_entry_id = je.id)
       LIMIT 5`,
      [businessId, line.date],
    );

    for (const candidate of candidates) {
      const entryAmount = candidate.total_debit || 0;
      if (Math.abs(entryAmount - Math.abs(line.amount)) < 100) { // within €1 tolerance
        suggestions.push({ line_id: line.id, suggested_entry_id: candidate.id, confidence: 0.9 });
      }
    }
  }

  return suggestions;
}

/**
 * Get reconciliation completion percentage for a statement.
 */
export async function getReconciliationStatus(statementId: string) {
  const { rows } = await adminPool.query(
    `SELECT reconciliation_status, COUNT(*)::int AS count FROM bank_statement_lines WHERE statement_id = $1 GROUP BY reconciliation_status`,
    [statementId],
  );

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const matched = rows.find((r) => r.reconciliation_status === 'matched')?.count || 0;
  const percentage = total > 0 ? Math.round((matched / total) * 100) : 0;

  return { total_lines: total, matched, unmatched: total - matched, completion_percentage: percentage };
}
