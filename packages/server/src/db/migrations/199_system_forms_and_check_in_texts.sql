-- Spec 51, gap 17, criteria 7 to 9 (owner, 24 Nov 2026: system templates are not limited to emails).
-- System forms and chart templates: built by platform administrators with the business's form
-- builder; a business sees the active ones read only and duplicates one into its own form or chart
-- template (a system form never applies to a business by itself). System check-in wording: the
-- platform's wording for the check-in screens, over the built-in wording and under a business's own.
-- Platform configuration (no tenant), like sys_document_templates (migration 198).
BEGIN;

CREATE TABLE IF NOT EXISTS sys_form_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        VARCHAR(12) NOT NULL CHECK (kind IN ('form', 'chart')),
  name        VARCHAR(200) NOT NULL,
  language    VARCHAR(10),
  definition  JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sys_form_templates_kind ON sys_form_templates(kind, is_active);

-- a business copy remembers the system form it came from
ALTER TABLE frm_forms ADD COLUMN IF NOT EXISTS copied_from_system_id UUID REFERENCES sys_form_templates(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sys_check_in_texts (
  language    VARCHAR(10) PRIMARY KEY,
  texts       JSONB NOT NULL DEFAULT '{}',
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Starters (criterion 8), not active, for the administrator to review and activate.
INSERT INTO sys_form_templates (kind, name, language, definition, is_active)
SELECT v.kind, v.name, 'en', v.definition::jsonb, false
  FROM (VALUES
  ('form', 'Starter: Health intake',
   $j${"items": [
     {"id": "h1", "type": "heading", "text": "Health questionnaire"},
     {"id": "t1", "type": "text", "text": "Please answer these questions before your first visit, so we can look after you safely. Your answers are kept private."},
     {"id": "q1", "type": "date", "label": "Date of birth", "required": true},
     {"id": "q2", "type": "write_in", "label": "Emergency contact (name and phone)", "required": true},
     {"id": "q3", "type": "yes_no", "label": "Are you currently under a doctor's care?", "required": true},
     {"id": "q4", "type": "write_in", "label": "If yes, please give details", "required": false},
     {"id": "q5", "type": "multi_choice", "label": "Do you have, or have you had, any of the following?", "required": false, "columns": 2,
      "options": ["High or low blood pressure", "Heart condition", "Diabetes", "Asthma or breathing problems", "Epilepsy", "Pregnancy", "Recent surgery or injury", "Skin condition", "None of these"]},
     {"id": "q6", "type": "write_in", "label": "Medication you are taking", "required": false},
     {"id": "q7", "type": "write_in", "label": "Allergies", "required": false},
     {"id": "q8", "type": "write_in", "label": "Anything else we should know?", "required": false}
   ]}$j$),
  ('form', 'Starter: Consent and waiver',
   $j${"items": [
     {"id": "h1", "type": "heading", "text": "Consent and waiver"},
     {"id": "t1", "type": "text", "text": "Our treatments are safe for most people, but every body is different. Some treatments can cause temporary discomfort, redness or tiredness. Please tell us before your treatment about any health condition, medication, pregnancy or injury, and tell the practitioner straight away if anything feels wrong during your session."},
     {"id": "t2", "type": "text", "text": "By signing, you confirm that the information you have given us is true and complete, that you will tell us if it changes, and that you take part in your treatment of your own free will."},
     {"id": "q1", "type": "yes_no", "label": "Have you told us about every health condition, medication and injury that could matter for your treatment?", "required": true},
     {"id": "a1", "type": "agree", "label": "I have read and agree to the above"},
     {"id": "s1", "type": "signature", "label": "Signature"}
   ]}$j$),
  ('chart', 'Starter: Treatment note',
   $j${"items": [
     {"id": "h1", "type": "heading", "text": "Treatment note"},
     {"id": "q1", "type": "write_in", "label": "Reason for the visit (what the customer tells you)", "required": true},
     {"id": "q2", "type": "write_in", "label": "Observations", "required": false},
     {"id": "q3", "type": "write_in", "label": "Assessment", "required": false},
     {"id": "q4", "type": "write_in", "label": "Treatment given", "required": true},
     {"id": "q5", "type": "write_in", "label": "Plan and advice for the customer", "required": false},
     {"id": "q6", "type": "date", "label": "Suggested next visit", "required": false}
   ]}$j$)
  ) AS v(kind, name, definition)
 WHERE NOT EXISTS (SELECT 1 FROM sys_form_templates s WHERE s.kind = v.kind AND s.name = v.name);

COMMIT;
