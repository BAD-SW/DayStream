# Requirements Document

## Introduction

This document defines the requirements for Phase 24: Query Editor — a SQL Query Editor module for the DayStream platform. The Query Editor enables authorized users to write and execute custom read-only SQL queries against the database. Given the multi-tenant architecture with Row-Level Security (RLS), the module must enforce strict security boundaries ensuring users can only query data within their tenant scope, cannot perform destructive operations, and are subject to resource limits that protect platform stability.

## Goals

- Provide a browser-based SQL editor with syntax highlighting and auto-completion
- Allow authorized roles to run read-only SQL queries scoped to their tenant
- Enforce RLS policies so queries never return cross-tenant data
- Implement query safeguards (statement restrictions, timeouts, row limits)
- Provide query history and saved queries for reuse
- Display results in a tabular format with export capabilities
- Maintain audit trails for all executed queries

## Glossary

- **Query_Editor**: The browser-based module that provides an interface for writing and executing SQL queries
- **Query_Executor**: The backend service that validates, executes, and returns results for SQL queries
- **Saved_Query**: A named SQL query stored by a User for future reuse
- **Query_History**: A chronological record of queries executed by a User
- **Read_Only_Connection**: A database connection configured with SELECT-only privileges and RLS enforcement
- **Statement_Validator**: The component that parses and validates SQL statements before execution
- **Result_Set**: The tabular data returned after successful query execution
- **Query_Timeout**: The maximum time allowed for a single query execution before termination
- **Schema_Browser**: A panel displaying available tables, columns, and data types within the user's access scope

## Requirements

### Requirement 1: Access Control and Authorization

**User Story:** As a platform operator, I want the Query Editor restricted to authorized roles, so that only trusted users can run ad-hoc queries against the database.

#### Acceptance Criteria

1. THE Platform SHALL restrict Query_Editor access to users with the system_admin or tenant_owner role
2. IF a User without the system_admin or tenant_owner role attempts to access the Query_Editor, THEN THE Platform SHALL return HTTP 403 and display a message indicating that the user does not have sufficient permissions to access the Query_Editor
3. THE Platform SHALL enforce the same JWT authentication required by all other Platform endpoints
4. THE Platform SHALL log every Query_Editor access attempt (successful and denied) in the Audit_Log, capturing at minimum the user identifier, tenant identifier, timestamp, action attempted, and outcome (granted or denied)
5. WHERE a Tenant has Query_Editor access disabled via configuration, THE Platform SHALL hide the Query_Editor navigation item and reject API requests for that Tenant with HTTP 403
6. IF a request to the Query_Editor contains a missing, malformed, or expired JWT, THEN THE Platform SHALL return HTTP 401 and display a message indicating that authentication is required

### Requirement 2: SQL Statement Validation

**User Story:** As a platform operator, I want SQL statements validated before execution, so that destructive or unauthorized operations are prevented.

#### Acceptance Criteria

1. THE Statement_Validator SHALL allow only SELECT statements for execution, rejecting any statement whose top-level command is not SELECT (including SELECT INTO and SELECT ... INTO)
2. THE Statement_Validator SHALL reject INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, GRANT, REVOKE, and COPY statements
3. THE Statement_Validator SHALL reject statements containing transaction control commands (BEGIN, COMMIT, ROLLBACK, SAVEPOINT)
4. THE Statement_Validator SHALL reject statements containing writes to system catalog tables (any reference to pg_catalog schema in a modification context or direct manipulation of system tables such as pg_authid, pg_roles, pg_database)
5. THE Statement_Validator SHALL reject statements containing function calls from a configured blocklist of data-modifying or administrative functions (including but not limited to pg_terminate_backend, set_config, lo_import, lo_export, pg_read_file, pg_write_file, dblink_exec)
6. THE Statement_Validator SHALL reject multiple statements separated by semicolons (only single-statement execution allowed)
7. IF a statement fails validation, THEN THE Statement_Validator SHALL return an error response that identifies which validation rule was violated and includes the rejected statement type or pattern
8. THE Statement_Validator SHALL reject statements containing COPY TO or COPY FROM commands
9. THE Statement_Validator SHALL perform validation before any query reaches the database
10. THE Statement_Validator SHALL perform case-insensitive keyword matching during validation so that variations such as "select", "SELECT", and "SeLeCt" are all recognized and evaluated by the same rules
11. THE Statement_Validator SHALL strip or normalize SQL comments (both single-line -- and multi-line /* */) before applying validation rules to prevent obfuscation of disallowed commands
12. THE Statement_Validator SHALL reject any input statement that exceeds 10,000 characters in length

