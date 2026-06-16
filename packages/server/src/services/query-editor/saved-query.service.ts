import { adminPool } from '../../db/pool';

export interface SavedQuery {
  id: string;
  userId: string;
  tenantId: string;
  name: string;
  description?: string;
  queryText: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveQueryInput {
  name: string;
  description?: string;
  queryText: string;
}

export class SavedQueryServiceError extends Error {
  constructor(
    message: string,
    public code: 'DUPLICATE_NAME' | 'SAVE_LIMIT' | 'INVALID_NAME' | 'INVALID_INPUT' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'SavedQueryServiceError';
  }
}

const MAX_SAVED_QUERIES = 50;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_QUERY_TEXT_LENGTH = 10000;

function validateName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new SavedQueryServiceError(
      'A valid name is required. Name cannot be empty or whitespace-only.',
      'INVALID_NAME',
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new SavedQueryServiceError(
      `Name must not exceed ${MAX_NAME_LENGTH} characters.`,
      'INVALID_NAME',
    );
  }
}

function validateDescription(description?: string): void {
  if (description !== undefined && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SavedQueryServiceError(
      `Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`,
      'INVALID_INPUT',
    );
  }
}

function validateQueryText(queryText: string): void {
  if (!queryText || queryText.length === 0) {
    throw new SavedQueryServiceError(
      'Query text is required.',
      'INVALID_INPUT',
    );
  }
  if (queryText.length > MAX_QUERY_TEXT_LENGTH) {
    throw new SavedQueryServiceError(
      `Query text must not exceed ${MAX_QUERY_TEXT_LENGTH} characters.`,
      'INVALID_INPUT',
    );
  }
}

function mapRow(row: any): SavedQuery {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || undefined,
    queryText: row.query_text,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export class SavedQueryService {
  async create(userId: string, tenantId: string, input: SaveQueryInput): Promise<SavedQuery> {
    validateName(input.name);
    validateDescription(input.description);
    validateQueryText(input.queryText);

    // Enforce max count
    const { rows: countRows } = await adminPool.query(
      'SELECT COUNT(*)::int AS count FROM saved_queries WHERE user_id = $1',
      [userId],
    );
    if (countRows[0].count >= MAX_SAVED_QUERIES) {
      throw new SavedQueryServiceError(
        `Maximum saved query limit (${MAX_SAVED_QUERIES}) reached.`,
        'SAVE_LIMIT',
      );
    }

    // Check name uniqueness for this user
    const { rows: existing } = await adminPool.query(
      'SELECT id FROM saved_queries WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [userId, input.name],
    );
    if (existing.length > 0) {
      throw new SavedQueryServiceError(
        'A saved query with this name already exists.',
        'DUPLICATE_NAME',
      );
    }

    const { rows } = await adminPool.query(
      `INSERT INTO saved_queries (tenant_id, user_id, name, description, query_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, userId, input.name, input.description || null, input.queryText],
    );

    return mapRow(rows[0]);
  }

  async update(id: string, userId: string, input: Partial<SaveQueryInput>): Promise<SavedQuery> {
    // Validate provided fields
    if (input.name !== undefined) {
      validateName(input.name);
    }
    if (input.description !== undefined) {
      validateDescription(input.description);
    }
    if (input.queryText !== undefined) {
      validateQueryText(input.queryText);
    }

    // Verify the query exists and belongs to the user
    const existing = await this.getById(id, userId);
    if (!existing) {
      throw new SavedQueryServiceError(
        'Saved query not found.',
        'NOT_FOUND',
      );
    }

    // Check name uniqueness if name is being changed
    if (input.name !== undefined && input.name !== existing.name) {
      const { rows: duplicates } = await adminPool.query(
        'SELECT id FROM saved_queries WHERE user_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
        [userId, input.name, id],
      );
      if (duplicates.length > 0) {
        throw new SavedQueryServiceError(
          'A saved query with this name already exists.',
          'DUPLICATE_NAME',
        );
      }
    }

    // Build update fields
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(input.description || null);
    }
    if (input.queryText !== undefined) {
      fields.push(`query_text = $${paramIndex++}`);
      values.push(input.queryText);
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push('updated_at = NOW()');
    values.push(id);
    values.push(userId);

    const { rows } = await adminPool.query(
      `UPDATE saved_queries SET ${fields.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex} RETURNING *`,
      values,
    );

    return mapRow(rows[0]);
  }

  async delete(id: string, userId: string): Promise<void> {
    const { rowCount } = await adminPool.query(
      'DELETE FROM saved_queries WHERE id = $1 AND user_id = $2',
      [id, userId],
    );

    if (rowCount === 0) {
      throw new SavedQueryServiceError(
        'Saved query not found.',
        'NOT_FOUND',
      );
    }
  }

  async list(userId: string, tenantId: string, options: { search?: string } = {}): Promise<SavedQuery[]> {
    let query = 'SELECT * FROM saved_queries WHERE user_id = $1 AND tenant_id = $2';
    const params: any[] = [userId, tenantId];

    if (options.search && options.search.trim().length > 0) {
      query += ' AND (LOWER(name) LIKE $3 OR LOWER(COALESCE(description, \'\')) LIKE $3)';
      params.push(`%${options.search.toLowerCase()}%`);
    }

    query += ' ORDER BY updated_at DESC';

    const { rows } = await adminPool.query(query, params);
    return rows.map(mapRow);
  }

  async getById(id: string, userId: string): Promise<SavedQuery | null> {
    const { rows } = await adminPool.query(
      'SELECT * FROM saved_queries WHERE id = $1 AND user_id = $2',
      [id, userId],
    );

    if (rows.length === 0) {
      return null;
    }

    return mapRow(rows[0]);
  }
}
