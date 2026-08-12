/**
 * Import Kontur Population Data into prp_population_lookup table.
 * 
 * Data source: https://data.humdata.org/dataset/kontur-population-dataset
 * Download the GeoPackage (.gpkg) file for the desired country.
 * 
 * Prerequisites:
 *   1. Install ogr2ogr (part of GDAL): https://gdal.org/download.html
 *   2. Download the Kontur population file for your country
 *   3. Convert to CSV: ogr2ogr -f CSV output.csv kontur_population_US.gpkg -sql "SELECT h3, population FROM kontur_population"
 *   4. Run this script: npx tsx scripts/import-population.ts ./output.csv
 * 
 * The CSV should have columns: h3, population
 * 
 * Usage: npx tsx scripts/import-population.ts <path-to-csv>
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { adminPool } from '../src/db/pool';

const BATCH_SIZE = 5000;
const MIN_POPULATION = 1; // Only import hexagons with at least 1 person

async function importPopulation(csvPath: string) {
  console.log(`Importing population data from: ${csvPath}`);

  const stream = createReadStream(csvPath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: { h3: string; pop: number }[] = [];
  let totalImported = 0;
  let lineCount = 0;
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; } // Skip header
    lineCount++;

    const parts = line.split(',');
    const h3Index = parts[0]?.trim().replace(/"/g, '');
    const population = parseInt(parts[1]?.trim() || '0');

    if (!h3Index || population < MIN_POPULATION) continue;

    batch.push({ h3: h3Index, pop: population });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch);
      totalImported += batch.length;
      batch = [];
      if (totalImported % 50000 === 0) {
        console.log(`  ...imported ${totalImported} hexagons (${lineCount} lines processed)`);
      }
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await insertBatch(batch);
    totalImported += batch.length;
  }

  console.log(`\nDone! Imported ${totalImported} populated hexagons from ${lineCount} total lines.`);
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
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: npx tsx scripts/import-population.ts <path-to-csv>');
  console.error('\nTo get the CSV:');
  console.error('  1. Download from https://data.humdata.org/dataset/kontur-population-dataset');
  console.error('  2. Convert: ogr2ogr -f CSV output.csv kontur_population_US.gpkg -sql "SELECT h3, population FROM kontur_population"');
  process.exit(1);
}

importPopulation(csvPath).catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
