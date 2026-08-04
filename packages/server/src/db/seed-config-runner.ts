/**
 * Seed Config Runner
 * 
 * Applies the seed-config.sql file to the database.
 * This seeds the Transcend Health business configuration (offerings, resources, staff, etc.)
 * 
 * Usage: npm run seed:config
 * 
 * Prerequisites: 
 *   - Database must be running with migrations applied (npm run migrate:dev)
 *   - Base seed should be run first if needed (npm run seed:dev)
 */

import * as fs from 'fs';
import * as path from 'path';
import { adminPool } from './pool';

async function runSeedConfig() {
  const sqlPath = path.join(__dirname, 'seed-config.sql');

  if (!fs.existsSync(sqlPath)) {
    console.error('❌ seed-config.sql not found. Run the export first: npx tsx src/db/export-config.ts');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf-8');
  console.log('🔄 Applying configuration seed...');

  try {
    await adminPool.query(sql);
    console.log('✓ Configuration seed applied successfully.');
  } catch (err: any) {
    console.error('❌ Seed failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.where) console.error('   Where:', err.where);
    process.exit(1);
  }

  process.exit(0);
}

runSeedConfig();
