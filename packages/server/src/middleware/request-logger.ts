import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { adminPool } from '../db/pool';

/**
 * Middleware that logs every API request to the api_request_logs table.
 * Captures method, path, status code, duration, user info, and IP.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId = (req as any).requestId || uuidv4();

  // Capture response finish event (fires after response is fully sent)
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Don't log health checks or non-API paths
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/health')) {
      return;
    }

    const user = (req as any).user;
    const userEmail = user?.email || null;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';

    adminPool.query(
      `INSERT INTO sys_api_request_logs (method, path, status_code, duration_ms, ip_address, user_agent, request_id, user_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.method, req.path, res.statusCode, duration, ip, req.headers['user-agent'] || null, requestId, userEmail],
    ).catch((err) => {
      console.error('[request-logger] Failed to log request:', err.message);
    });
  });

  next();
}
