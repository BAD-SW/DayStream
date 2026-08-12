/**
 * Import Kontur Population Data from a GeoPackage (.gpkg) file.
 * 
 * GeoPackage files are SQLite databases — we read them directly.
 * 
 * Data source: https://data.humdata.org/dataset/kontur-population-dataset
 * 
 * Usage: npx tsx scripts/import-population.ts <path-to-gpkg-file>
 * Example: npx tsx scripts/import-population.ts ./kontur_population_US_20231101.gpkg
 */

import Database from 'better-sqlite3';
import { adminPool } from '../src/db/pool';

const BATCH_SIZE = 5000;
const MIN_POPULATION = 1;

async function importPopulation(gpkgPath: string) {
  console.log(`Opening GeoPackage: ${gpkgPath}`);

  // Open the GeoPackage (SQLite) file
  const db = new Database(gpkgPath, { readonly: true });

  // Discover table name (Kontur files typically use 'kontur_population' or similar)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log('Tables found:', tables.map(t => t.name).join(', '));

  // Find the population table
  const popTable = tables.find(t => t.name.includes('population') || t.name.includes('kontur'));
  if (!popTable) {
    console.error('Could not find population table. Tables:', tables.map(t => t.name));
    process.exit(1);
  }
  console.log(`Using table: ${popTable.name}`);

  // Check columns
  const columns = db.prepare(`PRAGMA table_info(${popTable.name})`).all() as { name: string }[];
  console.log('Columns:', columns.map(c => c.name).join(', '));

  // Find the h3 and population columns
  const h3Col = columns.find(c => c.name.toLowerCase() === 'h3' || c.name.toLowerCase() === 'h3_index' || c.name.toLowerCase() === 'hex_id');
  const popCol = columns.find(c => c.name.toLowerCase() === 'population' || c.name.toLowerCase() === 'pop' || c.name.toLowerCase() === 'population_count');

  if (!h3Col || !popCol) {
    console.error(`Could not find h3 and population columns. Available: ${columns.map(c => c.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`Using columns: h3=${h3Col.name}, population=${popCol.name}`);

  // Count total rows
  const countResult = db.prepare(`SELECT COUNT(*) as cnt FROM ${popTable.name} WHERE ${popCol.name} >= ${MIN_POPULATION}`).get() as { cnt: number };
  console.log(`Total rows with population >= ${MIN_POPULATION}: ${countResult.cnt}`);

  // Read and import in batches
  const stmt = db.prepare(`SELECT ${h3Col.name} as h3, ${popCol.name} as population FROM ${popTable.name} WHERE ${popCol.name} >= ${MIN_POPULATION}`);

  let batch: { h3: string; pop: number }[] = [];
  let totalImported = 0;

  for (const row of stmt.iterate()) {
    const r = row as { h3: string; population: number };
    batch.push({ h3: r.h3, pop: Math.round(r.population) });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch);
      totalImported += batch.length;
      batch = [];
      if (totalImported % 50000 === 0) {
        console.log(`  ...imported ${totalImported} / ${countResult.cnt} hexagons`);
      }
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await insertBatch(batch);
    totalImported += batch.length;
  }

  db.close();
  console.log(`\nDone! Imported ${totalImported} populated hexagons.`);
  process.exit(0);
}

async function insertBatch(batch: { h3: string; pop: number }[]) {
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const item of batch) {
    values.push(`($${idx++}, $${idx++})`);
    params.push(item.h3, item.pop);
  }

  await adminPool.query(
    `INSERT INTO prp_population_lookup (h3_index, population) VALUES ${values.join(', ')}
     ON CONFLICT (h3_index) DO UPDATE SET population = EXCLUDED.population`,
    params,
  );
}

// Run
const gpkgPath = process.argv[2];
if (!gpkgPath) {
  console.error('Usage: npx tsx scripts/import-population.ts <path-to-gpkg-file>');
  console.error('\nDownload from: https://data.humdata.org/dataset/kontur-population-dataset');
  process.exit(1);
}

importPopulation(gpkgPath).catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
