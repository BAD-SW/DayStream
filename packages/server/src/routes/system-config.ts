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

/**
 * Storage settings (spec 51, design §1.1). The S3 secret key is stored encrypted
 * (s3_secret_key_encrypted) and never returned: the page gets STORAGE_SECRET_MASK when one is set,
 * and sending the mask back (or leaving the field blank) keeps the stored key.
 */
const STORAGE_SECRET_MASK = '••••••••';

/** The stored storage config, with the secret replaced by the mask. */
function maskStorageConfig(data: Record<string, any> | null): Record<string, any> {
  const { s3_secret_key_encrypted, s3_secret_key, ...rest } = data || {};
  return { ...rest, s3_secret_key: s3_secret_key_encrypted || s3_secret_key ? STORAGE_SECRET_MASK : '' };
}

/** Turn the page's values into what is stored: secret encrypted, mask/blank keeps the old secret. */
async function storageConfigToSave(body: Record<string, any>): Promise<Record<string, any>> {
  const { encrypt } = await import('../utils/encryption');
  const stored = (await getSystemConfig('storage')) || {};
  const { s3_secret_key: incoming, ...rest } = body || {};
  const out: Record<string, any> = {
    storage_type: rest.storage_type === 'aws_s3' ? 'aws_s3' : 'local',
    local_path: String(rest.local_path || '').trim(),
    s3_bucket: String(rest.s3_bucket || '').trim(),
    s3_region: String(rest.s3_region || '').trim(),
    s3_access_key: String(rest.s3_access_key || '').trim(),
  };
  const secret = typeof incoming === 'string' ? incoming.trim() : '';
  if (secret && secret !== STORAGE_SECRET_MASK) out.s3_secret_key_encrypted = encrypt(secret);
  else if (stored.s3_secret_key_encrypted) out.s3_secret_key_encrypted = stored.s3_secret_key_encrypted;
  else if (stored.s3_secret_key) out.s3_secret_key_encrypted = encrypt(String(stored.s3_secret_key)); // legacy plain value
  return out;
}

systemConfigRouter.get('/storage', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    success(res, maskStorageConfig(await getSystemConfig('storage')));
  } catch (err: any) {
    console.error('Failed to get storage config', err?.message || err);
    error(res, 'Failed to get storage config', 'INTERNAL_ERROR', 500);
  }
});

systemConfigRouter.put('/storage', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const toSave = await storageConfigToSave(req.body);
    await upsertSystemConfig('storage', toSave, authReq.user.sub);
    // The new location takes effect at once, without a restart.
    const { invalidateStorageConfig } = await import('../services/storage.service');
    invalidateStorageConfig();
    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.storage.updated',
      resourceType: 'system_config',
      details: { category: 'storage', storage_type: toSave.storage_type },
    });
    success(res, maskStorageConfig(toSave));
  } catch (err: any) {
    console.error('Failed to save storage config', err?.message || err);
    error(res, 'Failed to save storage config', 'INTERNAL_ERROR', 500);
  }
});

// Test Connection: prove the location in the form (not yet saved) can be written, read and deleted.
systemConfigRouter.post('/storage/test', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const config = req.body || {};
    if (config.storage_type !== 'local' && config.storage_type !== 'aws_s3') {
      error(res, 'Storage type is required.', 'VALIDATION_ERROR', 400);
      return;
    }
    if (config.storage_type === 'local' && !String(config.local_path || '').trim()) {
      error(res, 'Local storage path is required.', 'VALIDATION_ERROR', 400);
      return;
    }
    if (config.storage_type === 'aws_s3' && !String(config.s3_bucket || '').trim()) {
      error(res, 'An S3 bucket is required.', 'VALIDATION_ERROR', 400);
      return;
    }
    // Use the secret typed in the form, or the stored one when the field still shows the mask.
    const typed = typeof config.s3_secret_key === 'string' ? config.s3_secret_key.trim() : '';
    let secret = typed && typed !== STORAGE_SECRET_MASK ? typed : '';
    if (!secret && config.storage_type === 'aws_s3') {
      const stored = await storageConfigToSave({ ...config, s3_secret_key: STORAGE_SECRET_MASK });
      if (stored.s3_secret_key_encrypted) {
        const { decrypt } = await import('../utils/encryption');
        secret = decrypt(stored.s3_secret_key_encrypted);
      }
    }
    const { testStorage } = await import('../services/storage.service');
    const result = await testStorage({
      storage_type: config.storage_type,
      local_path: String(config.local_path || '').trim(),
      s3_bucket: String(config.s3_bucket || '').trim(),
      s3_region: String(config.s3_region || '').trim(),
      s3_access_key: String(config.s3_access_key || '').trim(),
    }, secret);
    if (result.ok) success(res, { message: result.message });
    else error(res, result.message, 'TEST_FAILED', 400);
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


// ============================================================
// Google Cloud (usage monitoring — KEYLESS, via ADC)
// ============================================================
// Authentication uses Application Default Credentials (ADC), NOT a downloaded
// service-account key (the org policy forbids keys, and keys are a security risk).
// There is therefore no secret to store — only the non-sensitive project id, an
// optional service-account to impersonate (production), and the free threshold.
// Whether ADC is actually available is a RUNTIME fact surfaced by GET /prospects/usage.

systemConfigRouter.get('/google-cloud', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const data = await getSystemConfig('google_cloud');
    success(res, {
      configured: !!data?.project_id,
      project_id: data?.project_id || '',
      free_threshold: typeof data?.free_threshold === 'number' ? data.free_threshold : null,
      impersonate_service_account: data?.impersonate_service_account || '',
    });
  } catch (err: any) { console.error('Failed to get Google Cloud config', err?.message || err); error(res, 'Failed to get Google Cloud config', 'INTERNAL_ERROR', 500); }
});

systemConfigRouter.put('/google-cloud', requirePermission('*:*'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const existing = (await getSystemConfig('google_cloud')) || {};
    const updated: Record<string, any> = { ...existing };

    if (typeof req.body?.project_id === 'string') {
      const v = req.body.project_id.trim();
      if (v) updated.project_id = v; else delete updated.project_id;
    }
    if (typeof req.body?.impersonate_service_account === 'string') {
      const v = req.body.impersonate_service_account.trim();
      if (v) updated.impersonate_service_account = v; else delete updated.impersonate_service_account;
    }
    if (req.body?.free_threshold !== undefined && req.body?.free_threshold !== '' && req.body?.free_threshold !== null) {
      const n = Number(req.body.free_threshold);
      if (Number.isFinite(n) && n >= 0) updated.free_threshold = Math.floor(n);
    }

    await upsertSystemConfig('google_cloud', updated, authReq.user.sub);

    // Config changed — drop the cached usage reading so the next load is fresh.
    try {
      const { invalidateUsageCache } = await import('../services/google-cloud-usage.service');
      invalidateUsageCache();
    } catch { /* non-fatal */ }

    await logAudit({
      tenantId: 'system',
      userId: authReq.user.sub,
      action: 'system_config.google_cloud.update',
      resourceType: 'system_configuration',
      details: { project_id: updated.project_id, impersonation: !!updated.impersonate_service_account },
    });

    success(res, { saved: true });
  } catch (err: any) { console.error('Failed to save Google Cloud config', err?.message || err); error(res, 'Failed to save Google Cloud config', 'INTERNAL_ERROR', 500); }
});