### Requirement 3: Tenant-Scoped Query Execution

**User Story:** As a tenant owner, I want queries automatically scoped to my tenant's data, so that I can safely explore my data without risk of accessing other tenants' information.

#### Acceptance Criteria

1. THE Query_Executor SHALL execute all queries using a Read_Only_Connection with PostgreSQL RLS policies active
2. THE Query_Executor SHALL set the tenant context (app.current_tenant_id) on the database session before executing any query
3. THE Query_Executor SHALL set the user context (app.current_user_id) on the database session before executing any query
4. THE Platform SHALL use a dedicated database role with SELECT-only permissions for Query_Editor connections
5. THE Query_Executor SHALL never bypass RLS policies regardless of query content
6. WHEN a system_admin executes a query without a selected tenant context, THE Query_Executor SHALL abort execution and return an error indicating that a tenant context must be selected
7. WHEN a system_admin executes a query with a selected tenant context, THE Query_Executor SHALL enforce RLS based on that selected tenant context
8. IF the database session fails to set tenant context or user context, THEN THE Query_Executor SHALL abort execution, return an error indicating the context could not be established, and SHALL NOT execute the query

### Requirement 4: Resource Protection and Limits

**User Story:** As a platform operator, I want resource limits on query execution, so that expensive queries do not degrade performance for other users.

#### Acceptance Criteria

1. THE Query_Executor SHALL enforce a configurable Query_Timeout (default 30 seconds) and terminate queries that exceed the limit
2. THE Query_Executor SHALL limit Result_Set size to a configurable maximum row count (default 10,000 rows)
3. THE Query_Executor SHALL limit concurrent query executions per User to 1 (one active query at a time)
4. THE Query_Executor SHALL limit total concurrent Query_Editor connections across the platform to a configurable pool size (default 5)
5. IF a query exceeds the Query_Timeout, THEN THE Query_Executor SHALL terminate the query and return a timeout error with the elapsed time in milliseconds
6. IF a Result_Set exceeds the maximum row count, THEN THE Query_Executor SHALL return the first N rows and include metadata indicating that results were truncated and the total row count if available
7. THE Query_Executor SHALL enforce a configurable maximum query text length (default 10,000 characters)
8. IF a User attempts to execute a query while another query is already running, THEN THE Query_Executor SHALL reject the request with an error indicating that only one concurrent query per user is allowed
9. IF all Query_Editor connections in the pool are in use, THEN THE Query_Executor SHALL reject the request with an error indicating that the system is at capacity and the user should retry later

### Requirement 5: Query Editor User Interface

**User Story:** As a tenant owner, I want a professional code editor for writing SQL, so that I can write queries efficiently with syntax support.

#### Acceptance Criteria

1. THE Query_Editor SHALL provide a text editor with SQL syntax highlighting using a code editor component (e.g., CodeMirror or Monaco)
2. THE Query_Editor SHALL provide auto-completion for SQL keywords (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, LIMIT, HAVING, UNION, DISTINCT, AS, ON, AND, OR, NOT, IN, BETWEEN, LIKE, IS NULL, IS NOT NULL)
3. THE Query_Editor SHALL provide auto-completion for table names and column names accessible to the current user, loaded from the Schema_Browser data
4. THE Query_Editor SHALL provide a keyboard shortcut to execute the current query (Ctrl+Enter on Windows/Linux, Cmd+Enter on macOS)
5. THE Query_Editor SHALL display a loading indicator while a query is executing and disable the execute button
6. WHILE a query is executing, THE Query_Editor SHALL display a cancel button that sends a cancellation request to the backend
7. THE Query_Editor SHALL preserve the editor content across page navigation within the same browser session using session storage
8. THE Query_Editor SHALL support up to 10 editor tabs for working on several queries simultaneously, each with independent content and state

### Requirement 6: Schema Browser

**User Story:** As a tenant owner, I want to browse the available database schema, so that I can understand what tables and columns are available for querying.

#### Acceptance Criteria

1. THE Schema_Browser SHALL display a list of tables accessible to the current user's tenant scope
2. THE Schema_Browser SHALL display columns for each table including column name, data type, and nullable status
3. THE Schema_Browser SHALL support filtering tables and columns by name using case-insensitive partial matching, updating results as the user types
4. WHEN a User clicks a table name in the Schema_Browser, THE Query_Editor SHALL insert the table name at the current cursor position, or append it at the end if the Query_Editor has no active cursor
5. WHEN a User clicks a column name in the Schema_Browser, THE Query_Editor SHALL insert the column name at the current cursor position, or append it at the end if the Query_Editor has no active cursor
6. THE Schema_Browser SHALL exclude system catalog tables and internal platform tables (tables not explicitly created by or for the tenant) from the display
7. WHEN the User triggers a manual refresh, THE Schema_Browser SHALL reload the schema information from the database and update the displayed tables and columns
8. IF the schema information fails to load, THEN THE Schema_Browser SHALL display an error message indicating the failure reason and provide an option to retry
9. IF no tables are available within the tenant scope, THEN THE Schema_Browser SHALL display an empty-state message indicating that no tables are available

