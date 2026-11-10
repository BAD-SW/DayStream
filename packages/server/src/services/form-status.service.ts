import { adminPool } from '../db/pool';
import { isSignedForm } from '@daystream/shared';
import type { FormApplies, FormDefinition } from '@daystream/shared';

/**
 * Which forms a customer still needs to complete (spec 51, gap 1, design 1.8).
 *
 * The status is information for staff. It never blocks a booking or a check-in.
 *
 *  - optional:    the form has no rules, so it is never required; staff use it when they choose
 *  - not_needed:  it has rules, and they don't apply to this customer or booking
 *  - done:        completed, and within its renewal period if it has one
 *  - missing:     it applies and has never been completed
 *  - out_of_date: it applies and the last completion is older than the renewal period
 */
export type FormStatus = 'optional' | 'not_needed' | 'done' | 'missing' | 'out_of_date';

export interface FormGroupRules {
  applies: FormApplies;
  renewAfterMonths: number | null;
}

export interface StatusContext {
  /** The customer already has a completed (or checked-in) visit. */
  hasVisited: boolean;
  /** Services of the booking being looked at, or of the customer's upcoming bookings. */
  serviceIds: ReadonlySet<string>;
  /** When the customer last completed this form, if ever. */
  lastCompletedAt: Date | null;
  now: Date;
}

/** Whole calendar months from `from` to `to`, rounded down. */
function monthsBetween(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return m;
}

export function formStatusFor(rules: FormGroupRules, ctx: StatusContext): FormStatus {
  const hasRules = !!rules.applies.first_visit || (rules.applies.service_ids?.length ?? 0) > 0;
  const expired = !!ctx.lastCompletedAt && rules.renewAfterMonths !== null
    && monthsBetween(ctx.lastCompletedAt, ctx.now) >= rules.renewAfterMonths;

  if (!hasRules) return 'optional';

  const needsFirstVisit = !!rules.applies.first_visit && !ctx.hasVisited;
  const needsForService = (rules.applies.service_ids ?? []).some((id) => ctx.serviceIds.has(id));
  const applies = needsFirstVisit || needsForService;

  if (ctx.lastCompletedAt) {
    if (!expired) return 'done';
    return applies ? 'out_of_date' : 'not_needed';
  }
  return applies ? 'missing' : 'not_needed';
}

export interface CustomerFormStatus {
  groupId: string;
  name: string;
  signed: boolean;
  languages: (string | null)[];
  renewAfterMonths: number | null;
  status: FormStatus;
  lastCompletedAt: string | null;
  lastSubmissionId: string | null;
}

interface Group extends FormGroupRules {
  groupId: string;
  name: string;
  signed: boolean;
  languages: (string | null)[];
}

/** The business's active forms, one entry per form (its language versions folded together). */
async function loadGroups(businessId: string): Promise<Group[]> {
  const { rows } = await adminPool.query(
    `SELECT group_id, name, language, definition, applies, renew_after_months
       FROM frm_forms
      WHERE business_id = $1 AND status = 'active' AND is_active = true
      ORDER BY (language IS NOT NULL), language, name`,
    [businessId],
  );
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const existing = groups.get(r.group_id);
    if (existing) { existing.languages.push(r.language); continue; }
    groups.set(r.group_id, {
      groupId: r.group_id,
      name: r.name,
      signed: isSignedForm(r.definition as FormDefinition),
      languages: [r.language],
      applies: r.applies ?? {},
      renewAfterMonths: r.renew_after_months,
    });
  }
  return [...groups.values()];
}

