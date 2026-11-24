-- Spec 51, gap 17 (design 17): system templates. The platform keeps one set of document templates,
-- built by platform administrators in System Configuration > Templates. A business sees them read
-- only and duplicates one to customise it; a business with no active template of its own for a
-- type sends with the active system template. Platform configuration, like
-- sys_system_configurations: no tenant, read and written only through the administrators' routes.
-- The starter wording below is loaded not active, for the administrator to review and activate.
BEGIN;

CREATE TABLE IF NOT EXISTS sys_document_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type     VARCHAR(40) NOT NULL,
  name              VARCHAR(120) NOT NULL,
  language          VARCHAR(10),
  is_active         BOOLEAN NOT NULL DEFAULT false,
  selection_rules   JSONB,
  logo_url          TEXT,
  color_primary     VARCHAR(9),
  color_secondary   VARCHAR(9),
  sender_name       VARCHAR(120),
  reply_to          VARCHAR(255),
  subject_template  TEXT,
  body_template     TEXT,
  footer_text       TEXT,
  footer_link_text  VARCHAR(120),
  footer_link_url   TEXT,
  created_by        UUID,
  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sys_document_templates_type ON sys_document_templates(artifact_type, is_active);

-- a business copy remembers the system template it came from
ALTER TABLE pay_document_branding ADD COLUMN IF NOT EXISTS copied_from_system_id UUID REFERENCES sys_document_templates(id) ON DELETE SET NULL;

