import { adminPool } from '../db/pool';

/**
 * Phase 46 — the single answer to "may we send this person a message on this channel for
 * this purpose?". Every sending path (campaigns, sequences, the Inbox, notifications) asks
 * here at the moment of sending, so a rule is enforced once and the same way everywhere.
 */

export type Channel = 'email' | 'sms' | 'whatsapp' | 'in_app' | 'push';
export type Purpose = 'marketing' | 'transactional';
export type RefusalReason =
  | 'no_consent' | 'no_contact_point' | 'archived' | 'merged' | 'anonymized'
  | 'undeliverable' | 'reminders_off' | 'not_found';

export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  no_consent: 'Has not agreed to marketing on this channel',
  no_contact_point: 'No address for this channel',
  archived: 'Archived',
  merged: 'Merged into another person',
  anonymized: 'Anonymised',
  undeliverable: 'Address marked as undeliverable',
  reminders_off: 'Reminders switched off',
  not_found: 'Person not found',
};

export interface ContactDecision {
  allowed: boolean;
  reason?: RefusalReason;
  message?: string;
  /** Where the message would go (email address or phone number). */
  address?: string | null;
}

/**
 * One row per person with the decision. `reason` is NULL when the person may be contacted.
 * Order of checks: record state, address, deliverability, then consent.
 */
const DECISION_SQL = `
  SELECT c.id,
         CASE $2::text
           WHEN 'email' THEN c.email
           WHEN 'sms' THEN COALESCE(c.phone_e164, c.phone)
           WHEN 'whatsapp' THEN COALESCE(c.phone_e164, c.phone)
           ELSE c.user_id::text
         END AS address,
         CASE
           WHEN c.status = 'archived' THEN 'archived'
           WHEN c.status = 'merged' THEN 'merged'
           WHEN c.status = 'anonymized' THEN 'anonymized'
           WHEN $2::text = 'email' AND c.email IS NULL THEN 'no_contact_point'
           WHEN $2::text IN ('sms', 'whatsapp') AND COALESCE(c.phone_e164, c.phone) IS NULL THEN 'no_contact_point'
           WHEN $2::text IN ('in_app', 'push') AND c.user_id IS NULL THEN 'no_contact_point'
           WHEN $2::text = 'email' AND c.email_deliverability <> 'ok' THEN 'undeliverable'
           WHEN $2::text IN ('sms', 'whatsapp') AND c.phone_deliverability <> 'ok' THEN 'undeliverable'
           WHEN $3::text = 'marketing' AND COALESCE(m.opted_in, false) = false THEN 'no_consent'
           WHEN $3::text = 'reminders' AND COALESCE(r.opted_in, true) = false THEN 'reminders_off'
           ELSE NULL
         END AS reason
    FROM cus_customers c
    LEFT JOIN mkt_communication_preferences m
           ON m.customer_id = c.id AND m.channel = $2::text AND m.category = 'marketing'
    LEFT JOIN mkt_communication_preferences r
           ON r.customer_id = c.id AND r.channel = $2::text AND r.category = 'reminders'
   WHERE c.business_id = $1`;

/**
 * `purpose` 'transactional' is always allowed by consent (a booking confirmation, a reply to
 * the person's own message). Pass `reminder: true` for booking reminders, which the person
 * can switch off.
 */
function consentMode(purpose: Purpose, reminder?: boolean): string {
  if (purpose === 'marketing') return 'marketing';
  return reminder ? 'reminders' : 'transactional';
}

export async function canContact(
  personId: string,
  businessId: string,
  channel: Channel,
  purpose: Purpose,
  options: { reminder?: boolean } = {},
): Promise<ContactDecision> {
  const { rows } = await adminPool.query(`${DECISION_SQL} AND c.id = $4`, [businessId, channel, consentMode(purpose, options.reminder), personId]);
  if (rows.length === 0) return { allowed: false, reason: 'not_found', message: REFUSAL_LABELS.not_found };
  const reason = rows[0].reason as RefusalReason | null;
  if (reason) return { allowed: false, reason, message: REFUSAL_LABELS[reason], address: rows[0].address };
  return { allowed: true, address: rows[0].address };
}

export interface AudienceResult {
  allowed: Array<{ personId: string; address: string }>;
  excluded: Array<{ personId: string; reason: RefusalReason }>;
}

/** Decide for many people at once (one query). People of another business are reported as not found. */
export async function filterAudience(
  businessId: string,
  personIds: string[],
  channel: Channel,
  purpose: Purpose,
  options: { reminder?: boolean } = {},
): Promise<AudienceResult> {
  if (personIds.length === 0) return { allowed: [], excluded: [] };
  const { rows } = await adminPool.query(
    `${DECISION_SQL} AND c.id = ANY($4::uuid[])`,
    [businessId, channel, consentMode(purpose, options.reminder), personIds],
  );
  const seen = new Set<string>();
  const result: AudienceResult = { allowed: [], excluded: [] };
  for (const row of rows) {
    seen.add(row.id);
    if (row.reason) result.excluded.push({ personId: row.id, reason: row.reason });
    else result.allowed.push({ personId: row.id, address: row.address });
  }
  for (const id of personIds) if (!seen.has(id)) result.excluded.push({ personId: id, reason: 'not_found' });
  return result;
}

export interface AudienceSummary {
  total: number;
  willReceive: number;
  excluded: number;
  excludedByReason: Array<{ reason: RefusalReason; label: string; count: number }>;
}

export function summarise(result: AudienceResult): AudienceSummary {
  const counts = new Map<RefusalReason, number>();
  for (const e of result.excluded) counts.set(e.reason, (counts.get(e.reason) || 0) + 1);
  return {
    total: result.allowed.length + result.excluded.length,
    willReceive: result.allowed.length,
    excluded: result.excluded.length,
    excludedByReason: [...counts.entries()].map(([reason, count]) => ({ reason, label: REFUSAL_LABELS[reason], count })),
  };
}