### Requirement 7: Result Display

**User Story:** As a tenant owner, I want query results displayed in a clear table, so that I can read and analyze the returned data.

#### Acceptance Criteria

1. THE Query_Editor SHALL display Result_Set data in a tabular format with column headers matching the returned column names
2. WHEN a query completes successfully, THE Query_Editor SHALL display the number of rows returned and the execution time in milliseconds (rounded to the nearest whole millisecond)
3. WHEN a User clicks a column header, THE Query_Editor SHALL sort the displayed rows by that column in ascending order, and clicking the same header again SHALL reverse the sort to descending order (client-side only)
4. THE Query_Editor SHALL support horizontal scrolling for wide Result_Sets
5. THE Query_Editor SHALL support vertical scrolling with fixed column headers for long Result_Sets
6. THE Query_Editor SHALL display NULL values with a distinct visual indicator differentiable from the literal string "NULL"
7. IF a query returns zero rows, THEN THE Query_Editor SHALL display a "No results" message in the results area
8. IF a query returns an error, THEN THE Query_Editor SHALL display the PostgreSQL error message in a dedicated error panel visually distinct from the results table (using a different background color and an error icon)
9. IF results are truncated due to the row limit, THEN THE Query_Editor SHALL display a persistent notice indicating that only the first N rows are shown out of a larger result, where N is the configured maximum row count
10. THE Query_Editor SHALL truncate cell content that exceeds 256 characters and provide a mechanism to view the full cell value on demand

### Requirement 8: Query History

**User Story:** As a tenant owner, I want to see my past queries, so that I can re-run or modify queries I executed previously.

#### Acceptance Criteria

