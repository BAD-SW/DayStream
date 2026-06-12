import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../middleware/logger';

export interface JwtPayload {
  sub: string;        // user_id
  tid: string;        // tenant_id
  role: string;       // primary role
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  tenantId: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Authenticate incoming requests via Bearer token.
 * Attaches decoded JWT payload to req.user and req.tenantId.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    (req as AuthenticatedRequest).user = decoded;
    (req as AuthenticatedRequest).tenantId = decoded.tid;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else if (err.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    } else {
      logger.error('Authentication error', { error: err.message });
      res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
    }
  }
}
