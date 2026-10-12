import { adminPool } from '../../src/db/pool';

const SEED_BUSINESS_ID = '00000000-0000-0000-0000-000000000002';

let businessTables: string[] | null = null;
let personReferences: Array<{ table: string; column: string }> | null = null;

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

  // Rows that point at this business's people from tables without a business_id (points,
  // streaks, campaign recipients...) would block deleting the people, so they go first.
  if (!personReferences) {
    const { rows } = await adminPool.query(
      `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'cus_customers'::regclass AND array_length(c.conkey, 1) = 1
          AND c.conrelid <> 'cus_customers'::regclass`,
    );
    personReferences = rows;
  }
  await adminPool.query('UPDATE cus_customers SET merged_into_id = NULL WHERE business_id = $1 AND merged_into_id IS NOT NULL', [businessId]);
  let refsPending = [...personReferences!];
  for (let pass = 0; pass < 4 && refsPending.length > 0; pass++) {
    const blocked: typeof refsPending = [];
    for (const ref of refsPending) {
      try {
        await adminPool.query(
          `DELETE FROM ${ref.table} WHERE "${ref.column}" IN (SELECT id FROM cus_customers WHERE business_id = $1)`,
          [businessId],
        );
      } catch {
        blocked.push(ref);
      }
    }
    if (blocked.length === refsPending.length) break;
    refsPending = blocked;
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

/**
 * Removes individual people (and whatever points at them) by email pattern. For the few
 * tests that have to create a person in a business they do not own, such as the seeded
 * one: registration and tenant-level lead forms.
 */
export async function deletePeopleByEmail(emailLike: string): Promise<void> {
  const { rows: people } = await adminPool.query('SELECT id FROM cus_customers WHERE email LIKE $1', [emailLike]);
  if (people.length === 0) return;
  const ids = people.map((p: any) => p.id);
  const { rows: refs } = await adminPool.query(
    `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'cus_customers'::regclass AND array_length(c.conkey, 1) = 1
        AND c.conrelid <> 'cus_customers'::regclass`,
  );
  for (let pass = 0; pass < 4; pass++) {
    for (const ref of refs) {
      await adminPool.query(`DELETE FROM ${ref.table} WHERE "${ref.column}" = ANY($1::uuid[])`, [ids]).catch(() => {});
    }
  }
  await adminPool.query('DELETE FROM cus_customers WHERE id = ANY($1::uuid[])', [ids]);
}
