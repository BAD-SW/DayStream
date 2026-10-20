import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { adminPool } from '../db/pool';
import { success, error } from '../utils/response';
import { logAudit } from '../services/audit.service';
import { logger } from '../middleware/logger';

export const systemConfigRouter = Router();

// All system config routes require authentication + super admin
systemConfigRouter.use(authenticate);

// ============================================================
// Helper: get/set system config by category
// ============================================================

async function getSystemConfig(category: string): Promise<Record<string, any> | null> {
  const { rows } = await adminPool.query(
    `SELECT config_data FROM sys_system_configurations WHERE category = $1`,
    [category],
  );
  return rows[0]?.config_data || null;
}

async function upsertSystemConfig(category: string, data: Record<string, any>, userId: string) {
  await adminPool.query(
    `INSERT INTO sys_system_configurations (category, config_data, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (category) DO UPDATE SET config_data = $2, updated_by = $3, updated_at = NOW()`,
    [category, JSON.stringify(data), userId],
  );
}


// ============================================================
// Email Configuration
// ============================================================

systemConfigRouter.get('/email', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('email');
    success(res, data);
  } catch (err: any) {
    console.error('Failed to get email config', err?.message || err);
    error(res, 'Failed to get email config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.put('/email', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await upsertSystemConfig('email', req.body, authReq.user.sub);
    // Drop the cached SMTP transporter so the new config takes effect on the next
    // send without a server restart.
    const { invalidateTransport } = await import('../services/email.service');
    invalidateTransport();
    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.email.updated',
      resourceType: 'system_config',
      details: { category: 'email' },
    });
    success(res, req.body);
  } catch (err: any) {
    console.error('Failed to save email config', err?.message || err);
    error(res, 'Failed to save email config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.post('/email/test', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const config = req.body || {};
    if (!config.smtp_host) {
      error(res, 'SMTP host is required.', 'VALIDATION_ERROR', 400);
      return;
    }
    if (!config.smtp_user) {
      error(res, 'SMTP credentials are incomplete. Username is required.', 'VALIDATION_ERROR', 400);
      return;
    }

    // The password field may be masked in the UI and not re-sent on test — fall
    // back to the saved password so a test reuses the stored credential.
    let password = config.smtp_password;
    if (!password) {
      const saved = await getSystemConfig('email');
      password = saved?.smtp_password;
    }
    if (!password) {
      error(res, 'SMTP password is required (none submitted and none saved).', 'VALIDATION_ERROR', 400);
      return;
    }

    const port = parseInt(String(config.smtp_port || 587), 10);
    const secure = config.use_ssl === true || port === 465;

    // Real SMTP handshake + auth (not just a TCP probe): build a transporter and
    // verify it against the relay. Surfaces bad host/port/credentials accurately.
    const { buildTransport } = await import('../services/email.service');
    const transport = buildTransport({
      host: String(config.smtp_host), port, secure,
      user: String(config.smtp_user), pass: String(password),
    });
    await transport.verify();

    success(res, { message: `SMTP connection to ${config.smtp_host}:${port} verified.` });
  } catch (err: any) {
    error(res, `SMTP connection failed: ${err.message}`, 'TEST_FAILED', 400);
  }
});


// ============================================================
// Storage Configuration
// ============================================================

systemConfigRouter.get('/storage', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('storage');
    success(res, data);
  } catch (err: any) {
    console.error('Failed to get storage config', err?.message || err);
    error(res, 'Failed to get storage config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.put('/storage', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await upsertSystemConfig('storage', req.body, authReq.user.sub);
    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.storage.updated',
      resourceType: 'system_config',
      details: { category: 'storage', storage_type: req.body.storage_type },
    });
    success(res, req.body);
  } catch (err: any) {
    console.error('Failed to save storage config', err?.message || err);
    error(res, 'Failed to save storage config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.post('/storage/test', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config || !config.storage_type) {
      error(res, 'Storage type is required.', 'VALIDATION_ERROR', 400);
      return;
    }

    if (config.storage_type === 'local') {
      if (!config.local_path) {
        error(res, 'Local storage path is required.', 'VALIDATION_ERROR', 400);
        return;
      }
      const fs = await import('fs/promises');
      const path = await import('path');
      const resolvedPath = path.resolve(config.local_path);
      try {
        await fs.access(resolvedPath);
        success(res, { message: `Local storage path verified: ${resolvedPath}` });
      } catch {
        try {
          await fs.mkdir(resolvedPath, { recursive: true });
          success(res, { message: `Local storage path created and verified: ${resolvedPath}` });
        } catch (mkErr: any) {
          error(res, `Cannot access or create path: ${resolvedPath}. ${mkErr.message}`, 'TEST_FAILED', 400);
        }
      }
    } else if (config.storage_type === 'aws_s3') {
      if (!config.s3_bucket || !config.s3_access_key || !config.s3_secret_key) {
        error(res, 'S3 configuration is incomplete. Bucket, Access Key, and Secret Key are required.', 'VALIDATION_ERROR', 400);
        return;
      }
      success(res, { message: `S3 configuration validated for bucket: ${config.s3_bucket} in ${config.s3_region}` });
    } else {
      error(res, 'Unknown storage type.', 'VALIDATION_ERROR', 400);
    }
  } catch (err: any) {
    error(res, 'Storage test failed: ' + err.message, 'TEST_FAILED', 500);
  }
});


// ============================================================
// Notifications Configuration
// ============================================================