/** Forms for one customer, optionally in the context of one booking. */
export async function getCustomerFormStatus(
  businessId: string, customerId: string, bookingId?: string | null, serviceId?: string | null,
): Promise<CustomerFormStatus[]> {
  const groups = await loadGroups(businessId);
  if (groups.length === 0) return [];

  const [{ rows: visits }, { rows: subs }] = await Promise.all([
    adminPool.query(
      `SELECT 1 FROM apt_bookings WHERE customer_id = $1 AND status IN ('completed', 'checked_in') LIMIT 1`,
      [customerId],
    ),
    adminPool.query(
      `SELECT DISTINCT ON (group_id) group_id, id, created_at
         FROM frm_submissions WHERE business_id = $1 AND customer_id = $2
        ORDER BY group_id, created_at DESC`,
      [businessId, customerId],
    ),
  ]);

  // One service while a booking is being made, one booking if given, otherwise the customer's upcoming ones.
  const { rows: svc } = serviceId
    ? { rows: [{ service_id: serviceId }] }
    : bookingId
      ? await adminPool.query(
        `SELECT service_id FROM apt_bookings WHERE id = $1 AND customer_id = $2`, [bookingId, customerId])
      : await adminPool.query(
      `SELECT DISTINCT service_id FROM apt_bookings
        WHERE customer_id = $1 AND start_time > NOW() AND status NOT IN ('cancelled', 'no_show')`, [customerId]);
  const serviceIds = new Set<string>(svc.map((r: { service_id: string }) => r.service_id));
  const last = new Map<string, { id: string; at: Date }>(
    subs.map((r: { group_id: string; id: string; created_at: Date }) => [r.group_id, { id: r.id, at: new Date(r.created_at) }]),
  );

  const now = new Date();
  return groups.map((g) => {
    const l = last.get(g.groupId);
    return {
      groupId: g.groupId,
      name: g.name,
      signed: g.signed,
      languages: g.languages,
      renewAfterMonths: g.renewAfterMonths,
      status: formStatusFor(g, { hasVisited: visits.length > 0, serviceIds, lastCompletedAt: l?.at ?? null, now }),
      lastCompletedAt: l ? l.at.toISOString() : null,
      lastSubmissionId: l?.id ?? null,
    };
  });
}

/**
 * For booking detail and the check-in list: how many forms each booking's customer still needs
 * (missing or out of date). One round of queries for the whole list.
 */
export interface OutstandingForms {
  count: number;
  forms: { groupId: string; name: string; status: 'missing' | 'out_of_date' }[];
}

export async function countOutstandingForBookings(
  businessId: string, bookingIds: string[],
): Promise<Record<string, OutstandingForms>> {
  const out: Record<string, OutstandingForms> = {};
  const ids = [...new Set(bookingIds)].slice(0, 500);
  if (ids.length === 0) return out;
  for (const id of ids) out[id] = { count: 0, forms: [] };

  const groups = await loadGroups(businessId);
  const ruled = groups.filter((g) => g.applies.first_visit || (g.applies.service_ids?.length ?? 0) > 0);
  if (ruled.length === 0) return out;

  const { rows: bookings } = await adminPool.query(
    `SELECT id, customer_id, service_id FROM apt_bookings WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [businessId, ids],
  );
  const customerIds = [...new Set<string>(bookings.map((b: { customer_id: string }) => b.customer_id))];
  if (customerIds.length === 0) return out;

  const [{ rows: visited }, { rows: subs }] = await Promise.all([
    adminPool.query(
      `SELECT DISTINCT customer_id FROM apt_bookings
        WHERE customer_id = ANY($1::uuid[]) AND status IN ('completed', 'checked_in')`,
      [customerIds],
    ),
    adminPool.query(
      `SELECT customer_id, group_id, MAX(created_at) AS last_at FROM frm_submissions
        WHERE business_id = $1 AND customer_id = ANY($2::uuid[]) GROUP BY customer_id, group_id`,
      [businessId, customerIds],
    ),
  ]);
  const hasVisited = new Set<string>(visited.map((r: { customer_id: string }) => r.customer_id));
  const lastAt = new Map<string, Date>(
    subs.map((r: { customer_id: string; group_id: string; last_at: Date }) => [`${r.customer_id}:${r.group_id}`, new Date(r.last_at)]),
  );

  const now = new Date();
  for (const b of bookings as { id: string; customer_id: string; service_id: string }[]) {
    const needed: OutstandingForms['forms'] = [];
    for (const g of ruled) {
      const status = formStatusFor(g, {
        hasVisited: hasVisited.has(b.customer_id),
        serviceIds: new Set([b.service_id]),
        lastCompletedAt: lastAt.get(`${b.customer_id}:${g.groupId}`) ?? null,
        now,
      });
      if (status === 'missing' || status === 'out_of_date') needed.push({ groupId: g.groupId, name: g.name, status });
    }
    out[b.id] = { count: needed.length, forms: needed };
  }
  return out;
}
