import Joi from 'joi';

export interface PaginationParams {
  page: number;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
}

export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().default('created_at'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
});

/**
 * Build SQL LIMIT/OFFSET/ORDER BY clause from pagination params.
 * Returns the clause and the param index to continue from.
 */
export function paginateSQL(
  params: PaginationParams,
  allowedSortColumns: string[],
): { clause: string; offset: number } {
  const sortColumn = allowedSortColumns.includes(params.sort) ? params.sort : 'created_at';
  const offset = (params.page - 1) * params.limit;
  const clause = `ORDER BY ${sortColumn} ${params.order} LIMIT ${params.limit} OFFSET ${offset}`;
  return { clause, offset };
}

/**
 * Build pagination meta for responses.
 */
export function paginationMeta(total: number, params: PaginationParams) {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.ceil(total / params.limit),
  };
}
