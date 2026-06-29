import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './middleware';

/**
 * Middleware that enforces business_id is present on all business-scoped requests.
 * Reads from x-business-id header or the user's JWT business_id claim.
 * Rejects the request with 400 if no business_id can be resolved.
 * 
 * Attaches `req.businessId` for downstream use.
 */
export function businessContext(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest & { businessId: string };

  const businessId = req.headers['x-business-id'] as string
    || (req as any).user?.business_id
    || req.query.business_id as string;

  if (!businessId) {
    res.status(400).json({
      error: 'Business ID is required for this operation',
      code: 'MISSING_BUSINESS_ID',
    });
    return;
  }

  authReq.businessId = businessId;
  next();
}
