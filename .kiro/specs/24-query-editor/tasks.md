# Implementation Plan: Query Editor

## Overview

This plan implements a browser-based SQL Query Editor for DayStream. The approach starts with shared types and database schema, builds out the backend services (statement validation, query execution, history, saved queries, schema browsing, audit logging), then the frontend components (CodeMirror editor, results panel, schema browser, history, saved queries, export), and finally wires everything together with routing and integration.

## Tasks

- [x] 1. Set up shared types and database schema
  - [x] 1.1 Create shared TypeScript interfaces for Query Editor
    - Create `packages/shared/src/types/query-editor.ts` with all DTOs: `QueryExecuteRequest`, `QueryExecuteResponse`, `SchemaTable`, `ColumnInfo`, `SavedQueryDTO`, `QueryHistoryDTO`, and related types
    - Export from shared package index
    - _Requirements: All (shared contract)_

  - [x] 1.2 Create database migration for query_history and saved_queries tables
    - Create migration file with `query_history` table (id, tenant_id, user_id, query_text, execution_time_ms, row_count, status, error_message, truncated, created_at)
    - Create migration file with `saved_queries` table (id, tenant_id, user_id, name, description, query_text, created_at, updated_at) with UNIQUE(user_id, name) constraint
    - Enable RLS on both tables with tenant and user isolation policies
    - Create indexes for user lookups and auto-purge
    - _Requirements: 8.1, 8.2, 8.7, 9.1, 9.2_

  - [x] 1.3 Create database migration for read-only role and query pool configuration
    - Create `daystream_query_reader` role with SELECT-only privileges on public schema
    - Grant CONNECT, USAGE, and SELECT permissions
    - Set default privileges for future tables
    - _Requirements: 3.4_

- [x] 2. Implement Statement Validator
  - [x] 2.1 Implement the StatementValidator service
    - Create `packages/server/src/services/query-editor/statement-validator.ts`
    - Implement validation pipeline: length check → comment stripping → multi-statement check → normalize → command check (SELECT only, reject SELECT INTO) → blocked keywords → blocked functions → system catalog write detection
    - Return structured `ValidationResult` with `violatedRule` field
    - Case-insensitive matching throughout
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [ ]* 2.2 Write property tests for StatementValidator — SELECT-only validation
    - **Property 2: SELECT-only validation**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.8**
    - Generate random valid SELECT statements → expect valid=true
    - Generate statements with blocked top-level commands → expect valid=false

  - [ ]* 2.3 Write property tests for StatementValidator — blocked function rejection
    - **Property 3: Blocked function rejection**
    - **Validates: Requirements 2.5**
    - Generate SELECT statements containing calls to blocklisted functions → expect valid=false with blocked function identified

  - [ ]* 2.4 Write property tests for StatementValidator — multi-statement rejection
    - **Property 4: Multi-statement rejection**
    - **Validates: Requirements 2.6**
    - Generate inputs with multiple semicolon-separated statements → expect valid=false

  - [ ]* 2.5 Write property tests for StatementValidator — obfuscation resistance
    - **Property 5: Obfuscation resistance**
    - **Validates: Requirements 2.10, 2.11**
    - Generate blocked statements with random comment insertion and case variation → expect same rejection verdict

  - [ ]* 2.6 Write property tests for StatementValidator — length validation
    - **Property 6: Query length validation**
    - **Validates: Requirements 2.12, 4.7**
    - Generate strings exceeding 10,000 chars → expect valid=false with LENGTH_EXCEEDED

  - [ ]* 2.7 Write property tests for StatementValidator — error identification
    - **Property 7: Validation error identification**
    - **Validates: Requirements 2.7**
    - For any rejected statement, verify error contains non-empty violatedRule

