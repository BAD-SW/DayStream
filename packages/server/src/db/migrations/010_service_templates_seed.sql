-- Phase 06: Service templates seed data

-- ============================================================
-- Recovery Center templates
-- ============================================================

INSERT INTO service_templates (business_type, category_name, name, description, short_description, booking_type, default_duration, suggested_price, display_order) VALUES
('recovery_center', 'Cold Therapy', 'Cold Plunge', 'Immerse yourself in our cold plunge pool to reduce inflammation, boost circulation, and accelerate recovery.', 'Cold water immersion for recovery and wellness.', 'shared', 15, 3500, 1),
('recovery_center', 'Cold Therapy', 'Cryotherapy Chamber', 'Step into our cryotherapy chamber for a 3-minute session at -110°C for full-body recovery.', 'Whole-body cryotherapy session.', 'individual', 5, 4500, 2),
('recovery_center', 'Heat Therapy', 'Infrared Sauna', 'Relax in our infrared sauna to detoxify, relieve pain, and improve cardiovascular health.', 'Deep-penetrating infrared heat therapy.', 'shared', 45, 3500, 1),
('recovery_center', 'Heat Therapy', 'Traditional Sauna', 'Classic Finnish sauna experience for relaxation and recovery.', 'Traditional dry heat sauna session.', 'shared', 30, 2500, 2),
('recovery_center', 'Contrast Therapy', 'Fire & Ice', 'Alternate between hot and cold to stimulate blood flow and accelerate muscle recovery.', 'Alternating heat and cold contrast session.', 'shared', 60, 5500, 1),
('recovery_center', 'Float Therapy', 'Float Tank', 'Experience weightlessness in our sensory deprivation float tanks for deep relaxation and recovery.', 'Sensory deprivation float session.', 'individual', 60, 6500, 1),
('recovery_center', 'Compression', 'Compression Therapy', 'Dynamic pneumatic compression to enhance blood flow and reduce muscle soreness.', 'NormaTec compression boots session.', 'individual', 30, 3000, 1),
('recovery_center', 'Massage', 'Sports Massage', 'Targeted deep tissue massage focused on recovery and performance.', 'Deep tissue sports recovery massage.', 'individual', 60, 7500, 1),
('recovery_center', 'Massage', 'Recovery Massage', 'Gentle recovery-focused massage to promote relaxation and healing.', 'Gentle recovery-focused massage.', 'individual', 45, 6000, 2);

-- ============================================================
-- Yoga Studio templates
-- ============================================================

INSERT INTO service_templates (business_type, category_name, name, description, short_description, booking_type, default_duration, suggested_price, display_order) VALUES
('yoga_studio', 'Group Classes', 'Vinyasa Flow', 'Dynamic flowing yoga linking breath to movement. Suitable for all levels.', 'Dynamic flowing yoga class.', 'group', 60, 1800, 1),
('yoga_studio', 'Group Classes', 'Hatha Yoga', 'Traditional yoga focusing on postures and breathing techniques.', 'Traditional yoga for alignment and breath.', 'group', 75, 1800, 2),
('yoga_studio', 'Group Classes', 'Yin Yoga', 'Slow-paced class holding poses for 3-5 minutes to target deep connective tissues.', 'Slow restorative yoga for flexibility.', 'group', 60, 1800, 3),
('yoga_studio', 'Group Classes', 'Hot Yoga', 'Yoga in a heated room (38°C) for deeper stretching and detoxification.', 'Yoga in a heated room.', 'group', 90, 2200, 4),
('yoga_studio', 'Private Sessions', 'Private Yoga Session', 'One-on-one yoga instruction tailored to your goals and abilities.', 'Personal one-on-one yoga session.', 'individual', 60, 6500, 1),
('yoga_studio', 'Workshops', 'Yoga Workshop', 'Extended workshop exploring a specific yoga topic or technique.', 'In-depth yoga topic exploration.', 'group', 120, 3500, 1);

-- ============================================================
-- Gym/Fitness templates
-- ============================================================

