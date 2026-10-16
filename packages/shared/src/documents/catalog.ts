/**
 * Document-branding artifact catalog — the single source of truth for which
 * customer-facing documents a business can brand, and which placeholders each
 * document supports.
 *
 * Both client and server consume this: the client renders the artifact-type
 * dropdown and the clickable placeholder chips in the Templates editor, and the
 * server validates incoming template payloads and (later, in the resolver)
 * substitutes placeholders when rendering a real document.
 *
 * A placeholder token is written `{{token}}` inside a template field. The
 * resolver replaces it with the resolved value for a given artifact instance.
 * Keep tokens stable: once a business has saved a template referencing a token,
 * renaming it silently breaks their document.
 */

/** A single insertable placeholder for an artifact type. */
export interface DocumentPlaceholder {
  /** Token name without braces, e.g. `business_name` → inserted as `{{business_name}}`. */
  token: string;
  /** Short human label shown on the clickable chip. */
  label: string;
  /** One-line description shown on hover / in the chip's title. */
  description: string;
  /** Example resolved value, used for the live preview before a real document exists. */
  sample: string;
}

/** Which template fields a placeholder chip can be inserted into. */
export type DocumentFieldKey = 'subject' | 'body' | 'footer';

/** A brandable customer-facing document type. */
export interface DocumentArtifactType {
  /**
   * Stable dotted key that matches the notification `type` string used across
   * the platform (e.g. `invoice.issued`, `payment.receipt`). This is what the
   * resolver keys off when deciding which business template to apply.
   */
  key: string;
  /** Human label for the artifact-type dropdown. */
  label: string;
  /** One-line description of when this document is sent. */
  description: string;
  /** Placeholders available to this artifact's templates. */
  placeholders: DocumentPlaceholder[];
}

/**
 * Placeholders common to every artifact — business identity and the recipient.
 * Spread into each artifact's list so the shared set stays consistent.
 */
const COMMON_PLACEHOLDERS: DocumentPlaceholder[] = [
  {
    token: 'business_name',
    label: 'Business Name',
    description: "The sending business's display name.",
    sample: 'Transcend Health',
  },
  {
    token: 'business_address',
    label: 'Business Address',
    description: "The business's postal address.",
    sample: '12 Carrer Gran, Barcelona',
  },
  {
    token: 'business_email',
    label: 'Business Email',
    description: "The business's contact email.",
    sample: 'hello@transcend.test',
  },
  {
    token: 'business_phone',
    label: 'Business Phone',
    description: "The business's contact phone number.",
    sample: '+34 600 000 000',
  },
  {
    token: 'customer_name',
    label: 'Customer Name',
    description: "The recipient customer's full name.",
    sample: 'Alex Rivera',
  },
  {
    token: 'customer_first_name',
    label: 'Customer First Name',
    description: "The recipient customer's first name, for a friendly greeting.",
    sample: 'Alex',
  },
  {
    token: 'customer_email',
    label: 'Customer Email',
    description: "The recipient customer's email.",
    sample: 'alex@example.com',
  },
];

/**
 * The brandable artifact types. We ship the framework proven end-to-end with
 * Invoice; the remaining types are registered here so adding them later is a
 * catalog edit, not a code change.
 */
export const DOCUMENT_ARTIFACT_TYPES: DocumentArtifactType[] = [
  {
    key: 'invoice.issued',
    label: 'Invoice',
    description: 'Sent when an invoice is issued to a customer.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'invoice_number',
        label: 'Invoice Number',
        description: 'The invoice reference number.',
        sample: 'INV-2026-00042',
      },
      {
        token: 'invoice_date',
        label: 'Invoice Date',
        description: 'The date the invoice was issued.',
        sample: '15 Oct 2026',
      },
      {
        token: 'due_date',
        label: 'Due Date',
        description: 'The date payment is due.',
        sample: '29 Oct 2026',
      },
      {
        token: 'amount_due',
        label: 'Amount Due',
        description: 'The total amount payable, formatted in the business currency.',
        sample: '€120.00',
      },
      {
        token: 'payment_link',
        label: 'Payment Link',
        description: "URL where the customer can pay the invoice.",
        sample: 'https://pay.daystream.app/i/INV-2026-00042',
      },
    ],
  },
];

/** Look up an artifact type by its dotted key. */
export function getArtifactType(key: string): DocumentArtifactType | undefined {
  return DOCUMENT_ARTIFACT_TYPES.find((a) => a.key === key);
}

/** Returns true if the given dotted key is a known brandable artifact type. */
export function isKnownArtifactType(key: string): boolean {
  return DOCUMENT_ARTIFACT_TYPES.some((a) => a.key === key);
}
