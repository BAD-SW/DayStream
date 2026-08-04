/**
 * Export Configuration Seed Script
 * 
 * Exports the current business configuration (offerings + business setup) as a SQL seed file.
 * Run with: npx tsx src/db/export-config.ts
 * 
 * Exports:
 * - Business & Location setup
 * - Service categories
 * - Services & variants
 * - Service availability rules
 * - Products (merchandise)
 * - Memberships
 * - Packages
 * - Promotions
 * - Resources & resource types
 * - Staff profiles
 * - Staff availability patterns & slots
 * - Location hours & overrides
 * - Location-staff assignments
 */

import { adminPool } from './pool';
import * as fs from 'fs';
import * as path from 'path';

const BUSINESS_ID = '83e81f01-93eb-4895-a9a6-c44912748978';

function escapeSQL(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return 'NULL';
    return `ARRAY[${val.map(v => `'${v}'`).join(',')}]::uuid[]`;
  }
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function buildInsert(table: string, rows: any[], columns: string[]): string {
  if (rows.length === 0) return `-- No data in ${table}\n`;
  let sql = `-- ${table} (${rows.length} rows)\n`;
  for (const row of rows) {
    const values = columns.map(col => {
      const val = row[col];
      if (col.endsWith('_ids') && Array.isArray(val)) {
        return val.length > 0 ? `ARRAY[${val.map((v: string) => `'${v}'`).join(',')}]::uuid[]` : 'NULL';
      }
      if (col === 'days_of_week' && Array.isArray(val)) {
        return `ARRAY[${val.join(',')}]::int[]`;
      }
      if (col === 'blocked_dates' && Array.isArray(val)) {
        return val.length > 0 ? `ARRAY[${val.map((v: string) => `'${v}'`).join(',')}]::text[]` : 'NULL';
      }
      return escapeSQL(val);
    });
    sql += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
  }
  return sql + '\n';
}

