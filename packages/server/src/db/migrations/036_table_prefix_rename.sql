-- Migration 036: Rename all tables with domain-based 3-character prefixes
-- Groups: SYS, USR, CUS, SVC, APT, MEM, PRI, FIN, STF, RES, EVT, MKT, RPT, WEB, INT, ENG

BEGIN;

-- ============================================================
-- SYS — System
-- ============================================================
ALTER TABLE tenants RENAME TO sys_tenants;
ALTER TABLE businesses RENAME TO sys_businesses;
ALTER TABLE locations RENAME TO sys_locations;
ALTER TABLE configuration_definitions RENAME TO sys_configuration_definitions;
ALTER TABLE tenant_configurations RENAME TO sys_tenant_configurations;
ALTER TABLE business_configurations RENAME TO sys_business_configurations;
ALTER TABLE feature_flags RENAME TO sys_feature_flags;
ALTER TABLE feature_flag_overrides RENAME TO sys_feature_flag_overrides;
ALTER TABLE system_configurations RENAME TO sys_system_configurations;
ALTER TABLE server_logs RENAME TO sys_server_logs;
ALTER TABLE api_request_logs RENAME TO sys_api_request_logs;
ALTER TABLE scheduled_jobs RENAME TO sys_scheduled_jobs;
ALTER TABLE job_executions RENAME TO sys_job_executions;
ALTER TABLE query_history RENAME TO sys_query_history;
ALTER TABLE saved_queries RENAME TO sys_saved_queries;

-- ============================================================
-- USR — Users
-- ============================================================
ALTER TABLE users RENAME TO usr_users;
ALTER TABLE password_history RENAME TO usr_password_history;
ALTER TABLE login_attempts RENAME TO usr_login_attempts;
ALTER TABLE refresh_tokens RENAME TO usr_refresh_tokens;
ALTER TABLE oauth_links RENAME TO usr_oauth_links;
ALTER TABLE user_mfa RENAME TO usr_user_mfa;
ALTER TABLE mfa_backup_codes RENAME TO usr_mfa_backup_codes;
ALTER TABLE roles RENAME TO usr_roles;
ALTER TABLE user_roles RENAME TO usr_user_roles;
ALTER TABLE audit_log RENAME TO usr_audit_log;
ALTER TABLE consent_records RENAME TO usr_consent_records;
ALTER TABLE deletion_requests RENAME TO usr_deletion_requests;

-- ============================================================
-- CUS — Customers
-- ============================================================
ALTER TABLE customers RENAME TO cus_customers;
ALTER TABLE customer_notes RENAME TO cus_notes;
ALTER TABLE note_categories RENAME TO cus_note_categories;
ALTER TABLE tags RENAME TO cus_tags;
ALTER TABLE customer_tags RENAME TO cus_customer_tags;
ALTER TABLE customer_custom_fields RENAME TO cus_custom_fields;
ALTER TABLE customer_activities RENAME TO cus_activities;
ALTER TABLE segments RENAME TO cus_segments;
ALTER TABLE customer_preferences RENAME TO cus_preferences;
ALTER TABLE customer_businesses RENAME TO cus_businesses;

-- ============================================================
-- SVC — Services
-- ============================================================
ALTER TABLE services RENAME TO svc_services;
ALTER TABLE service_categories RENAME TO svc_categories;
ALTER TABLE service_variants RENAME TO svc_variants;
ALTER TABLE service_images RENAME TO svc_images;
ALTER TABLE service_staff RENAME TO svc_staff;
ALTER TABLE service_resources RENAME TO svc_resources;
ALTER TABLE service_locations RENAME TO svc_locations;
ALTER TABLE service_availability_rules RENAME TO svc_availability_rules;
ALTER TABLE service_templates RENAME TO svc_templates;
ALTER TABLE tax_categories RENAME TO svc_tax_categories;
ALTER TABLE cancellation_policies RENAME TO svc_cancellation_policies;
ALTER TABLE service_qualification_requirements RENAME TO svc_qualification_requirements;
ALTER TABLE service_resource_requirements RENAME TO svc_resource_requirements;

