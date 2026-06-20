-- Remove FK constraints from api_request_logs that prevent logging
-- when user/tenant IDs are not valid references (e.g. system admin, unauthenticated)
ALTER TABLE api_request_logs DROP CONSTRAINT IF EXISTS api_request_logs_tenant_id_fkey;
ALTER TABLE api_request_logs DROP CONSTRAINT IF EXISTS api_request_logs_user_id_fkey;
