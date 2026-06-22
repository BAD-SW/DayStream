import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { isFeatureEnabled } from '../services/feature-flag.service';
import { validateStatement, DEFAULT_CONFIG } from '../services/query-editor/statement-validator';
import { QueryExecutor } from '../services/query-editor/query-executor';
import { QueryAuditService } from '../services/query-editor/query-audit.service';
import { QueryHistoryService } from '../services/query-editor/query-history.service';
import { SavedQueryService, SavedQueryServiceError } from '../services/query-editor/saved-query.service';
import { SchemaService } from '../services/query-editor/schema.service';
import { success, error } from '../utils/response';
import { logger } from '../middleware/logger';

export const queryEditorRouter = Router();

// Service instances
const queryExecutor = new QueryExecutor();
const queryAuditService = new QueryAuditService();
const queryHistoryService = new QueryHistoryService();
const savedQueryService = new SavedQueryService();
const schemaService = new SchemaService();

// --- Middleware ---

/**
 * Role check middleware: restricts access to users with *:* permission (super admins)
 * or specific allowed roles.
 */
function roleCheck(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      error(res, 'Insufficient permissions to access Query Editor', 'FORBIDDEN', 403);
      return;
    }
    // Allow if user has wildcard permission
    if (authReq.user.permissions?.includes('*:*')) {
      next();
      return;
    }
    // Allow if role matches
    if (allowedRoles.includes(authReq.user.role)) {
      next();
      return;
    }
    error(res, 'Insufficient permissions to access Query Editor', 'FORBIDDEN', 403);
  };
}

/**
 * Feature flag check middleware: ensures the query_editor_enabled flag is active
 * for the requesting tenant. Super admins (with *:* permission) bypass this check.
 */
function featureFlagCheck(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
      // Super admins bypass feature flag checks
      if (authReq.user.permissions?.includes('*:*')) {
        next();
        return;
      }
      const enabled = await isFeatureEnabled(flagKey, { tenantId: authReq.tenantId });
      if (!enabled) {
        error(res, 'Query Editor is not enabled for your organization', 'FEATURE_DISABLED', 403);
        return;
      }
      next();
    } catch (err: any) {
      logger.error('Feature flag check failed', { error: err.message });
      error(res, 'Query Editor is not enabled for your organization', 'FEATURE_DISABLED', 403);
    }
  };
}

// Apply middleware chain to all routes: authenticate → roleCheck → featureFlagCheck
queryEditorRouter.use(
  authenticate,
  roleCheck(['Super Admin', 'system_admin', 'system_support', 'tenant_owner']),
  featureFlagCheck('query_editor_enabled'),
);

// --- Routes ---

/**
 * POST /execute — Execute a SQL query
 *
 * Flow:
 * 1. Validate the statement using StatementValidator
 * 2. If invalid, log the rejection via QueryAuditService and return 400
 * 3. Log the audit entry for execution attempt
 * 4. Execute via QueryExecutor
 * 5. Record in QueryHistory
 * 6. Return the result
 */