-- ============================================================
-- APT — Appointments (includes Check-In)
-- ============================================================
ALTER TABLE bookings RENAME TO apt_bookings;
ALTER TABLE booking_status_history RENAME TO apt_booking_status_history;
ALTER TABLE recurring_booking_series RENAME TO apt_recurring_series;
ALTER TABLE slot_holds RENAME TO apt_slot_holds;
ALTER TABLE waitlist_entries RENAME TO apt_waitlist_entries;
ALTER TABLE staff_schedules RENAME TO apt_staff_schedules;
ALTER TABLE staff_time_off RENAME TO apt_staff_time_off;
ALTER TABLE notification_queue RENAME TO apt_notification_queue;
ALTER TABLE check_in_records RENAME TO apt_check_in_records;
ALTER TABLE check_in_qr_codes RENAME TO apt_check_in_qr_codes;
ALTER TABLE no_show_records RENAME TO apt_no_show_records;
ALTER TABLE check_in_config RENAME TO apt_check_in_config;
ALTER TABLE kiosk_sessions RENAME TO apt_kiosk_sessions;

-- ============================================================
-- MEM — Memberships
-- ============================================================
ALTER TABLE membership_plans RENAME TO mem_plans;
ALTER TABLE plan_service_access RENAME TO mem_plan_service_access;
ALTER TABLE plan_benefits RENAME TO mem_plan_benefits;
ALTER TABLE plan_upgrade_paths RENAME TO mem_plan_upgrade_paths;
ALTER TABLE memberships RENAME TO mem_memberships;
ALTER TABLE credit_transactions RENAME TO mem_credit_transactions;
ALTER TABLE membership_status_history RENAME TO mem_status_history;

-- ============================================================
-- PRI — Pricing
-- ============================================================
ALTER TABLE pricing_rules RENAME TO pri_rules;
ALTER TABLE discount_codes RENAME TO pri_discount_codes;
ALTER TABLE discount_code_usage RENAME TO pri_discount_usage;
ALTER TABLE pricing_bundles RENAME TO pri_bundles;
ALTER TABLE bundle_items RENAME TO pri_bundle_items;
ALTER TABLE corporate_accounts RENAME TO pri_corporate_accounts;
ALTER TABLE corporate_account_members RENAME TO pri_corporate_members;
ALTER TABLE price_history RENAME TO pri_history;

-- ============================================================
-- FIN — Finance
-- ============================================================
ALTER TABLE compensation_rules RENAME TO fin_compensation_rules;
ALTER TABLE payroll_deductions RENAME TO fin_payroll_deductions;
ALTER TABLE pay_periods RENAME TO fin_pay_periods;
ALTER TABLE payroll_entries RENAME TO fin_payroll_entries;
ALTER TABLE time_entries RENAME TO fin_time_entries;
ALTER TABLE vendors RENAME TO fin_vendors;
ALTER TABLE bills RENAME TO fin_bills;
ALTER TABLE bill_line_items RENAME TO fin_bill_line_items;
ALTER TABLE expenses RENAME TO fin_expenses;
ALTER TABLE chart_of_accounts RENAME TO fin_chart_of_accounts;
ALTER TABLE journal_entries RENAME TO fin_journal_entries;
ALTER TABLE journal_entry_lines RENAME TO fin_journal_entry_lines;
ALTER TABLE bank_statements RENAME TO fin_bank_statements;
ALTER TABLE bank_statement_lines RENAME TO fin_bank_statement_lines;
ALTER TABLE tax_documents RENAME TO fin_tax_documents;

