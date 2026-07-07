import { queryPool } from './query-pool';

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

export interface TableInfo {
  tableName: string;
  columns: ColumnInfo[];
}

/**
 * Default list of internal/platform tables excluded from the schema browser.
 * These tables are not relevant to tenant users and should not be exposed.
 */
const DEFAULT_EXCLUDED_TABLES: string[] = [
  'migrations',
  'usr_audit_log',
  'usr_login_attempts',
  'usr_refresh_tokens',
  'usr_password_history',
  'sys_query_history',
];

/**
 * Prefixes for system tables that should always be excluded.
 */
const SYSTEM_TABLE_PREFIXES: string[] = ['pg_'];

/**
 * Schemas that should always be excluded from results.
 */
const EXCLUDED_SCHEMAS: string[] = ['information_schema', 'pg_catalog'];

export interface SchemaServiceConfig {
  excludedTables?: string[];
}

export class SchemaService {
  private excludedTables: string[];

  constructor(config?: SchemaServiceConfig) {
    this.excludedTables = config?.excludedTables ?? DEFAULT_EXCLUDED_TABLES;
  }

  /**
   * Retrieves all user-facing tables and their columns for the public schema.
   * Excludes system catalog tables, internal platform tables, and tables
   * matching configured exclusion patterns.
   */
  async getTables(tenantId: string): Promise<TableInfo[]> {
    const client = await queryPool.connect();
    try {
      // Note: SET LOCAL doesn't support parameterized queries for custom GUCs
      // Schema queries use information_schema which doesn't need RLS context
      // We just query the public schema tables directly

      // Query tables from public schema, excluding internal tables
      const tablesResult = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );

      // Filter out excluded tables
      const visibleTables = tablesResult.rows
        .map((row) => row.table_name)
        .filter((name) => !this.isExcluded(name));

      if (visibleTables.length === 0) {
        return [];
      }

      // Query columns for visible tables
      const columnsResult = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1)
         ORDER BY table_name, ordinal_position`,
        [visibleTables],
      );

      // Group columns by table
      const tableMap = new Map<string, ColumnInfo[]>();
      for (const tableName of visibleTables) {
        tableMap.set(tableName, []);
      }

      for (const row of columnsResult.rows) {
        const columns = tableMap.get(row.table_name);
        if (columns) {
          columns.push({
            columnName: row.column_name,
            dataType: row.data_type,
            isNullable: row.is_nullable === 'YES',
          });
        }
      }

      // Build result array
      const tables: TableInfo[] = [];
      for (const [tableName, columns] of tableMap) {
        tables.push({ tableName, columns });
      }

      return tables;
    } finally {
      client.release();
    }
  }

  /**
   * Determines if a table name should be excluded from the schema browser.
   */
  private isExcluded(tableName: string): boolean {
    // Check system table prefixes
    for (const prefix of SYSTEM_TABLE_PREFIXES) {
      if (tableName.startsWith(prefix)) {
        return true;
      }
    }

    // Check configurable exclusion list
    return this.excludedTables.includes(tableName);
  }
}