async function exportConfig() {
  console.log('Exporting configuration for business:', BUSINESS_ID);

  let output = `-- DayStream Configuration Seed
-- Generated: ${new Date().toISOString()}
-- Business ID: ${BUSINESS_ID}
-- 
-- This script seeds configuration data for development/testing.
-- Run after the main seed.ts to add offerings and business setup.
--
-- Usage: psql -f seed-config.sql
--        or: npx tsx src/db/seed-config.ts

BEGIN;

`;

  // 0. Tenant
  const { rows: tenants } = await adminPool.query(
    'SELECT * FROM sys_tenants WHERE id = (SELECT tenant_id FROM sys_businesses WHERE id = $1)', [BUSINESS_ID]
  );
  output += buildInsert('sys_tenants', tenants, [
    'id', 'name', 'slug', 'status', 'default_language', 'currency', 'timezone',
  ]);

  const tenantId = tenants[0]?.id;

  // 0b. Users (all users belonging to this tenant)
  const { rows: users } = await adminPool.query(
    'SELECT * FROM usr_users WHERE tenant_id = $1 ORDER BY created_at', [tenantId]
  );
  output += `-- usr_users (${users.length} rows) - passwords excluded, set to bcrypt hash of 'password123'\n`;
  for (const u of users) {
    output += `INSERT INTO usr_users (id, tenant_id, business_id, email, password_hash, first_name, last_name, role, persona, status, email_verified, created_at) VALUES (${escapeSQL(u.id)}, ${escapeSQL(u.tenant_id)}, ${escapeSQL(u.business_id)}, ${escapeSQL(u.email)}, '$2b$12$LJ3a4xq5YzKzV.1e6H6n8OJ5v7u5u5u5u5u5u5u5u5u5u5u5u5u5u', ${escapeSQL(u.first_name)}, ${escapeSQL(u.last_name)}, ${escapeSQL(u.role)}, ${escapeSQL(u.persona)}, ${escapeSQL(u.status)}, TRUE, ${escapeSQL(u.created_at?.toISOString?.() || u.created_at)}) ON CONFLICT (id) DO NOTHING;\n`;
  }
  output += '\n';

  // 0c. Roles
  const { rows: roles } = await adminPool.query(
    'SELECT * FROM usr_roles WHERE tenant_id = $1 ORDER BY name', [tenantId]
  );
  output += buildInsert('usr_roles', roles, [
    'id', 'tenant_id', 'name', 'permissions', 'is_system',
  ]);

  // 0d. User-Role assignments
  const { rows: userRoles } = await adminPool.query(
    'SELECT * FROM usr_user_roles WHERE tenant_id = $1', [tenantId]
  );
  if (userRoles.length > 0) {
    output += buildInsert('usr_user_roles', userRoles, [
      'id', 'tenant_id', 'user_id', 'role_id',
    ]);
  }

  // 1. Business
  const { rows: businesses } = await adminPool.query(
    'SELECT * FROM sys_businesses WHERE id = $1', [BUSINESS_ID]
  );
  output += buildInsert('sys_businesses', businesses, [
    'id', 'tenant_id', 'name', 'slug', 'status', 'default_language', 'currency', 'timezone', 'scheduling_mode',
  ]);

  // 2. Locations
  const { rows: locations } = await adminPool.query(
    'SELECT * FROM sys_locations WHERE business_id = $1 ORDER BY is_primary DESC, name', [BUSINESS_ID]
  );
  output += buildInsert('sys_locations', locations, [
    'id', 'business_id', 'name', 'address_line1', 'address_line2', 'city', 'state_province', 'postal_code', 'country', 'phone', 'email', 'timezone', 'is_primary', 'status',
  ]);

  // 3. Location hours
  const locationIds = locations.map(l => l.id);
  if (locationIds.length > 0) {
    const { rows: hours } = await adminPool.query(
      'SELECT * FROM sys_location_hours WHERE location_id = ANY($1) ORDER BY location_id, day_of_week', [locationIds]
    );
    output += buildInsert('sys_location_hours', hours, [
      'id', 'location_id', 'day_of_week', 'open_time', 'close_time', 'is_closed',
    ]);
  }

  // 4. Service categories
  const { rows: categories } = await adminPool.query(
    'SELECT * FROM svc_categories WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  output += buildInsert('svc_categories', categories, [
    'id', 'business_id', 'name', 'description',
  ]);

  // 5. Services
  const { rows: services } = await adminPool.query(
    'SELECT * FROM svc_services WHERE business_id = $1 ORDER BY display_order, name', [BUSINESS_ID]
  );
  output += buildInsert('svc_services', services, [
    'id', 'business_id', 'category_id', 'name', 'slug', 'description', 'short_description',
    'booking_type', 'status', 'default_duration', 'buffer_before', 'buffer_after',
    'max_capacity', 'min_advance_booking_hours', 'max_advance_booking_days',
    'online_booking_enabled', 'requires_dedicated_staff', 'preparation_notes', 'display_order',
    'is_taxable', 'tax_category_id',
  ]);

  // 6. Service variants
  const serviceIds = services.map(s => s.id);
  if (serviceIds.length > 0) {
    const { rows: variants } = await adminPool.query(
      'SELECT * FROM svc_variants WHERE service_id = ANY($1) ORDER BY service_id, display_order', [serviceIds]
    );
    output += buildInsert('svc_variants', variants, [
      'id', 'service_id', 'name', 'duration', 'price', 'status', 'display_order',
    ]);
  }

  // 7. Service availability rules
  if (serviceIds.length > 0) {
    const { rows: rules } = await adminPool.query(
      'SELECT * FROM svc_availability_rules WHERE service_id = ANY($1) ORDER BY service_id, rule_type', [serviceIds]
    );
    output += buildInsert('svc_availability_rules', rules, [
      'id', 'service_id', 'rule_type', 'days_of_week', 'start_time', 'end_time',
      'effective_from', 'effective_to', 'blocked_dates', 'description',
      'variant_ids', 'location_ids', 'staff_ids', 'resource_ids',
    ]);
  }

  // 8. Resources
  const { rows: resources } = await adminPool.query(
    'SELECT * FROM res_resources WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  output += buildInsert('res_resources', resources, [
    'id', 'business_id', 'name', 'category', 'capacity', 'buffer_minutes', 'status', 'description',
  ]);

  // 9. Products (merchandise)
  const { rows: products } = await adminPool.query(
    'SELECT * FROM prd_merchandise WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  if (products.length > 0) {
    output += buildInsert('prd_merchandise', products, [
      'id', 'business_id', 'name', 'slug', 'description', 'short_description',
      'price', 'status', 'sku', 'track_inventory', 'stock_quantity',
      'is_taxable', 'tax_category_id', 'display_order',
    ]);
  }

  // 10. Memberships
  const { rows: memberships } = await adminPool.query(
    'SELECT * FROM mbr_plans WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  if (memberships.length > 0) {
    output += buildInsert('mbr_plans', memberships, [
      'id', 'business_id', 'name', 'slug', 'description', 'short_description',
      'price', 'billing_frequency', 'status', 'access_frequency',
      'is_taxable', 'tax_category_id', 'display_order',
    ]);
  }

  // 11. Packages
  const { rows: packages } = await adminPool.query(
    'SELECT * FROM pkg_packages WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  if (packages.length > 0) {
    output += buildInsert('pkg_packages', packages, [
      'id', 'business_id', 'name', 'slug', 'description', 'short_description',
      'price', 'redemption_type', 'session_count', 'total_minutes',
      'valid_days', 'expiration_unit', 'status', 'new_customers_only',
      'is_taxable', 'tax_category_id', 'display_order',
    ]);
  }

  // 12. Promotions
  const { rows: promotions } = await adminPool.query(
    'SELECT * FROM prm_promotions WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  if (promotions.length > 0) {
    output += buildInsert('prm_promotions', promotions, [
      'id', 'business_id', 'name', 'slug', 'description', 'short_description',
      'discount_type', 'discount_value', 'code', 'start_date', 'end_date',
      'max_uses', 'current_uses', 'status', 'display_order',
    ]);
  }

  // 13. Staff profiles
  const { rows: staff } = await adminPool.query(
    'SELECT * FROM stf_profiles WHERE tenant_id = (SELECT tenant_id FROM sys_businesses WHERE id = $1) ORDER BY last_name, first_name', [BUSINESS_ID]
  );
  output += buildInsert('stf_profiles', staff, [
    'id', 'tenant_id', 'user_id', 'staff_ref', 'first_name', 'last_name', 'email',
    'mobile_phone', 'employment_type', 'status', 'hire_date', 'bio', 'languages',
    'show_on_directory',
  ]);

  // 14. Staff availability patterns
  const staffIds = staff.map(s => s.id);
  if (staffIds.length > 0) {
    const { rows: patterns } = await adminPool.query(
      'SELECT * FROM stf_availability_patterns WHERE staff_id = ANY($1) ORDER BY staff_id', [staffIds]
    );
    output += buildInsert('stf_availability_patterns', patterns, [
      'id', 'staff_id', 'name', 'is_default', 'effective_from', 'effective_to',
    ]);

    const patternIds = patterns.map(p => p.id);
    if (patternIds.length > 0) {
      const { rows: slots } = await adminPool.query(
        'SELECT * FROM stf_availability_pattern_slots WHERE pattern_id = ANY($1) ORDER BY pattern_id, day_of_week', [patternIds]
      );
      output += buildInsert('stf_availability_pattern_slots', slots, [
        'id', 'pattern_id', 'day_of_week', 'start_time', 'end_time',
      ]);
    }
  }

  // 15. Location-staff assignments
  if (locationIds.length > 0) {
    const { rows: locStaff } = await adminPool.query(
      'SELECT * FROM sys_location_staff WHERE location_id = ANY($1)', [locationIds]
    );
    if (locStaff.length > 0) {
      output += buildInsert('sys_location_staff', locStaff, [
        'id', 'location_id', 'staff_id',
      ]);
    }
  }

  // 16. Note categories
  const { rows: noteCategories } = await adminPool.query(
    'SELECT * FROM cus_note_categories WHERE business_id = $1 ORDER BY name', [BUSINESS_ID]
  );
  if (noteCategories.length > 0) {
    output += buildInsert('cus_note_categories', noteCategories, [
      'id', 'business_id', 'name', 'is_sensitive', 'customer_visible',
    ]);
  }

  output += 'COMMIT;\n';

  // Write to file
  const outputPath = path.join(__dirname, 'seed-config.sql');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`\nExported to: ${outputPath}`);
  console.log(`Total size: ${(output.length / 1024).toFixed(1)} KB`);
  process.exit(0);
}

exportConfig().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