-- ============================================================
-- STF — Staff
-- ============================================================
ALTER TABLE staff_profiles RENAME TO stf_profiles;
ALTER TABLE staff_qualifications RENAME TO stf_qualifications;
ALTER TABLE availability_patterns RENAME TO stf_availability_patterns;
ALTER TABLE availability_pattern_slots RENAME TO stf_availability_pattern_slots;
ALTER TABLE availability_overrides RENAME TO stf_availability_overrides;
ALTER TABLE leave_requests RENAME TO stf_leave_requests;
ALTER TABLE leave_balances RENAME TO stf_leave_balances;
ALTER TABLE staff_service_assignments RENAME TO stf_service_assignments;
ALTER TABLE staff_location_assignments RENAME TO stf_location_assignments;
ALTER TABLE staff_capacity_config RENAME TO stf_capacity_config;
ALTER TABLE staff_capacity_overrides RENAME TO stf_capacity_overrides;
ALTER TABLE staff_notification_preferences RENAME TO stf_notification_preferences;

-- ============================================================
-- RES — Resources
-- ============================================================
ALTER TABLE resource_types RENAME TO res_types;
ALTER TABLE resources RENAME TO res_resources;
ALTER TABLE resource_schedules RENAME TO res_schedules;
ALTER TABLE resource_schedule_slots RENAME TO res_schedule_slots;
ALTER TABLE resource_schedule_blocks RENAME TO res_schedule_blocks;
ALTER TABLE resource_bookings RENAME TO res_bookings;
ALTER TABLE resource_dependencies RENAME TO res_dependencies;
ALTER TABLE resource_maintenance RENAME TO res_maintenance;

-- ============================================================
-- EVT — Events
-- ============================================================
ALTER TABLE event_types RENAME TO evt_types;
ALTER TABLE event_series RENAME TO evt_series;
ALTER TABLE recurring_event_templates RENAME TO evt_recurring_templates;
ALTER TABLE events RENAME TO evt_events;
ALTER TABLE event_facilitators RENAME TO evt_facilitators;
ALTER TABLE event_ticket_tiers RENAME TO evt_ticket_tiers;
ALTER TABLE event_registrations RENAME TO evt_registrations;
ALTER TABLE event_waitlist RENAME TO evt_waitlist;
ALTER TABLE event_communications RENAME TO evt_communications;

-- ============================================================
-- MKT — Marketing
-- ============================================================
ALTER TABLE message_templates RENAME TO mkt_message_templates;
ALTER TABLE campaigns RENAME TO mkt_campaigns;
ALTER TABLE campaign_recipients RENAME TO mkt_campaign_recipients;
ALTER TABLE sequences RENAME TO mkt_sequences;
ALTER TABLE sequence_steps RENAME TO mkt_sequence_steps;
ALTER TABLE sequence_connections RENAME TO mkt_sequence_connections;
ALTER TABLE sequence_enrollments RENAME TO mkt_sequence_enrollments;
ALTER TABLE sequence_history RENAME TO mkt_sequence_history;
ALTER TABLE communication_preferences RENAME TO mkt_communication_preferences;
ALTER TABLE lead_funnels RENAME TO mkt_lead_funnels;

-- ============================================================
-- RPT — Reports
-- ============================================================
ALTER TABLE report_daily_metrics RENAME TO rpt_daily_metrics;
ALTER TABLE dashboard_configs RENAME TO rpt_dashboard_configs;
ALTER TABLE scheduled_reports RENAME TO rpt_scheduled_reports;
ALTER TABLE report_delivery_log RENAME TO rpt_delivery_log;

-- ============================================================
-- WEB — Website
-- ============================================================
ALTER TABLE tenant_sites RENAME TO web_sites;
ALTER TABLE page_templates RENAME TO web_page_templates;
ALTER TABLE site_pages RENAME TO web_pages;
ALTER TABLE blog_posts RENAME TO web_blog_posts;
ALTER TABLE media_files RENAME TO web_media_files;
ALTER TABLE form_submissions RENAME TO web_form_submissions;
ALTER TABLE site_navigation RENAME TO web_navigation;

