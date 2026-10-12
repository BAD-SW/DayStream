import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Phase 46 — the single record of what each person agreed to receive.
 *
 * One state per person, per channel, per category, held in mkt_communication_preferences.
 * Every change is also written to cus_consent_events (who, when, how, old and new value).
 * Defaults when no row exists: marketing is NOT given; reminders are ON.
 */

export const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp', 'in_app', 'push'] as const;
export type ConsentChannel = typeof CONSENT_CHANNELS[number];

export const CONSENT_METHODS = [
  'form', 'portal', 'unsubscribe_link', 'staff_entry', 'import', 'keyword_reply', 'merge', 'migration',
] as const;
export type ConsentMethod = typeof CONSENT_METHODS[number];

/** 'marketing' (promotional) and 'reminders' (booking reminders) are the categories the product uses. */
export type ConsentCategory = 'marketing' | 'reminders' | string;

export class ConsentEvidenceRequiredError extends Error {
  code = 'CONSENT_EVIDENCE_REQUIRED';
  constructor() { super('Say how this consent was obtained'); }
}

export function defaultState(category: ConsentCategory): boolean {
  return category === 'reminders';
}

interface PersonRef { id: string; tenant_id: string; business_id: string }

async function personRef(customerId: string): Promise<PersonRef | null> {
  const { rows } = await adminPool.query('SELECT id, tenant_id, business_id FROM cus_customers WHERE id = $1', [customerId]);
  return rows[0] || null;
}

