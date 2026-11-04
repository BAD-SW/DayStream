import { useEffect, useState } from 'react';
import { getColumnOrder } from '../api/inbox';

/**
 * Column order (THE-18, David 2026-11-04: one order per business, set in Settings → People lists).
 * People and Leads show their own columns in this order; a column a list doesn't have is skipped.
 * Fixed, never ordered: the selection box (first), the name (first after it) and the actions (last).
 */
export const ORDERABLE_COLUMNS: { key: string; label: string; lists: string }[] = [
  { key: 'reference_number', label: 'Ref', lists: 'People' },
  { key: 'email', label: 'Email', lists: 'People, Leads' },
  { key: 'phone', label: 'Phone', lists: 'People, Leads' },
  { key: 'stage', label: 'Stage (lifecycle / lead stage)', lists: 'People, Leads' },
  { key: 'source', label: 'Source', lists: 'People, Leads' },
  { key: 'owner', label: 'Staff member / Assigned staff', lists: 'People, Leads' },
  { key: 'tags', label: 'Tags', lists: 'Leads' },
  { key: 'messages_sent', label: 'Messages sent', lists: 'Leads' },
  { key: 'last_contacted', label: 'Last contacted', lists: 'People' },
  { key: 'last_activity', label: 'Last activity', lists: 'People' },
  { key: 'next_booking', label: 'Next booking', lists: 'People' },
  { key: 'visits', label: 'Visits', lists: 'People' },
  { key: 'created_at', label: 'Added / Created at', lists: 'People, Leads' },
];

export const DEFAULT_ORDER = ORDERABLE_COLUMNS.map((c) => c.key);

/** The saved order completed with any column it doesn't name yet (in the default place). */
export function fullOrder(saved: string[]): string[] {
  const known = saved.filter((k) => DEFAULT_ORDER.includes(k));
  return [...known, ...DEFAULT_ORDER.filter((k) => !known.includes(k))];
}

let cached: Promise<string[]> | null = null;
/** The business's column order (loaded once per page load; Settings refreshes it after saving). */
export function useColumnOrder(): string[] {
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  useEffect(() => {
    cached = cached || getColumnOrder().catch(() => []);
    cached.then((o) => setOrder(fullOrder(o)));
  }, []);
  return order;
}
export function forgetColumnOrder() { cached = null; }

/**
 * A list's columns in the business order. `canonical` maps the list's column key to the shared key
 * (e.g. People's lifecycle_stage → stage); `fixedFirst` are the name columns, always first; any
 * other column without a shared key (the actions) stays last.
 */
export function orderColumns<C extends { key: string }>(columns: C[], order: string[], canonical: Record<string, string>, fixedFirst: string[]): C[] {
  const rank = (c: C) => order.indexOf(canonical[c.key]);
  const first = columns.filter((c) => fixedFirst.includes(c.key));
  const ordered = columns.filter((c) => !fixedFirst.includes(c.key) && canonical[c.key] && rank(c) >= 0).sort((a, b) => rank(a) - rank(b));
  const last = columns.filter((c) => !first.includes(c) && !ordered.includes(c));
  return [...first, ...ordered, ...last];
}
