import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import swaggerUi from 'swagger-ui-express';
import { logger } from './middleware/logger';
import { router } from './routes';
import { openApiSpec } from './docs/openapi';
import { config } from './config';

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
