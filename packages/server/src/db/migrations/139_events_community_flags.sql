-- The Events and Community modules are shown only when their feature flag is on
-- (moduleRegistry: feature.events, feature.community), but the flags themselves were never
-- created, so the two modules could not be switched on from Configuration at all.
-- They start off; a system admin turns them on globally or for one tenant.

INSERT INTO sys_feature_flags (key, description, scope, enabled)
VALUES
  ('feature.events', 'Events and workshops', 'tenant', false),
  ('feature.community', 'Community and engagement (feed, challenges, rewards)', 'tenant', false)
ON CONFLICT (key) DO NOTHING;
