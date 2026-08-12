-- Replace rigid Google API types with semantic keyword arrays and exclusion filters

BEGIN;

-- New category mapping table
CREATE TABLE IF NOT EXISTS prp_category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ui_category_name VARCHAR(100) NOT NULL,
  google_search_strings TEXT[] NOT NULL DEFAULT '{}',
  api_exclusion_types VARCHAR(50)[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed wellness/recovery verticals
INSERT INTO prp_category_mappings (ui_category_name, google_search_strings, api_exclusion_types, display_order) VALUES
('Spas & Recovery Centers', ARRAY['Day spa', 'Medical spa', 'Float spa', 'Cryotherapy center', 'Infrared sauna', 'Wellness center', 'Sports recovery'], ARRAY['hospital', 'doctor', 'car_wash'], 1),
('Massage Therapy', ARRAY['Massage therapist', 'Massage spa', 'Thai massage', 'Sports massage', 'Deep tissue massage'], ARRAY['hospital', 'bus_station', 'travel_agency'], 2),
('Yoga & Pilates', ARRAY['Yoga studio', 'Pilates studio', 'Hot yoga', 'Bikram yoga'], ARRAY['gym', 'shopping_mall'], 3),
('Fitness & Gyms', ARRAY['Gym', 'Fitness center', 'CrossFit gym', 'Personal trainer', 'Boxing gym'], ARRAY['hospital', 'school'], 4),
('Beauty & Hair', ARRAY['Beauty salon', 'Hair salon', 'Nail salon', 'Barber shop', 'Hair extensions'], ARRAY['clothing_store', 'department_store'], 5),
('Physiotherapy & Rehab', ARRAY['Physiotherapist', 'Physical therapy', 'Chiropractor', 'Osteopath', 'Sports medicine'], ARRAY['hospital', 'pharmacy'], 6)
ON CONFLICT DO NOTHING;

COMMIT;
