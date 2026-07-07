import winston from 'winston';
import Transport from 'winston-transport';
import { config } from '../config';

/**
 * Custom Winston transport that writes log entries to the server_logs table.
 * Uses lazy pool import to avoid circular dependency issues.
 */
class DatabaseTransport extends Transport {
  private pool: any = null;
  private ready = false;

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
    // Delay initialization to let pool connect
    setTimeout(() => this.init(), 3000);
  }

  private async init() {
    try {
      const { adminPool } = await import('../db/pool');
      this.pool = adminPool;
      // Test if table exists
      await this.pool.query('SELECT 1 FROM sys_server_logs LIMIT 0');
      this.ready = true;
    } catch {
      // Table doesn't exist yet or pool not ready — disable this transport
      this.ready = false;
    }
  }

  log(info: any, callback: () => void) {
    if (!this.ready || !this.pool) {
      callback();
      return;
    }

    const { level, message, timestamp, ...meta } = info;
    // Strip ANSI color codes from colorized output
    const cleanMessage = typeof message === 'string' ? message.replace(/\x1B\[[0-9;]*m/g, '') : message;
    const metaObj = Object.keys(meta).length > 0 ? meta : null;

    this.pool.query(
      'INSERT INTO sys_server_logs (level, message, meta, created_at) VALUES ($1, $2, $3, $4)',
      [level.replace(/\x1B\[[0-9;]*m/g, ''), cleanMessage, metaObj ? JSON.stringify(metaObj) : null, timestamp || new Date()],
    ).catch(() => {
      // Silently fail
    });

    callback();
  }
}

export const logger = winston.createLogger({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    config.nodeEnv === 'development'
      ? winston.format.combine(winston.format.colorize(), winston.format.simple())
      : winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    new DatabaseTransport({ level: 'info' }),
  ],
});
