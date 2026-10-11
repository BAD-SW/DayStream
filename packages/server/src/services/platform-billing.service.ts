import { adminPool } from '../db/pool';
import { getConfiguredAdapter } from './payments';
import { resolveConnectedAccount, getProviderToken, getCustomerRef } from './payment-methods.service';
import { getDecryptedSecrets } from './processor-config.service';
import { logAudit } from './audit.service';

/** Build an array of {field, from, to} for fields that changed between two objects. */
function diffFields(
  before: Record<string, any> | null,
  after: Record<string, any>,
  fields: string[],
): { field: string; from: any; to: any }[] {
  const changes: { field: string; from: any; to: any }[] = [];
  for (const f of fields) {
    const from = before ? before[f] : undefined;
    const to = after[f];
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field: f, from: from ?? null, to });
  }
  return changes;
}

/**
 * Platform Billing service (spec phase 10, Section A — DayStream → Tenant).
 *
 * Computes and settles what DayStream charges a tenant each month, from the
 * tenant's negotiated plan (flat + percentage of net collections, optional cap,
 * intro period), billed in arrears and charged automatically against the tenant's
 * stored payment method — the "charging party owns the vault" model routes the
 * charge through DayStream's (platform) processor connection.
 *
 * "Bill what it's told": this layer decides the amount and timing; the provider
 * only executes the single charge.
 *
 * Net collections (the % basis) come from pay_tenant_net_collections, populated by
 * Section B. Until Section B lands those rows are absent and the basis is zero, so
 * percentage-only plans compute to zero and flat plans are unaffected.
 */

export interface BillingCycle {
  year: number;
  month: number; // 1-12
}

/** Audit context for a charge attempt: which run (if any) and how it was triggered. */
export interface RunContext {
  executionId: string | null;      // sys_job_executions id, null for manual
  trigger: 'scheduled' | 'manual';
}

const MANUAL_RUN: RunContext = { executionId: null, trigger: 'manual' };

interface TenantBillingPlan {
  id: string;
  tenant_id: string;
  flat_amount_cents: number;
  percentage_rate: string;        // NUMERIC comes back as string from pg
  cap_amount_cents: number | null;
  cap_applies_to: 'percentage' | 'combined';
  intro_period_months: number;
  intro_flat_amount_cents: number;
  intro_percentage_rate: string;
  billing_day: number;
  plan_start_date: string;        // YYYY-MM-DD
}

export interface ComputedCharge {
  tenantId: string;
  planId: string | null;
  cycle: BillingCycle;
  flatComponentCents: number;
  netCollectionsCents: number;
  percentageRate: number;
  percentageComponentCents: number;
  capAppliedCents: number | null;
  creditAppliedCents: number;
  amountChargedCents: number;
  creditCarriedForwardCents: number;
  currency: string;
  isZero: boolean;
}

/**
 * The billing cycle to bill on a given run date: the just-closed month (arrears).
 * On 2026-07-xx the cycle billed is 2026-06.
 */
