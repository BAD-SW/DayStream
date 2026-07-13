# Phase 26: Invoicing & Accounts Receivable - Requirements

## Overview

This phase builds a complete invoicing system that bridges the gap between services rendered and payments collected. For businesses that bill after service (dentists, clinics, professional services), this provides invoice generation, payment application, aging tracking, and automated dunning. The system supports both immediate-pay workflows (charge at time of service) and deferred-pay workflows (invoice generated, payment collected later).

## Goals

- Generate invoices automatically from completed bookings or manually by staff
- Track invoice lifecycle from draft through payment to closure
- Support partial payments, credit application, and overpayment handling
- Calculate and display accounts receivable aging (current, 30, 60, 90+ days)
- Automate dunning notices for overdue invoices on configurable schedules
- Integrate with the existing payment module for payment recording against invoices
- Provide AR reporting and dashboards for business financial oversight
- Support security restrictions on invoice management actions

## Glossary

- **Invoice**: A formal request for payment issued to a Customer for services rendered or products sold
- **Line_Item**: An individual charge on an Invoice (service, product, fee, discount, tax)
- **Invoice_Status**: The current state of an Invoice (draft, sent, partially_paid, paid, overdue, void, written_off)
- **Payment_Application**: The act of applying a payment (full or partial) to an outstanding Invoice
- **Credit_Memo**: A document reducing the amount owed, applied against an Invoice or held as customer credit
- **Aging_Bucket**: A time-based categorization of outstanding receivables (current, 1-30, 31-60, 61-90, 90+)
- **Dunning**: The process of sending reminders to customers with overdue invoices
- **Dunning_Schedule**: A configurable sequence of reminder actions (email, SMS) triggered at defined intervals after due date
- **Write_Off**: Marking an uncollectible invoice as a loss for accounting purposes
- **Statement**: A periodic summary of a customer's account activity and balance

## Requirements

### Requirement 1: Invoice Generation

**User Story:** As a staff member, I want invoices to be generated automatically when services are completed, so that billing is timely and consistent without manual effort.

#### Acceptance Criteria

1. THE system SHALL automatically generate an Invoice when a booking is marked as completed (configurable per business: auto-generate or manual-only)
2. THE system SHALL support manual Invoice creation by staff for ad-hoc charges
3. THE system SHALL generate a unique, sequential invoice number per Business (e.g., INV-2026-0001)
4. THE system SHALL populate Line_Items from the booking's service, variant, and pricing rule calculations
5. THE system SHALL support adding multiple Line_Items to a single Invoice (bundled services, products, fees)
6. THE system SHALL calculate tax per Line_Item based on the applicable tax rules
7. THE system SHALL set a due date based on the Business's configured payment terms (e.g., due on receipt, net 15, net 30, net 60)
8. THE system SHALL support configurable payment terms per Business (default) and per Customer (override)
9. THE system SHALL create the Invoice in "draft" status, allowing review before sending
10. THE system SHALL support adding discount Line_Items (flat or percentage) to an Invoice

### Requirement 2: Invoice Lifecycle Management

**User Story:** As a billing manager, I want to track invoices through their entire lifecycle, so that I know the status of every charge issued by the business.

#### Acceptance Criteria

1. THE system SHALL support the following Invoice_Status transitions: draft → sent → partially_paid → paid, draft → void, sent → overdue → partially_paid → paid, sent → void, overdue → written_off
2. THE system SHALL automatically transition an Invoice to "overdue" when the due date passes without full payment
3. THE system SHALL automatically transition an Invoice to "paid" when the total payments applied equal or exceed the invoice amount
4. THE system SHALL allow staff to void a draft or sent Invoice (with reason required)
5. THE system SHALL allow staff to write off an overdue Invoice (with approval if configured)
6. THE system SHALL log all status transitions with timestamp, user, and reason in the audit trail
7. THE system SHALL prevent editing Line_Items on a sent Invoice (void and re-issue instead)
8. THE system SHALL support viewing the full history of an Invoice (status changes, payments applied, communications sent)

### Requirement 3: Payment Application

**User Story:** As a receptionist, I want to apply payments to specific invoices, so that the customer's balance accurately reflects what has been paid.

#### Acceptance Criteria

1. THE system SHALL support applying a payment to one or more outstanding Invoices
2. THE system SHALL support partial payments (payment less than invoice total)
3. THE system SHALL track the remaining balance on each Invoice after partial payment
4. THE system SHALL support applying customer credit balances to outstanding Invoices
5. THE system SHALL handle overpayment by either applying the excess as customer credit or refunding (configurable)
6. THE system SHALL record which Invoice(s) each payment transaction is applied to (payment-to-invoice mapping)
7. THE system SHALL update Invoice_Status automatically when payments are applied (partially_paid or paid)
8. THE system SHALL support un-applying a payment from an Invoice (e.g., payment bounced) with appropriate status reversion
9. THE system SHALL integrate with the existing pay_transactions table — payments recorded there can be linked to invoices

### Requirement 4: Accounts Receivable Aging

**User Story:** As a business owner, I want to see my outstanding receivables organized by how overdue they are, so that I can prioritize collections and understand cash flow risk.

#### Acceptance Criteria