- [x] 3. Checkpoint - Ensure statement validator tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Query Executor
  - [x] 4.1 Create the dedicated query connection pool
    - Create `packages/server/src/services/query-editor/query-pool.ts`
    - Configure a separate pg Pool using the `daystream_query_reader` role
    - Set pool max size to configurable value (default 5)
    - _Requirements: 3.4, 4.4_

  - [x] 4.2 Implement the QueryExecutor service
    - Create `packages/server/src/services/query-editor/query-executor.ts`
    - Implement execution flow: acquire connection → check user concurrency → SET LOCAL statement_timeout → SET LOCAL app.current_tenant_id → SET LOCAL app.current_user_id → execute with LIMIT wrapper → detect truncation → record metrics → release connection
    - Implement cancellation via `pg_cancel_backend`
    - Track active queries per user for concurrency enforcement
    - Return structured `QueryExecutionResult`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9_

  - [ ]* 4.3 Write unit tests for QueryExecutor
    - Test concurrency rejection (user already has active query)
    - Test pool exhaustion handling
    - Test timeout configuration
    - Test tenant context setup failure handling
    - _Requirements: 4.3, 4.4, 4.8, 4.9, 3.8_

- [x] 5. Implement Query History and Saved Query services
  - [x] 5.1 Implement QueryHistoryService
    - Create `packages/server/src/services/query-editor/query-history.service.ts`
    - Implement `record()`: store entry with truncation at 10,000 chars
    - Implement `list()`: return most recent 100 entries for user, support search by case-insensitive substring
    - Implement `purgeOlderThan()`: delete entries older than N days (default 90)
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 8.9_

  - [x] 5.2 Implement SavedQueryService
    - Create `packages/server/src/services/query-editor/saved-query.service.ts`
    - Implement `create()`: validate name (1-100 chars, not whitespace-only, unique per user), description (≤500 chars), query text (≤10,000 chars), enforce max count (50)
    - Implement `update()`: same validation, enforce name uniqueness
    - Implement `delete()`: remove by id and userId
    - Implement `list()`: ordered by updated_at DESC, support search by name/description
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [ ]* 5.3 Write property tests for saved query input validation
    - **Property 17: Saved query input validation**
    - **Validates: Requirements 9.1, 9.5, 9.9**
    - Generate valid names (1-100 chars, not whitespace-only) → expect accepted
    - Generate invalid names (empty, >100 chars, whitespace-only) → expect rejected

  - [ ]* 5.4 Write unit tests for QueryHistoryService
    - Test history storage with truncation for long queries (Property 16)
    - Test list returns only user's entries (Property 15)
    - Test search filtering
    - Test purge by age
    - **Property 16: History storage truncation**
    - **Validates: Requirements 8.9**

- [x] 6. Implement Schema and Audit services
  - [x] 6.1 Implement SchemaService
    - Create `packages/server/src/services/query-editor/schema.service.ts`
    - Query `information_schema.tables` and `information_schema.columns` filtered to public schema
    - Exclude system/internal tables via configurable exclusion list
    - Return `TableInfo[]` with column details
    - _Requirements: 6.1, 6.2, 6.6_

  - [x] 6.2 Integrate audit logging for query execution
    - Extend existing AuditService to handle query editor events
    - Log execution events: user_id, tenant_id, query text, duration, row count, status
    - Log validation rejections: user_id, tenant_id, submitted query, rejection reason
    - Log access attempts (granted/denied)
    - Log cancellations/timeouts with elapsed time
    - Ensure no result data is stored (only metadata)
    - Implement fail-closed: reject query if audit write fails
    - _Requirements: 1.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 6.3 Write unit tests for audit logging
    - **Property 21: Audit entry completeness**
    - **Property 22: Audit privacy — no result data**
    - **Validates: Requirements 1.4, 11.1, 11.2, 11.4**
    - Verify audit entries contain all required fields
    - Verify no row data appears in audit entries