1. THE Platform SHALL store Query_History entries for each executed query including: query text (up to 10,000 characters), execution time in milliseconds, row count, success/failure status, and execution timestamp
2. THE Platform SHALL store Query_History scoped to the individual User (users cannot see other users' history)
3. THE Query_Editor SHALL display a Query_History panel showing the most recent 100 queries sorted by execution timestamp in descending order (newest first)
4. WHEN a User clicks a Query_History entry, THE Query_Editor SHALL replace the current editor content with the selected query text
5. THE Query_Editor SHALL support searching Query_History by case-insensitive substring match against query text content, filtering the displayed list to show only matching entries
6. THE Platform SHALL retain Query_History for 90 days and automatically purge older entries
7. THE Platform SHALL scope Query_History storage within the user's tenant
8. IF the Query_History panel fails to load, THEN THE Platform SHALL display an error message indicating the history is temporarily unavailable and allow the User to retry loading
9. IF a query exceeds 10,000 characters, THEN THE Platform SHALL store only the first 10,000 characters in Query_History and indicate the entry was truncated

### Requirement 9: Saved Queries

**User Story:** As a tenant owner, I want to save frequently used queries with descriptive names, so that I can quickly access them without rewriting.

#### Acceptance Criteria

1. THE Platform SHALL allow users to save the current query with a name (1 to 100 characters, must be unique per user) and an optional description (maximum 500 characters)
2. THE Platform SHALL store Saved_Queries scoped to the individual User
3. THE Query_Editor SHALL display a list of the user's Saved_Queries in a dedicated panel, ordered by last modified date descending
4. WHEN a User selects a Saved_Query, THE Query_Editor SHALL load the query text into the editor, replacing the current editor content
5. THE Platform SHALL allow users to update the name, description, and query text of an existing Saved_Query, subject to the same name uniqueness and length constraints as creation
6. WHEN a User requests deletion of a Saved_Query, THE Platform SHALL prompt for confirmation before permanently removing the Saved_Query
7. IF a User attempts to save a query and the user's Saved_Query count has reached the configured maximum (default 50), THEN THE Platform SHALL reject the save and display an error message indicating the limit has been reached
8. THE Query_Editor SHALL support searching Saved_Queries by name or description using case-insensitive substring matching
9. IF a User attempts to save a query with a name that contains only whitespace, THEN THE Platform SHALL reject the save and display an error message indicating a valid name is required

### Requirement 10: Result Export

**User Story:** As a tenant owner, I want to export query results, so that I can analyze data in external tools or share it with colleagues.

#### Acceptance Criteria

1. THE Query_Editor SHALL support exporting the current Result_Set in CSV format using RFC 4180 conventions (comma delimiter, double-quote enclosure for fields containing commas, quotes, or newlines, UTF-8 encoding)
2. THE Query_Editor SHALL support exporting the current Result_Set in JSON format as a JSON array of objects where each object represents a row with column names as keys
3. THE Query_Editor SHALL include column headers as the first row in CSV exports
4. THE Query_Editor SHALL name exported files using the pattern: `query-results-{YYYY-MM-DD-HHmmss}.{format}`
5. WHEN results are truncated, THE Query_Editor SHALL export only the rows available in the current Result_Set (not re-execute the query)
6. IF no Result_Set is displayed, THEN THE Query_Editor SHALL disable export controls
7. WHEN the user initiates an export, THE Query_Editor SHALL deliver the file as a browser download to the user's default download location
8. IF the Result_Set exceeds 100,000 rows, THEN THE Query_Editor SHALL display an error message indicating the export size limit has been exceeded and not initiate the download
9. THE Query_Editor SHALL represent null values as empty fields in CSV exports and as JSON null in JSON exports

### Requirement 11: Audit Logging for Query Execution

**User Story:** As a platform operator, I want all query executions logged, so that I can audit data access and investigate security incidents.

#### Acceptance Criteria

1. THE Platform SHALL log every query execution in the Audit_Log including: user_id, tenant_id, query text (up to the maximum query text length), execution timestamp, execution duration in milliseconds, row count returned, and a status field indicating success, error, timeout, or cancelled
2. WHEN the Statement_Validator rejects a statement, THE Platform SHALL log the rejection in the Audit_Log including: user_id, tenant_id, the submitted query text, the rejection reason, and the timestamp
3. WHEN a query is cancelled by the user or terminated due to Query_Timeout, THE Platform SHALL log the event in the Audit_Log including: user_id, tenant_id, query text, elapsed time before termination, and whether the cause was user cancellation or timeout
4. THE Platform SHALL not log the actual data in Result_Sets (only metadata such as row count and column count)
5. THE Audit_Log entries for query execution SHALL follow the same tamper-proof format defined in Phase 02 (HMAC signatures and chain integrity)
6. THE Platform SHALL support filtering Audit_Log entries by Query_Editor activity using the following dimensions: tenant_id, user_id, time range, and status (success, error, timeout, cancelled, validation_rejected)
7. IF the Platform fails to write an Audit_Log entry for a query execution, THEN THE Platform SHALL reject the query execution and return an error indicating that the operation could not be audited

---

## Dependencies

- Phase 00: Infrastructure - Database, API server, connection pooling
- Phase 02: Security & Compliance - RBAC, JWT authentication, RLS policies, Audit Logging
- Phase 03: Core Platform - Tenant context, user management
- Phase 04: Design System - UI components (panels, tables, tabs, buttons)

## Success Criteria

- Only system_admin and tenant_owner roles can access the Query Editor
- SQL validation rejects all non-SELECT statements before reaching the database
- Queries execute within RLS boundaries (zero cross-tenant data leakage)
- Queries that exceed timeout are terminated and return a clear error
- The editor provides syntax highlighting and auto-completion
- Schema browser displays only tenant-accessible tables
- Query results display in a sortable, scrollable table
- Query history and saved queries persist across sessions
- All query executions are audit logged
- Export produces valid CSV and JSON files

## Out of Scope

- Write operations (INSERT, UPDATE, DELETE) through the Query Editor - Read-only by design
- Query scheduling or automated recurring queries - Future enhancement
- Visual query builder (drag-and-drop) - Future enhancement
- Query sharing between users - Future enhancement
- Database administration operations - Not appropriate for a SaaS platform
- Cross-tenant queries for system_admin - Each query runs in a single tenant context

## Notes

- The dedicated read-only database role prevents any write operations even if statement validation is bypassed — defense in depth
- RLS enforcement is critical — the database session MUST set tenant context before executing any user-provided query
- Consider using PostgreSQL's `statement_timeout` at the connection level as an additional safeguard
- The query connection pool should be separate from the application's main connection pool to prevent resource contention
- Auto-completion data (table/column names) can be cached per tenant and refreshed on demand
- For system_admin users, a tenant selector should be provided to choose which tenant context to query within
- Consider implementing query plan analysis (EXPLAIN) as a future enhancement for query optimization support
