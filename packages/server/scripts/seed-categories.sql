INSERT INTO prp_category_mappings (ui_category_name, google_search_strings, api_exclusion_types, display_order) VALUES
('Spas & Recovery Centers', ARRAY['Day spa', 'Medical spa', 'Float spa', 'Cryotherapy center', 'Infrared sauna', 'Wellness center', 'Sports recovery'], ARRAY['hospital', 'doctor', 'car_wash'], 1),
('Massage Therapy', ARRAY['Massage therapist', 'Massage spa', 'Thai massage', 'Sports massage', 'Deep tissue massage'], ARRAY['hospital', 'bus_station', 'travel_agency'], 2),
('Yoga & Pilates', ARRAY['Yoga studio', 'Pilates studio', 'Hot yoga', 'Bikram yoga'], ARRAY['gym', 'shopping_mall'], 3),
('Fitness & Gyms', ARRAY['Gym', 'Fitness center', 'CrossFit gym', 'Personal trainer', 'Boxing gym'], ARRAY['hospital', 'school'], 4),
('Beauty & Hair', ARRAY['Beauty salon', 'Hair salon', 'Nail salon', 'Barber shop', 'Hair extensions'], ARRAY['clothing_store', 'department_store'], 5),
('Physiotherapy & Rehab', ARRAY['Physiotherapist', 'Physical therapy', 'Chiropractor', 'Osteopath', 'Sports medicine'], ARRAY['hospital', 'pharmacy'], 6)
ON CONFLICT DO NOTHING;
