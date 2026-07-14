import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import swaggerUi from 'swagger-ui-express';
import { logger } from './middleware/logger';
import { router } from './routes';
import { openApiSpec } from './docs/openapi';
import { config } from './config';
import { adminPool } from './db/pool';

export const app = express();

// Request ID middleware
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] as string || uuidv4();
  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId: (req as any).requestId,
    });

    // Also log to sys_api_request_logs table for Query History
    const reqPath = req.originalUrl || req.path;
    if (reqPath.startsWith('/api/') && !reqPath.startsWith('/api/health')) {
      const user = (req as any).user;
      const userId = user?.sub || null;
      const tenantId = (req as any).tenantId || user?.tid || null;
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress || 'unknown';
      adminPool.query(
        `INSERT INTO sys_api_request_logs (method, path, status_code, duration_ms, ip_address, user_agent, request_id, user_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.method, reqPath, res.statusCode, duration, ip, req.headers['user-agent'] || null, (req as any).requestId, userId, tenantId],
      ).catch((err: any) => {
        console.error('[request-logger]', err.message);
      });
    }
  });
  next();
});

// CORS
app.use(cors({
  origin: `http://localhost:${config.nodeEnv === 'development' ? 4000 : config.port}`,
  credentials: true,
}));

// Cookie parser
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Serve uploaded files from storage (reads path from database config)
app.use('/storage', async (req, res, next) => {
  try {
    const { adminPool: pool } = await import('./db/pool');
    const { rows } = await pool.query("SELECT config_data FROM sys_system_configurations WHERE category = 'storage'");
    const config = rows[0]?.config_data;
    const storagePath = config?.local_path || process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'storage');
    const filePath = path.join(storagePath, req.path);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(storagePath))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (fs.existsSync(resolved)) {
      res.sendFile(resolved);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch {
    res.status(500).json({ error: 'Storage error' });
  }
});

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// API routes
app.use('/api', router);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    code: 'NOT_FOUND',
    details: { path: req.path },
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: (req as any).requestId,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
    details: config.nodeEnv === 'development' ? { message: err.message } : undefined,
  });
});
