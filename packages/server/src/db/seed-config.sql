-- DayStream Configuration Seed
-- Generated: 2026-08-04T14:53:26.015Z
-- Business ID: 83e81f01-93eb-4895-a9a6-c44912748978
-- 
-- This script seeds configuration data for development/testing.
-- Run after the main seed.ts to add offerings and business setup.
--
-- Usage: psql -f seed-config.sql
--        or: npx tsx src/db/seed-config.ts

BEGIN;

-- sys_tenants (1 rows)
INSERT INTO sys_tenants (id, name, slug, status, default_language, currency, timezone) VALUES ('21aec56f-cc01-4566-8cf0-1f0490320da3', 'Spain DMA SRL', 'spain-dma-srl', 'active', 'en', 'EUR', 'UTC') ON CONFLICT (id) DO NOTHING;

-- sys_businesses (1 rows) — moved up locally: usr_users.business_id FKs into this table,
-- but the exported file had users before businesses; reordered so it runs first.
INSERT INTO sys_businesses (id, tenant_id, name, slug, status, default_language, currency, timezone, scheduling_mode) VALUES ('83e81f01-93eb-4895-a9a6-c44912748978', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Transcend Health', 'transcend-health', 'active', 'en', 'EUR', 'Europe/Madrid', 'availability') ON CONFLICT (id) DO NOTHING;

-- usr_users (8 rows) - passwords excluded, set to bcrypt hash of 'password123'
-- NOTE: 4 rows skipped locally (Javier Sanchez, Frank Gomez, Sally Janero, William Everitt) —
-- their business_id (dd2c503d-... / c03dac87-...) has no matching sys_businesses row in this
-- export; export-config.ts only exported the one business it was scoped to. Skipped rather than
-- stubbing in fake business data for the missing ones.
INSERT INTO usr_users (id, tenant_id, business_id, email, password_hash, first_name, last_name, role, persona, status, email_verified, created_at) VALUES ('a1825d45-cfa7-4b3b-a819-8f3e7581abe7', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'nicole@th.eu', '$2b$12$fwPgBuVLqxCzAfFe.QLWc.k7SPdicPeaMfR/SUoU.ahQ2YJFEAL3K', 'Nicole', 'Santos', 'business_owner', 'business', 'active', TRUE, '2026-07-17T07:16:26.216Z') ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_users (id, tenant_id, business_id, email, password_hash, first_name, last_name, role, persona, status, email_verified, created_at) VALUES ('9cd819ea-8541-4a44-b202-d5267f23708f', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'samba@th.eu', '$2b$12$fwPgBuVLqxCzAfFe.QLWc.k7SPdicPeaMfR/SUoU.ahQ2YJFEAL3K', 'Samba', 'Sy', 'business_staff', 'business', 'active', TRUE, '2026-07-17T07:17:52.682Z') ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_users (id, tenant_id, business_id, email, password_hash, first_name, last_name, role, persona, status, email_verified, created_at) VALUES ('4d957591-965e-40b2-8c26-9bf3f542815d', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'ines@th.eu', '$2b$12$fwPgBuVLqxCzAfFe.QLWc.k7SPdicPeaMfR/SUoU.ahQ2YJFEAL3K', 'Ines', 'Gaya', 'business_manager', 'business', 'active', TRUE, '2026-07-17T07:20:38.256Z') ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_users (id, tenant_id, business_id, email, password_hash, first_name, last_name, role, persona, status, email_verified, created_at) VALUES ('4ead8f0b-ae21-4fe3-a4d5-ff796c828198', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'amanda@th.eu', '$2b$12$fwPgBuVLqxCzAfFe.QLWc.k7SPdicPeaMfR/SUoU.ahQ2YJFEAL3K', 'Amanda', 'Balieiro', 'business_manager', 'business', 'active', TRUE, '2026-07-17T07:21:31.759Z') ON CONFLICT (id) DO NOTHING;

-- usr_roles (5 rows)
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system) VALUES ('c20262ec-4151-4046-9172-52490f8ac1b2', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Business Owner', '["services:*","bookings:*","staff:*","reports:*","settings:*","customers:*","resources:*"]'::jsonb, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system) VALUES ('9a641331-b635-4c30-8a27-c131a40d23ce', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Customer', '["bookings:create","bookings:read","profile:update"]'::jsonb, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system) VALUES ('edb63246-3fb9-4141-ae2c-3c3f14d73ab5', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Manager', '["services:read","bookings:*","staff:read","reports:read","customers:*","schedule:*"]'::jsonb, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system) VALUES ('dfc2968d-a2e5-41c3-b8cc-b83644dc7a26', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Staff', '["bookings:read","bookings:update","customers:read","schedule:read"]'::jsonb, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO usr_roles (id, tenant_id, name, permissions, is_system) VALUES ('3b5511a6-822b-425f-a731-12a763f61e79', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'Tenant Owner', '["*:*"]'::jsonb, TRUE) ON CONFLICT (id) DO NOTHING;

-- usr_user_roles (4 rows)
INSERT INTO usr_user_roles (tenant_id, user_id, role_id) VALUES ('21aec56f-cc01-4566-8cf0-1f0490320da3', 'a1825d45-cfa7-4b3b-a819-8f3e7581abe7', 'c20262ec-4151-4046-9172-52490f8ac1b2') ON CONFLICT (user_id, role_id, tenant_id) DO NOTHING;

-- sys_locations (1 rows)
INSERT INTO sys_locations (id, business_id, name, slug, address_line1, address_line2, city, state_province, postal_code, country, phone, email, timezone, is_primary, status) VALUES ('27107471-f13b-407e-935f-a7acde2f88ee', '83e81f01-93eb-4895-a9a6-c44912748978', 'Transcend Health', 'transcend-health', 'Carrer del Marquès de la Sènia', '37, Loc 1, semisotano, Ponent', 'Palma', '', '07014', '', '34 971 06 28 42', 'info@transcendhealth.eu', '', TRUE, 'active') ON CONFLICT (id) DO NOTHING;

-- sys_location_hours (7 rows)
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('ad7f10ed-0e02-4f9a-b76a-3c32a7c8d3c2', '27107471-f13b-407e-935f-a7acde2f88ee', 0, '09:00:00', '17:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('3fbeb5ff-8e0b-4315-91d6-eeeae7c14a61', '27107471-f13b-407e-935f-a7acde2f88ee', 1, '09:00:00', '20:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('dac77c60-28d3-4798-9ec7-7ef007aff40e', '27107471-f13b-407e-935f-a7acde2f88ee', 2, '09:00:00', '20:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('722e0845-3490-4889-be85-c8e9305a856e', '27107471-f13b-407e-935f-a7acde2f88ee', 3, '15:00:00', '20:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('1ba05265-4226-496a-8a38-0e16f9638891', '27107471-f13b-407e-935f-a7acde2f88ee', 4, '09:00:00', '20:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('d6043609-8bba-4833-af0b-552300f28345', '27107471-f13b-407e-935f-a7acde2f88ee', 5, '09:00:00', '20:00:00', FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO sys_location_hours (id, location_id, day_of_week, open_time, close_time, is_closed) VALUES ('5c4cdab2-a1b4-48fe-926b-061437a561d8', '27107471-f13b-407e-935f-a7acde2f88ee', 6, '09:00:00', '18:00:00', FALSE) ON CONFLICT (id) DO NOTHING;

-- svc_categories (3 rows)
INSERT INTO svc_categories (id, business_id, name, description) VALUES ('676c48e3-a657-4df0-a6d9-c53024ff28e7', '83e81f01-93eb-4895-a9a6-c44912748978', 'Body', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_categories (id, business_id, name, description) VALUES ('cddd8a22-80c3-4671-8a5d-518862b9c022', '83e81f01-93eb-4895-a9a6-c44912748978', 'Mind', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_categories (id, business_id, name, description) VALUES ('5effae46-6f4c-4c25-ae2a-9fff0036c6e3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Soul', NULL) ON CONFLICT (id) DO NOTHING;

-- svc_services (6 rows)
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('84114869-d06a-415f-8d51-d2b939ba4a32', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Fire & Ice', 'fire-ice', 'Ideal if you want to focus on one or two modalities, such as a cold plunge after training or a short sauna session followed by 15 minutes in the compression boots. Perfect for time-conscious residents or anyone new to the Reset Zone.', 'At the heart of Transcend lies Fire & Ice biohack zone—a dynamic space where the elemental power of hot and cold therapies converge to create the ultimate wellness experience.', 'individual', 'active', 60, 5, 0, 1, 2, 30, TRUE, FALSE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('e51954b6-2dcc-4c0e-bdb5-6a3823b554c4', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Float Therapy', 'float-therapy', 'Completely switch off, unwind, and allow your mind and body to enter a deeply restorative state of calm. Perfect for reducing stress, easing muscular tension, and experiencing the full benefits of float therapy.', '', 'individual', 'active', 60, 0, 0, 1, 2, 30, TRUE, FALSE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('d0528393-925c-45dd-b56c-d7e01582fbb3', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Personal Training', 'personal-training', 'A session dedicated to your goals, combining movement preparation, strength, conditioning, mobility, and expert coaching. Ideal for those looking to improve performance, move better, and build lasting results through a structured, individual approach.', '', 'individual', 'active', 60, 0, 0, 10, 2, 30, TRUE, TRUE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('409d7050-1bcd-42dd-9b72-e8a43d903e64', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Private Gym Access', 'private-gym-access', 'Enjoy private access with enough time for movement preparation, a full workout, and a proper cool-down. Ideal for longer strength sessions, combined training and mobility work, or anyone who values space, privacy, and the freedom to train without rushing.', '', 'individual', 'active', 60, 0, 0, 1, 2, 30, TRUE, FALSE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('cc54745c-7806-4ff5-acda-70a261f5d77d', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Red Light Therapy', 'red-light-therapy', 'A focused session designed to support cellular energy, skin health, and muscle recovery. Ideal for busy days, post-workout recovery, or as a simple addition to your regular wellness routine.', '', 'individual', 'active', 60, 0, 0, 1, 2, 30, TRUE, FALSE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_services (id, business_id, category_id, name, slug, description, short_description, booking_type, status, default_duration, buffer_before, buffer_after, max_capacity, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, requires_dedicated_staff, preparation_notes, display_order, is_taxable, tax_category_id) VALUES ('b2d8abda-b29d-4dd1-afef-a9dc47817f09', '83e81f01-93eb-4895-a9a6-c44912748978', '676c48e3-a657-4df0-a6d9-c53024ff28e7', 'Sport Massage', 'sport-massage', 'A treatment that allows time for detailed, unhurried work across the whole body. Ideal for persistent tension, demanding training schedules, or anyone seeking a more comprehensive recovery experience that leaves the body feeling lighter, looser, and fully reset.', '', 'individual', 'active', 60, 0, 0, 1, 2, 30, TRUE, TRUE, NULL, 0, TRUE, NULL) ON CONFLICT (id) DO NOTHING;

-- svc_variants (16 rows)
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('406ce494-e37f-4360-bc8d-d26c5d000f7d', '409d7050-1bcd-42dd-9b72-e8a43d903e64', '90 min', 90, 6000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('731f2805-42bd-4ef8-9529-33bc4f6e231e', '409d7050-1bcd-42dd-9b72-e8a43d903e64', '60 min', 60, 4000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('a9d7a36d-64d3-415a-828d-6ce1359a7b33', '409d7050-1bcd-42dd-9b72-e8a43d903e64', '30 min', 30, 1500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('d62ce850-8c43-4f97-a55f-2ecdc964fc02', '84114869-d06a-415f-8d51-d2b939ba4a32', '30 min', 30, 2000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('33c24ece-501d-467c-8aba-6a5478ea7314', '84114869-d06a-415f-8d51-d2b939ba4a32', '60 min', 60, 3500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('e88eaf1f-aa50-4aea-8498-c46c1e6eca07', '84114869-d06a-415f-8d51-d2b939ba4a32', '90 min', 90, 5000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('5ace9b27-d5d6-4e7d-9412-975a9652d2d1', 'b2d8abda-b29d-4dd1-afef-a9dc47817f09', '60', 60, 9000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('655b2896-bf33-4586-9694-a7a9e891c896', 'b2d8abda-b29d-4dd1-afef-a9dc47817f09', '90', 90, 13500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('a80f780b-dc14-4fbf-a9d9-57cbbbe68a23', 'b2d8abda-b29d-4dd1-afef-a9dc47817f09', '30 min', 30, 4500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('cabc6059-1949-4fea-a360-e3780191a0ee', 'cc54745c-7806-4ff5-acda-70a261f5d77d', '10 min', 10, 1500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('c585fe28-6258-41f7-845a-b728c1a7f130', 'cc54745c-7806-4ff5-acda-70a261f5d77d', '20 min', 20, 3000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('31803c21-165b-416f-bb69-344b223e4709', 'd0528393-925c-45dd-b56c-d7e01582fbb3', '45 min', 45, 6000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('d9abb083-3924-4fb6-8a67-0c0db67817cb', 'd0528393-925c-45dd-b56c-d7e01582fbb3', '30 min', 30, 4000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('3bbd1302-f466-4ad8-867a-53c1084ffd87', 'd0528393-925c-45dd-b56c-d7e01582fbb3', '60 min', 60, 8000, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('666fc52a-0e48-4ff7-aacb-cd2aec48942b', 'e51954b6-2dcc-4c0e-bdb5-6a3823b554c4', '30 min', 30, 2500, 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_variants (id, service_id, name, duration, price, status, display_order) VALUES ('ac0a472a-de31-48dd-b025-8a0fa8dd47c1', 'e51954b6-2dcc-4c0e-bdb5-6a3823b554c4', '60 min', 60, 4500, 'active', 0) ON CONFLICT (id) DO NOTHING;

-- svc_availability_rules (6 rows)
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('39a94923-0677-4383-b0f0-95c10cf5c951', '409d7050-1bcd-42dd-9b72-e8a43d903e64', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['2f595e02-8d78-43ed-add6-0e11a3e7d606']::uuid[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('e2831fc7-3cd1-4729-8e5e-c65deed39c13', '84114869-d06a-415f-8d51-d2b939ba4a32', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['5429522c-be16-49ff-97da-3114f2cac267']::uuid[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('3277696b-d494-476e-a8ae-d061ec04ce94', 'b2d8abda-b29d-4dd1-afef-a9dc47817f09', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['a1825d45-cfa7-4b3b-a819-8f3e7581abe7','9cd819ea-8541-4a44-b202-d5267f23708f']::uuid[], ARRAY['93cee9db-754f-4f91-b1bc-65cb861cfdc8','a1c75a02-1888-4cdb-9e33-164aef9349e8']::uuid[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('2ab49c68-eebd-40cc-bfda-367d070c3673', 'cc54745c-7806-4ff5-acda-70a261f5d77d', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['5796ae49-dc19-4a2e-89ad-1cb2ed7400b7']::uuid[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('92522bd0-8d87-4edf-80b3-5b76450a2d1d', 'd0528393-925c-45dd-b56c-d7e01582fbb3', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['a1825d45-cfa7-4b3b-a819-8f3e7581abe7','9cd819ea-8541-4a44-b202-d5267f23708f']::uuid[], ARRAY['2f595e02-8d78-43ed-add6-0e11a3e7d606']::uuid[]) ON CONFLICT (id) DO NOTHING;
INSERT INTO svc_availability_rules (id, service_id, rule_type, days_of_week, start_time, end_time, effective_from, effective_to, blocked_dates, description, variant_ids, location_ids, staff_ids, resource_ids) VALUES ('c3d81e56-528a-4e01-957e-0946f4f65dc7', 'e51954b6-2dcc-4c0e-bdb5-6a3823b554c4', 'recurring', ARRAY[1,2,3,4,5,6]::int[], '09:00:00', '17:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['4f42d317-7454-44ee-b083-131cb5962465']::uuid[]) ON CONFLICT (id) DO NOTHING;

-- res_resources (6 rows)
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('5429522c-be16-49ff-97da-3114f2cac267', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice Room', 'equipment', 1, 5, 'active', '') ON CONFLICT (id) DO NOTHING;
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('4f42d317-7454-44ee-b083-131cb5962465', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Float Tank', 'equipment', 3, 0, 'active', '') ON CONFLICT (id) DO NOTHING;
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('2f595e02-8d78-43ed-add6-0e11a3e7d606', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Gym', 'room', 10, 0, 'active', '') ON CONFLICT (id) DO NOTHING;
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('93cee9db-754f-4f91-b1bc-65cb861cfdc8', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Massage Room #1', 'room', 1, 5, 'active', '') ON CONFLICT (id) DO NOTHING;
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('a1c75a02-1888-4cdb-9e33-164aef9349e8', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Massage Room #2', 'room', 1, 5, 'active', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO res_resources (id, tenant_id, business_id, name, category, capacity, buffer_minutes, status, description) VALUES ('5796ae49-dc19-4a2e-89ad-1cb2ed7400b7', '21aec56f-cc01-4566-8cf0-1f0490320da3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light wall', 'equipment', 1, 0, 'active', NULL) ON CONFLICT (id) DO NOTHING;

-- prd_merchandise (2 rows)
INSERT INTO prd_merchandise (id, business_id, name, description, short_description, price, status, sku, tax_category_id, display_order) VALUES ('1a9e754b-fe99-47d3-b651-c6a63b96ccf9', '83e81f01-93eb-4895-a9a6-c44912748978', 'Essence', NULL, NULL, 1500, 'active', NULL, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO prd_merchandise (id, business_id, name, description, short_description, price, status, sku, tax_category_id, display_order) VALUES ('c0121a43-f8a1-4e5c-9c32-0d8c5392e7a3', '83e81f01-93eb-4895-a9a6-c44912748978', 'Massage Lotion', NULL, NULL, 3500, 'active', NULL, NULL, 0) ON CONFLICT (id) DO NOTHING;

-- mbr_plans (3 rows)
INSERT INTO mbr_plans (id, business_id, name, description, short_description, price, billing_frequency, status, display_order) VALUES ('8c33e227-8ea4-4491-b625-bf4267327a20', '83e81f01-93eb-4895-a9a6-c44912748978', 'Optimize', 'For those training harder, working longer, or managing higher stress. Added tools to support circulation, cellular recovery, and nervous system balance.

✓ Unlimited Fire & Ice access (1 session per day)
✓ Unlimited compression boots (1 session per day)
✓ Unlimited red light therapy (1 session per day)
✓1 guest pass per month
✓ 10% off float sessions and workshops
✓ Towels included', 'Enhanced recovery for higher demands.', 14900, 'monthly', 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO mbr_plans (id, business_id, name, description, short_description, price, billing_frequency, status, display_order) VALUES ('980700f4-962b-4bc4-aa15-c94ee3e85640', '83e81f01-93eb-4895-a9a6-c44912748978', 'Recover', 'Built for those who use sauna and cold as the foundation of their recovery routine. Simple, effective, and easy to maintain week after week.

✓ Unlimited Fire & Ice access (1 session per day)
✓ Unlimited compression boots (1 session per day)
✓ Towels included', 'Essential recovery, done consistently.', 9900, 'monthly', 'active', 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO mbr_plans (id, business_id, name, description, short_description, price, billing_frequency, status, display_order) VALUES ('58fcbbef-8dd2-487e-8bbe-38432affb09d', '83e81f01-93eb-4895-a9a6-c44912748978', 'Transcend', 'Our most comprehensive membership. Designed for those who treat recovery as a core part of training, longevity, and mental performance.

✓ Unlimited Fire & Ice access (1 session per day)
✓ Unlimited compression boots (1 session per day)
✓ Unlimited red light therapy (1 session per day)
✓ Unlimited float sessions (90min/day)
✓ Unlimited private gym access (60min/day)
✓ 2 guest passes per month
✓ 15% off sports massage with Samba, floats, and workshops
✓ 15% off personal training with Shane
✓ Towels included', 'Complete mind–body recovery.', 24900, 'monthly', 'active', 0) ON CONFLICT (id) DO NOTHING;

-- pkg_packages (29 rows)
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('216b72b6-1aa7-4964-a080-95ee30e64843', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice 10 Pack', 'Enjoy 10 sessions of 60-minute access to the Reset Zone at Transcend. 
Including: 
- Infrared saunas 
- Cold plunges 
- Jacuzzi hydrotherapy 
- 15min Compression Boots 
This package is fully flexible: you’re purchasing a total of 10 hours of Fire & Ice time, and you can use them however you like. Drop in for 30 minutes one day or stay for 90 minutes another, credits are simply deducted based on the duration of your visit. ', '', 24000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('029403f2-4cc7-4f51-9d8d-a29d9cc17094', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice 15 Pack', '15-Session Reset Zone Pack (Fire & Ice). Enjoy 15 hours of access to the Reset Zone at Transcend. Including:
- Infrared saunas
- Cold plunges
- Jacuzzi hydrotherapy
- 15min Compression Boots
This package is fully flexible: you’re purchasing a total of 15 hours of Fire & Ice time, and you can use them however you like. Drop in for 30 minutes one day or stay for 90 minutes another, credits are simply deducted based on the duration of your visit.', '', 34500, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('a1af77d0-23b6-4b7a-aa64-be827dccb0a6', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice 20 Pack', '20-Session Reset Zone Pack (Fire & Ice). Enjoy 20 hours of access to the Reset Zone at Transcend. Including:
- Infrared saunas
- Cold plunges
- Jacuzzi hydrotherapy
- 15min Compression Boots
This package is fully flexible: you’re purchasing a total of 20 hours of Fire & Ice time, and you can use them however you like. Drop in for 30 minutes one day or stay for 90 minutes another, credits are simply deducted based on the duration of your visit.', '', 40000, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('c8d796e1-9fa8-430e-8e5d-6b1c58aa8871', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice 3 Pack', '3-Session Reset Zone Pack (Fire & Ice) Enjoy 3 hours of access to the Reset Zone at Transcend. Including: 
- Infrared saunas
- Cold plunges 
- Jacuzzi hydrotherapy 
- 15min Compression Boots
This package is fully flexible: you’re purchasing a total of 3 hours of Fire & Ice time, and you can use them however you like. Drop in for 30 minutes one day or stay for 90 minutes another, credits are simply deducted based on the duration of your visit.', '', 9900, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('bf3bc2e5-0227-4880-a67a-34a03befa629', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fire & Ice 5 Pack', 'Enjoy 5 hours of access to the Reset Zone at Transcend.   
Including:
- Infrared saunas
- Cold plunges
- Jacuzzi hydrotherapy
- 15min Compression Boots
This package is fully flexible: you’re purchasing a total of 5 hours of Fire & Ice time, and you can use them however you like. Drop in for 30 minutes one day or stay for 90 minutes another, credits are simply deducted based on the duration of your visit.', '', 14500, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('b1f86782-f898-4235-af0b-b642f0361394', '83e81f01-93eb-4895-a9a6-c44912748978', 'Float Therapy 10 Pack', 'Experience deep relaxation with our Float Tank Therapy at Transcend. Each session takes place in a warm, highly concentrated Epsom salt solution that allows your body to float effortlessly. Relieving pressure on joints, reducing stress, and promoting mental clarity. We offer flexible 30, 60 or 90minute float sessions, so you can choose the experience that best suits your needs each visit. Credits are simply deducted based on the duration of your session.', '', 28400, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('50b930e1-d690-4197-b19b-6dfa7a83e153', '83e81f01-93eb-4895-a9a6-c44912748978', 'Float Therapy 2 Pack', 'Experience deep relaxation with Float Tank Therapy at Transcend. Each session takes place in a warm, highly concentrated Epsom salt solution that allows your body to float effortlessly, relieving joint pressure, reducing stress, and promoting mental clarity.
This flexible pack can be used for 30, 60, or 90-minute float sessions, with credits automatically deducted based on your chosen session length.', '', 8000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('1af37a83-746e-49f8-8fb5-f1d63e37a56d', '83e81f01-93eb-4895-a9a6-c44912748978', 'Float Therapy 3 Pack', '3 × 60-Minute Float Tank Therapy
Experience deep relaxation with Float Tank Therapy at Transcend. Each session takes place in a warm, highly concentrated Epsom salt solution that allows your body to float effortlessly, relieving joint pressure, reducing stress, and promoting mental clarity.
This flexible pack can be used for 30, 60, or 90-minute float sessions, with credits automatically deducted based on your chosen session length.', '', 11500, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('61197b4b-5db8-4c52-b6f5-6b7de48890cd', '83e81f01-93eb-4895-a9a6-c44912748978', 'Float Therapy 5 Pack', 'Experience deep relaxation with Float Tank Therapy at Transcend. Each session takes place in a warm, highly concentrated Epsom salt solution that allows your body to float effortlessly, relieving joint pressure, reducing stress, and promoting mental clarity.

This flexible pack can be used for 30, 60, or 90-minute float sessions, with credits automatically deducted based on your chosen session length.', '', 17400, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('56162a7b-4afe-4d43-8722-faffbc9b0fce', '83e81f01-93eb-4895-a9a6-c44912748978', 'Intro Pack Fire & Ice', '- 3 credits = 3 × 60-minute Fire & Ice sessions
- A flexible way to discover Transcend and our recovery experience.
- Valid for 1 month to help you feel the benefits of consistent sessions.
- Designed to show how Fire & Ice can fit into your lifestyle.
- Non-transferable.
- Intro offer valid once per new customer.', '', 5000, 'days', 'active', TRUE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('c55e04e8-2aa5-4a2d-8407-16edd42dbe85', '83e81f01-93eb-4895-a9a6-c44912748978', 'Intro Pack Float Session', 'A flexible way to discover Transcend and our recovery experience.
- Each credit = 60 minutes of float therapy
- Valid for 2 month to help you feel the benefits of consistent sessions. 
- Designed to show how Float therapy can enhance your mental/physical wellbeing.
- Non-transferable.
-Intro offer valid once per new customer.', '', 7000, 'months', 'active', TRUE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('ceb06b15-d536-4eeb-b3db-7c0123b011f0', '83e81f01-93eb-4895-a9a6-c44912748978', 'Intro Pack Red Light Therapy', 'A flexible way to discover Transcend and our recovery experience.
- Each credit = 10 minutes of red light 
- Valid for 1 month to help you feel the benefits of consistent sessions. 
- Designed to show how Red light therapy can fit into your lifestyle.
- Non-transferable.
-Intro offer valid once per new customer.', '', 2000, 'months', 'active', TRUE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('9174278b-98a9-45b6-b340-df5d051b1599', '83e81f01-93eb-4895-a9a6-c44912748978', 'Private Gym Access 10 Pack', '10 × 60-Minute Private Gym Access
Enjoy exclusive, uninterrupted access to Transcend’s fully equipped gym for your personal training sessions.
Book 30, 45, 60, or 90 minutes, credits are automatically deducted based on the session length.
This flexible package lets you train on your schedule in a private space designed to support your fitness goals.', '', 15000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('2826b6ed-a667-43be-8024-4c10635de49b', '83e81f01-93eb-4895-a9a6-c44912748978', 'Private Gym Access 15 Pack', '15 × 60-Minute Private Gym Access
Enjoy exclusive, uninterrupted access to Transcend’s fully equipped gym for your personal training sessions.
Book 30, 45, 60, or 90 minutes, credits are automatically deducted based on the session length.
This flexible package lets you train on your schedule in a private space designed to support your fitness goals.', '', 18000, 'months', 'active', FALSE, FALSE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('2ef08185-1825-4c27-a91e-2646506c4575', '83e81f01-93eb-4895-a9a6-c44912748978', 'Private Gym Access 20 Pack', '20 × 60-Minute Private Gym Access
Enjoy exclusive, uninterrupted access to Transcend’s fully equipped gym for your personal training sessions.
Book 30, 45, 60, or 90 minutes, credits are automatically deducted based on the session length.
This flexible package lets you train on your schedule in a private space designed to support your fitness goals.', '', 20000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('ce86ac7b-b503-49f1-8aeb-4195f8ac38ee', '83e81f01-93eb-4895-a9a6-c44912748978', 'Private Gym Access 3 Pack', '3 × 60-Minute Private Gym Access
Enjoy exclusive, uninterrupted access to Transcend’s fully equipped gym for your personal training sessions.
Book 30, 45, 60, or 90 minutes, credits are automatically deducted based on the session length.
This flexible package lets you train on your schedule in a private space designed to support your fitness goals.', '', 7500, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('753e025e-063c-401a-adf1-023478884c06', '83e81f01-93eb-4895-a9a6-c44912748978', 'Private Gym Access 5 Pack', '5 × 60-Minute Private Gym Access
Enjoy exclusive, uninterrupted access to Transcend’s fully equipped gym for your personal training sessions.
Book 30, 45, 60, or 90 minutes, credits are automatically deducted based on the session length.
This flexible package lets you train on your schedule in a private space designed to support your fitness goals.', '', 10000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('f4c7a61d-0e42-4cff-ad17-2ab606c890d0', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light 10 Pack', '10 Pack Red Light Therapy (10-Minute Sessions)
Enjoy 10 sessions of Red Light Therapy at Transcend. Each session provides 10 minutes of targeted, full-body red light exposure designed to support recovery, skin health, and overall well being. ', '', 11600, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('dbfc94f1-62f8-4d6c-b315-757fcd09f55a', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light 15 Pack', 'Enjoy 15 sessions of Red Light Therapy at Transcend. Each session provides 10 minutes of targeted, full-body red light exposure designed to support recovery, skin health, and overall well being. ', '', 14800, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('8b6d6176-70ec-4267-a272-9b370b1c109c', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light 20 Pack', '20 Pack Red Light Therapy (10-Minute Sessions) 
Enjoy 20 sessions of Red Light Therapy at Transcend. Each session provides 10 minutes of targeted, full-body red light exposure designed to support recovery, skin health, and overall well being.', '', 16300, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('9b2c92aa-4a1d-49cb-9710-b705e5294a8e', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light 3 Pack', '3 Pack Red Light Therapy (10-Minute Sessions)
Enjoy 3 sessions of Red Light Therapy at Transcend. Each session provides 10 minutes of targeted, full-body red light exposure designed to support recovery, skin health, and overall well being.', '', 4300, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('36c4a4d1-b4f1-4bef-8025-83f24ed5b153', '83e81f01-93eb-4895-a9a6-c44912748978', 'Red Light 5 Pack', '5 Pack Red Light Therapy (10-Minute Sessions) 
Enjoy 5 sessions of Red Light Therapy at Transcend. Each session provides 10 minutes of targeted, full-body red light exposure designed to support recovery, skin health, and overall well being. ', '', 6700, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('f201cbc2-8629-41e9-b85c-294d49b6f76d', '83e81f01-93eb-4895-a9a6-c44912748978', 'Sports Massage with Nicole 10 Pack', '10 sessions of 60min Sports Massage with Nicole', '', 99000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('cf781e8d-cfa9-451c-b905-6f09ac39589d', '83e81f01-93eb-4895-a9a6-c44912748978', 'Sports Massage with Nicole 5 Pack', '5 sessions of 60min Sports Massage with Nicole', '', 52000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('390d9667-9c10-4567-8ac4-bec9a86b4e1c', '83e81f01-93eb-4895-a9a6-c44912748978', 'Sports Massage with Samba 10 Pack', '10 sessions of 60-minute sports massage with Samba at a 10% discount. Sessions can also be taken as 30 or 90 minutes and will be credited accordingly.', '', 81000, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('a57d1bd9-54b0-4439-92ea-a0afe2612150', '83e81f01-93eb-4895-a9a6-c44912748978', 'Sports Massage with Samba 5 Pack', '5 sessions of 60-minute sports massage with Samba at a 5% discount. Sessions can also be taken as 30 or 90 minutes and will be credited accordingly.', '', 42700, 'months', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('2aab97f3-f073-4fb2-8a61-97c6707bd434', '83e81f01-93eb-4895-a9a6-c44912748978', 'The Recharge', 'Three hours of complete restoration. 
You’ve earned every minute. The perfect gift for those who never stop.

The Recharge combines three powerful recovery experiences into one seamless session:

✦ 90 min Fire & Ice: infrared sauna, cold plunge, jacuzzi & compression boots
✦ 20 min Red Light Therapy: cellular repair, skin & energy boost
✦ 60 min Float Therapy:  full sensory reset in epsom salt water, complete stillness

Perfect for: Deep recovery, stress relief, and mental clarity.

Normal value: €129 bought separately — you save €20', '', 10900, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('e6233f44-85db-4bf9-abda-57066156ef00', '83e81f01-93eb-4895-a9a6-c44912748978', 'The Reset', 'A powerful introduction to recovery.
Enjoy a quick yet effective session designed to boost circulation, reduce inflammation, and reset your nervous system.

The Reset combines two powerful recovery experiences into one seamless session:

✦ 90 min Fire & Ice therapy (sauna + cold plunge + jacuzzi)
✦ 20 min Red Light Therapy

Perfect for: A fast, efficient full-body reset.', '', 6500, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO pkg_packages (id, business_id, name, description, short_description, price, expiration_unit, status, new_customers_only, is_taxable, tax_category_id, display_order) VALUES ('19f70ea0-ec6b-4e5e-bd17-8dc052d2c950', '83e81f01-93eb-4895-a9a6-c44912748978', 'The Ultimate', 'The complete Transcend experience. A full recovery journey designed to optimise performance, release tension, and leave you feeling fully restored.

The Ultimate is the full experience, four treatments, one unforgettable day of pure recovery and renewal:

✦ 90 min Fire & Ice circuit — infrared sauna, cold plunge, jacuzzi & compression boots.
✦ 20 min Red Light Therapy — cellular repair, skin glow & energy reset.
✦ 60 min Float Therapy — sensory deprivation in epsom salt water, the deepest stillness you''ll ever feel.
✦ 60 min Sports Massage with Samba — expert hands, full body recovery

Perfect for: Total body recovery, performance optimisation, and deep relaxation.

* Sports massage with Samba subject to availability.', '', 16900, 'days', 'active', FALSE, TRUE, NULL, 0) ON CONFLICT (id) DO NOTHING;

-- prm_promotions (1 rows)
-- NOTE: source export had no real value for the NOT NULL `type` column (this promotion was
-- an unconfigured draft) — using 'discount_percentage' / value 0 as a harmless placeholder.
INSERT INTO prm_promotions (id, business_id, name, description, status, type, value) VALUES ('0eaa4689-578e-4ffe-af62-4b4b0b9721a7', '83e81f01-93eb-4895-a9a6-c44912748978', 'Fun FIFA Friday''s', '', 'active', 'discount_percentage', 0) ON CONFLICT (id) DO NOTHING;

-- stf_profiles (7 rows)
INSERT INTO stf_profiles (id, tenant_id, user_id, staff_ref, first_name, last_name, email, mobile_phone, employment_type, status, hire_date, bio, languages, show_on_directory) VALUES ('21800cf9-4be2-4bd9-85d8-da07dcf279d8', '21aec56f-cc01-4566-8cf0-1f0490320da3', '4ead8f0b-ae21-4fe3-a4d5-ff796c828198', 'STF-007', 'Amanda', 'Balieiro', 'amanda@th.eu', NULL, 'part_time', 'active', '2026-07-01', NULL, NULL, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_profiles (id, tenant_id, user_id, staff_ref, first_name, last_name, email, mobile_phone, employment_type, status, hire_date, bio, languages, show_on_directory) VALUES ('63c3f11f-beb8-459f-a7bc-addf3fd1a760', '21aec56f-cc01-4566-8cf0-1f0490320da3', '4d957591-965e-40b2-8c26-9bf3f542815d', 'STF-006', 'Ines', 'Gaya', 'ines@th.eu', NULL, 'part_time', 'active', '2026-07-01', NULL, NULL, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_profiles (id, tenant_id, user_id, staff_ref, first_name, last_name, email, mobile_phone, employment_type, status, hire_date, bio, languages, show_on_directory) VALUES ('0718337d-7342-4d45-bcef-0d9d47e2b5c1', '21aec56f-cc01-4566-8cf0-1f0490320da3', 'a1825d45-cfa7-4b3b-a819-8f3e7581abe7', 'STF-004', 'Nicole', 'Santos', 'nicole@th.eu', NULL, 'full_time', 'active', NULL, NULL, NULL, TRUE) ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_profiles (id, tenant_id, user_id, staff_ref, first_name, last_name, email, mobile_phone, employment_type, status, hire_date, bio, languages, show_on_directory) VALUES ('d7fd808b-06ad-4bc5-939e-0b8654721e38', '21aec56f-cc01-4566-8cf0-1f0490320da3', '9cd819ea-8541-4a44-b202-d5267f23708f', 'STF-005', 'Samba', 'Sy', 'samba@th.eu', NULL, 'full_time', 'active', '2026-07-01', NULL, NULL, TRUE) ON CONFLICT (id) DO NOTHING;

-- stf_availability_patterns (2 rows)
INSERT INTO stf_availability_patterns (id, staff_id, name, is_default, effective_from, effective_to) VALUES ('80a25982-a508-4a07-831d-5108626e862b', '21800cf9-4be2-4bd9-85d8-da07dcf279d8', 'Default Schedule', TRUE, '2026-07-20', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_patterns (id, staff_id, name, is_default, effective_from, effective_to) VALUES ('325b600f-8672-4f03-9711-c95b0854737c', 'd7fd808b-06ad-4bc5-939e-0b8654721e38', 'Default Schedule', TRUE, '2026-07-23', NULL) ON CONFLICT (id) DO NOTHING;

-- stf_availability_pattern_slots (7 rows)
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('849864bd-a9ca-45d0-bc93-a82769748a64', '325b600f-8672-4f03-9711-c95b0854737c', 0, '09:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('fb6cd2f6-3ea4-4c40-943e-1f9c85279c82', '325b600f-8672-4f03-9711-c95b0854737c', 1, '09:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('f514d63e-520e-4ebe-87b1-84a11b003c20', '325b600f-8672-4f03-9711-c95b0854737c', 6, '09:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('bcc7d82f-0d1b-4038-9ee3-dafc4b77ece5', '80a25982-a508-4a07-831d-5108626e862b', 1, '12:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('d0aa7efb-a695-48a4-ace6-30f537b30d6a', '80a25982-a508-4a07-831d-5108626e862b', 2, '09:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('f204820b-76d7-4822-ad5e-fc0f995931ea', '80a25982-a508-4a07-831d-5108626e862b', 4, '00:00:00', '17:00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO stf_availability_pattern_slots (id, pattern_id, day_of_week, start_time, end_time) VALUES ('88080869-734f-43ec-be54-4ba752168a0c', '80a25982-a508-4a07-831d-5108626e862b', 6, '09:00:00', '12:00:00') ON CONFLICT (id) DO NOTHING;

-- cus_note_categories (3 rows)
INSERT INTO cus_note_categories (id, business_id, name, is_sensitive, customer_visible) VALUES ('a7760956-2053-4d76-badd-40524ac46fa6', '83e81f01-93eb-4895-a9a6-c44912748978', 'Financial', FALSE, FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO cus_note_categories (id, business_id, name, is_sensitive, customer_visible) VALUES ('86ec2b50-908c-43fe-9089-5a5524a760cf', '83e81f01-93eb-4895-a9a6-c44912748978', 'Service', FALSE, FALSE) ON CONFLICT (id) DO NOTHING;
INSERT INTO cus_note_categories (id, business_id, name, is_sensitive, customer_visible) VALUES ('cae6ef28-b7f5-4b29-9291-0cb687404533', '83e81f01-93eb-4895-a9a6-c44912748978', 'Staff', FALSE, FALSE) ON CONFLICT (id) DO NOTHING;

COMMIT;
