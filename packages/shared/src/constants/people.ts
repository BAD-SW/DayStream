/**
 * Phase 46 — People Foundation: the names shown for a person's stage and source.
 * Stored values never change; only these labels are shown to users.
 */

export const LIFECYCLE_STAGES = ['lead', 'trial', 'active', 'at_risk', 'churned', 'winback'] as const;
export type LifecycleStageValue = typeof LIFECYCLE_STAGES[number];

/** 'trial' is a new customer (first booking until they become a regular), not a free trial. */
export const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  trial: 'New customer',
  active: 'Active',
  at_risk: 'At risk',
  churned: 'Former',
  winback: 'Won back',
};

export function lifecycleStageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return LIFECYCLE_STAGE_LABELS[stage] || stage;
}

export const PERSON_SOURCE_LABELS: Record<string, string> = {
  manual: 'Added by staff',
  import: 'Import',
  booking_widget: 'Booking widget',
  online_registration: 'Online registration',
  lead_form: 'Lead form',
  inbound_message: 'Inbound message',
  referral: 'Referral',
  walk_in: 'Walk-in',
  api: 'API',
  unknown: 'Unknown',
};

export function personSourceLabel(source: string | null | undefined, detail?: string | null): string {
  const label = PERSON_SOURCE_LABELS[source || 'unknown'] || source || 'Unknown';
  return detail ? `${label} (${detail})` : label;
}

/** The system views of the People list: each is a fixed set of stages. */
export const PEOPLE_VIEWS: Array<{ id: string; label: string; stages: LifecycleStageValue[] | null }> = [
  { id: 'all', label: 'All', stages: null },
  { id: 'leads', label: 'Leads', stages: ['lead'] },
  { id: 'customers', label: 'Customers', stages: ['trial', 'active', 'at_risk', 'winback'] },
  { id: 'at_risk', label: 'At risk', stages: ['at_risk'] },
  { id: 'former', label: 'Former', stages: ['churned'] },
];

/**
 * Leads (THE-17): where a lead came from, chosen by staff. Separate from the person's
 * `source`, which records how the record was created. Values agreed with David on
 * 28 October 2026 (Momence's list).
 */
export const LEAD_SOURCE_LABELS: Record<string, string> = {
  abandoned_checkout: 'Abandoned checkout',
  meta_ads: 'Paid Meta ads (Facebook/Instagram)',
  api: 'API endpoint',
  missed_call: 'Missed call',
  incoming_call: 'Incoming call',
  incoming_sms: 'Incoming SMS',
  web_chat: 'Web chat',
  app_message: 'Incoming app message',
  whatsapp: 'WhatsApp',
  website: 'Website',
};

export const LEAD_SOURCES = Object.keys(LEAD_SOURCE_LABELS);

/** The stages a new business starts with; each business can change them. */
export const DEFAULT_LEAD_STAGES = ['New', 'Contacted', 'Interested', 'Trial booked', 'Lost'];
