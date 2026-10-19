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

/**
 * The `{{details_table}}` token. Unlike scalar placeholders (which substitute a
 * string), this is a PLACEMENT MARKER: each renderer (on-screen, PDF) replaces it
 * with a natively-drawn line-item table at the position the user placed it.
 */
export const DETAILS_TABLE_TOKEN = 'details_table';

/** One row of a document's line-item (details) table. */
export interface DocumentTableRow {
  description: string;
  qty: number;
  /** Amount in minor units (cents). */
  amountCents: number;
}

/** The structured details table a renderer draws where `{{details_table}}` sits. */
export interface DocumentDetailsTable {
  rows: DocumentTableRow[];
  totalCents: number;
  currency: string;
}

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
    label: 'Adjustment',
    description: 'A customer adjustment — an invoice (debit) or a credit note (credit).',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'adjustment_number',
        label: 'Adjustment Number',
        description: 'The adjustment reference number (e.g. credit note CN-1001 or debit note DN-1001).',
        sample: 'CN-1001',
      },
      {
        token: 'adjustment_date',
        label: 'Adjustment Date',
        description: 'The date the adjustment was issued.',
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
      {
        token: 'details_table',
        label: 'Details Table',
        description: 'A line-item table (Description, Qty, Amount) with a total. Expands where you place it.',
        sample: '[line-item table]',
      },
    ],
  },
  {
    key: 'payment.receipt',
    label: 'Payment Receipt',
    description: 'Sent after a payment is successfully taken.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'receipt_number',
        label: 'Receipt Number',
        description: 'The receipt reference number.',
        sample: 'RCP-2026-00117',
      },
      {
        token: 'payment_date',
        label: 'Payment Date',
        description: 'The date the payment was taken.',
        sample: '15 Oct 2026',
      },
      {
        token: 'amount_paid',
        label: 'Amount Paid',
        description: 'The amount paid, formatted in the business currency.',
        sample: '€120.00',
      },
      {
        token: 'payment_method',
        label: 'Payment Method',
        description: 'How the payment was made (e.g. card ending 4242).',
        sample: 'Visa ending 4242',
      },
      {
        token: 'details_table',
        label: 'Details Table',
        description: 'A line-item table (Description, Qty, Amount) with a total. Expands where you place it.',
        sample: '[line-item table]',
      },
    ],
  },
  {
    key: 'payment.refund_confirmation',
    label: 'Refund Confirmation',
    description: 'Confirms to the customer that a refund has been processed.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'refund_amount',
        label: 'Refund Amount',
        description: 'The refunded amount, formatted in the business currency.',
        sample: '€120.00',
      },
      {
        token: 'refund_date',
        label: 'Refund Date',
        description: 'The date the refund was processed.',
        sample: '16 Oct 2026',
      },
      {
        token: 'payment_method',
        label: 'Payment Method',
        description: 'Where the refund was sent (e.g. card ending 4242).',
        sample: 'Visa ending 4242',
      },
      {
        token: 'original_payment_date',
        label: 'Original Payment Date',
        description: 'The date of the payment being refunded.',
        sample: '15 Oct 2026',
      },
      {
        token: 'reference_number',
        label: 'Reference Number',
        description: 'The refund transaction reference.',
        sample: 'RFN-2026-00042',
      },
    ],
  },
  {
    key: 'payment.dunning',
    label: 'Failed Payment',
    description: 'Sent when an automatic payment fails and will be retried.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'amount_due',
        label: 'Amount Due',
        description: 'The outstanding amount, formatted in the business currency.',
        sample: '€59.00',
      },
      {
        token: 'failure_reason',
        label: 'Failure Reason',
        description: 'Why the payment failed (e.g. card declined).',
        sample: 'Card declined',
      },
      {
        token: 'retry_date',
        label: 'Retry Date',
        description: 'When the next automatic retry will happen.',
        sample: '19 Oct 2026',
      },
      {
        token: 'update_payment_link',
        label: 'Update Payment Link',
        description: 'URL where the customer can update their payment method.',
        sample: 'https://pay.daystream.app/update/abc123',
      },
    ],
  },
  {
    key: 'membership.renewal_reminder',
    label: 'Renewal Reminder',
    description: 'Reminds a customer that their membership is about to renew.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'membership_name',
        label: 'Membership Name',
        description: 'The name of the membership plan.',
        sample: 'Unlimited Monthly',
      },
      {
        token: 'renewal_date',
        label: 'Renewal Date',
        description: 'When the membership will renew.',
        sample: '1 Nov 2026',
      },
      {
        token: 'renewal_amount',
        label: 'Renewal Amount',
        description: 'The amount that will be charged on renewal.',
        sample: '€89.00',
      },
      {
        token: 'payment_method',
        label: 'Payment Method',
        description: 'The card/method that will be charged.',
        sample: 'Visa ending 4242',
      },
      {
        token: 'manage_link',
        label: 'Manage Link',
        description: 'URL where the customer can manage their membership.',
        sample: 'https://pay.daystream.app/membership/abc123',
      },
    ],
  },
  {
    key: 'gift_card.issued',
    label: 'Gift Card',
    description: 'Sent to the recipient when a gift card is issued.',
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      {
        token: 'gift_card_code',
        label: 'Gift Card Code',
        description: 'The redeemable gift card code.',
        sample: 'GC-7K4M-9QP2',
      },
      {
        token: 'gift_card_amount',
        label: 'Gift Card Amount',
        description: 'The value of the gift card, formatted in the business currency.',
        sample: '€50.00',
      },
      {
        token: 'recipient_name',
        label: 'Recipient Name',
        description: 'The name of the gift card recipient.',
        sample: 'Jordan Lee',
      },
      {
        token: 'sender_name',
        label: 'Sender Name',
        description: 'Who the gift card is from.',
        sample: 'Alex Rivera',
      },
      {
        token: 'expiry_date',
        label: 'Expiry Date',
        description: 'When the gift card expires (if applicable).',
        sample: '15 Oct 2027',
      },
      {
        token: 'redeem_link',
        label: 'Redeem Link',
        description: 'URL where the recipient can redeem the gift card.',
        sample: 'https://pay.daystream.app/gift/GC-7K4M-9QP2',
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