- [x] 7. Implement backend API routes
  - [x] 7.1 Create Query Editor routes with middleware chain
    - Create `packages/server/src/routes/query-editor.ts`
    - Implement POST `/api/query-editor/execute` — validate statement, execute query, record history, audit log
    - Implement POST `/api/query-editor/cancel` — cancel running query
    - Implement GET `/api/query-editor/schema` — return schema info
    - Implement GET `/api/query-editor/history` — list with search param
    - Implement CRUD routes for `/api/query-editor/saved`
    - Apply middleware chain: authenticate → roleCheck(['system_admin', 'tenant_owner']) → featureFlagCheck('query_editor_enabled')
    - Handle all error scenarios with proper HTTP status codes
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 7.2 Register routes in Express app
    - Add query editor routes to the main Express router
    - Add feature flag configuration for `query_editor_enabled`
    - _Requirements: 1.5_

  - [ ]* 7.3 Write unit tests for route authorization and feature flag
    - Test 403 for unauthorized roles
    - Test 401 for missing/invalid JWT
    - Test 403 for disabled feature flag
    - **Property 1: Role-based access control**
    - **Validates: Requirements 1.1, 1.2**

- [x] 8. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement frontend utility functions
  - [x] 9.1 Implement filter utility for case-insensitive substring matching
    - Create `packages/client/src/components/query-editor/utils/filter.ts`
    - Implement generic filter function usable for tables, history, and saved queries
    - _Requirements: 6.3, 8.5, 9.8_

  - [ ]* 9.2 Write property tests for filter utility
    - **Property 11: Case-insensitive substring filtering**
    - **Validates: Requirements 6.3, 8.5, 9.8**
    - For any list and search string, verify correct inclusion/exclusion

  - [x] 9.3 Implement cursor-position insertion utility
    - Create `packages/client/src/components/query-editor/utils/cursor-insertion.ts`
    - Insert identifier at specified cursor position, fallback to end of content
    - _Requirements: 6.4, 6.5_

  - [ ]* 9.4 Write property tests for cursor insertion
    - **Property 12: Cursor-position insertion**
    - **Validates: Requirements 6.4, 6.5**
    - For any content, cursor position, and identifier, verify correct insertion

  - [x] 9.5 Implement column sort utility
    - Create `packages/client/src/components/query-editor/utils/column-sort.ts`
    - Client-side sort with ascending/descending toggle per column
    - _Requirements: 7.3_

  - [ ]* 9.6 Write property tests for column sort
    - **Property 13: Client-side column sort**
    - **Validates: Requirements 7.3**
    - For any result set and column, verify ascending/descending order

  - [x] 9.7 Implement cell truncation utility
    - Create `packages/client/src/components/query-editor/utils/cell-truncation.ts`
    - Truncate at 256 characters with indicator for long values
    - _Requirements: 7.10_

  - [ ]* 9.8 Write property tests for cell truncation
    - **Property 14: Cell content truncation**
    - **Validates: Requirements 7.10**
    - For any string, verify truncation behavior at 256 char boundary

- [x] 10. Implement export utilities
  - [x] 10.1 Implement CSV export function
    - Create `packages/client/src/components/query-editor/utils/csv-export.ts`
    - RFC 4180 compliant: comma delimiter, double-quote enclosure, UTF-8
    - Column headers as first row, null as empty field
    - File naming: `query-results-{YYYY-MM-DD-HHmmss}.csv`
    - _Requirements: 10.1, 10.3, 10.4, 10.9_

  - [ ]* 10.2 Write property tests for CSV export
    - **Property 19: CSV export correctness**
    - **Validates: Requirements 10.1, 10.3, 10.9**
    - For any result set, verify RFC 4180 conformance and round-trip integrity

  - [x] 10.3 Implement JSON export function
    - Create `packages/client/src/components/query-editor/utils/json-export.ts`
    - JSON array of objects with column names as keys, null as JSON null
    - File naming: `query-results-{YYYY-MM-DD-HHmmss}.json`
    - _Requirements: 10.2, 10.4, 10.9_

  - [ ]* 10.4 Write property tests for JSON export
    - **Property 20: JSON export correctness**
    - **Validates: Requirements 10.2, 10.9**
    - For any result set, verify valid JSON array and round-trip integrity