export function arrearsCycleFor(runDate = new Date()): BillingCycle {
  const d = new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Does today match a tenant's billing_day, clamping to month-end for short months? */
function isDueToday(billingDay: number, runDate: Date): boolean {
  const y = runDate.getUTCFullYear();
  const m = runDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const effectiveDay = Math.min(billingDay, lastDay); // billing_day 31 in a 30-day month → 30
  return runDate.getUTCDate() === effectiveDay;
}

export interface BillingRunSummary {
  runDate: string;
  cycle: BillingCycle;
  newCharges: number;
  retries: number;
  settled: number;
  pending: number;
  failed: number;
  skippedSuspended: number;
}

/**
 * The daily platform billing run (Section A, Requirement A3/A6). Processes, for the
 * given run date:
 *   - every active tenant whose billing_day falls today → a NEW charge for the
 *     just-closed cycle (billed in arrears), and
 *   - every tenant with an OUTSTANDING failed/retrying charge → a retry of THAT
 *     charge (each cycle retried independently, never merged).
 * Suspended tenants are skipped (no new charges, no retries). Idempotent per
 * (tenant, cycle) via billTenantForCycle, so a second run the same day is safe.
 */
export async function runPlatformBilling(runDate = new Date(), executionId: string | null = null): Promise<BillingRunSummary> {
  const runContext: RunContext = { executionId, trigger: 'scheduled' };
  const cycle = arrearsCycleFor(runDate);
  const summary: BillingRunSummary = {
    runDate: runDate.toISOString(), cycle,
    newCharges: 0, retries: 0, settled: 0, pending: 0, failed: 0, skippedSuspended: 0,
  };

  const tally = (status: string) => {
    if (status === 'settled' || status === 'zero') summary.settled++;
    else if (status === 'pending') summary.pending++;
    else if (status === 'failed') summary.failed++;
  };

  // 1. New charges: active, non-suspended tenants with a current plan due today.
  const { rows: tenants } = await adminPool.query(
    `SELECT t.id, t.currency, t.status, p.billing_day
     FROM sys_tenants t
     JOIN pay_tenant_billing_plans p ON p.tenant_id = t.id AND p.ended_at IS NULL`,
  );
  for (const t of tenants) {
    if (t.status === 'suspended') { summary.skippedSuspended++; continue; }
    if (!isDueToday(t.billing_day, runDate)) continue;
    summary.newCharges++;
    try {
      const r = await billTenantForCycle(t.id, cycle, t.currency || 'USD', runContext);
      tally(r.status);
    } catch { summary.failed++; }
  }

  // 2. Retries: any open (failed/retrying/pending) charge for a non-suspended
  //    tenant, including charges from PRIOR cycles — each retried on its own row.
  const { rows: open } = await adminPool.query(
    `SELECT c.* FROM pay_platform_billing_charges c
     JOIN sys_tenants t ON t.id = c.tenant_id
     WHERE c.status IN ('failed', 'retrying') AND t.status <> 'suspended'`,
  );
  for (const chargeRow of open) {
    // Skip the row we may have just created above (same tenant+cycle).
    if (chargeRow.cycle_year === cycle.year && chargeRow.cycle_month === cycle.month
        && tenants.some((t) => t.id === chargeRow.tenant_id && isDueToday(t.billing_day, runDate))) {
      continue;
    }
    summary.retries++;
    try {
      const r = await settleCharge(chargeRow, runContext);
      tally(r.status);
    } catch { summary.failed++; }
  }

  return summary;
}

/**
 * Count whole months between a plan start and the first day of a billing cycle.
 * `planStart` may arrive as a JS Date (pg maps DATE → Date) or a 'YYYY-MM-DD'
 * string, so normalize both — concatenating a Date with 'T00:00:00Z' yields an
 * Invalid Date, which previously made the intro-period check silently fail.
 */
function monthsSincePlanStart(planStart: string | Date, cycle: BillingCycle): number {
  const start = planStart instanceof Date ? planStart : new Date(planStart + 'T00:00:00Z');
  const cycleStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  return (cycleStart.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (cycleStart.getUTCMonth() - start.getUTCMonth());
}

/** The current (un-ended) plan version for a tenant, or null if none configured. */
async function getCurrentPlan(tenantId: string): Promise<TenantBillingPlan | null> {
  const { rows } = await adminPool.query(
    `SELECT id, tenant_id, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date
     FROM pay_tenant_billing_plans
     WHERE tenant_id = $1 AND ended_at IS NULL
     ORDER BY version DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/** Sum of the per-business net collections for a tenant in a cycle (zero if none). */
async function getNetCollectionsCents(tenantId: string, cycle: BillingCycle): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(net_amount_cents), 0)::int AS total
     FROM pay_tenant_net_collections
     WHERE tenant_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int`,
    [tenantId, cycle.year, cycle.month],
  );
  return rows[0]?.total ?? 0;
}

/**
 * Compute (without charging) the amount owed by a tenant for a cycle. Pure
 * arithmetic over the current plan + net collections + outstanding credits;
 * does not draw down credits or write anything.
 */
export async function computeChargeForCycle(
  tenantId: string, cycle: BillingCycle, currency = 'USD',
): Promise<ComputedCharge | null> {
  const plan = await getCurrentPlan(tenantId);
  if (!plan) return null;

  // Intro applies ONLY to the first N months starting AT the plan start — never to
  // cycles before the plan began (months < 0), and never when intro_period_months is 0.
  const monthsIn = monthsSincePlanStart(plan.plan_start_date, cycle);
  const inIntro = monthsIn >= 0 && monthsIn < plan.intro_period_months;
  const flatCents = inIntro ? plan.intro_flat_amount_cents : plan.flat_amount_cents;
  const rate = parseFloat(inIntro ? plan.intro_percentage_rate : plan.percentage_rate) || 0;

  const netCollectionsCents = await getNetCollectionsCents(tenantId, cycle);
  const rawPctCents = Math.round(netCollectionsCents * (rate / 100));

  // Apply the per-cycle cap: either to the percentage component alone or to the
  // combined (flat + percentage) charge (A1.6).
  let percentageComponentCents = rawPctCents;
  let subtotalCents: number;
  let capAppliedCents: number | null = null;

  if (plan.cap_amount_cents != null && plan.cap_applies_to === 'percentage') {
    if (percentageComponentCents > plan.cap_amount_cents) {
      capAppliedCents = plan.cap_amount_cents;
      percentageComponentCents = plan.cap_amount_cents;
    }
    subtotalCents = flatCents + percentageComponentCents;
  } else {
    subtotalCents = flatCents + percentageComponentCents;
    if (plan.cap_amount_cents != null && subtotalCents > plan.cap_amount_cents) {
      capAppliedCents = plan.cap_amount_cents;
      subtotalCents = plan.cap_amount_cents;
    }
  }

  // Apply outstanding tenant credits (FIFO) against the subtotal; floor at zero.
  const { rows: creditRows } = await adminPool.query(
    `SELECT id, remaining_cents FROM pay_tenant_credits
     WHERE tenant_id = $1 AND status = 'active' AND remaining_cents > 0
     ORDER BY created_at ASC`,
    [tenantId],
  );
  let remainingToCharge = subtotalCents;
  let creditAppliedCents = 0;
  for (const c of creditRows) {
    if (remainingToCharge <= 0) break;
    const draw = Math.min(c.remaining_cents, remainingToCharge);
    creditAppliedCents += draw;
    remainingToCharge -= draw;
  }
  const amountChargedCents = Math.max(0, remainingToCharge);

  return {
    tenantId,
    planId: plan.id,
    cycle,
    flatComponentCents: flatCents,
    netCollectionsCents,
    percentageRate: rate,
    percentageComponentCents,
    capAppliedCents,
    creditAppliedCents,
    amountChargedCents,
    creditCarriedForwardCents: 0, // set when credits are actually drawn down on execute
    currency,
    isZero: amountChargedCents === 0,
  };
}

/** The tenant's default stored payment method id, or null. */
async function getTenantDefaultMethodId(tenantId: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT id FROM pay_payment_methods
     WHERE owner_level = 'tenant' AND tenant_id = $1 AND status = 'active'
     ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0]?.id ?? null;
}

/** Draw down active credits by `amount` (FIFO), marking exhausted ones. */
async function applyCredits(client: any, tenantId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const { rows } = await client.query(
    `SELECT id, remaining_cents FROM pay_tenant_credits
     WHERE tenant_id = $1 AND status = 'active' AND remaining_cents > 0
     ORDER BY created_at ASC FOR UPDATE`,
    [tenantId],
  );
  let left = amount;
  let applied = 0;
  for (const c of rows) {
    if (left <= 0) break;
    const draw = Math.min(c.remaining_cents, left);
    const newRemaining = c.remaining_cents - draw;
    await client.query(
      `UPDATE pay_tenant_credits
       SET remaining_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [newRemaining, newRemaining === 0 ? 'exhausted' : 'active', c.id],
    );
    applied += draw;
    left -= draw;
  }
  return applied;
}

export interface ChargeResult {
  chargeId: string;
  referenceNumber: number;
  status: 'zero' | 'pending' | 'settled' | 'failed' | 'retrying';
  amountChargedCents: number;
  failureReason?: string;
}

/**
 * Bill a tenant for a cycle: compute the amount, apply credits, and settle it
 * against the tenant's stored method via the platform's processor connection.
 * Idempotent per (tenant, cycle) — re-running settles/retries the SAME charge row
 * rather than creating a duplicate (A3.11). Returns the resulting charge record.
 */
export async function billTenantForCycle(
  tenantId: string, cycle: BillingCycle, currency = 'USD', runContext: RunContext = MANUAL_RUN,
): Promise<ChargeResult> {
  // Idempotency: if a settled/zero charge already exists for this cycle, return it.
  const existing = await adminPool.query(
    `SELECT id, reference_number, status, amount_charged_cents FROM pay_platform_billing_charges
     WHERE tenant_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int`,
    [tenantId, cycle.year, cycle.month],
  );
  if (existing.rows[0] && ['settled', 'zero'].includes(existing.rows[0].status)) {
    const r = existing.rows[0];
    return { chargeId: r.id, referenceNumber: Number(r.reference_number), status: r.status, amountChargedCents: r.amount_charged_cents };
  }

  const computed = await computeChargeForCycle(tenantId, cycle, currency);
  if (!computed) {
    throw Object.assign(new Error('Tenant has no billing plan configured'), { code: 'NO_PLAN' });
  }

  // Create or load the charge row (idempotent per tenant+cycle), then draw down
  // credits inside the same transaction so retries don't double-apply.
  const client = await adminPool.connect();
  let chargeRow: any;
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT * FROM pay_platform_billing_charges
       WHERE tenant_id = $1::uuid AND cycle_year = $2::int AND cycle_month = $3::int FOR UPDATE`,
      [tenantId, cycle.year, cycle.month],
    );

    if (found.rows[0]) {
      chargeRow = found.rows[0];
    } else {
      // Subtotal after the cap (computeChargeForCycle already applied the cap to
      // the percentage/combined total). Reconstruct it as flat + (possibly capped)
      // percentage, then let the cap on the combined total bind if configured.
      let subtotal = computed.flatComponentCents + computed.percentageComponentCents;
      if (computed.capAppliedCents != null && computed.capAppliedCents < subtotal) {
        subtotal = computed.capAppliedCents;
      }
      // First time for this cycle: draw down real credits against the subtotal.
      const creditApplied = await applyCredits(client, tenantId, subtotal);
      const amount = Math.max(0, subtotal - creditApplied);
      const status = amount === 0 ? 'zero' : 'pending';
      const ins = await client.query(
        `INSERT INTO pay_platform_billing_charges
           (tenant_id, plan_id, cycle_year, cycle_month, reference_number,
            flat_component_cents, net_collections_cents, percentage_rate, percentage_component_cents,
            cap_applied_cents, credit_applied_cents, amount_charged_cents, currency, status)
         VALUES ($1,$2,$3,$4, nextval('pay_platform_billing_charge_ref_seq'),
                 $5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [tenantId, computed.planId, cycle.year, cycle.month,
         computed.flatComponentCents, computed.netCollectionsCents, computed.percentageRate, computed.percentageComponentCents,
         computed.capAppliedCents, creditApplied, amount, currency, status],
      );
      chargeRow = ins.rows[0];
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  // Zero charge: recorded, no transaction attempted (A3.8). Still log an attempt.
  if (chargeRow.status === 'zero' || chargeRow.amount_charged_cents === 0) {
    await recordAttempt(chargeRow, 'zero', runContext, undefined, undefined);
    return { chargeId: chargeRow.id, referenceNumber: Number(chargeRow.reference_number), status: 'zero', amountChargedCents: 0 };
  }

  return settleCharge(chargeRow, runContext);
}

/** Write one per-attempt audit row (pay_billing_charge_attempts). */
async function recordAttempt(
  chargeRow: any, outcome: 'settled' | 'pending' | 'failed' | 'zero', runContext: RunContext,
  providerReference?: string | null, failureReason?: string | null,
): Promise<void> {
  await adminPool.query(
    `INSERT INTO pay_billing_charge_attempts
       (run_execution_id, trigger, scope_level, charge_id, tenant_id, cycle_year, cycle_month,
        outcome, amount_cents, currency, provider_reference, failure_reason)
     VALUES ($1,$2,'platform',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      runContext.executionId, runContext.trigger, chargeRow.id, chargeRow.tenant_id,
      chargeRow.cycle_year, chargeRow.cycle_month, outcome, chargeRow.amount_charged_cents,
      chargeRow.currency, providerReference ?? null, failureReason ?? null,
    ],
  );
}

/**
 * Attempt (or retry) settlement of an existing charge row against the tenant's
 * stored method. Updates the row's status/attempts. Separated so the daily run
 * can retry failed charges without recomputing them.
 */
export async function settleCharge(chargeRow: any, runContext: RunContext = MANUAL_RUN): Promise<ChargeResult> {
  const tenantId = chargeRow.tenant_id;
  const owner = { ownerLevel: 'tenant' as const, tenantId };

  const methodId = await getTenantDefaultMethodId(tenantId);
  const account = await resolveConnectedAccount(owner);

  const fail = async (reason: string): Promise<ChargeResult> => {
    await adminPool.query(
      `UPDATE pay_platform_billing_charges
       SET status = 'failed', failure_reason = $1, attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reason, chargeRow.id],
    );
    await recordAttempt(chargeRow, 'failed', runContext, null, reason);
    return { chargeId: chargeRow.id, referenceNumber: Number(chargeRow.reference_number), status: 'failed', amountChargedCents: chargeRow.amount_charged_cents, failureReason: reason };
  };

  if (!methodId) return fail('No payment method on file for tenant');
  if (!account) return fail('No active platform processor connection');

  const tokenInfo = await getProviderToken(methodId);
  if (!tokenInfo) return fail('Stored payment method is no longer available');

  // The vaulted method is attached to the owner's Stripe Customer; off-session
  // charges must reference it.
  const customerRef = await getCustomerRef(owner, account.provider);

  // Build the charging adapter from the PLATFORM connection's secrets (DayStream
  // charges the tenant → platform connection owns the vault & account).
  const secrets = await getDecryptedSecrets({ ownerLevel: 'platform' });
  const adapter = getConfiguredAdapter(account.provider, secrets);

  let outcome: 'succeeded' | 'pending' | 'failed';
  let providerReference: string | undefined;
  let failureReason: string | undefined;
  try {
    const result = await adapter.charge({
      account,
      amount: chargeRow.amount_charged_cents,
      currency: chargeRow.currency,
      methodToken: tokenInfo.token,
      methodType: tokenInfo.methodType as any,
      customerRef,
      idempotencyKey: `platbill:${tenantId}:${chargeRow.cycle_year}-${chargeRow.cycle_month}`,
      description: `DayStream platform billing ${chargeRow.cycle_year}-${String(chargeRow.cycle_month).padStart(2, '0')}`,
      // Metadata must be STABLE for a given idempotency key (tenant+cycle), so it
      // excludes the charge row's UUID (which can differ if a row is recreated).
      metadata: {
        kind: 'platform_billing',
        tenant_id: tenantId,
        cycle: `${chargeRow.cycle_year}-${String(chargeRow.cycle_month).padStart(2, '0')}`,
      },
    });
    outcome = result.outcome;
    providerReference = result.providerReference;
    failureReason = result.failureReason;
  } catch (e: any) {
    return fail(e?.message || 'Charge failed');
  }

  // Map adapter outcome to charge status. Bank debits settle asynchronously, so
  // 'pending' is normal and the webhook later flips it to settled/failed.
  const status = outcome === 'succeeded' ? 'settled' : outcome === 'pending' ? 'pending' : 'failed';
  await adminPool.query(
    `UPDATE pay_platform_billing_charges
     SET status = $1::varchar, provider_reference = $2, payment_method_id = $3, failure_reason = $4,
         attempts = attempts + 1, last_attempt_at = NOW(),
         settled_at = CASE WHEN $1::varchar = 'settled' THEN NOW() ELSE settled_at END, updated_at = NOW()
     WHERE id = $5`,
    [status, providerReference ?? null, methodId, outcome === 'failed' ? (failureReason ?? 'Declined') : null, chargeRow.id],
  );

  await recordAttempt(
    chargeRow,
    status === 'settled' ? 'settled' : status === 'pending' ? 'pending' : 'failed',
    runContext, providerReference ?? null, outcome === 'failed' ? (failureReason ?? 'Declined') : null,
  );

  return {
    chargeId: chargeRow.id,
    referenceNumber: Number(chargeRow.reference_number),
    status: status as ChargeResult['status'],
    amountChargedCents: chargeRow.amount_charged_cents,
    failureReason: outcome === 'failed' ? failureReason : undefined,
  };
}

// ============================================================
// Plan management (A1), credits (A4), and read views (A5)
// ============================================================

export interface TenantBillingPlanInput {
  flatAmountCents: number;
  percentageRate: number;              // percent, e.g. 2.5
  capAmountCents?: number | null;
  capAppliesTo?: 'percentage' | 'combined';
  introPeriodMonths?: number;
  introFlatAmountCents?: number;
  introPercentageRate?: number;
  billingDay: number;                  // 1-31
  planStartDate?: string;              // YYYY-MM-DD
}

/** The current (un-ended) plan for a tenant, as a display view (or null). */
export async function getTenantPlan(tenantId: string): Promise<any | null> {
  const { rows } = await adminPool.query(
    `SELECT id, tenant_id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date,
            effective_from, created_at
     FROM pay_tenant_billing_plans
     WHERE tenant_id = $1::uuid AND ended_at IS NULL
     ORDER BY version DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/**
 * Save a new plan VERSION for a tenant: end the current one and insert the new
 * one (version + 1), preserving history so past charges stay explainable (A1.15).
 */
export async function saveTenantPlan(
  tenantId: string, input: TenantBillingPlanInput, userId: string | null,
): Promise<any> {
  const client = await adminPool.connect();
  let newRow: any;
  let prevRow: any = null;
  try {
    await client.query('BEGIN');
    const prev = await client.query(
      `SELECT * FROM pay_tenant_billing_plans WHERE tenant_id = $1::uuid AND ended_at IS NULL FOR UPDATE`,
      [tenantId],
    );
    prevRow = prev.rows[0] ?? null;
    const nextVersion = (prevRow?.version ?? 0) + 1;
    if (prevRow) {
      await client.query(
        `UPDATE pay_tenant_billing_plans SET ended_at = NOW() WHERE tenant_id = $1::uuid AND ended_at IS NULL`,
        [tenantId],
      );
    }
    const { rows } = await client.query(
      `INSERT INTO pay_tenant_billing_plans
         (tenant_id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
          intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day, plan_start_date, created_by)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        tenantId, nextVersion, input.flatAmountCents, input.percentageRate,
        input.capAmountCents ?? null, input.capAppliesTo ?? 'combined',
        input.introPeriodMonths ?? 0, input.introFlatAmountCents ?? 0, input.introPercentageRate ?? 0,
        input.billingDay, input.planStartDate ?? new Date().toISOString().slice(0, 10), userId,
      ],
    );
    newRow = rows[0];
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Audit: record what changed (from → to) on the tenant's billing plan.
  const changes = diffFields(prevRow, newRow, [
    'flat_amount_cents', 'percentage_rate', 'cap_amount_cents', 'cap_applies_to',
    'intro_period_months', 'intro_flat_amount_cents', 'intro_percentage_rate', 'billing_day', 'plan_start_date',
  ]);
  await logAudit({
    tenantId,
    userId: userId ?? undefined,
    action: prevRow ? 'billing_plan.updated' : 'billing_plan.created',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { version: newRow.version, changes },
  });

  return newRow;
}

/** All plan versions for a tenant (newest first) — the plan change history. */
export async function listTenantPlanVersions(tenantId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, version, flat_amount_cents, percentage_rate, cap_amount_cents, cap_applies_to,
            intro_period_months, intro_flat_amount_cents, intro_percentage_rate, billing_day,
            plan_start_date, effective_from, ended_at, created_by, created_at
     FROM pay_tenant_billing_plans
     WHERE tenant_id = $1::uuid
     ORDER BY version DESC`,
    [tenantId],
  );
  return rows;
}

/** List a tenant's charge history (most recent first). */
export async function listTenantCharges(tenantId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, cycle_year, cycle_month, reference_number, flat_component_cents, net_collections_cents,
            percentage_rate, percentage_component_cents, cap_applied_cents, credit_applied_cents,
            amount_charged_cents, currency, status, provider_reference, failure_reason, attempts,
            last_attempt_at, settled_at, created_at
     FROM pay_platform_billing_charges
     WHERE tenant_id = $1::uuid
     ORDER BY cycle_year DESC, cycle_month DESC, created_at DESC`,
    [tenantId],
  );
  return rows;
}

/** Issue a tenant credit (A4): amount + required reason. */
export async function issueTenantCredit(
  tenantId: string, amountCents: number, reason: string, userId: string | null,
): Promise<any> {
  const { rows } = await adminPool.query(
    `INSERT INTO pay_tenant_credits (tenant_id, amount_cents, remaining_cents, reason, issued_by)
     VALUES ($1::uuid,$2,$2,$3,$4) RETURNING *`,
    [tenantId, amountCents, reason, userId],
  );
  await logAudit({
    tenantId,
    userId: userId ?? undefined,
    action: 'billing_credit.issued',
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { amount_cents: amountCents, reason },
  });
  return rows[0];
}

/** List a tenant's credits with remaining balances. */
export async function listTenantCredits(tenantId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT id, amount_cents, remaining_cents, reason, status, created_at
     FROM pay_tenant_credits WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/** Total un-applied credit a tenant has (carry-forward balance). */
export async function getTenantCreditBalance(tenantId: string): Promise<number> {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(remaining_cents),0)::int AS total FROM pay_tenant_credits
     WHERE tenant_id = $1::uuid AND status = 'active'`,
    [tenantId],
  );
  return rows[0]?.total ?? 0;
}

// ============================================================
// Platform billing SCHEDULE (A6) — the single platform-wide daily run.
// One sys_scheduled_jobs row at scope_level='platform', job_type='platform_billing'.
// ============================================================

export interface PlatformScheduleView {
  enabled: boolean;
  scheduleTime: string;      // 'HH:MM'
  scheduleTimezone: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

/** Read the platform billing schedule (null if never configured). */
export async function getPlatformSchedule(): Promise<PlatformScheduleView | null> {
  const { rows } = await adminPool.query(
    `SELECT enabled, schedule_time, schedule_timezone, last_run_at, last_run_status, next_run_at
     FROM sys_scheduled_jobs WHERE scope_level = 'platform' AND job_type = 'platform_billing' LIMIT 1`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    enabled: r.enabled,
    scheduleTime: typeof r.schedule_time === 'string' ? r.schedule_time.slice(0, 5) : String(r.schedule_time).slice(0, 5),
    scheduleTimezone: r.schedule_timezone,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastRunStatus: r.last_run_status,
    nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
  };
}

/**
 * Create or update the platform billing schedule: a single daily job at the given
 * time in the given timezone (A6). Computes an initial next_run_at for today/
 * tomorrow at that time; the scheduler recomputes it after each run.
 */
export async function savePlatformSchedule(
  scheduleTime: string, scheduleTimezone: string, enabled: boolean,
): Promise<PlatformScheduleView> {
  // Initial next_run_at: today at the time if still future, else tomorrow.
  const [h, m] = scheduleTime.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  await adminPool.query(
    `INSERT INTO sys_scheduled_jobs
       (scope_level, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at)
     VALUES ('platform', 'platform_billing', $1, $2, 'daily', $3, $4)
     ON CONFLICT (job_type) WHERE scope_level = 'platform'
     DO UPDATE SET schedule_time = $1, schedule_timezone = $2, enabled = $3,
                   next_run_at = $4, updated_at = NOW()`,
    [scheduleTime, scheduleTimezone, enabled, next.toISOString()],
  );
  return (await getPlatformSchedule())!;
}

/** Run the platform billing now (manual trigger of the daily run). */
export async function runPlatformBillingNow(): Promise<BillingRunSummary> {
  return runPlatformBilling();
}

// ============================================================
// Observability (A5.3): job-run history + platform-wide charges / failed report
// ============================================================

/**
 * Platform billing job runs within a date range (default: last 7 days), newest
 * first. Over time there will be one run per day plus manual runs, so the UI
 * drives this by date range rather than an unbounded list.
 */
export async function listPlatformBillingRuns(opts: { from?: string; to?: string; limit?: number } = {}): Promise<any[]> {
  const limit = opts.limit ?? 200;
  const from = opts.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = opts.to ?? new Date().toISOString();
  const { rows } = await adminPool.query(
    `SELECT id, started_at, completed_at, status, duration_ms, result, error
     FROM sys_job_executions
     WHERE job_type = 'platform_billing' AND started_at >= $1::timestamptz AND started_at <= $2::timestamptz
     ORDER BY started_at DESC
     LIMIT $3`,
    [from, to, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    status: r.status,
    durationMs: r.duration_ms,
    summary: r.result || null,   // the BillingRunSummary (new/retries/settled/pending/failed/skipped)
    error: r.error || null,
  }));
}

/**
 * Platform-wide charges across all tenants (A5.3 + failed-charge report A3.12).
 * `status` filters (e.g. 'failed'); omit for all. Joined to the tenant name.
 */
export async function listAllPlatformCharges(opts: { status?: string; limit?: number } = {}): Promise<any[]> {
  const limit = opts.limit ?? 100;
  const params: any[] = [limit];
  let statusClause = '';
  if (opts.status) {
    params.push(opts.status);
    statusClause = `AND c.status = $2::varchar`;
  }
  const { rows } = await adminPool.query(
    `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.cycle_year, c.cycle_month, c.reference_number,
            c.amount_charged_cents, c.currency, c.status, c.provider_reference, c.failure_reason,
            c.attempts, c.last_attempt_at, c.settled_at, c.created_at
     FROM pay_platform_billing_charges c
     JOIN sys_tenants t ON t.id = c.tenant_id
     WHERE 1=1 ${statusClause}
     ORDER BY c.created_at DESC
     LIMIT $1`,
    params,
  );
  return rows;
}

/**
 * The charge attempts made during a specific run (drill-down from a run row).
 * Reads pay_billing_charge_attempts for that execution, joined to the tenant and
 * the charge's reference number.
 */
export async function getRunCharges(runExecutionId: string): Promise<any[]> {
  const { rows } = await adminPool.query(
    `SELECT a.id, a.charge_id, a.tenant_id, t.name AS tenant_name, a.cycle_year, a.cycle_month,
            a.outcome, a.amount_cents, a.currency, a.provider_reference, a.failure_reason, a.trigger, a.created_at,
            c.reference_number
     FROM pay_billing_charge_attempts a
     JOIN sys_tenants t ON t.id = a.tenant_id
     LEFT JOIN pay_platform_billing_charges c ON c.id = a.charge_id
     WHERE a.run_execution_id = $1 AND a.scope_level = 'platform'
     ORDER BY a.created_at`,
    [runExecutionId],
  );
  return rows;
}
