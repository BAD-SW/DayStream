import { Response } from 'express';

/**
 * Send a standard success response.
 */
export function success<T>(res: Response, data: T, meta?: object, status = 200): void {
  res.status(status).json({ data, ...(meta ? { meta } : {}) });
}

/**
 * Send a standard error response.
 */
export function error(
  res: Response, message: string, code: string, status: number, details?: unknown,
): void {
  res.status(status).json({ error: message, code, ...(details ? { details } : {}) });
}