- [x] 11. Checkpoint - Ensure all utility and export tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement frontend components
  - [x] 12.1 Implement CodeEditor component with CodeMirror
    - Create `packages/client/src/components/query-editor/CodeEditor.tsx`
    - Install and configure CodeMirror 6 with SQL language mode
    - Implement SQL keyword auto-completion
    - Implement table/column auto-completion from schema data
    - Implement Ctrl+Enter / Cmd+Enter keyboard shortcut for execution
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 12.2 Implement EditorTabs component
    - Create `packages/client/src/components/query-editor/EditorTabs.tsx`
    - Support up to 10 tabs with independent content and state
    - Persist tab content to sessionStorage
    - Handle tab creation, switching, and closing
    - _Requirements: 5.7, 5.8_

  - [x] 12.3 Implement ResultsPanel component
    - Create `packages/client/src/components/query-editor/ResultsPanel.tsx`
    - Tabular display with column headers, sortable columns, fixed headers
    - Horizontal and vertical scrolling
    - NULL value display with distinct visual indicator
    - Empty state, error state (colored panel with icon), truncation notice
    - Row count and execution time display
    - Cell truncation with expand mechanism
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 12.4 Implement SchemaPanel component
    - Create `packages/client/src/components/query-editor/SchemaPanel.tsx`
    - Tree view of tables and columns with data type and nullable info
    - Search/filter with case-insensitive partial matching
    - Click-to-insert for table and column names
    - Manual refresh button, error state, empty state
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9_

  - [x] 12.5 Implement HistoryPanel component
    - Create `packages/client/src/components/query-editor/HistoryPanel.tsx`
    - Display recent 100 queries sorted newest first
    - Click to load query into editor
    - Search by substring
    - Error state with retry
    - _Requirements: 8.3, 8.4, 8.5, 8.8_

  - [x] 12.6 Implement SavedQueriesPanel component
    - Create `packages/client/src/components/query-editor/SavedQueriesPanel.tsx`
    - List saved queries ordered by last modified
    - Click to load into editor
    - Save dialog with name and description inputs
    - Edit and delete with confirmation
    - Search by name/description
    - Error display for limit reached, duplicate names
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

  - [x] 12.7 Implement ExportControls component
    - Create `packages/client/src/components/query-editor/ExportControls.tsx`
    - CSV and JSON export buttons
    - Disabled when no result set
    - Error message for result sets exceeding 100,000 rows
    - Trigger browser download
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 10.8_

- [x] 13. Implement QueryEditorPage and wire together
  - [x] 13.1 Implement QueryEditorPage
    - Create `packages/client/src/pages/QueryEditorPage.tsx`
    - Orchestrate layout: editor tabs, schema panel, results panel, history/saved panels
    - Implement execute flow: validate → show loading → call API → display results
    - Implement cancel button during execution
    - Manage state: active query, results, loading, errors
    - Tenant selector for system_admin users
    - _Requirements: 5.5, 5.6_

  - [x] 13.2 Add routing and navigation
    - Add `/query-editor` route to the React router
    - Add navigation item (conditionally hidden based on role and feature flag)
    - _Requirements: 1.1, 1.5_

  - [ ]* 13.3 Write unit tests for QueryEditorPage
    - Test loading state display
    - Test error state display
    - Test execute button disabled during query
    - Test cancel button visibility
    - _Requirements: 5.5, 5.6_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- CodeMirror 6 needs to be installed as a dependency (`@codemirror/lang-sql`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state`)
- The dedicated query pool uses the `daystream_query_reader` role — connection string must be configured separately
- Integration tests for RLS (Property 8) and timeout (Property 9) require a running PostgreSQL instance and are not included as tasks (test in CI/staging)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "5.2", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "4.2", "5.3", "5.4", "6.2"] },
    { "id": 3, "tasks": ["4.3", "6.3", "7.1", "9.1", "9.3", "9.5", "9.7"] },
    { "id": 4, "tasks": ["7.2", "7.3", "9.2", "9.4", "9.6", "9.8", "10.1", "10.3"] },
    { "id": 5, "tasks": ["10.2", "10.4", "12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7"] },
    { "id": 6, "tasks": ["13.1", "13.2"] },
    { "id": 7, "tasks": ["13.3"] }
  ]
}
```
