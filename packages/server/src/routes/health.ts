import { Router } from 'express';
import { pool } from '../db/pool';

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

healthRouter.get('/ready', async (req, res) => {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const responseTime = Date.now() - start;

    res.json({
      status: 'ok',
      dependencies: {
        database: { status: 'ok', responseTime },
      },
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'unavailable',
      dependencies: {
        database: { status: 'unavailable', error: err.message },
      },
    });
  }
});
