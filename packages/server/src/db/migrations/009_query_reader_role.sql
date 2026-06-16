-- Phase 24: Query Editor - Read-only role for Query Editor connections
-- Defense-in-depth: even if statement validation is bypassed, this role cannot perform any write operations.

-- Create read-only role for Query Editor connections
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'daystream_query_reader') THEN
    CREATE ROLE daystream_query_reader WITH LOGIN PASSWORD 'daystream_query_reader_dev';
  END IF;
END $$;

-- Grant minimal permissions
GRANT CONNECT ON DATABASE daystream_dev TO daystream_query_reader;
GRANT USAGE ON SCHEMA public TO daystream_query_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO daystream_query_reader;

-- Ensure future tables are also readable
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO daystream_query_reader;
