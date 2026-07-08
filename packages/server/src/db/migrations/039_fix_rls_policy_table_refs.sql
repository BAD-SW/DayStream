-- Migration 039: Fix RLS policies whose USING clauses reference old (unprefixed) table names.
-- After migration 036 renamed all tables, the RLS policy expressions still reference
-- the old table names in their subqueries. This migration drops and recreates each
-- affected policy with corrected table references.

BEGIN;

-- ============================================================
-- SYS — Business Configurations (006)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_business_configurations ON sys_business_configurations;
CREATE POLICY tenant_isolation_business_configurations ON sys_business_configurations
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Customer Businesses (006)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_customer_businesses ON cus_businesses;
CREATE POLICY tenant_isolation_customer_businesses ON cus_businesses
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Customer Notes (007)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_customer_notes ON cus_notes;
CREATE POLICY tenant_isolation_customer_notes ON cus_notes
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Note Categories (007)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_note_categories ON cus_note_categories;
CREATE POLICY tenant_isolation_note_categories ON cus_note_categories
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Tags (007)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_tags ON cus_tags;
CREATE POLICY tenant_isolation_tags ON cus_tags
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Customer Tags (007)
-- Old: customer_id IN (SELECT id FROM customers WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_customer_tags ON cus_customer_tags;
CREATE POLICY tenant_isolation_customer_tags ON cus_customer_tags
    FOR ALL TO daystream_app
    USING (customer_id IN (
        SELECT id FROM cus_customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Custom Fields (007)
-- Old: customer_id IN (SELECT id FROM customers WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_custom_fields ON cus_custom_fields;
CREATE POLICY tenant_isolation_custom_fields ON cus_custom_fields
    FOR ALL TO daystream_app
    USING (customer_id IN (
        SELECT id FROM cus_customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Activities (007)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_activities ON cus_activities;
CREATE POLICY tenant_isolation_activities ON cus_activities
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Segments (007)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_segments ON cus_segments;
CREATE POLICY tenant_isolation_segments ON cus_segments
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- CUS — Preferences (007)
-- Old: customer_id IN (SELECT id FROM customers WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_preferences ON cus_preferences;
CREATE POLICY tenant_isolation_preferences ON cus_preferences
    FOR ALL TO daystream_app
    USING (customer_id IN (
        SELECT id FROM cus_customers WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Tax Categories (009)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_tax_categories ON svc_tax_categories;
CREATE POLICY tenant_isolation_tax_categories ON svc_tax_categories
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Cancellation Policies (009)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_cancellation_policies ON svc_cancellation_policies;
CREATE POLICY tenant_isolation_cancellation_policies ON svc_cancellation_policies
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Service Categories (009)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_categories ON svc_categories;
CREATE POLICY tenant_isolation_service_categories ON svc_categories
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Services (009)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_services ON svc_services;
CREATE POLICY tenant_isolation_services ON svc_services
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Service Variants (009)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_variants ON svc_variants;
CREATE POLICY tenant_isolation_service_variants ON svc_variants
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- SVC — Service Images (009)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_images ON svc_images;
CREATE POLICY tenant_isolation_service_images ON svc_images
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- SVC — Service Staff (009)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_staff ON svc_staff;
CREATE POLICY tenant_isolation_service_staff ON svc_staff
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- SVC — Service Resources (009)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_resources ON svc_resources;
CREATE POLICY tenant_isolation_service_resources ON svc_resources
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- SVC — Service Availability Rules (009)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_availability_rules ON svc_availability_rules;
CREATE POLICY tenant_isolation_availability_rules ON svc_availability_rules
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- APT — Bookings (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_bookings ON apt_bookings;
CREATE POLICY tenant_isolation_bookings ON apt_bookings
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Booking Status History (011)
-- Old: booking_id IN (SELECT id FROM bookings WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_booking_history ON apt_booking_status_history;
CREATE POLICY tenant_isolation_booking_history ON apt_booking_status_history
    FOR ALL TO daystream_app
    USING (booking_id IN (
        SELECT id FROM apt_bookings WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- APT — Slot Holds (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_slot_holds ON apt_slot_holds;
CREATE POLICY tenant_isolation_slot_holds ON apt_slot_holds
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Waitlist Entries (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_waitlist ON apt_waitlist_entries;
CREATE POLICY tenant_isolation_waitlist ON apt_waitlist_entries
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Recurring Booking Series (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_recurring ON apt_recurring_series;
CREATE POLICY tenant_isolation_recurring ON apt_recurring_series
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Staff Schedules (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_schedules ON apt_staff_schedules;
CREATE POLICY tenant_isolation_staff_schedules ON apt_staff_schedules
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Staff Time Off (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_time_off ON apt_staff_time_off;
CREATE POLICY tenant_isolation_staff_time_off ON apt_staff_time_off
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- APT — Notification Queue (011)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_notifications ON apt_notification_queue;
CREATE POLICY tenant_isolation_notifications ON apt_notification_queue
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MEM — Membership Plans (013)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_membership_plans ON mem_plans;
CREATE POLICY tenant_isolation_membership_plans ON mem_plans
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MEM — Plan Service Access (013)
-- Old: plan_id IN (SELECT id FROM membership_plans WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_plan_service_access ON mem_plan_service_access;
CREATE POLICY tenant_isolation_plan_service_access ON mem_plan_service_access
    FOR ALL TO daystream_app
    USING (plan_id IN (
        SELECT id FROM mem_plans WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- MEM — Plan Benefits (013)
-- Old: plan_id IN (SELECT id FROM membership_plans WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_plan_benefits ON mem_plan_benefits;
CREATE POLICY tenant_isolation_plan_benefits ON mem_plan_benefits
    FOR ALL TO daystream_app
    USING (plan_id IN (
        SELECT id FROM mem_plans WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- MEM — Memberships (013)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_memberships ON mem_memberships;
CREATE POLICY tenant_isolation_memberships ON mem_memberships
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MEM — Credit Transactions (013)
-- Old: membership_id IN (SELECT id FROM memberships WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_credit_transactions ON mem_credit_transactions;
CREATE POLICY tenant_isolation_credit_transactions ON mem_credit_transactions
    FOR ALL TO daystream_app
    USING (membership_id IN (
        SELECT id FROM mem_memberships WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- MEM — Membership Status History (013)
-- Old: membership_id IN (SELECT id FROM memberships WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_membership_history ON mem_status_history;
CREATE POLICY tenant_isolation_membership_history ON mem_status_history
    FOR ALL TO daystream_app
    USING (membership_id IN (
        SELECT id FROM mem_memberships WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- PRI — Pricing Rules (014)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_pricing_rules ON pri_rules;
CREATE POLICY tenant_isolation_pricing_rules ON pri_rules
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- PRI — Discount Codes (014)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_discount_codes ON pri_discount_codes;
CREATE POLICY tenant_isolation_discount_codes ON pri_discount_codes
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- PRI — Discount Code Usage (014)
-- Old: code_id IN (SELECT id FROM discount_codes WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_discount_usage ON pri_discount_usage;
CREATE POLICY tenant_isolation_discount_usage ON pri_discount_usage
    FOR ALL TO daystream_app
    USING (code_id IN (
        SELECT id FROM pri_discount_codes WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- PRI — Pricing Bundles (014)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_pricing_bundles ON pri_bundles;
CREATE POLICY tenant_isolation_pricing_bundles ON pri_bundles
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- PRI — Corporate Accounts (014)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_corporate_accounts ON pri_corporate_accounts;
CREATE POLICY tenant_isolation_corporate_accounts ON pri_corporate_accounts
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- PRI — Price History (014)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_price_history ON pri_history;
CREATE POLICY tenant_isolation_price_history ON pri_history
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Compensation Rules (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_compensation_rules ON fin_compensation_rules;
CREATE POLICY tenant_isolation_compensation_rules ON fin_compensation_rules
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Payroll Deductions (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_payroll_deductions ON fin_payroll_deductions;
CREATE POLICY tenant_isolation_payroll_deductions ON fin_payroll_deductions
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Pay Periods (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_pay_periods ON fin_pay_periods;
CREATE POLICY tenant_isolation_pay_periods ON fin_pay_periods
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Payroll Entries (015)
-- Old: pay_period_id IN (SELECT id FROM pay_periods WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_payroll_entries ON fin_payroll_entries;
CREATE POLICY tenant_isolation_payroll_entries ON fin_payroll_entries
    FOR ALL TO daystream_app
    USING (pay_period_id IN (
        SELECT id FROM fin_pay_periods WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- FIN — Time Entries (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_time_entries ON fin_time_entries;
CREATE POLICY tenant_isolation_time_entries ON fin_time_entries
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Vendors (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_vendors ON fin_vendors;
CREATE POLICY tenant_isolation_vendors ON fin_vendors
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Bills (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_bills ON fin_bills;
CREATE POLICY tenant_isolation_bills ON fin_bills
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Bill Line Items (015)
-- Old: bill_id IN (SELECT id FROM bills WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_bill_line_items ON fin_bill_line_items;
CREATE POLICY tenant_isolation_bill_line_items ON fin_bill_line_items
    FOR ALL TO daystream_app
    USING (bill_id IN (
        SELECT id FROM fin_bills WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- FIN — Expenses (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_expenses ON fin_expenses;
CREATE POLICY tenant_isolation_expenses ON fin_expenses
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Chart of Accounts (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_chart_of_accounts ON fin_chart_of_accounts;
CREATE POLICY tenant_isolation_chart_of_accounts ON fin_chart_of_accounts
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Journal Entries (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_journal_entries ON fin_journal_entries;
CREATE POLICY tenant_isolation_journal_entries ON fin_journal_entries
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Journal Entry Lines (015)
-- Old: journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_journal_entry_lines ON fin_journal_entry_lines;
CREATE POLICY tenant_isolation_journal_entry_lines ON fin_journal_entry_lines
    FOR ALL TO daystream_app
    USING (journal_entry_id IN (
        SELECT id FROM fin_journal_entries WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- FIN — Bank Statements (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_bank_statements ON fin_bank_statements;
CREATE POLICY tenant_isolation_bank_statements ON fin_bank_statements
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- FIN — Bank Statement Lines (015)
-- Old: statement_id IN (SELECT id FROM bank_statements WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_bank_statement_lines ON fin_bank_statement_lines;
CREATE POLICY tenant_isolation_bank_statement_lines ON fin_bank_statement_lines
    FOR ALL TO daystream_app
    USING (statement_id IN (
        SELECT id FROM fin_bank_statements WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- FIN — Tax Documents (015)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_tax_documents ON fin_tax_documents;
CREATE POLICY tenant_isolation_tax_documents ON fin_tax_documents
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Qualifications (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_qualifications ON stf_qualifications;
CREATE POLICY tenant_isolation_staff_qualifications ON stf_qualifications
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Service Qualification Requirements (017)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_qual_reqs ON svc_qualification_requirements;
CREATE POLICY tenant_isolation_service_qual_reqs ON svc_qualification_requirements
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- STF — Availability Patterns (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_availability_patterns ON stf_availability_patterns;
CREATE POLICY tenant_isolation_availability_patterns ON stf_availability_patterns
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Availability Pattern Slots (017)
-- Old: pattern_id IN (SELECT id FROM availability_patterns WHERE staff_id IN (SELECT id FROM staff_profiles WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_availability_pattern_slots ON stf_availability_pattern_slots;
CREATE POLICY tenant_isolation_availability_pattern_slots ON stf_availability_pattern_slots
    FOR ALL TO daystream_app
    USING (pattern_id IN (
        SELECT id FROM stf_availability_patterns WHERE staff_id IN (
            SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- STF — Availability Overrides (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_availability_overrides ON stf_availability_overrides;
CREATE POLICY tenant_isolation_availability_overrides ON stf_availability_overrides
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Leave Balances (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_leave_balances ON stf_leave_balances;
CREATE POLICY tenant_isolation_leave_balances ON stf_leave_balances
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Service Assignments (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_service_assignments ON stf_service_assignments;
CREATE POLICY tenant_isolation_staff_service_assignments ON stf_service_assignments
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Location Assignments (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_location_assignments ON stf_location_assignments;
CREATE POLICY tenant_isolation_staff_location_assignments ON stf_location_assignments
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Capacity Config (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_capacity_config ON stf_capacity_config;
CREATE POLICY tenant_isolation_staff_capacity_config ON stf_capacity_config
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Capacity Overrides (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_capacity_overrides ON stf_capacity_overrides;
CREATE POLICY tenant_isolation_staff_capacity_overrides ON stf_capacity_overrides
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- STF — Staff Notification Preferences (017)
-- Old: staff_id IN (SELECT id FROM staff_profiles WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_staff_notification_prefs ON stf_notification_preferences;
CREATE POLICY tenant_isolation_staff_notification_prefs ON stf_notification_preferences
    FOR ALL TO daystream_app
    USING (staff_id IN (
        SELECT id FROM stf_profiles WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- RES — Resource Schedules (018)
-- Old: resource_id IN (SELECT id FROM resources WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_schedules ON res_schedules;
CREATE POLICY tenant_isolation_resource_schedules ON res_schedules
    FOR ALL TO daystream_app
    USING (resource_id IN (
        SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- RES — Resource Schedule Slots (018)
-- Old: schedule_id IN (SELECT id FROM resource_schedules WHERE resource_id IN (SELECT id FROM resources WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_schedule_slots ON res_schedule_slots;
CREATE POLICY tenant_isolation_resource_schedule_slots ON res_schedule_slots
    FOR ALL TO daystream_app
    USING (schedule_id IN (
        SELECT id FROM res_schedules WHERE resource_id IN (
            SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- RES — Resource Schedule Blocks (018)
-- Old: resource_id IN (SELECT id FROM resources WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_schedule_blocks ON res_schedule_blocks;
CREATE POLICY tenant_isolation_resource_schedule_blocks ON res_schedule_blocks
    FOR ALL TO daystream_app
    USING (resource_id IN (
        SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- RES — Resource Bookings (018)
-- Old: resource_id IN (SELECT id FROM resources WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_bookings ON res_bookings;
CREATE POLICY tenant_isolation_resource_bookings ON res_bookings
    FOR ALL TO daystream_app
    USING (resource_id IN (
        SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SVC — Service Resource Requirements (018)
-- Old: service_id IN (SELECT id FROM services WHERE business_id IN (SELECT id FROM businesses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_service_resource_reqs ON svc_resource_requirements;
CREATE POLICY tenant_isolation_service_resource_reqs ON svc_resource_requirements
    FOR ALL TO daystream_app
    USING (service_id IN (
        SELECT id FROM svc_services WHERE business_id IN (
            SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- RES — Resource Dependencies (018)
-- Old: resource_id IN (SELECT id FROM resources WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_dependencies ON res_dependencies;
CREATE POLICY tenant_isolation_resource_dependencies ON res_dependencies
    FOR ALL TO daystream_app
    USING (resource_id IN (
        SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- RES — Resource Maintenance (018)
-- Old: resource_id IN (SELECT id FROM resources WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_resource_maintenance ON res_maintenance;
CREATE POLICY tenant_isolation_resource_maintenance ON res_maintenance
    FOR ALL TO daystream_app
    USING (resource_id IN (
        SELECT id FROM res_resources WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- EVT — Event Facilitators (019)
-- Old: event_id IN (SELECT id FROM events WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_event_facilitators ON evt_facilitators;
CREATE POLICY tenant_isolation_event_facilitators ON evt_facilitators
    FOR ALL TO daystream_app
    USING (event_id IN (
        SELECT id FROM evt_events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- EVT — Event Ticket Tiers (019)
-- Old: event_id IN (SELECT id FROM events WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_event_ticket_tiers ON evt_ticket_tiers;
CREATE POLICY tenant_isolation_event_ticket_tiers ON evt_ticket_tiers
    FOR ALL TO daystream_app
    USING (event_id IN (
        SELECT id FROM evt_events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- EVT — Event Registrations (019)
-- Old: event_id IN (SELECT id FROM events WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_event_registrations ON evt_registrations;
CREATE POLICY tenant_isolation_event_registrations ON evt_registrations
    FOR ALL TO daystream_app
    USING (event_id IN (
        SELECT id FROM evt_events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- EVT — Event Waitlist (019)
-- Old: event_id IN (SELECT id FROM events WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_event_waitlist ON evt_waitlist;
CREATE POLICY tenant_isolation_event_waitlist ON evt_waitlist
    FOR ALL TO daystream_app
    USING (event_id IN (
        SELECT id FROM evt_events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- EVT — Event Communications (019)
-- Old: event_id IN (SELECT id FROM events WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_event_communications ON evt_communications;
CREATE POLICY tenant_isolation_event_communications ON evt_communications
    FOR ALL TO daystream_app
    USING (event_id IN (
        SELECT id FROM evt_events WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MKT — Campaign Recipients (021)
-- Old: campaign_id IN (SELECT id FROM campaigns WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_campaign_recipients ON mkt_campaign_recipients;
CREATE POLICY tenant_isolation_campaign_recipients ON mkt_campaign_recipients
    FOR ALL TO daystream_app
    USING (campaign_id IN (
        SELECT id FROM mkt_campaigns WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MKT — Sequence Steps (021)
-- Old: sequence_id IN (SELECT id FROM sequences WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_sequence_steps ON mkt_sequence_steps;
CREATE POLICY tenant_isolation_sequence_steps ON mkt_sequence_steps
    FOR ALL TO daystream_app
    USING (sequence_id IN (
        SELECT id FROM mkt_sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MKT — Sequence Connections (021)
-- Old: sequence_id IN (SELECT id FROM sequences WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_sequence_connections ON mkt_sequence_connections;
CREATE POLICY tenant_isolation_sequence_connections ON mkt_sequence_connections
    FOR ALL TO daystream_app
    USING (sequence_id IN (
        SELECT id FROM mkt_sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MKT — Sequence Enrollments (021)
-- Old: sequence_id IN (SELECT id FROM sequences WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_sequence_enrollments ON mkt_sequence_enrollments;
CREATE POLICY tenant_isolation_sequence_enrollments ON mkt_sequence_enrollments
    FOR ALL TO daystream_app
    USING (sequence_id IN (
        SELECT id FROM mkt_sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- MKT — Sequence History (021)
-- Old: sequence_id IN (SELECT id FROM sequences WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_sequence_history ON mkt_sequence_history;
CREATE POLICY tenant_isolation_sequence_history ON mkt_sequence_history
    FOR ALL TO daystream_app
    USING (sequence_id IN (
        SELECT id FROM mkt_sequences WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- WEB — Site Pages (023)
-- Old: site_id IN (SELECT id FROM tenant_sites WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_site_pages ON web_pages;
CREATE POLICY tenant_isolation_site_pages ON web_pages
    FOR ALL TO daystream_app
    USING (site_id IN (
        SELECT id FROM web_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- WEB — Blog Posts (023)
-- Old: site_id IN (SELECT id FROM tenant_sites WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_blog_posts ON web_blog_posts;
CREATE POLICY tenant_isolation_blog_posts ON web_blog_posts
    FOR ALL TO daystream_app
    USING (site_id IN (
        SELECT id FROM web_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- WEB — Site Navigation (023)
-- Old: site_id IN (SELECT id FROM tenant_sites WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_site_navigation ON web_navigation;
CREATE POLICY tenant_isolation_site_navigation ON web_navigation
    FOR ALL TO daystream_app
    USING (site_id IN (
        SELECT id FROM web_sites WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- INT — Integration Sync Log (024)
-- Old: connection_id IN (SELECT id FROM integration_connections WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_integration_sync_log ON int_sync_log;
CREATE POLICY tenant_isolation_integration_sync_log ON int_sync_log
    FOR ALL TO daystream_app
    USING (connection_id IN (
        SELECT id FROM int_connections WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- INT — Webhook Deliveries (024)
-- Old: subscription_id IN (SELECT id FROM webhook_subscriptions WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON int_webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON int_webhook_deliveries
    FOR ALL TO daystream_app
    USING (subscription_id IN (
        SELECT id FROM int_webhook_subscriptions WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Community Reactions (025)
-- Old: post_id IN (SELECT id FROM community_posts WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_community_reactions ON eng_reactions;
CREATE POLICY tenant_isolation_community_reactions ON eng_reactions
    FOR ALL TO daystream_app
    USING (post_id IN (
        SELECT id FROM eng_posts WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Community Comments (025)
-- Old: post_id IN (SELECT id FROM community_posts WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_community_comments ON eng_comments;
CREATE POLICY tenant_isolation_community_comments ON eng_comments
    FOR ALL TO daystream_app
    USING (post_id IN (
        SELECT id FROM eng_posts WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Challenge Participants (025)
-- Old: challenge_id IN (SELECT id FROM challenges WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_challenge_participants ON eng_challenge_participants;
CREATE POLICY tenant_isolation_challenge_participants ON eng_challenge_participants
    FOR ALL TO daystream_app
    USING (challenge_id IN (
        SELECT id FROM eng_challenges WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Customer Badges (025)
-- Old: badge_id IN (SELECT id FROM badges WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_customer_badges ON eng_customer_badges;
CREATE POLICY tenant_isolation_customer_badges ON eng_customer_badges
    FOR ALL TO daystream_app
    USING (badge_id IN (
        SELECT id FROM eng_badges WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — VOD Progress (025)
-- Old: content_id IN (SELECT id FROM vod_content WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_vod_progress ON eng_vod_progress;
CREATE POLICY tenant_isolation_vod_progress ON eng_vod_progress
    FOR ALL TO daystream_app
    USING (content_id IN (
        SELECT id FROM eng_vod_content WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Course Lessons (025)
-- Old: course_id IN (SELECT id FROM courses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_course_lessons ON eng_course_lessons;
CREATE POLICY tenant_isolation_course_lessons ON eng_course_lessons
    FOR ALL TO daystream_app
    USING (course_id IN (
        SELECT id FROM eng_courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Course Enrollments (025)
-- Old: course_id IN (SELECT id FROM courses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_course_enrollments ON eng_course_enrollments;
CREATE POLICY tenant_isolation_course_enrollments ON eng_course_enrollments
    FOR ALL TO daystream_app
    USING (course_id IN (
        SELECT id FROM eng_courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- ENG — Course Lesson Progress (025)
-- Old: enrollment_id IN (SELECT id FROM course_enrollments WHERE course_id IN (SELECT id FROM courses WHERE ...))
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_course_lesson_progress ON eng_course_lesson_progress;
CREATE POLICY tenant_isolation_course_lesson_progress ON eng_course_lesson_progress
    FOR ALL TO daystream_app
    USING (enrollment_id IN (
        SELECT id FROM eng_course_enrollments WHERE course_id IN (
            SELECT id FROM eng_courses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
    ));

-- ============================================================
-- ENG — Referrals (025)
-- Old: referral_code_id IN (SELECT id FROM referral_codes WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_referrals ON eng_referrals;
CREATE POLICY tenant_isolation_referrals ON eng_referrals
    FOR ALL TO daystream_app
    USING (referral_code_id IN (
        SELECT id FROM eng_referral_codes WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

-- ============================================================
-- SYS — Locations (035)
-- Old: business_id IN (SELECT id FROM businesses WHERE ...)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation_locations ON sys_locations;
CREATE POLICY tenant_isolation_locations ON sys_locations
    FOR ALL TO daystream_app
    USING (business_id IN (
        SELECT id FROM sys_businesses WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));

COMMIT;