systemConfigRouter.get('/notifications', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('notifications');
    success(res, data);
  } catch (err: any) {
    console.error('Failed to get notifications config', err?.message || err);
    error(res, 'Failed to get notifications config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.put('/notifications', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await upsertSystemConfig('notifications', req.body, authReq.user.sub);
    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.notifications.updated',
      resourceType: 'system_config',
      details: { category: 'notifications' },
    });
    success(res, req.body);
  } catch (err: any) {
    console.error('Failed to save notifications config', err?.message || err);
    error(res, 'Failed to save notifications config', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Platform Billing (DayStream's receiving account)
// ============================================================

systemConfigRouter.get('/platform-billing', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('platform-billing');
    success(res, data);
  } catch (err: any) {
    console.error('Failed to get platform billing config', err?.message || err);
    error(res, 'Failed to get platform billing config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.put('/platform-billing', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await upsertSystemConfig('platform-billing', req.body, authReq.user.sub);
    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.platform_billing.updated',
      resourceType: 'system_config',
      details: { category: 'platform-billing' },
    });
    success(res, req.body);
  } catch (err: any) {
    console.error('Failed to save platform billing config', err?.message || err);
    error(res, 'Failed to save platform billing config', 'INTERNAL_ERROR', 500);
  }
});

// ============================================================
// Server Logs
// ============================================================

systemConfigRouter.get('/logs', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const level = req.query.level as string;
    const limit = parseInt(req.query.limit as string) || 100;

    let query = 'SELECT id, level, message, meta, created_at as timestamp FROM sys_server_logs';
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (level && level !== 'all') {
      conditions.push(`level = $${idx++}`);
      params.push(level);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(limit);

    const { rows } = await adminPool.query(query, params);
    success(res, rows);
  } catch (err: any) {
    console.error('Failed to fetch logs', err?.message || err);
    error(res, 'Failed to fetch logs', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// Query Log (API Request Logs)
// ============================================================

systemConfigRouter.get('/query-history', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const { method, path: pathFilter, status_code, user_email, start_date, end_date } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (method) { conditions.push(`r.method = $${idx++}`); params.push(method); }
    if (pathFilter) { conditions.push(`r.path ILIKE $${idx++}`); params.push(`%${pathFilter}%`); }
    if (status_code) { conditions.push(`r.status_code = $${idx++}`); params.push(parseInt(status_code as string)); }
    if (user_email) { conditions.push(`u.email ILIKE $${idx++}`); params.push(`%${user_email}%`); }
    if (start_date) { conditions.push(`r.created_at >= $${idx++}`); params.push(new Date(start_date as string)); }
    if (end_date) { conditions.push(`r.created_at <= $${idx++}`); params.push(new Date(end_date as string)); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count
    const countRes = await adminPool.query(
      `SELECT COUNT(*) FROM sys_api_request_logs r LEFT JOIN usr_users u ON r.user_id::uuid = u.id ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].count, 10);

    // Fetch with tenant name and user email join
    params.push(limit, offset);
    const { rows } = await adminPool.query(
      `SELECT r.id, r.method, r.path, r.status_code, r.duration_ms, r.ip_address, r.user_agent, r.request_id, r.created_at,
              u.email as user_email, t.name as tenant_name
       FROM sys_api_request_logs r
       LEFT JOIN usr_users u ON r.user_id::uuid = u.id
       LEFT JOIN sys_tenants t ON r.tenant_id::uuid = t.id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    success(res, rows, { page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('Failed to fetch query log', err?.message || err);
    error(res, 'Failed to fetch query log', 'INTERNAL_ERROR', 500);
  }
});


// ============================================================
// API Keys
// ============================================================

systemConfigRouter.get('/api-keys', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('api_keys');
    // Mask sensitive values for display
    const masked: Record<string, any> = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 8) {
          masked[key] = value.slice(0, 4) + '...' + value.slice(-4);
        } else {
          masked[key] = value ? '****' : '';
        }
      }
    }
    success(res, { keys: masked, configured: Object.keys(data || {}) });
  } catch (err: any) { console.error('Failed to get API keys', err?.message || err); error(res, 'Failed to get API keys', 'INTERNAL_ERROR', 500); }
});

systemConfigRouter.put('/api-keys', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Merge with existing (don't overwrite keys not provided)
    const existing = await getSystemConfig('api_keys') || {};
    const updated = { ...existing, ...req.body };
    // Remove empty values
    for (const key of Object.keys(updated)) {
      if (updated[key] === '' || updated[key] === null) delete updated[key];
    }
    await upsertSystemConfig('api_keys', updated, authReq.user.sub);
    success(res, { saved: true });
  } catch (err: any) { console.error('Failed to save API keys', err?.message || err); error(res, 'Failed to save API keys', 'INTERNAL_ERROR', 500); }
});


// ============================================================
// Prospect Settings
// ============================================================

systemConfigRouter.get('/prospects', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('prospects');
    success(res, data || { h3_resolution: 5 });
  } catch (err: any) { console.error('Failed to get prospect settings', err?.message || err); error(res, 'Failed to get prospect settings', 'INTERNAL_ERROR', 500); }
});

systemConfigRouter.put('/prospects', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await upsertSystemConfig('prospects', req.body, authReq.user.sub);
    success(res, { saved: true });
  } catch (err: any) { console.error('Failed to save prospect settings', err?.message || err); error(res, 'Failed to save prospect settings', 'INTERNAL_ERROR', 500); }
});
