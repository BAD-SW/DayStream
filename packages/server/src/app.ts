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

// Render (and its own edge/CDN in front of it) sits in front of this app, so every
// request arrives with an X-Forwarded-For chain, not a direct connection — without this,
// req.ip resolves to Render's own internal proxy address (useless for rate limiting/audit),
// and any code reading the raw header directly gets the whole comma-separated chain instead
// of a single IP (broke inet-typed columns — see auth.service.ts's recordLoginAttempt).
app.set('trust proxy', true);

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
// CLIENT_URL defaults to the local Vite dev server; in production it's the deployed
// Vercel client URL (spec 38 Phase 4) — the old hardcoded `localhost:${config.port}`
// fallback for non-development NODE_ENV pointed at the API's OWN port, not the client's,
// which could never have been a working origin for any real deployment.
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));

// Cookie parser
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Serve the embeddable booking widget script — Requirement 1.1: publicly accessible,
// unauthenticated, cacheable. Lives outside src/ (packages/server/static/) so it needs
// no build step and resolves the same way from both `tsx src/index.ts` (dev) and
// `node dist/index.js` (prod) — '../static' from either src/app.ts or dist/app.js lands
// on the same sibling folder.
app.use('/widget', express.static(path.join(__dirname, '../static'), {
  maxAge: '5m',
}));

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
