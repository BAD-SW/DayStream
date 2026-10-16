-- Reshape pay_document_branding to support MULTIPLE named templates per artifact
-- type (spec 10, Requirement C12 extended — task 6.1 refinement).
--
-- 148 created one customization row per (business, artifact_type). The product
-- requirement is richer: a business may keep several named templates for the same
-- artifact type (e.g. a default and a seasonal variant, or per-language versions)
-- and the RESOLVER (task 6.2, code) decides which one a given document uses.
--
-- Design principle: the SCHEMA must not constrain the resolver. So we store
-- candidate templates and their selection ATTRIBUTES, and let code pick the winner.
--   - Typed, first-class selection dimensions we're confident about: name,
--     language, is_active.
--   - selection_rules JSONB is the growth valve — future dimensions (date ranges,
--     per-process bindings, priority, etc.) go here with NO further migration.
--   - NO uniqueness / "exactly one active" constraint: more than one template may
--     validly be a candidate, so "which is used" is resolver logic, not a DB rule.
--
-- Nothing reads this table yet (6.2/6.3 are pending), so reshaping is safe.

BEGIN;

-- Drop the one-per-type uniqueness (now many templates per artifact_type) and the
-- old enable flag (replaced by is_active below).
ALTER TABLE pay_document_branding
  DROP CONSTRAINT IF EXISTS pay_document_branding_business_id_artifact_type_key;

ALTER TABLE pay_document_branding
  DROP COLUMN IF EXISTS enabled;

ALTER TABLE pay_document_branding
  -- Human label for the template ("Default", "Summer 2026", "French", ...).
  ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL DEFAULT 'Default',
  -- BCP-47-ish language tag this template is written in (NULL = language-agnostic /
  -- business default). A first-class matching dimension for the resolver.
  ADD COLUMN IF NOT EXISTS language VARCHAR(10),
  -- Simple enable/disable: an inactive template is a draft the resolver ignores.
  -- NOT a uniqueness constraint — several templates can be active at once; the
  -- resolver decides which applies.
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  -- Open-ended selection attributes the resolver will grow into without a migration:
  -- e.g. { "valid_from": "...", "valid_to": "...", "processes": [...], "priority": N }.
  ADD COLUMN IF NOT EXISTS selection_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Lookups the resolver and the editor list will make: all templates for a
-- business + artifact type (then filter by language/is_active/rules in code).
CREATE INDEX IF NOT EXISTS idx_pay_document_branding_lookup
  ON pay_document_branding(business_id, artifact_type);

COMMIT;
