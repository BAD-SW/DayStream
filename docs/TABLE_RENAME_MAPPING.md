# Database Table Rename Mapping

All tables are being renamed with a 3-character domain prefix to organize them by functional area.

## Prefix Legend

| Prefix | Domain |
|---|---|
| sys_ | System (platform, config, logs, jobs, query editor) |
| usr_ | Users (accounts, auth, roles, permissions, audit) |
| cus_ | Customers |
| svc_ | Services |
| apt_ | Appointments (bookings + check-in) |
| mem_ | Memberships |
| pri_ | Pricing |
| fin_ | Finance (accounts payable, payroll, vendors) |
| stf_ | Staff |
| res_ | Resources |
| evt_ | Events |
| mkt_ | Marketing |
| rpt_ | Reports |
| web_ | Website (CMS) |
| int_ | Integrations |
| eng_ | Engagement (community, gamification, referrals) |

---

## Complete Mapping

### SYS — System

| Current Name | New Name |
|---|---|
| tenants | sys_tenants |
| businesses | sys_businesses |
| locations | sys_locations |
| configuration_definitions | sys_configuration_definitions |
| tenant_configurations | sys_tenant_configurations |
| business_configurations | sys_business_configurations |
| feature_flags | sys_feature_flags |
| feature_flag_overrides | sys_feature_flag_overrides |
| system_configurations | sys_system_configurations |
| server_logs | sys_server_logs |
| api_request_logs | sys_api_request_logs |
| scheduled_jobs | sys_scheduled_jobs |
| job_executions | sys_job_executions |
| query_history | sys_query_history |
| saved_queries | sys_saved_queries |

### USR — Users

| Current Name | New Name |
|---|---|
| users | usr_users |
| password_history | usr_password_history |
| login_attempts | usr_login_attempts |
| refresh_tokens | usr_refresh_tokens |
| oauth_links | usr_oauth_links |
| user_mfa | usr_user_mfa |
| mfa_backup_codes | usr_mfa_backup_codes |
| roles | usr_roles |
| user_roles | usr_user_roles |
| audit_log | usr_audit_log |
| consent_records | usr_consent_records |
| deletion_requests | usr_deletion_requests |

### CUS — Customers

| Current Name | New Name |
|---|---|
| customers | cus_customers |
| customer_notes | cus_notes |
| note_categories | cus_note_categories |
| tags | cus_tags |
| customer_tags | cus_customer_tags |
| customer_custom_fields | cus_custom_fields |
| customer_activities | cus_activities |
| segments | cus_segments |
| customer_preferences | cus_preferences |
| customer_businesses | cus_businesses |

### SVC — Services

| Current Name | New Name |
|---|---|
| services | svc_services |
| service_categories | svc_categories |
| service_variants | svc_variants |
| service_images | svc_images |
| service_staff | svc_staff |
| service_resources | svc_resources |
| service_locations | svc_locations |
| service_availability_rules | svc_availability_rules |
| service_templates | svc_templates |
| tax_categories | svc_tax_categories |
| cancellation_policies | svc_cancellation_policies |
| service_qualification_requirements | svc_qualification_requirements |
| service_resource_requirements | svc_resource_requirements |

### APT — Appointments (includes Check-In)

| Current Name | New Name |
|---|---|
| bookings | apt_bookings |
| booking_status_history | apt_booking_status_history |
| recurring_booking_series | apt_recurring_series |
| slot_holds | apt_slot_holds |
| waitlist_entries | apt_waitlist_entries |
| staff_schedules | apt_staff_schedules |
| staff_time_off | apt_staff_time_off |
| notification_queue | apt_notification_queue |
| check_in_records | apt_check_in_records |
| check_in_qr_codes | apt_check_in_qr_codes |
| no_show_records | apt_no_show_records |
| check_in_config | apt_check_in_config |
| kiosk_sessions | apt_kiosk_sessions |

### MEM — Memberships

| Current Name | New Name |
|---|---|
| membership_plans | mem_plans |
| plan_service_access | mem_plan_service_access |
| plan_benefits | mem_plan_benefits |
| plan_upgrade_paths | mem_plan_upgrade_paths |
| memberships | mem_memberships |
| credit_transactions | mem_credit_transactions |
| membership_status_history | mem_status_history |

### PRI — Pricing

| Current Name | New Name |
|---|---|
| pricing_rules | pri_rules |
| discount_codes | pri_discount_codes |
| discount_code_usage | pri_discount_usage |
| pricing_bundles | pri_bundles |
| bundle_items | pri_bundle_items |
| corporate_accounts | pri_corporate_accounts |
| corporate_account_members | pri_corporate_members |
| price_history | pri_history |