INSERT INTO service_templates (business_type, category_name, name, description, short_description, booking_type, default_duration, suggested_price, display_order) VALUES
('gym_fitness', 'Personal Training', 'Personal Training Session', 'One-on-one training session with a certified personal trainer.', 'Private session with personal trainer.', 'individual', 60, 5500, 1),
('gym_fitness', 'Personal Training', 'Partner Training', 'Train with a partner for motivation and shared cost.', 'Two-person training session.', 'shared', 60, 4000, 2),
('gym_fitness', 'Group Fitness', 'HIIT Class', 'High-intensity interval training for maximum calorie burn.', 'High-intensity group workout.', 'group', 45, 1500, 1),
('gym_fitness', 'Group Fitness', 'Spin Class', 'Indoor cycling class set to motivating music.', 'High-energy indoor cycling.', 'group', 45, 1500, 2),
('gym_fitness', 'Group Fitness', 'Strength & Conditioning', 'Group strength training focusing on functional movements.', 'Functional strength group class.', 'group', 60, 1500, 3),
('gym_fitness', 'Assessments', 'Fitness Assessment', 'Comprehensive fitness evaluation including body composition and movement screening.', 'Full fitness evaluation and report.', 'individual', 60, 4500, 1);

-- ============================================================
-- Spa templates
-- ============================================================

INSERT INTO service_templates (business_type, category_name, name, description, short_description, booking_type, default_duration, suggested_price, display_order) VALUES
('spa', 'Massage', 'Swedish Massage', 'Classic full-body massage using long flowing strokes for relaxation.', 'Classic relaxation massage.', 'individual', 60, 7000, 1),
('spa', 'Massage', 'Deep Tissue Massage', 'Targeted massage using firm pressure to release chronic muscle tension.', 'Deep pressure therapeutic massage.', 'individual', 60, 8000, 2),
('spa', 'Massage', 'Hot Stone Massage', 'Heated basalt stones placed on the body to melt away tension.', 'Heated stone relaxation massage.', 'individual', 75, 9000, 3),
('spa', 'Facials', 'Classic Facial', 'Deep cleansing facial with extraction, mask, and moisturizer.', 'Rejuvenating deep cleanse facial.', 'individual', 60, 6500, 1),
('spa', 'Facials', 'Anti-Aging Facial', 'Premium facial targeting fine lines and skin firmness.', 'Premium anti-aging skin treatment.', 'individual', 75, 9500, 2),
('spa', 'Body Treatments', 'Body Scrub', 'Full-body exfoliation to reveal smooth, glowing skin.', 'Exfoliating body polish treatment.', 'individual', 45, 5500, 1),
('spa', 'Body Treatments', 'Body Wrap', 'Detoxifying body wrap to nourish and hydrate the skin.', 'Hydrating detox body wrap.', 'individual', 60, 7000, 2);

-- ============================================================
-- Physiotherapy templates
-- ============================================================

INSERT INTO service_templates (business_type, category_name, name, description, short_description, booking_type, default_duration, suggested_price, display_order) VALUES
('physiotherapy', 'Consultations', 'Initial Assessment', 'Comprehensive first visit including history, examination, and treatment plan.', 'First visit assessment and treatment plan.', 'individual', 60, 8500, 1),
('physiotherapy', 'Consultations', 'Follow-up Session', 'Progress review and continued treatment based on your plan.', 'Ongoing treatment and progress review.', 'individual', 30, 5500, 2),
('physiotherapy', 'Treatments', 'Manual Therapy', 'Hands-on techniques including mobilization and manipulation.', 'Manual joint and soft tissue therapy.', 'individual', 45, 7000, 1),
('physiotherapy', 'Treatments', 'Dry Needling', 'Trigger point dry needling to release muscle tension and pain.', 'Trigger point release with dry needling.', 'individual', 30, 6000, 2),
('physiotherapy', 'Treatments', 'Electrotherapy', 'Ultrasound or TENS treatment for pain relief and tissue healing.', 'Electrical stimulation therapy.', 'individual', 20, 4000, 3),
('physiotherapy', 'Rehabilitation', 'Exercise Prescription', 'Guided exercise session based on your rehabilitation program.', 'Supervised rehabilitation exercises.', 'individual', 45, 5500, 1);
