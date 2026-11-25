import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { lifecycleStageLabel, personSourceLabel } from '@daystream/shared';
import { getColumnOrder } from '../api/inbox';
import i18n from '../i18n';

/**
 * Column order (THE-18, David 2026-11-04: one order per business, set in Settings → People lists).
 * People and Leads show their own columns in this order; a column a list doesn't have is skipped.
 * Fixed, never ordered: the selection box (first), the name (first after it) and the actions (last).
 */
/** A column's words come from the customers translation file, looked up when they are read (never at load). */
function orderable(key: string, lists: string): { key: string; label: string; lists: string } {
  return {
    key,
    get label() { return i18n.t('customers:peopleColumns.' + key); },
    get lists() { return i18n.t('customers:peopleColumns.lists.' + lists); },
  };
}
export const ORDERABLE_COLUMNS: { key: string; label: string; lists: string }[] = [
  orderable('reference_number', 'people'),
  orderable('email', 'both'),
  orderable('phone', 'both'),
  orderable('stage', 'both'),
  orderable('source', 'both'),
  orderable('owner', 'both'),
  orderable('tags', 'leads'),
  orderable('messages_sent', 'leads'),
  orderable('last_contacted', 'people'),
  orderable('last_activity', 'people'),
  orderable('next_booking', 'people'),
  orderable('visits', 'people'),
  orderable('created_at', 'both'),
];
/** A person's lifecycle stage in the language shown. */
export const stageText = (t: TFunction, stage: string | null | undefined): string =>
  stage ? t('customers:stage.' + stage, { defaultValue: lifecycleStageLabel(stage) }) : '';
/** A person's source in the language shown, with the detail in brackets when there is one. */
export function sourceText(t: TFunction, source: string | null | undefined, detail?: string | null): string {
  const label = t('customers:source.' + (source || 'unknown'), { defaultValue: personSourceLabel(source) });
  return detail ? t('customers:sourceWithDetail', { label, detail }) : label;
}
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