1. THE system SHALL calculate aging based on invoice due date (not invoice date)
2. THE system SHALL categorize outstanding balances into buckets: current (not yet due), 1-30 days overdue, 31-60 days overdue, 61-90 days overdue, 90+ days overdue
3. THE system SHALL display aging summary at the business level (total AR by bucket)
4. THE system SHALL display aging detail per customer (what each customer owes by bucket)
5. THE system SHALL update aging calculations in real-time as payments are applied
6. THE system SHALL display aging data on the Customer 360 view (Phase 05, Requirement 12)
7. THE system SHALL support filtering the aging report by date range, customer, and amount threshold
8. THE system SHALL support exporting the aging report to CSV

### Requirement 5: Dunning Automation

**User Story:** As a business owner, I want the system to automatically remind customers about overdue invoices, so that I can improve collections without manual follow-up.

#### Acceptance Criteria

1. THE system SHALL support configuring a Dunning_Schedule per Business with multiple steps (e.g., email at 1 day overdue, email at 7 days, SMS at 14 days, final notice at 30 days)
2. THE system SHALL execute dunning actions automatically based on the schedule
3. THE system SHALL support email and SMS as dunning communication channels
4. THE system SHALL use configurable templates for dunning messages (with merge fields: customer name, invoice number, amount, due date, days overdue)
5. THE system SHALL track which dunning steps have been sent for each Invoice
6. THE system SHALL stop dunning when an Invoice is paid, voided, or written off
7. THE system SHALL respect customer communication preferences (do not send SMS if customer opted out)
8. THE system SHALL log all dunning communications in the customer's Activity_Timeline
9. THE system SHALL support pausing dunning for a specific Invoice or Customer (manual override)
10. THE system SHALL provide a dunning activity report showing messages sent and collection outcomes

### Requirement 6: Customer Statements

**User Story:** As a customer, I want to receive periodic statements showing my account activity, so that I can track what I owe and what I've paid.

#### Acceptance Criteria

1. THE system SHALL support generating a Customer Statement showing: opening balance, invoices issued, payments received, credits applied, closing balance for a date range
2. THE system SHALL support on-demand statement generation by staff
3. THE system SHALL support automated periodic statements (monthly, configurable per business)
4. THE system SHALL support emailing statements to customers
5. THE system SHALL support PDF generation for statements
6. THE system SHALL include aging summary on the statement (current, 30, 60, 90+)

### Requirement 7: Invoice Display and Delivery

**User Story:** As a staff member, I want to send professional invoices to customers via email, so that they know what they owe and how to pay.

#### Acceptance Criteria

1. THE system SHALL support sending an Invoice to the customer via email
2. THE system SHALL generate a printable/PDF version of the Invoice
3. THE system SHALL include business branding (name, logo, address) on the Invoice
4. THE system SHALL include payment instructions on the Invoice (configurable per business)
5. THE system SHALL support a customer-facing invoice view (link in email, no login required, with secure token)
6. THE system SHALL track when an Invoice email is sent and when the customer views it

### Requirement 8: Security and Permissions

**User Story:** As a business owner, I want to control who can create, edit, void, and write off invoices, so that financial actions are restricted to authorized staff.

#### Acceptance Criteria

1. THE system SHALL define granular permissions for invoice operations: create, send, void, write_off, apply_payment
2. THE system SHALL support configuring which roles have access to each permission
3. THE system SHALL require approval for write-offs above a configurable threshold
4. THE system SHALL log all invoice-related actions in the audit trail with user identification
5. THE system SHALL restrict access to AR reports and aging data based on role

---

## Dependencies

- Phase 00: Infrastructure - Database, API, migration runner
- Phase 02: Security & Compliance - RBAC, audit logging, permissions
- Phase 03: Core Platform - Tenant/business context, configuration engine
- Phase 05: Customer Management - Customer records, 360 view integration
- Phase 07: Booking Engine - Completed bookings trigger invoice generation
- Phase 09: Pricing Engine - Price calculations for line items
- Phase 10: Payment Platform - Payment recording and linkage to invoices

## Success Criteria

- Invoices are generated automatically from completed bookings (when configured)
- Partial payments correctly reduce invoice balance and update status
- Aging report accurately reflects outstanding balances by time bucket
- Dunning notices fire on schedule and stop when invoices are resolved
- Customer 360 view displays financial standing derived from invoice data
- All invoice actions are permission-controlled and audit-logged
- Statement generation produces accurate account summaries

## Out of Scope

- Full accounting/general ledger system (DayStream is not an accounting platform)
- Accounts payable (vendor payments) — Phase 11
- Tax filing or tax return preparation
- Integration with external accounting systems (QuickBooks, Xero) — Phase 20
- Online payment links (pay invoice online) — future enhancement

## Notes

- The invoicing system must coexist with the existing direct-payment workflow. Not all businesses need invoicing — some charge at time of service. The business can configure whether invoice generation is automatic, manual, or disabled.
- Aging calculations should be efficient — consider materialized views or scheduled recalculation for businesses with large invoice volumes.
- Dunning integrates with the notification system (Phase 03/Phase 16) for actual message delivery.
- Write-off workflow may need multi-level approval for larger amounts — design the approval mechanism to be reusable.
- Credit memos and customer credit balances tie back to Phase 10 (Payment Platform) credit transactions.

---

**Status**: 📋 Planned
**Dependencies**: Phase 00, Phase 02, Phase 03, Phase 05, Phase 07, Phase 09, Phase 10
**Next Phase**: Phase 27 (Insurance Module)