/** Current state for every channel, for marketing and reminders. */
export async function getConsent(customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT channel, category, opted_in, opted_in_at, opted_out_at, source, updated_at
       FROM mkt_communication_preferences WHERE customer_id = $1`,
    [customerId],
  );
  const find = (channel: string, category: string) => rows.find((r) => r.channel === channel && r.category === category);
  return CONSENT_CHANNELS.map((channel) => {
    const marketing = find(channel, 'marketing');
    const reminders = find(channel, 'reminders');
    return {
      channel,
      marketing: marketing ? marketing.opted_in : defaultState('marketing'),
      marketing_changed_at: marketing ? (marketing.opted_in ? marketing.opted_in_at : marketing.opted_out_at) : null,
      reminders: reminders ? reminders.opted_in : defaultState('reminders'),
    };
  });
}

export async function isGiven(customerId: string, channel: ConsentChannel, category: ConsentCategory): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT opted_in FROM mkt_communication_preferences WHERE customer_id = $1 AND channel = $2 AND category = $3',
    [customerId, channel, category],
  );
  return rows.length === 0 ? defaultState(category) : rows[0].opted_in;
}

export interface SetConsentInput {
  customerId: string;
  channel: ConsentChannel;
  category: ConsentCategory;
  given: boolean;
  method: ConsentMethod;
  /** How the consent was obtained. Required when a staff member records it by hand. */
  evidence?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
}

/** Record one consent change. Returns false when the person does not exist. */
export async function setConsent(input: SetConsentInput): Promise<boolean> {
  if (input.method === 'staff_entry' && input.given && input.category === 'marketing' && !(input.evidence || '').trim()) {
    throw new ConsentEvidenceRequiredError();
  }
  const person = await personRef(input.customerId);
  if (!person) return false;

  const { rows: before } = await adminPool.query(
    'SELECT opted_in FROM mkt_communication_preferences WHERE customer_id = $1 AND channel = $2 AND category = $3',
    [input.customerId, input.channel, input.category],
  );
  const previous: boolean | null = before.length > 0 ? before[0].opted_in : null;
  const effectivePrevious = previous === null ? defaultState(input.category) : previous;

  await adminPool.query(
    `INSERT INTO mkt_communication_preferences
       (tenant_id, business_id, customer_id, channel, category, opted_in, opted_in_at, opted_out_at, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN NOW() END, CASE WHEN NOT $6 THEN NOW() END, $7, NOW())
     ON CONFLICT (tenant_id, customer_id, channel, category) DO UPDATE SET
       opted_in = EXCLUDED.opted_in,
       business_id = EXCLUDED.business_id,
       opted_in_at = CASE WHEN EXCLUDED.opted_in THEN NOW() ELSE mkt_communication_preferences.opted_in_at END,
       opted_out_at = CASE WHEN NOT EXCLUDED.opted_in THEN NOW() ELSE mkt_communication_preferences.opted_out_at END,
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [person.tenant_id, person.business_id, input.customerId, input.channel, input.category, input.given, input.method],
  );

  // History records real changes only (and the first explicit statement, even if it equals the default).
  if (previous === null || effectivePrevious !== input.given) {
    await adminPool.query(
      `INSERT INTO cus_consent_events
         (tenant_id, business_id, customer_id, channel, category, previous_state, new_state, method, evidence, actor_user_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [person.tenant_id, person.business_id, input.customerId, input.channel, input.category, previous, input.given,
        input.method, (input.evidence || '').trim() || null, input.actorUserId || null, input.ipAddress || null],
    );
    await logAudit({
      tenantId: person.tenant_id,
      userId: input.actorUserId || undefined,
      action: 'customer.consent_changed',
      resourceType: 'customer',
      resourceId: input.customerId,
      details: { channel: input.channel, category: input.category, from: previous, to: input.given, method: input.method },
    });
  }
  return true;
}

export async function getConsentHistory(customerId: string, limit = 100) {
  const { rows } = await adminPool.query(
    `SELECT e.id, e.channel, e.category, e.previous_state, e.new_state, e.method, e.evidence, e.created_at,
            e.actor_user_id, NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS actor_name
       FROM cus_consent_events e
       LEFT JOIN usr_users u ON u.id = e.actor_user_id
      WHERE e.customer_id = $1
      ORDER BY e.created_at DESC, e.id
      LIMIT $2`,
    [customerId, Math.min(limit, 500)],
  );
  return rows;
}

/** Withdraw marketing consent on a channel (an unsubscribe link, a STOP reply). Immediate. */
export async function withdrawMarketing(
  customerId: string,
  channel: ConsentChannel,
  method: ConsentMethod,
  category: ConsentCategory = 'marketing',
): Promise<boolean> {
  const ok = await setConsent({ customerId, channel, category, given: false, method });
  if (ok && category !== 'marketing') {
    // Granular unsubscribe: the named category is withdrawn; general marketing is left as it was.
    return ok;
  }
  return ok;
}

// ---------------------------------------------------------------------------
// The four profile switches of Phase 05 (email / SMS / push marketing, booking reminders).
// The profile and the customer portal still speak this shape; it is read from and written to
// the single store above, so both screens and Marketing always agree.
// ---------------------------------------------------------------------------

export interface LegacyPreferences {
  customer_id: string;
  email_marketing: boolean;
  sms_marketing: boolean;
  push_notifications: boolean;
  booking_reminders: boolean;
  updated_at: Date | null;
}

export async function getLegacyPreferences(customerId: string): Promise<LegacyPreferences> {
  const { rows } = await adminPool.query(
    'SELECT channel, category, opted_in, updated_at FROM mkt_communication_preferences WHERE customer_id = $1',
    [customerId],
  );
  const state = (channel: string, category: string) => {
    const r = rows.find((x) => x.channel === channel && x.category === category);
    return r ? r.opted_in : defaultState(category);
  };
  const updated = rows.map((r) => r.updated_at).filter(Boolean).sort((a: Date, b: Date) => +b - +a)[0] || null;
  return {
    customer_id: customerId,
    email_marketing: state('email', 'marketing'),
    sms_marketing: state('sms', 'marketing'),
    push_notifications: state('push', 'marketing'),
    // Reminders are one switch on screen; off on either channel shows as off.
    booking_reminders: state('email', 'reminders') && state('sms', 'reminders'),
    updated_at: updated,
  };
}

export async function setLegacyPreferences(
  customerId: string,
  changes: Partial<Record<'email_marketing' | 'sms_marketing' | 'push_notifications' | 'booking_reminders', boolean>>,
  ctx: { method: ConsentMethod; evidence?: string | null; actorUserId?: string | null; ipAddress?: string | null },
): Promise<LegacyPreferences> {
  const base = { customerId, method: ctx.method, evidence: ctx.evidence, actorUserId: ctx.actorUserId, ipAddress: ctx.ipAddress };
  if (changes.email_marketing !== undefined) await setConsent({ ...base, channel: 'email', category: 'marketing', given: changes.email_marketing });
  if (changes.sms_marketing !== undefined) await setConsent({ ...base, channel: 'sms', category: 'marketing', given: changes.sms_marketing });
  if (changes.push_notifications !== undefined) await setConsent({ ...base, channel: 'push', category: 'marketing', given: changes.push_notifications });
  if (changes.booking_reminders !== undefined) {
    await setConsent({ ...base, channel: 'email', category: 'reminders', given: changes.booking_reminders });
    await setConsent({ ...base, channel: 'sms', category: 'reminders', given: changes.booking_reminders });
  }
  return getLegacyPreferences(customerId);
}
