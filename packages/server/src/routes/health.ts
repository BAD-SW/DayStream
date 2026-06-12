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

healthRouter.get('/dependencies', async (req, res) => {
  try {
    const start = Date.now();
    const dbResult = await pool.query('SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()');
    const responseTime = Date.now() - start;
    const activeConnections = parseInt(dbResult.rows[0].count, 10);

    res.json({
      status: 'ok',
      dependencies: {
        database: {
          status: 'ok',
          responseTime,
          activeConnections,
        },
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
