import { adminPool } from '../db/pool';

/**
 * Customer cancellation settings (THE-20), set by the business owner, separately for
 * events and for appointments:
 *   - may customers cancel themselves (default: no — they could not before)
 *   - up to how many hours before the start (default 24)
 *   - where the money of a paid cancellation goes: back to the card, or account credit
 *
 * Stored in sys_business_configurations under `<kind>.customer_cancel_enabled`,
 * `<kind>.customer_cancel_hours` and `<kind>.cancel_refund_to` (migration 157). For an
 * event, the settings of the business that hosts it apply.
 *
 * Events also have `events.change_refund_days` (migration 163, decision 14): after an event's date,
 * time or place changes, its registered people may cancel for a full refund for that many days.
 */

export type CancelKind = 'events' | 'appointments';

export interface CancelSettings {
  customer_cancel_enabled: boolean;
  customer_cancel_hours: number;
  cancel_refund_to: 'card' | 'credit';
  /** Events only: days to cancel for a full refund after a date, time or place change. */
  change_refund_days: number;
}

export const DEFAULT_CANCEL_SETTINGS: CancelSettings = {
  customer_cancel_enabled: false,
  customer_cancel_hours: 24,
  cancel_refund_to: 'card',
  change_refund_days: 7,
};

const KEYS = ['customer_cancel_enabled', 'customer_cancel_hours', 'cancel_refund_to', 'change_refund_days'] as const;

export async function getCancelSettings(businessId: string | null, kind: CancelKind): Promise<CancelSettings> {
  if (!businessId) return { ...DEFAULT_CANCEL_SETTINGS };
  const { rows } = await adminPool.query(
    `SELECT key, value FROM sys_business_configurations WHERE business_id = $1 AND key = ANY($2)`,
    [businessId, KEYS.map((k) => `${kind}.${k}`)],
  );
  const value = (k: string) => rows.find((r: any) => r.key === `${kind}.${k}`)?.value as string | undefined;
  const hours = Number(value('customer_cancel_hours'));
  const changeDays = Number(value('change_refund_days') ?? DEFAULT_CANCEL_SETTINGS.change_refund_days);
  return {
    customer_cancel_enabled: value('customer_cancel_enabled') === 'true',
    customer_cancel_hours: Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_CANCEL_SETTINGS.customer_cancel_hours,
    cancel_refund_to: value('cancel_refund_to') === 'credit' ? 'credit' : 'card',
    change_refund_days: Number.isFinite(changeDays) && changeDays >= 0 ? changeDays : DEFAULT_CANCEL_SETTINGS.change_refund_days,
  };
}

export async function setCancelSettings(businessId: string, kind: CancelKind, input: Partial<CancelSettings>): Promise<CancelSettings> {
  const values: Record<string, string> = {};
  if (input.customer_cancel_enabled !== undefined) values.customer_cancel_enabled = String(!!input.customer_cancel_enabled);
  if (input.customer_cancel_hours !== undefined) values.customer_cancel_hours = String(input.customer_cancel_hours);
  if (input.cancel_refund_to !== undefined) values.cancel_refund_to = input.cancel_refund_to;
  if (kind === 'events' && input.change_refund_days !== undefined) values.change_refund_days = String(input.change_refund_days);
  for (const [k, v] of Object.entries(values)) {
    await adminPool.query(
      `INSERT INTO sys_business_configurations (business_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [businessId, `${kind}.${k}`, v],
    );
  }
  return getCancelSettings(businessId, kind);
}

/**
 * Whether a customer may cancel something that starts at `startTime` under these
 * settings, and until when. `until` is null when customers may not cancel at all.
 */
export function customerCancelWindow(settings: CancelSettings, startTime: Date | string, now = new Date(), changeRefundUntil?: Date | string | null): { allowed: boolean; until: string | null; reason?: string; afterChange?: boolean } {
  // After a date, time or place change: cancelling (full refund) is open until the window ends,
  // whatever the normal rules say (decision 14).
  if (changeRefundUntil && now.getTime() < new Date(changeRefundUntil).getTime() && now.getTime() < new Date(startTime).getTime()) {
    return { allowed: true, until: new Date(changeRefundUntil).toISOString(), afterChange: true };
  }
  if (!settings.customer_cancel_enabled) {
    return { allowed: false, until: null, reason: 'Cancelling online is not available. Please contact the business.' };
  }
  const until = new Date(new Date(startTime).getTime() - settings.customer_cancel_hours * 3600 * 1000);
  if (now.getTime() > until.getTime()) {
    return { allowed: false, until: until.toISOString(), reason: `It can no longer be cancelled online: cancelling closes ${settings.customer_cancel_hours} hours before the start. Please contact the business.` };
  }
  return { allowed: true, until: until.toISOString() };
}
