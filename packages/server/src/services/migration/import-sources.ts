import { ColumnProposal, normalizeHeader } from './import-engine';

/**
 * Source systems (spec 50, Requirement 19). The owner picks where a file came from BEFORE
 * uploading it, so the column mapping can use that system's known layout instead of guessing.
 *
 * The owner only picks the SYSTEM (e.g. "Stripe"). A system can produce more than one file
 * layout (Stripe's account-copy file and its import-from-another-processor file); which one was
 * uploaded is recognised here, from the file's headers or, for a header-less file, its width.
 * A layout maps the columns it knows; any column it doesn't name falls back to automatic detection.
 *
 * Add a system by adding an entry to SOURCE_SYSTEMS and its option in the client's SOURCE_OPTIONS;
 * add a layout to an existing system without touching the client.
 */

export type ImportSourceId = 'auto' | 'stripe';

export interface SourceLayout {
  /** Plain-language name shown to the owner once recognised. */
  label: string;
  /** Known header (normalised) → DayStream field, or null to leave that column unmapped. */
  headers: Record<string, string | null>;
  /** Known column order, used only for a header-less file of exactly this width. */
  positions?: Array<string | null>;
}

export interface SourceSystem {
  id: Exclude<ImportSourceId, 'auto'>;
  /** Import kinds this system applies to. */
  kinds: string[];
  layouts: SourceLayout[];
}

// Stripe's self-serve account-to-account copy. Mapping file headers per Stripe's guide:
// customer_id_old, source_id_old, customer_id_new, source_id_new (customer ids are unchanged by
// the copy; v2 copies add v2_account_id_old / _new). The OLD payment id can't be charged.
const STRIPE_ACCOUNT_COPY: SourceLayout = {
  label: 'Stripe account copy file',
  headers: {
    customeridold: 'previous_processor_customer_id',
    sourceidold: null,
    customeridnew: 'stripe_customer_id',
    sourceidnew: 'payment_method_token',
    v2accountidold: null,
    v2accountidnew: null,
  },
  positions: ['previous_processor_customer_id', null, 'stripe_customer_id', 'payment_method_token'],
};

// Stripe's Data Migrations team importing from another processor. CSV mapping file per Stripe's
// guide: old_customer_id, customer_id, old_card_id, card_id, card_fingerprint, card_last4,
// card_exp_month, card_exp_year, card_brand. Payment Method imports name the id columns
// old_payment_method_id / payment_method_id instead of the card ones.
const STRIPE_PROCESSOR_IMPORT: SourceLayout = {
  label: 'Stripe import mapping file (from another processor)',
  headers: {
    oldcustomerid: 'previous_processor_customer_id',
    customerid: 'stripe_customer_id',
    oldcardid: null,
    cardid: 'payment_method_token',
    oldpaymentmethodid: null,
    paymentmethodid: 'payment_method_token',
    cardfingerprint: null,
    fingerprint: null,
    cardlast4: 'last4',
    cardexpmonth: 'exp_month',
    cardexpyear: 'exp_year',
    cardbrand: 'brand',
  },
  positions: ['previous_processor_customer_id', 'stripe_customer_id', null, 'payment_method_token', null, 'last4', 'exp_month', 'exp_year', 'brand'],
};

export const SOURCE_SYSTEMS: Record<Exclude<ImportSourceId, 'auto'>, SourceSystem> = {
  stripe: { id: 'stripe', kinds: ['payment_methods'], layouts: [STRIPE_ACCOUNT_COPY, STRIPE_PROCESSOR_IMPORT] },
};

/** True when `source` is a known source id usable for this import kind ('auto' always is). */
export function isValidSource(source: string, kind: string): source is ImportSourceId {
  if (source === 'auto') return true;
  const system = (SOURCE_SYSTEMS as Record<string, SourceSystem | undefined>)[source];
  return !!system && system.kinds.includes(kind);
}

/** A header row must name at least this many of a layout's columns to count as that layout. */
const MIN_HEADER_MATCHES = 2;

/**
 * Recognise which of a system's layouts the file is: by header (the layout naming the most
 * columns, at least MIN_HEADER_MATCHES), else for a header-less file the layout of exactly that
 * width. Returns the column → field assignments, or null when no layout fits.
 */
export function recognizeLayout(
  system: SourceSystem, headerRow: string[], hasHeader: boolean, width: number,
): { layout: SourceLayout; assigned: Map<number, string | null> } | null {
  if (hasHeader) {
    let best: { layout: SourceLayout; assigned: Map<number, string | null> } | null = null;
    for (const layout of system.layouts) {
      const assigned = new Map<number, string | null>();
      headerRow.forEach((h, i) => {
        const key = normalizeHeader(h ?? '');
        if (key in layout.headers) assigned.set(i, layout.headers[key]);
      });
      if (assigned.size >= MIN_HEADER_MATCHES && (!best || assigned.size > best.assigned.size)) best = { layout, assigned };
    }
    return best;
  }
  const layout = system.layouts.find((l) => l.positions && l.positions.length === width);
  if (!layout) return null;
  return { layout, assigned: new Map(layout.positions!.map((f, i) => [i, f])) };
}

/**
 * Overlay the chosen system's recognised layout on the automatic proposals. Columns the layout
 * names are set to its field (certain) or deliberately left unmapped; a field the layout assigns
 * is removed from any other column the automatic pass gave it to; every other column keeps its
 * automatic proposal. 'auto', or a file no layout fits, returns the proposals unchanged.
 */
export function applySourcePreset(
  proposals: ColumnProposal[], headerRow: string[], hasHeader: boolean, source: ImportSourceId,
): { proposals: ColumnProposal[]; layout: string | null } {
  if (source === 'auto') return { proposals, layout: null };
  const match = recognizeLayout(SOURCE_SYSTEMS[source], headerRow, hasHeader, proposals.length);
  if (!match) return { proposals, layout: null };

  const { assigned } = match;
  const layoutFields = new Set([...assigned.values()].filter((f): f is string => !!f));
  const mapped = proposals.map((p) => {
    if (assigned.has(p.index)) {
      const field = assigned.get(p.index) ?? null;
      return { ...p, field, confident: field !== null, confidence: field ? 'certain' as const : 'unknown' as const };
    }
    if (p.field && layoutFields.has(p.field)) return { ...p, field: null, confident: false, confidence: 'unknown' as const };
    return p;
  });
  return { proposals: mapped, layout: match.layout.label };
}
