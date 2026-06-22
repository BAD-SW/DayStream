-- Allow the query reader role to bypass RLS so system admins can query all data
-- This is safe because the query editor only allows SELECT and is restricted to system admins
ALTER ROLE daystream_query_reader BYPASSRLS;
