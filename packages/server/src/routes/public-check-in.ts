import { Router, Request, Response } from 'express';
import { success, error } from '../utils/response';
import { selfCheckInLimiter } from '../middleware/rate-limit';
import { CheckInRefused } from '../services/checkin.service';
import * as selfService from '../services/self-check-in.service';

/**
 * Check in from your own phone (spec 51, design 1.11a). No login: the long personal code in the
 * link (sent in the reminder email) identifies the one booking. The page shows an "I'm here"
 * button, then the list of forms for the visit. Check-in is never held back by a form.
 */
export const publicCheckInRouter = Router();
publicCheckInRouter.use(selfCheckInLimiter);

const NOT_VALID = 'This link is no longer valid. Please see the front desk.';

function refuse(res: Response, err: unknown, fallback: string): void {
  if (err instanceof CheckInRefused) { error(res, err.message, 'CHECK_IN_REFUSED', 400); return; }
  console.error(fallback, (err as Error)?.message || err);
  error(res, fallback, 'INTERNAL_ERROR', 500);
}

// GET /v1/public/check-in/:code — the visit and its forms
publicCheckInRouter.get('/:code', async (req: Request, res: Response) => {
  try {
    const ctx = await selfService.contextFromLinkCode(req.params.code);
    if (!ctx) { error(res, NOT_VALID, 'INVALID_LINK', 410); return; }
    res.setHeader('Cache-Control', 'no-store');
    success(res, await selfService.selfScreen(ctx));
  } catch (err) { refuse(res, err, 'Failed to load your appointment'); }
});

// POST /v1/public/check-in/:code — "I'm here"
publicCheckInRouter.post('/:code', async (req: Request, res: Response) => {
  try {
    const ctx = await selfService.contextFromLinkCode(req.params.code);
    if (!ctx) { error(res, NOT_VALID, 'INVALID_LINK', 410); return; }
    const result = await selfService.selfCheckIn(ctx, 'qr_self');
    success(res, { checked_in_now: result.checkedInNow, ...(await selfService.selfScreen(ctx)) });
  } catch (err) { refuse(res, err, 'Check-in failed'); }
});

// POST /v1/public/check-in/:code/forms/start — open one of the visit's forms
publicCheckInRouter.post('/:code/forms/start', async (req: Request, res: Response) => {
  try {
    const ctx = await selfService.contextFromLinkCode(req.params.code);
    if (!ctx) { error(res, NOT_VALID, 'INVALID_LINK', 410); return; }
    success(res, await selfService.startSelfForm(ctx, String(req.body?.group_id || '')));
  } catch (err) { refuse(res, err, 'Could not start the form'); }
});
