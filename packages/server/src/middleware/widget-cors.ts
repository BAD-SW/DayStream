import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * CORS for /api/v1/widget/* only — the business's external website (an arbitrary origin)
 * loads the booking iframe which calls these endpoints directly. This does NOT loosen the
 * app-wide CORS policy in app.ts, which stays a single fixed origin for the admin app.
 * credentials: false because the widget never uses cookies — the customer JWT travels as a
 * bearer header (see requirements.md 13.1).
 */
export const widgetCors = cors({ origin: true, credentials: false });

/** Requirement 12.3 — 60 requests/minute/IP on booking-mutating widget endpoints. */
export const widgetMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please try again shortly.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Requirement 12.5 — every widget route must carry a well-formed business_id. */
export function requireValidBusinessId(req: Request, res: Response, next: NextFunction): void {
  const businessId = (req.params.business_id || req.query.business_id || req.body?.business_id) as string | undefined;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!businessId || !uuidRe.test(businessId)) {
    res.status(400).json({ error: 'Invalid or missing business_id', code: 'VALIDATION_ERROR' });
    return;
  }
  next();
}
