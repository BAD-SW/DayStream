export interface ConfigDefinition {
  id: string;
  key: string;
  category: string;
  data_type: 'string' | 'number' | 'boolean' | 'json';
  default_value: string;
  description: string | null;
  validation_schema: unknown | null;
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  scope: 'global' | 'tenant' | 'role' | 'percentage';
  enabled: boolean;
  percentage: number | null;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
