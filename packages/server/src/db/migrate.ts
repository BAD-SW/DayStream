import path from 'path';
import fs from 'fs';
import { pool } from './pool';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const client = await pool.connect();

  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Read migration files, sorted numerically
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Get already-applied migrations
    const { rows: applied } = await client.query('SELECT filename FROM migrations');
    const appliedSet = new Set(applied.map((r) => r.filename));

    // Apply unapplied migrations
    let appliedCount = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ Applied: ${file}`);
        appliedCount++;
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(`  ✗ Failed: ${file}`);
        console.error(`    ${err.message}`);
        process.exit(1);
      }
    }

    if (appliedCount === 0) {
      console.log('  All migrations already applied.');
    } else {
      console.log(`\n  ${appliedCount} migration(s) applied.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

console.log('\n🔄 Running migrations...\n');
migrate()
  .then(() => {
    console.log('\n✓ Migration complete.\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Migration failed:', err.message);
    process.exit(1);
  });
