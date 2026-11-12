import { Router, Request, Response } from 'express';
import { publicFormLimiter } from '../middleware/rate-limit';
import { success, error } from '../utils/response';
import * as completion from '../services/form-completion.service';

/**
 * The public page a customer opens from an emailed link or on a device in the business
 * (spec 51, gap 1). No login: the link's token is the key. It works once and expires.
 * Rate limited, since anyone can call it.
 */
export const publicFormsRouter = Router();

const HTTP: Record<string, number> = {
  INVALID_LINK: 410,
  NOT_FOUND: 404,
  INVALID_ANSWERS: 422,
  SIGNATURE_REQUIRED: 422,
  STORAGE_FAILED: 503,
};

function fail(res: Response, e: unknown, fallback: string): void {
  const err = e as { code?: string; message?: string; details?: unknown };
  if (err.code && HTTP[err.code]) { error(res, err.message ?? fallback, err.code, HTTP[err.code], err.details); return; }
  console.error(fallback, err.message ?? e);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

// GET /v1/public/forms/:token
publicFormsRouter.get('/:token', publicFormLimiter, async (req: Request, res: Response) => {
  try {
    if (!TOKEN_RE.test(req.params.token)) { error(res, 'This link is no longer valid.', 'INVALID_LINK', 410); return; }
    res.setHeader('Cache-Control', 'no-store');
    success(res, await completion.getPublicForm(req.params.token));
  } catch (e) { fail(res, e, 'Failed to load the form'); }
});

// POST /v1/public/forms/:token
publicFormsRouter.post('/:token', publicFormLimiter, async (req: Request, res: Response) => {
  try {
    if (!TOKEN_RE.test(req.params.token)) { error(res, 'This link is no longer valid.', 'INVALID_LINK', 410); return; }
    const result = await completion.submitPublic(req.params.token, {
      language: typeof req.body?.language === 'string' ? req.body.language : null,
      answers: req.body?.answers,
      signature: req.body?.signature,
    }, { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
    success(res, { completed: true, submissionId: result.submissionId }, undefined, 201);
  } catch (e) { fail(res, e, 'Failed to submit the form'); }
});
