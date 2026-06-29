import { app } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { logger } from './middleware/logger';
import { startJobScheduler } from './jobs/job-scheduler';

const start = async () => {
  // Test database connection
  try {
    await pool.query('SELECT 1');
    logger.info('✓ Database connected');
  } catch (err: any) {
    logger.error(`✗ Database connection failed: ${err.message}`);
    logger.error('  Check your .env database configuration and ensure PostgreSQL is running.');
    process.exit(1);
  }

  // Start job scheduler
  startJobScheduler();

  // Start server
  app.listen(config.port, () => {
    logger.info(`✓ Server running on http://localhost:${config.port}`);
    logger.info(`✓ API docs at http://localhost:${config.port}/api/docs`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
