-- Per-business, per-artifact-type customization of customer-facing payment
-- artifacts (spec 10, Requirement C12 / task 6.1).
--
-- A business can customize each artifact it issues to customers — invoices,
-- receipts, credit notes, dunning notices, payment/refund confirmations, renewal
-- reminders, and gift-card emails — with its own sender identity, messaging
-- (subject/body/footer), and per-artifact logo/color overrides.
--
-- This does NOT duplicate existing branding:
--   - Global UI/theme branding (logo, colors, fonts) lives in cfg_themes +
--     sys_businesses appearance columns (specs 37 / branding cascade).
--   - Business IDENTITY on documents (name, address, email, phone, tax_id) lives
--     on sys_businesses and is read directly by the invoice/receipt renderers.
-- This table adds what has no home today: the MESSAGING + sender identity for each
-- artifact TYPE, plus optional per-artifact logo/color overrides. Columns left NULL
-- mean "fall back to the platform default / the business's global branding."
--
-- Resolution (implemented in task 6.2): platform default template
--   -> this business's row for the artifact_type (or its 'default' row)
--   -> i18n. One business's branding never appears on another's artifacts.
--
-- Conventions (match migrations 127/146): tenant_id + business_id, gen_random_uuid,
-- timestamps; application-level isolation (no Postgres RLS — the query layer scopes
-- by business_id/tenant_id via adminPool).

BEGIN;

CREATE TABLE IF NOT EXISTS pay_document_branding (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,

  -- Which artifact this row customizes. Uses the dotted notification/document keys
  -- already in use (invoice.issued, invoice.paid, payment.receipt, payment.dunning,
  -- payment.credit_note, gift_card.issued, plus future payment.confirmation /
  -- payment.refund_confirmation / membership.renewal_reminder). The special value
  -- 'default' is a fallback applied to any artifact without its own row.
  artifact_type VARCHAR(40) NOT NULL,

  -- Optional per-artifact branding OVERRIDES (NULL = inherit the business's global
  -- branding / platform default). Colors are hex incl. optional alpha (#RRGGBB[AA]).
  logo_url        TEXT,
  color_primary   VARCHAR(9),
  color_secondary VARCHAR(9),

  -- Sender identity for emailed artifacts (NULL = platform/business default).
  sender_name   VARCHAR(120),
  reply_to      VARCHAR(255),

  -- Messaging. Templates may contain placeholders the render layer (6.2) fills,
  -- e.g. {{customer_name}}, {{invoice_number}}, {{amount}}, {{business_name}}.
  subject_template TEXT,
  body_template    TEXT,
  footer_text      TEXT,

  -- Whether this customization is active; a business can draft without applying.
  enabled       BOOLEAN NOT NULL DEFAULT true,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One customization row per (business, artifact_type).
  UNIQUE (business_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS idx_pay_document_branding_business ON pay_document_branding(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_document_branding_tenant ON pay_document_branding(tenant_id);

COMMIT;
