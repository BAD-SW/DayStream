export interface QueryExecuteRequest {
  sql: string;
  tenantId?: string; // Required for system_admin if not in JWT
}

export interface QueryExecuteResponse {
  columns: { name: string; dataType: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  totalRowCount?: number;
  executionTimeMs: number;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  error?: string;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

export interface SchemaTable {
  tableName: string;
  columns: ColumnInfo[];
}

export interface SavedQueryDTO {
  id: string;
  name: string;
  description?: string;
  queryText: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueryHistoryDTO {
  id: string;
  queryText: string;
  executionTimeMs: number;
  rowCount: number;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  createdAt: string;
}
