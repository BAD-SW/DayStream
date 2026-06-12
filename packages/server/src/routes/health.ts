import { Router } from 'express';

export const healthRouter = Router();

const startTime = Date.now();

healthRouter.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});