queryEditorRouter.post('/execute', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { sql } = req.body;

  if (!sql || typeof sql !== 'string') {
    error(res, 'SQL query text is required', 'VALIDATION_FAILED', 400);
    return;
  }

  const userId = authReq.user.sub;
  const tenantId = authReq.tenantId;

  // System admins must have a tenant context
  if (!tenantId) {
    error(res, 'A tenant context must be selected before executing queries', 'MISSING_CONTEXT', 400);
    return;
  }

  // Step 1: Validate the statement
  const validation = validateStatement(sql, DEFAULT_CONFIG);

  if (!validation.valid) {
    // Step 2: Log validation rejection and return 400
    try {
      await queryAuditService.logValidationRejection({
        userId,
        tenantId,
        action: 'query_validate_reject',
        queryText: sql,
        rejectionReason: validation.error?.message,
        metadata: {
          violatedRule: validation.error?.violatedRule,
          queryLength: sql.length,
        },
      });
    } catch (auditErr: any) {
      logger.error('Audit logging failed during validation rejection', { error: auditErr.message });
      error(res, 'Unable to process query at this time. Please try again.', 'AUDIT_FAILED', 500);
      return;
    }

    // Determine the appropriate error code
    const errorCode = validation.error?.code === 'LENGTH_EXCEEDED' ? 'QUERY_TOO_LONG' : 'VALIDATION_FAILED';
    const message = validation.error?.code === 'LENGTH_EXCEEDED'
      ? 'Query exceeds maximum length of 10,000 characters'
      : `Query rejected: ${validation.error?.message}`;

    error(res, message, errorCode, 400);
    return;
  }

  // Step 3: Log audit entry for execution attempt (fail-closed)
  try {
    await queryAuditService.logExecution({
      userId,
      tenantId,
      action: 'query_execute',
      queryText: sql,
      status: 'attempting',
      metadata: { queryLength: sql.length },
    });
  } catch (auditErr: any) {
    logger.error('Audit logging failed before execution', { error: auditErr.message });
    error(res, 'Unable to process query at this time. Please try again.', 'AUDIT_FAILED', 500);
    return;
  }

  // Step 4: Execute via QueryExecutor
  const result = await queryExecutor.execute({
    sql,
    tenantId,
    userId,
  });

  // Step 5: Record in QueryHistory (best-effort, don't block response)
  try {
    await queryHistoryService.record({
      userId,
      tenantId,
      queryText: sql,
      executionTimeMs: result.executionTimeMs,
      rowCount: result.rowCount,
      status: result.status,
    });
  } catch (historyErr: any) {
    logger.error('Failed to record query history', { error: historyErr.message });
  }

  // Handle error statuses with appropriate HTTP codes
  if (result.status === 'timeout') {
    error(
      res,
      `Query exceeded the ${Math.round((result.executionTimeMs || 30000) / 1000)}s time limit and was terminated`,
      'QUERY_TIMEOUT',
      408,
    );
    return;
  }

  if (result.status === 'error' && result.error) {
    if (result.error.includes('CONCURRENT_LIMIT')) {
      error(res, 'You already have a query running. Wait for it to complete or cancel it.', 'CONCURRENT_LIMIT', 429);
      return;
    }
    if (result.error.includes('CAPACITY_REACHED')) {
      error(res, 'System is at capacity. Please retry in a moment.', 'CAPACITY_REACHED', 503);
      return;
    }
    if (result.error.includes('context')) {
      error(res, 'Unable to establish database context. Please try again.', 'CONTEXT_FAILED', 500);
      return;
    }
    // Generic query error — return sanitized message
    error(res, result.error, 'VALIDATION_FAILED', 400);
    return;
  }

  // Step 6: Return the result
  success(res, {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    truncated: result.truncated,
    totalRowCount: result.totalRowCount,
    executionTimeMs: result.executionTimeMs,
    status: result.status,
  });
});

/**
 * POST /cancel — Cancel a running query
 */
queryEditorRouter.post('/cancel', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const tenantId = authReq.tenantId;

  const cancelled = await queryExecutor.cancel(userId);

  if (cancelled) {
    // Log cancellation audit event (best-effort)
    try {
      await queryAuditService.logCancellation({
        userId,
        tenantId,
        action: 'query_cancel',
        metadata: { cause: 'user_cancellation' },
      });
    } catch (auditErr: any) {
      logger.error('Failed to audit query cancellation', { error: auditErr.message });
    }
  }

  success(res, { cancelled });
});

/**
 * GET /schema — Get schema information (tables and columns)
 */
