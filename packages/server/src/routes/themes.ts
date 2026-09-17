import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { tenantContext } from '../auth/tenant-context';
import { validate } from '../middleware/validate';
import { requireThemeWritePermission, requireThemeRowWritePermission } from '../middleware/themePermission';
import { success, error } from '../utils/response';
import { adminPool } from '../db/pool';
import * as themeService from '../services/theme.service';
import { ThemeServiceError } from '../services/theme.service';
import { BUILT_IN_TOKENS, TOKEN_LABELS } from '../services/themeTokens';

export const themesRouter = Router();

function statusForCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'FORBIDDEN': return 403;
    case 'CONFLICT': return 409;
    case 'ACTIVE_THEME': return 409;
    case 'VALIDATION': return 400;
    default: return 500;
  }
}

function handleThemeError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof ThemeServiceError) {
    error(res, err.message, err.code, statusForCode(err.code));
    return;
  }
  error(res, fallbackMessage, 'INTERNAL_ERROR', 500);
}

// IMPORTANT: registered before '/:id' routes so Express doesn't match 'resolve' as a UUID param.
// Deliberately unauthenticated — public-facing pages need theming before login; returns
// only CSS/branding token values, no sensitive data.
//
// Accepts (in priority order) business_id, then tenant_id, then neither — the admin
// chrome itself has no business in scope at tenant/system context level, so it needs a
// way to resolve "the tenant's active theme" or "the platform default" directly, not
// only "this business's theme".
themesRouter.get('/resolve', async (req: Request, res: Response) => {
  const businessId = req.query.business_id as string | undefined;
  const tenantId = req.query.tenant_id as string | undefined;
  try {
    const resolved = businessId
      ? await themeService.resolveForBusiness(businessId, adminPool)
      : tenantId
        ? await themeService.resolveForTenant(tenantId, adminPool)
        : await themeService.resolveSystemDefault(adminPool);
    success(res, resolved);
  } catch (err: any) {
    error(res, 'Failed to resolve theme', 'INTERNAL_ERROR', 500);
  }
});

// Registered before '/:id' for the same reason as '/resolve' — 'base-tokens' would
// otherwise be matched as a UUID param by a GET '/:id' route.
themesRouter.get('/base-tokens', authenticate, (req: Request, res: Response) => {
  success(res, { tokens: BUILT_IN_TOKENS, labels: TOKEN_LABELS });
});

themesRouter.get('/', authenticate, tenantContext, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const caller = await themeService.getCallerScope(authReq, adminPool);
    const result = await themeService.listForCaller(caller, adminPool);
    success(res, result.themes);
  } catch (err: any) {
    error(res, 'Failed to list themes', 'INTERNAL_ERROR', 500);
  }
});

const createThemeSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  base_theme: Joi.string().valid('bold-business', 'classic').required(),
  scope: Joi.string().valid('system', 'tenant', 'business').required(),
  scope_id: Joi.string().uuid().allow(null),
  tokens: Joi.object().pattern(Joi.string(), Joi.string()),
});

themesRouter.post('/', authenticate, tenantContext, requireThemeWritePermission(), validate(createThemeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const caller = (authReq as any).callerScope || await themeService.getCallerScope(authReq, adminPool);
    const created = await themeService.create(req.body, caller, adminPool);
    success(res, created, undefined, 201);
  } catch (err: any) {
    handleThemeError(res, err, 'Failed to create theme');
  }
});

const updateThemeSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  tokens: Joi.object().pattern(Joi.string(), Joi.string()),
}).min(1);

themesRouter.put('/:id', authenticate, tenantContext, requireThemeRowWritePermission(), validate(updateThemeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const caller = (authReq as any).callerScope || await themeService.getCallerScope(authReq, adminPool);
    const updated = await themeService.update(req.params.id, req.body, caller, adminPool);
    success(res, updated);
  } catch (err: any) {
    handleThemeError(res, err, 'Failed to update theme');
  }
});

themesRouter.delete('/:id', authenticate, tenantContext, requireThemeRowWritePermission(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const caller = (authReq as any).callerScope || await themeService.getCallerScope(authReq, adminPool);
    await themeService.softDelete(req.params.id, caller, adminPool);
    res.status(204).send();
  } catch (err: any) {
    handleThemeError(res, err, 'Failed to delete theme');
  }
});

const applyThemeSchema = Joi.object({
  scope: Joi.string().valid('system', 'tenant', 'business').required(),
  scope_id: Joi.string().uuid().allow(null).required(),
});

themesRouter.post('/:id/apply', authenticate, tenantContext, requireThemeWritePermission(), validate(applyThemeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const caller = (authReq as any).callerScope || await themeService.getCallerScope(authReq, adminPool);
    const resolved = await themeService.applyToScope(req.params.id, req.body, caller, adminPool);
    success(res, { resolved });
  } catch (err: any) {
    handleThemeError(res, err, 'Failed to apply theme');
  }
});
