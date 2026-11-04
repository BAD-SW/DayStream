import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import { evaluateRules } from '../src/services/customer-segments.service';

/**
 * Segment filters added for the Inbox (THE-18): visits, future bookings, address (smart match),
 * membership state, birthday (incl. "next month"), age, tags, service, location / resource, groups.
 * Own business, known data; each test checks exactly who matches.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BIZ: string;
const P: Record<string, string> = {};
let SERVICE: string; let PLAN: string; let TAG: string; let LOCATION: string; let RESOURCE: string;

const who = async (rules: any[], logic: 'AND' | 'OR' = 'AND') =>
  (await evaluateRules({ logic, rules }, BIZ, 1, 100)).members.map((m: any) => m.first_name).sort();

async function cleanup() {
  await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM mbr_enrollments WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM mbr_plans WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM cus_customer_tags WHERE customer_id IN (SELECT id FROM cus_customers WHERE business_id = $1)', [BIZ]);
  await adminPool.query('DELETE FROM cus_tags WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM res_resources WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM svc_variants WHERE service_id IN (SELECT id FROM svc_services WHERE business_id = $1)', [BIZ]);
  await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM sys_locations WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM cus_customers WHERE business_id = $1', [BIZ]);
}

describe('Segment filters (THE-18)', () => {
  beforeAll(async () => {
    BIZ = (await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status, timezone) VALUES ($1, 'Segment Filters Biz', 'segment-filters-biz', 'active', 'Europe/Madrid')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [TENANT_ID],
    )).rows[0].id;
    await cleanup();
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const people: Array<[string, string | null, string | null, string | null]> = [
      // name, date of birth, street, city
      ['Ana', `1990-${iso(nextMonth).slice(5)}`, 'Avenida Jaume III, 12', 'Palma'],
      ['Bea', '1960-01-01', 'C/ Sant Miquel 5', 'Palma'],
      ['Carla', '2005-06-15', 'McAllister Avenue 3', 'Inca'],
      ['Dani', null, null, null],
    ];
    for (const [i, [name, dob, street, city]] of people.entries()) {
      P[name] = (await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, first_name, last_name, email, date_of_birth, address_line, city)
         VALUES ($1, $2, $3, $4, 'Seg', $5, $6, $7, $8) RETURNING id`,
        [TENANT_ID, BIZ, `SEG-${i}`, name, `${name.toLowerCase()}@segment-filters.test`, dob, street, city],
      )).rows[0].id;
    }
    LOCATION = (await adminPool.query(`INSERT INTO sys_locations (business_id, name, slug) VALUES ($1, 'North', 'seg-north') RETURNING id`, [BIZ])).rows[0].id;
    RESOURCE = (await adminPool.query(`INSERT INTO res_resources (tenant_id, business_id, location_id, name) VALUES ($1, $2, $3, 'Float Room') RETURNING id`, [TENANT_ID, BIZ, LOCATION])).rows[0].id;
    const cat = (await adminPool.query(`INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Seg Cat') RETURNING id`, [BIZ])).rows[0].id;
    SERVICE = (await adminPool.query(`INSERT INTO svc_services (business_id, category_id, name, slug, status) VALUES ($1, $2, 'Float', 'seg-float', 'active') RETURNING id`, [BIZ, cat])).rows[0].id;
    const variant = (await adminPool.query(`INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 5000, 'active') RETURNING id`, [SERVICE])).rows[0].id;
    const booking = (cust: string, daysFromNow: number, status: string, resource: string | null = null) => adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, resource_id, start_time, end_time, status, booking_reference, booking_type, price)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * INTERVAL '1 day'), NOW() + ($6::int * INTERVAL '1 day') + INTERVAL '1 hour', $7, $8, 'individual', 5000)`,
      [BIZ, cust, SERVICE, variant, resource, daysFromNow, status, `SEG-${Math.random().toString(36).slice(2, 10)}`],
    );
    // Ana: 3 past visits (one at the Float Room), 1 future booking. Bea: 1 past visit long ago. Carla: 2 future bookings.
    await booking(P.Ana, -5, 'completed', RESOURCE); await booking(P.Ana, -10, 'completed'); await booking(P.Ana, -20, 'checked_in');
    await booking(P.Ana, 3, 'confirmed');
    await booking(P.Bea, -200, 'completed');
    await booking(P.Carla, 2, 'confirmed'); await booking(P.Carla, 40, 'pending');
    PLAN = (await adminPool.query(`INSERT INTO mbr_plans (business_id, name, price, status) VALUES ($1, 'Unlimited', 5000, 'active') RETURNING id`, [BIZ])).rows[0].id;
    await adminPool.query(
      `INSERT INTO mbr_enrollments (plan_id, business_id, customer_id, status, start_date, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'active', '2026-01-01', '2026-11-01', '2026-11-30'), ($1, $2, $4, 'cancelled', '2025-01-01', '2025-01-01', '2025-01-31')`,
      [PLAN, BIZ, P.Ana, P.Bea],
    );
    TAG = (await adminPool.query(`INSERT INTO cus_tags (business_id, name) VALUES ($1, 'VIP') RETURNING id`, [BIZ])).rows[0].id;
    await adminPool.query(`INSERT INTO cus_customer_tags (customer_id, tag_id) VALUES ($1, $2), ($3, $2)`, [P.Ana, TAG, P.Carla]);
  });
  afterAll(cleanup);

  it('visits: more than N, in the last X days, at a location', async () => {
    expect(await who([{ field: 'visits', operator: 'gt', value: { count: 2 } }])).toEqual(['Ana']);
    expect(await who([{ field: 'visits', operator: 'eq', value: { count: 1 } }])).toEqual(['Bea']);
    expect(await who([{ field: 'visits', operator: 'gt', value: { count: 0, within_days: 30 } }])).toEqual(['Ana']);
    expect(await who([{ field: 'visits', operator: 'eq', value: { count: 1, location_id: LOCATION } }])).toEqual(['Ana']);
    expect(await who([{ field: 'visits', operator: 'gt', value: { count: 0, membership_plan_id: PLAN } }])).toEqual(['Ana']);
  });

  it('future bookings: count, within X days', async () => {
    expect(await who([{ field: 'future_bookings', operator: 'gt', value: { count: 1 } }])).toEqual(['Carla']);
    expect(await who([{ field: 'future_bookings', operator: 'eq', value: { count: 1, within_days: 7 } }])).toEqual(['Ana', 'Carla']);
  });

  it('address: abbreviations, accents and missing words match; any filled part counts', async () => {
    expect(await who([{ field: 'address', operator: 'eq', value: { street: 'av. jaume iii' } }])).toEqual(['Ana']);
    expect(await who([{ field: 'address', operator: 'eq', value: { street: 'Calle Sant Miquel' } }])).toEqual(['Bea']);
    expect(await who([{ field: 'address', operator: 'eq', value: { street: 'McAllister' } }])).toEqual(['Carla']);
    expect(await who([{ field: 'address', operator: 'eq', value: { city: 'PALMA' } }])).toEqual(['Ana', 'Bea']);
    expect(await who([{ field: 'address', operator: 'eq', value: { street: 'Sant Miquel', city: 'Inca' } }])).toEqual([]);
  });

  it('membership: active, cancelled, never, not active', async () => {
    expect(await who([{ field: 'membership', operator: 'eq', value: { plan_id: PLAN, state: 'active' } }])).toEqual(['Ana']);
    expect(await who([{ field: 'membership', operator: 'eq', value: { plan_id: PLAN, state: 'cancelled' } }])).toEqual(['Bea']);
    expect(await who([{ field: 'membership', operator: 'eq', value: { plan_id: PLAN, state: 'never' } }])).toEqual(['Carla', 'Dani']);
    expect(await who([{ field: 'membership', operator: 'eq', value: { plan_id: PLAN, state: 'not_active' } }])).toEqual(['Bea', 'Carla', 'Dani']);
  });

  it('birthday next month (follows the calendar), exact day; age', async () => {
    expect(await who([{ field: 'birthday', operator: 'eq', value: { mode: 'next_month' } }])).toEqual(['Ana']);
    expect(await who([{ field: 'birthday', operator: 'eq', value: { mode: 'date', date: '01-01' } }])).toEqual(['Bea']);
    expect(await who([{ field: 'birthday', operator: 'eq', value: { mode: 'between', from: '12-31', to: '01-05' } }])).toEqual(['Bea']);
    expect(await who([{ field: 'age', operator: 'between', value: { min: 18, max: 40 } }])).toEqual(['Ana', 'Carla']);
  });

  it('tags any / none, service past / future, resource', async () => {
    expect(await who([{ field: 'tags', operator: 'in', value: { mode: 'any', tag_ids: [TAG] } }])).toEqual(['Ana', 'Carla']);
    expect(await who([{ field: 'tags', operator: 'in', value: { mode: 'none', tag_ids: [TAG] } }])).toEqual(['Bea', 'Dani']);
    expect(await who([{ field: 'service', operator: 'eq', value: { service_id: SERVICE } }])).toEqual(['Ana', 'Bea', 'Carla']);
    expect(await who([{ field: 'service', operator: 'eq', value: { service_id: SERVICE, when: 'future' } }])).toEqual(['Ana', 'Carla']);
    expect(await who([{ field: 'resource', operator: 'eq', value: { resource_id: RESOURCE } }])).toEqual(['Ana']);
    expect(await who([{ field: 'location', operator: 'eq', value: { location_id: LOCATION } }])).toEqual(['Ana']);
  });

  it('combines conditions with a group (all of … and any of …)', async () => {
    const rules = [
      { field: 'tags', operator: 'in', value: { mode: 'any', tag_ids: [TAG] } },
      { field: 'group', operator: 'eq', value: { logic: 'OR', rules: [
        { field: 'future_bookings', operator: 'gt', value: { count: 1 } },
        { field: 'membership', operator: 'eq', value: { plan_id: PLAN, state: 'active' } },
      ] } },
    ];
    expect(await who(rules)).toEqual(['Ana', 'Carla']);
    expect(await who([...rules, { field: 'address', operator: 'eq', value: { city: 'Inca' } }])).toEqual(['Carla']);
  });
});