queryEditorRouter.get('/schema', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const tenantId = authReq.tenantId;

  if (!tenantId) {
    error(res, 'A tenant context must be selected before viewing schema', 'MISSING_CONTEXT', 400);
    return;
  }

  try {
    const tables = await schemaService.getTables(tenantId);
    success(res, { tables });
  } catch (err: any) {
    logger.error('Schema load failed', { error: err.message, tenantId });
    error(res, 'Unable to load schema information', 'SCHEMA_ERROR', 500);
  }
});

/**
 * GET /history — List query history with optional search
 */
queryEditorRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const tenantId = authReq.tenantId;
  const search = req.query.search as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  try {
    const entries = await queryHistoryService.list(userId, tenantId, { search, limit });
    success(res, { entries });
  } catch (err: any) {
    logger.error('History load failed', { error: err.message, userId });
    error(res, 'Query history is temporarily unavailable', 'HISTORY_ERROR', 500);
  }
});

/**
 * GET /saved — List saved queries with optional search
 */
queryEditorRouter.get('/saved', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const tenantId = authReq.tenantId;
  const search = req.query.search as string | undefined;

  try {
    const queries = await savedQueryService.list(userId, tenantId, { search });
    success(res, { queries });
  } catch (err: any) {
    logger.error('Failed to list saved queries', { error: err.message, userId });
    error(res, 'Unable to load saved queries', 'INTERNAL_ERROR', 500);
  }
});

/**
 * POST /saved — Save a new query
 */
queryEditorRouter.post('/saved', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const tenantId = authReq.tenantId;
  const { name, description, queryText } = req.body;

  if (!name || !queryText) {
    error(res, 'Name and query text are required', 'VALIDATION_FAILED', 400);
    return;
  }

  try {
    const saved = await savedQueryService.create(userId, tenantId, { name, description, queryText });
    success(res, saved, undefined, 201);
  } catch (err: any) {
    if (err instanceof SavedQueryServiceError) {
      switch (err.code) {
        case 'DUPLICATE_NAME':
          error(res, err.message, 'DUPLICATE_NAME', 409);
          return;
        case 'SAVE_LIMIT':
          error(res, err.message, 'SAVE_LIMIT', 400);
          return;
        case 'INVALID_NAME':
        case 'INVALID_INPUT':
          error(res, err.message, 'VALIDATION_FAILED', 400);
          return;
      }
    }
    logger.error('Failed to save query', { error: err.message, userId });
    error(res, 'Failed to save query', 'INTERNAL_ERROR', 500);
  }
});

/**
 * PUT /saved/:id — Update a saved query
 */
queryEditorRouter.put('/saved/:id', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const { id } = req.params;
  const { name, description, queryText } = req.body;

  try {
    const updated = await savedQueryService.update(id, userId, { name, description, queryText });
    success(res, updated);
  } catch (err: any) {
    if (err instanceof SavedQueryServiceError) {
      switch (err.code) {
        case 'NOT_FOUND':
          error(res, err.message, 'NOT_FOUND', 404);
          return;
        case 'DUPLICATE_NAME':
          error(res, err.message, 'DUPLICATE_NAME', 409);
          return;
        case 'INVALID_NAME':
        case 'INVALID_INPUT':
          error(res, err.message, 'VALIDATION_FAILED', 400);
          return;
      }
    }
    logger.error('Failed to update saved query', { error: err.message, userId });
    error(res, 'Failed to update saved query', 'INTERNAL_ERROR', 500);
  }
});

/**
 * DELETE /saved/:id — Delete a saved query
 */
queryEditorRouter.delete('/saved/:id', async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.sub;
  const { id } = req.params;

  try {
    await savedQueryService.delete(id, userId);
    success(res, { deleted: true });
  } catch (err: any) {
    if (err instanceof SavedQueryServiceError && err.code === 'NOT_FOUND') {
      error(res, err.message, 'NOT_FOUND', 404);
      return;
    }
    logger.error('Failed to delete saved query', { error: err.message, userId });
    error(res, 'Failed to delete saved query', 'INTERNAL_ERROR', 500);
  }
});