-- ============================================================
-- INT — Integrations
-- ============================================================
ALTER TABLE integration_connections RENAME TO int_connections;
ALTER TABLE integration_sync_log RENAME TO int_sync_log;
ALTER TABLE webhook_subscriptions RENAME TO int_webhook_subscriptions;
ALTER TABLE webhook_deliveries RENAME TO int_webhook_deliveries;
ALTER TABLE api_keys RENAME TO int_api_keys;
ALTER TABLE ical_feeds RENAME TO int_ical_feeds;

-- ============================================================
-- ENG — Engagement
-- ============================================================
ALTER TABLE community_posts RENAME TO eng_posts;
ALTER TABLE community_reactions RENAME TO eng_reactions;
ALTER TABLE community_comments RENAME TO eng_comments;
ALTER TABLE challenges RENAME TO eng_challenges;
ALTER TABLE challenge_participants RENAME TO eng_challenge_participants;
ALTER TABLE customer_points RENAME TO eng_customer_points;
ALTER TABLE badges RENAME TO eng_badges;
ALTER TABLE customer_badges RENAME TO eng_customer_badges;
ALTER TABLE customer_streaks RENAME TO eng_customer_streaks;
ALTER TABLE vod_content RENAME TO eng_vod_content;
ALTER TABLE vod_progress RENAME TO eng_vod_progress;
ALTER TABLE courses RENAME TO eng_courses;
ALTER TABLE course_lessons RENAME TO eng_course_lessons;
ALTER TABLE course_enrollments RENAME TO eng_course_enrollments;
ALTER TABLE course_lesson_progress RENAME TO eng_course_lesson_progress;
ALTER TABLE referral_codes RENAME TO eng_referral_codes;
ALTER TABLE referrals RENAME TO eng_referrals;
ALTER TABLE reviews RENAME TO eng_reviews;

-- ============================================================
-- Update stored functions to use new table names
-- ============================================================
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '4000', 'Revenue', 'revenue', true),
        (p_business_id, '4100', 'Service Revenue', 'revenue', true),
        (p_business_id, '4200', 'Membership Revenue', 'revenue', true),
        (p_business_id, '4300', 'Product Revenue', 'revenue', false),
        (p_business_id, '4400', 'Gift Card Revenue', 'revenue', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '6000', 'Operating Expenses', 'expense', true),
        (p_business_id, '6100', 'Rent & Occupancy', 'expense', false),
        (p_business_id, '6200', 'Utilities', 'expense', false),
        (p_business_id, '6300', 'Insurance', 'expense', false),
        (p_business_id, '6400', 'Marketing & Advertising', 'expense', false),
        (p_business_id, '6500', 'Supplies & Consumables', 'expense', false),
        (p_business_id, '6600', 'Equipment & Maintenance', 'expense', false),
        (p_business_id, '6700', 'Software & Technology', 'expense', false),
        (p_business_id, '6800', 'Professional Services', 'expense', false),
        (p_business_id, '6900', 'Other Operating Expenses', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '7000', 'Payroll Expenses', 'expense', true),
        (p_business_id, '7100', 'Wages & Salaries', 'expense', true),
        (p_business_id, '7200', 'Commissions', 'expense', false),
        (p_business_id, '7300', 'Contractor Payments', 'expense', false),
        (p_business_id, '7400', 'Payroll Taxes (Employer)', 'expense', false),
        (p_business_id, '7500', 'Benefits & Insurance (Employer)', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '1000', 'Assets', 'asset', true),
        (p_business_id, '1100', 'Cash & Bank', 'asset', true),
        (p_business_id, '1200', 'Accounts Receivable', 'asset', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '2000', 'Liabilities', 'liability', true),
        (p_business_id, '2100', 'Accounts Payable', 'liability', true),
        (p_business_id, '2200', 'Payroll Payable', 'liability', true),
        (p_business_id, '2300', 'Tax Payable', 'liability', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '3000', 'Equity', 'equity', true),
        (p_business_id, '3100', 'Owner Equity', 'equity', true),
        (p_business_id, '3200', 'Retained Earnings', 'equity', false)
    ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMIT;