-- Starter wording (criterion 6): plain, friendly English with the placeholders in place.
INSERT INTO sys_document_templates (artifact_type, name, language, is_active, subject_template, body_template, footer_text)
SELECT v.artifact_type, v.name, 'en', false, v.subject_template, v.body_template, NULL
  FROM (VALUES
  ('booking.confirmation', 'Starter: Appointment',
   $s$Your appointment at {{business_name}} is confirmed$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your appointment at {{business_name}} is confirmed.</div><div><br></div><div>Service: {{service_name}}</div><div>Date: {{appointment_date}}</div><div>Time: {{appointment_time}}</div><div>With: {{staff_name}}</div><div>Reference: {{booking_reference}}</div><div><br></div><div>{{calendar_links}}</div><div><br></div><div>When you arrive, you can check in from your phone and complete any forms here: {{check_in_link}}</div><div><br></div><div>Need to change something? Reply to this email.</div><div><br></div><div>See you soon,</div><div>{{business_name}}</div>$b$),

  ('booking.reminder', 'Starter: Appointment Reminder',
   $s$Reminder: your appointment at {{business_name}} on {{appointment_date}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>This is a reminder that your appointment is in {{reminder_lead}}.</div><div><br></div><div>Service: {{service_name}}</div><div>Date: {{appointment_date}}</div><div>Time: {{appointment_time}}</div><div>With: {{staff_name}}</div><div>Reference: {{booking_reference}}</div><div><br></div><div>Save time when you arrive: check in from your phone and complete any forms here: {{check_in_link}}</div><div><br></div><div>If you can no longer come, please let us know as soon as possible by replying to this email.</div><div><br></div><div>See you soon,</div><div>{{business_name}}</div>$b$),

  ('booking.cancellation', 'Starter: Cancellation',
   $s$Your appointment at {{business_name}} has been cancelled$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your appointment has been cancelled.</div><div><br></div><div>Service: {{service_name}}</div><div>Date: {{appointment_date}}</div><div>Time: {{appointment_time}}</div><div>Reference: {{booking_reference}}</div><div>Reason: {{reason}}</div><div><br></div><div>We would be glad to see you another time. To book again, reply to this email.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$),

  ('booking.reschedule', 'Starter: Appointment Rescheduled',
   $s$Your appointment at {{business_name}} has moved to {{appointment_date}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your appointment has been moved.</div><div><br></div><div>Was: {{previous_date}} at {{previous_time}}</div><div>Now: {{appointment_date}} at {{appointment_time}}</div><div><br></div><div>Service: {{service_name}}</div><div>With: {{staff_name}}</div><div>Reference: {{booking_reference}}</div><div><br></div><div>{{calendar_links}}</div><div><br></div><div>If the new time does not suit you, reply to this email.</div><div><br></div><div>See you soon,</div><div>{{business_name}}</div>$b$),

  ('invoice.issued', 'Starter: Adjustment',
   $s${{business_name}}: {{adjustment_number}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Please find the details of {{adjustment_number}}, dated {{adjustment_date}}, below.</div><div><br></div><div>{{details_table}}</div><div><br></div><div>Amount: {{amount_due}}</div><div><br></div><div>If you have any questions about it, reply to this email.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$),

  ('payment.receipt', 'Starter: Payment Receipt',
   $s$Your receipt from {{business_name}} ({{receipt_number}})$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Thank you for your payment. Here are the details.</div><div><br></div><div>{{details_table}}</div><div><br></div><div>Amount paid: {{amount_paid}}</div><div>Paid by: {{payment_method}}</div><div>Date: {{payment_date}}</div><div>Receipt number: {{receipt_number}}</div><div><br></div><div>Keep this email for your records.</div><div><br></div><div>Thank you,</div><div>{{business_name}}</div>$b$),

  ('payment.refund_confirmation', 'Starter: Refund Confirmation',
   $s$Your refund from {{business_name}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>We have processed a refund of {{refund_amount}} on {{refund_date}}.</div><div><br></div><div>Refunded to: {{payment_method}}</div><div>Original payment: {{original_payment_date}}</div><div>Reference: {{reference_number}}</div><div><br></div><div>Depending on your bank, it can take a few days to appear on your statement.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$),

  ('payment.dunning', 'Starter: Failed Payment',
   $s$Your payment to {{business_name}} did not go through$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>We could not take your payment of {{amount_due}}.</div><div>Reason: {{failure_reason}}</div><div><br></div><div>We will try again on {{retry_date}}. To avoid any interruption, please check or update your payment details here: {{update_payment_link}}</div><div><br></div><div>If you have any questions, reply to this email.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$),

  ('membership.renewal_reminder', 'Starter: Renewal Reminder',
   $s$Your {{membership_name}} membership renews on {{renewal_date}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your {{membership_name}} membership renews on {{renewal_date}}.</div><div><br></div><div>Amount: {{renewal_amount}}</div><div>Paid by: {{payment_method}}</div><div><br></div><div>There is nothing you need to do. To change or manage your membership: {{manage_link}}</div><div><br></div><div>Thank you for being a member,</div><div>{{business_name}}</div>$b$),

  ('gift_card.issued', 'Starter: Gift Card',
   $s${{sender_name}} sent you a gift card for {{business_name}}$s$,
   $b$<div>Hi {{recipient_name}},</div><div><br></div><div>{{sender_name}} has sent you a gift card for {{business_name}}.</div><div><br></div><div>Amount: {{gift_card_amount}}</div><div>Code: {{gift_card_code}}</div><div>Valid until: {{expiry_date}}</div><div><br></div><div>Use it here: {{redeem_link}}</div><div>Or give the code when you book or pay with us.</div><div><br></div><div>Enjoy,</div><div>{{business_name}}</div>$b$),

  ('purchase_order.sent', 'Starter: Purchase Order',
   $s$Purchase order {{po_number}} from {{business_name}}$s$,
   $b$<div>Hello {{vendor_contact_name}},</div><div><br></div><div>Please find our purchase order {{po_number}}, dated {{po_date}}, below.</div><div><br></div><div>{{details_table}}</div><div><br></div><div>Order total: {{po_total}}</div><div>Expected by: {{expected_date}}</div><div>Deliver to: {{deliver_to}}, {{deliver_to_address}}</div><div><br></div><div>{{po_note}}</div><div><br></div><div>Please confirm the order and the delivery date by replying to this email.</div><div><br></div><div>Thank you,</div><div>{{business_name}}</div>$b$),

  ('customer.document', 'Starter: New Customer',
   $s$Welcome to {{business_name}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Welcome to {{business_name}}. We are glad to have you.</div><div><br></div><div>If you have any questions, reply to this email.</div><div><br></div><div>See you soon,</div><div>{{business_name}}</div>$b$),

  ('event.registration_confirmed', 'Starter: Event Registration',
   $s$You are registered: {{event_name}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>You are registered for {{event_name}}.</div><div><br></div><div>When: {{event_when}}</div><div>Where: {{event_location}}</div><div>Ticket: {{event_ticket}}</div><div>Reference: {{booking_reference}}</div><div><br></div><div>If you can no longer come, please let us know by replying to this email.</div><div><br></div><div>See you there,</div><div>{{business_name}}</div>$b$),

  ('event.registration_reserved', 'Starter: Event Place Reserved',
   $s$Your place is reserved: {{event_name}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your place at {{event_name}} is reserved.</div><div><br></div><div>When: {{event_when}}</div><div>Where: {{event_location}}</div><div>Ticket: {{event_ticket}}</div><div>Reference: {{booking_reference}}</div><div><br></div><div>{{event_payment_note}}</div><div><br></div><div>If you can no longer come, please let us know by replying to this email.</div><div><br></div><div>See you there,</div><div>{{business_name}}</div>$b$),

  ('event.registration_cancelled', 'Starter: Event Registration Cancelled',
   $s$Your registration has been cancelled: {{event_name}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>Your registration for {{event_name}} ({{event_when}}) has been cancelled.</div><div>Reference: {{booking_reference}}</div><div><br></div><div>{{event_refund_note}}</div><div><br></div><div>We hope to see you at another event soon.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$),

  ('customer.task_reminder', 'Starter: Task Reminder',
   $s$A reminder from {{business_name}}: {{task_title}}$s$,
   $b$<div>Hi {{customer_first_name}},</div><div><br></div><div>A reminder from {{business_name}}:</div><div><br></div><div>{{task_title}}</div><div>{{task_details}}</div><div>Date: {{task_due_date}}</div><div><br></div><div>If you have any questions, reply to this email.</div><div><br></div><div>Kind regards,</div><div>{{business_name}}</div>$b$)
  ) AS v(artifact_type, name, subject_template, body_template)
 WHERE NOT EXISTS (SELECT 1 FROM sys_document_templates s WHERE s.artifact_type = v.artifact_type);

COMMIT;
