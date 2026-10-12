import { adminPool } from '../../src/db/pool';

const SEED_BUSINESS_ID = '00000000-0000-0000-0000-000000000002';

let businessTables: string[] | null = null;

/**
 * Empties a dedicated TEST business so a test file starts from the same state on every
 * run (the tests share the development database and used to trip over their own
 * leftovers: duplicate emails, tag names, references).
 *
 * Deletes every row carrying this business_id, in whatever order the foreign keys
 * allow, and keeps the business row and its users. Refuses the seeded demo business.
 */
export async function resetBusinessData(businessId: string): Promise<void> {
  if (!businessId || businessId === SEED_BUSINESS_ID) {
    throw new Error('resetBusinessData is only for dedicated test businesses');
  }
  if (!businessTables) {
    const { rows } = await adminPool.query(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
        WHERE c.table_schema = 'public' AND c.column_name = 'business_id' AND t.table_type = 'BASE TABLE'
          AND c.table_name NOT IN ('sys_businesses', 'usr_users')`,
    );
    businessTables = rows.map((r: any) => r.table_name);
  }

  let pending = [...businessTables];
  for (let pass = 0; pass < 8 && pending.length > 0; pass++) {
    const blocked: string[] = [];
    for (const table of pending) {
      try {
        await adminPool.query(`DELETE FROM "${table}" WHERE business_id = $1`, [businessId]);
      } catch {
        blocked.push(table); // still referenced by a table not emptied yet — retry next pass
      }
    }
    if (blocked.length === pending.length) break; // no progress; leave the rest
    pending = blocked;
  }
}