### FIN — Finance

| Current Name | New Name |
|---|---|
| compensation_rules | fin_compensation_rules |
| payroll_deductions | fin_payroll_deductions |
| pay_periods | fin_pay_periods |
| payroll_entries | fin_payroll_entries |
| time_entries | fin_time_entries |
| vendors | fin_vendors |
| bills | fin_bills |
| bill_line_items | fin_bill_line_items |
| expenses | fin_expenses |
| chart_of_accounts | fin_chart_of_accounts |
| journal_entries | fin_journal_entries |
| journal_entry_lines | fin_journal_entry_lines |
| bank_statements | fin_bank_statements |
| bank_statement_lines | fin_bank_statement_lines |
| tax_documents | fin_tax_documents |

### STF — Staff

| Current Name | New Name |
|---|---|
| staff_profiles | stf_profiles |
| staff_qualifications | stf_qualifications |
| availability_patterns | stf_availability_patterns |
| availability_pattern_slots | stf_availability_pattern_slots |
| availability_overrides | stf_availability_overrides |
| leave_requests | stf_leave_requests |
| leave_balances | stf_leave_balances |
| staff_service_assignments | stf_service_assignments |
| staff_location_assignments | stf_location_assignments |
| staff_capacity_config | stf_capacity_config |
| staff_capacity_overrides | stf_capacity_overrides |
| staff_notification_preferences | stf_notification_preferences |

### RES — Resources

| Current Name | New Name |
|---|---|
| resource_types | res_types |
| resources | res_resources |
| resource_schedules | res_schedules |
| resource_schedule_slots | res_schedule_slots |
| resource_schedule_blocks | res_schedule_blocks |
| resource_bookings | res_bookings |
| resource_dependencies | res_dependencies |
| resource_maintenance | res_maintenance |

### EVT — Events

| Current Name | New Name |
|---|---|
| event_types | evt_types |
| event_series | evt_series |
| recurring_event_templates | evt_recurring_templates |
| events | evt_events |
| event_facilitators | evt_facilitators |
| event_ticket_tiers | evt_ticket_tiers |
| event_registrations | evt_registrations |
| event_waitlist | evt_waitlist |
| event_communications | evt_communications |

### MKT — Marketing

| Current Name | New Name |
|---|---|
| message_templates | mkt_message_templates |
| campaigns | mkt_campaigns |
| campaign_recipients | mkt_campaign_recipients |
| sequences | mkt_sequences |
| sequence_steps | mkt_sequence_steps |
| sequence_connections | mkt_sequence_connections |
| sequence_enrollments | mkt_sequence_enrollments |
| sequence_history | mkt_sequence_history |
| communication_preferences | mkt_communication_preferences |
| lead_funnels | mkt_lead_funnels |

### RPT — Reports

| Current Name | New Name |
|---|---|
| report_daily_metrics | rpt_daily_metrics |
| dashboard_configs | rpt_dashboard_configs |
| scheduled_reports | rpt_scheduled_reports |
| report_delivery_log | rpt_delivery_log |

### WEB — Website

| Current Name | New Name |
|---|---|
| tenant_sites | web_sites |
| page_templates | web_page_templates |
| site_pages | web_pages |
| blog_posts | web_blog_posts |
| media_files | web_media_files |
| form_submissions | web_form_submissions |
| site_navigation | web_navigation |

### INT — Integrations

| Current Name | New Name |
|---|---|
| integration_connections | int_connections |
| integration_sync_log | int_sync_log |
| webhook_subscriptions | int_webhook_subscriptions |
| webhook_deliveries | int_webhook_deliveries |
| api_keys | int_api_keys |
| ical_feeds | int_ical_feeds |

### ENG — Engagement

| Current Name | New Name |
|---|---|
| community_posts | eng_posts |
| community_reactions | eng_reactions |
| community_comments | eng_comments |
| challenges | eng_challenges |
| challenge_participants | eng_challenge_participants |
| customer_points | eng_customer_points |
| badges | eng_badges |
| customer_badges | eng_customer_badges |
| customer_streaks | eng_customer_streaks |
| vod_content | eng_vod_content |
| vod_progress | eng_vod_progress |
| courses | eng_courses |
| course_lessons | eng_course_lessons |
| course_enrollments | eng_course_enrollments |
| course_lesson_progress | eng_course_lesson_progress |
| referral_codes | eng_referral_codes |
| referrals | eng_referrals |
| reviews | eng_reviews |

---

**Total tables: 153**
**Date: July 6, 2026**
