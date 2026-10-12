# Suite 11 — Accounting & Payroll

Persona: owner (Accounting needs `reports:*`). Covers spec 11: chart of accounts, journal, vendors, bills, expenses, bank reconciliation, financial reports, and payroll (compensation, time, pay periods, deductions, tax profiles, tax documents). Conventions: [README](../README.md).

Rule for every script here: **debits equal credits**, and amounts are whole cents.

---

## Accounts payable and ledger

### ACC-01 · Chart of accounts
`P0` `regression` · Spec 11 R8 · Status: Verified
1. At `/accounting`, open the chart of accounts; if empty, seed the default chart. Add account `E2E {RUN} Supplies` (expense); edit it; archive; unarchive.
**Expect:** the default chart contains the accounts the payment postings rely on (Cash 1100, Deferred Revenue 2400, Service Revenue 4100); an account with postings cannot be deleted, only archived; an archived account is not offered for new entries.

### ACC-02 · Manual journal entry and void
`P0` `regression` · Spec 11 R9 · Status: Verified
1. Post an entry of 50.00 debit Supplies / credit Cash. 2. Try an unbalanced entry (50.00 / 40.00). 3. Void the first entry.
**Expect:** balanced entry posts; unbalanced is refused; voiding creates a visible reversal rather than deleting the entry.
**Cross-check:** the P&L moves by 50.00 and returns after the void.

### ACC-03 · Vendors
`P1` `regression` · Spec 11 R5 · Status: Verified
1. Create vendor `E2E {RUN} Vendor` with tax id and payment terms; edit.
**Expect:** the vendor is selectable on bills and expenses.

### ACC-04 · Bill: enter, approve, pay
`P0` `regression` · Spec 11 R6 · Status: Verified
1. Enter a bill of 300.00 from the vendor due in 10 days. 2. Approve. 3. Pay. Try to pay an unapproved bill and to pay twice.
**Expect:** status draft → approved → paid; the illegal actions are refused.
**Cross-check:** the AP aging report carries the 300.00 from the moment the bill is entered until it is paid; the journal has the payable (expense / Accounts Payable 2100) and the payment (2100 / Cash) entries. A payment larger than what is owed is refused.

### ACC-05 · Expenses
`P1` `regression` · Spec 11 R7 · Status: Verified
1. Record an expense of 42.50 in a category; approve it; record and delete another.
**Expect:** the approved expense is in the expenses report and the P&L; the deleted one is not.

### ACC-06 · Financial reports tie together
`P0` `regression` · Spec 11 R10 · Status: Verified
1. Run P&L, staff costs, AP aging and expenses for the current month.
**Expect:** P&L revenue equals the revenue-account postings (including those from suite 10); expenses equal ACC-02 + ACC-04 + ACC-05 + payroll; every report shows currency, never raw cents or floating-point noise.

### ACC-07 · Bank reconciliation
`P2` `regression` · Spec 11 R11 · Status: Verified
1. Import a small bank statement file (3 lines: one matching the cash payment from PAY-04, one matching the bill payment, one unknown). 2. Match the lines.
**Expect:** matching lines are suggested or can be matched by hand; the unknown line stays unmatched and visible; a line cannot be matched twice.

### ACC-08 · Customer payments post to the ledger
`P0` `regression` · Spec 10 task 4.11 (GL posting) · Status: Verified
1. After suite 10, list today's journal entries created by payments.
**Expect:** one balanced entry per settled charge, renewal and invoice settlement; refunds post reversals; membership renewals credit Deferred Revenue 2400; gift-card redemptions are not posted as revenue; nothing is posted twice for one payment; pending bank-debit charges are posted only when completed.

---

## Payroll

### ACC-09 · Payroll settings and auto-generated periods
`P0` `regression` · CLAUDE.md (payroll) · Status: Verified
1. At `/payroll` set pay frequency to biweekly; save. Read the generated periods. Change to monthly; read again; restore the original.
**Expect:** periods are generated to match the frequency with no gaps and no overlaps; already finalized periods are not altered by a frequency change.
**Cross-check:** `GET /api/v1/payroll/periods/unprocessed` and `/periods/history` agree with the screen.

### ACC-10 · Compensation rules
`P0` `regression` · Spec 11 R1 · Status: Verified
1. Create rules for E2E staff: hourly 20.00; per-session 15.00; commission 10 % of service revenue. Edit one; delete one.
**Expect:** rules persist per staff member; conflicting rules for the same basis are refused or clearly prioritised.

### ACC-11 · Tax profiles (US federal and Spain IRPF)
`P1` `regression` · CLAUDE.md (payroll) · Status: Verified
1. Give one E2E staff member a Spain IRPF profile with a withholding rate and another a US federal profile; save; reload.
**Expect:** each profile shows the fields for its regime and persists; invalid rates are refused.

### ACC-12 · Run and finalize the current pay period
`P0` `regression` `guarded` · Spec 11 R3, R4 · Status: Verified
**Pre:** bookings and completed sales for E2E staff in the period; compensation rules (ACC-10); a tax profile (ACC-11); a deduction of 25.00 for one of them.
1. Run the current period. Review each line. 2. Run it again. 3. Finalize. 4. Try to run or finalize the finalized period.
**Expect:** gross = hours × rate + sessions × rate + commission, where hours come from the basis of the hourly rule (time clock, schedule, or bookings by default); withholding follows the tax profile, using the latest tax table up to the pay year; net = gross − withholding − deductions, to the cent; a second run recalculates (one line per person); a finalized period is locked.
**Cross-check:** the journal has wages (6050) against Payroll Payable (2200) for the gross; the staff-costs report and payroll history show the same totals. The manual, approvable time entries are not used by the pay run (recorded as an observation).

### ACC-13 · Payroll access
`P0` `negative` · Spec 02 R4 · As: manager, therapist · Status: Verified
1. Open `/payroll`; call `GET /api/v1/payroll/periods`, `GET /api/v1/payroll/tax-profiles`, `PUT /api/v1/payroll/settings`.
**Expect:** staff are refused everywhere; record what a manager can see (the Manager role has `reports:read`, not `reports:*`) and compare with the intended rule. No one but the owner sees another person's pay or tax profile.

### ACC-14 · Tax documents
`P2` `regression` · Spec 11 R12 · Status: Verified
1. Generate tax documents for the last finalized period or year; open one.
**Expect:** the document totals equal the sum of the finalized periods it covers.
