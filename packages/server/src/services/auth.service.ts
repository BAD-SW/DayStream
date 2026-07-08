import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool, adminPool } from '../db/pool';
import { tenantQuery } from '../db/tenant-query';
import { logger } from '../middleware/logger';
import { JwtPayload } from '../auth/middleware';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const PASSWORD_HISTORY_COUNT = 5;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

// --- Password hashing ---

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// --- Token generation ---

export function generateAccessToken(userId: string, tenantId: string, role: string, permissions: string[]): string {
  const payload: Partial<JwtPayload> = {
    sub: userId,
    tid: tenantId,
    role,
    permissions,
    jti: crypto.randomUUID(),
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// --- User lookup ---

export async function findUserByEmail(email: string, tenantId?: string) {
  if (tenantId) {
    const { rows } = await tenantQuery(tenantId,
      'SELECT * FROM usr_users WHERE email = $1 AND tenant_id = $2',
      [email, tenantId],
    );
    return rows[0] || null;
  }
  // System user lookup (no tenant)
  const { rows } = await adminPool.query(
    'SELECT * FROM usr_users WHERE email = $1 AND tenant_id IS NULL',
    [email],
  );
  return rows[0] || null;
}

export async function findUserById(userId: string) {
  // This needs to work without tenant context for refresh token flow
  // Use adminPool since we're looking up by PK
  const { rows } = await adminPool.query('SELECT * FROM usr_users WHERE id = $1', [userId]);
  return rows[0] || null;
}

// --- User permissions ---

export async function getUserPermissions(userId: string, tenantId?: string): Promise<string[]> {
  const query = tenantId
    ? `SELECT DISTINCT jsonb_array_elements_text(r.permissions) AS permission
       FROM usr_user_roles ur
       JOIN usr_roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.tenant_id = $2`
    : `SELECT DISTINCT jsonb_array_elements_text(r.permissions) AS permission
       FROM usr_user_roles ur
       JOIN usr_roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.tenant_id IS NULL`;
  const params = tenantId ? [userId, tenantId] : [userId];
  const { rows } = await adminPool.query(query, params);
  return rows.map((r) => r.permission);
}

export async function getUserRole(userId: string, tenantId?: string): Promise<string> {
  const query = tenantId
    ? `SELECT r.name FROM usr_user_roles ur
       JOIN usr_roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.tenant_id = $2
       ORDER BY r.created_at ASC LIMIT 1`
    : `SELECT r.name FROM usr_user_roles ur
       JOIN usr_roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.tenant_id IS NULL
       ORDER BY r.created_at ASC LIMIT 1`;
  const params = tenantId ? [userId, tenantId] : [userId];
  const { rows } = await adminPool.query(query, params);
  return rows[0]?.name || 'customer';
}

// --- Account lockout ---

export async function isAccountLocked(email: string, tenantId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);
  const { rows } = await adminPool.query(
    `SELECT COUNT(*) AS count FROM usr_login_attempts
     WHERE email = $1 AND tenant_id = $2 AND success = false AND attempted_at > $3`,
    [email, tenantId, cutoff.toISOString()],
  );
  return parseInt(rows[0].count, 10) >= MAX_FAILED_ATTEMPTS;
}

export async function recordLoginAttempt(email: string, tenantId: string, ip: string, success: boolean): Promise<void> {
  await adminPool.query(
    'INSERT INTO usr_login_attempts (email, tenant_id, ip_address, success) VALUES ($1, $2, $3, $4)',
    [email, tenantId, ip, success],
  );
}

export async function clearLoginAttempts(email: string, tenantId: string): Promise<void> {
  const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);
  await adminPool.query(
    'DELETE FROM usr_login_attempts WHERE email = $1 AND tenant_id = $2 AND attempted_at > $3',
    [email, tenantId, cutoff.toISOString()],
  );
}

// --- Refresh tokens ---

export async function storeRefreshToken(
  userId: string, token: string, deviceInfo: string, ip: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await adminPool.query(
    `INSERT INTO usr_refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), deviceInfo || null, ip || null, expiresAt.toISOString()],
  );
}

export async function validateRefreshToken(token: string) {
  const hash = hashToken(token);
  const { rows } = await adminPool.query(
    `SELECT * FROM usr_refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [hash],
  );
  return rows[0] || null;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = hashToken(token);
  await adminPool.query(
    'UPDATE usr_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [hash],
  );
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await adminPool.query(
    'UPDATE usr_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

// --- Password history ---

export async function addToPasswordHistory(userId: string, passwordHash: string): Promise<void> {
  await adminPool.query(
    'INSERT INTO usr_password_history (user_id, password_hash) VALUES ($1, $2)',
    [userId, passwordHash],
  );
}

export async function isPasswordInHistory(userId: string, password: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT password_hash FROM usr_password_history
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, PASSWORD_HISTORY_COUNT],
  );
  for (const row of rows) {
    if (await bcrypt.compare(password, row.password_hash)) {
      return true;
    }
  }
  return false;
}

// --- Registration ---

export async function registerUser(
  tenantId: string,
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<{ user: any; accessToken: string; refreshToken: string }> {
  // Check existing
  const existing = await findUserByEmail(email, tenantId);
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  const passwordHash = await hashPassword(password);

  // Use adminPool for writes (RLS requires tenant context for select but admin for insert)
  const { rows } = await adminPool.query(
    `INSERT INTO usr_users (tenant_id, email, first_name, last_name, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, 'customer', 'active')
     RETURNING id, tenant_id, email, first_name, last_name, role, status, created_at`,
    [tenantId, email, firstName, lastName, passwordHash],
  );

  const user = rows[0];

  // Store in password history
  await addToPasswordHistory(user.id, passwordHash);

  // Assign default Customer role
  await adminPool.query(
    `INSERT INTO usr_user_roles (user_id, role_id, tenant_id)
     VALUES ($1, '00000000-0000-0000-0000-000000000104', $2)`,
    [user.id, tenantId],
  );

  // Generate tokens
  const permissions = await getUserPermissions(user.id, tenantId);
  const accessToken = generateAccessToken(user.id, tenantId, 'Customer', permissions);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, refreshToken, '', '');

  return { user, accessToken, refreshToken };
}

// --- Login ---

export async function loginUser(
  tenantId: string,
  email: string,
  password: string,
  ip: string,
  userAgent: string,
): Promise<{ user: any; accessToken: string; refreshToken: string; requiresMfa: boolean }> {
  // Check lockout
  if (await isAccountLocked(email, tenantId)) {
    throw new Error('Account is locked. Please try again later.');
  }

  const user = await findUserByEmail(email, tenantId);
  if (!user) {
    // Fallback: try to find user by email across all tenants
    const { rows: fallbackRows } = await adminPool.query(
      "SELECT * FROM usr_users WHERE email = $1 AND status = 'active'",
      [email],
    );
    if (fallbackRows.length === 0) {
      await recordLoginAttempt(email, tenantId, ip, false);
      throw new Error('Invalid credentials');
    }
    // Use the found user and their actual tenant
    const foundUser = fallbackRows[0];
    const effectiveTenantId = foundUser.tenant_id;

    if (!foundUser.password_hash) {
      throw new Error('Invalid credentials');
    }

    const valid = await verifyPassword(password, foundUser.password_hash);
    if (!valid) {
      await recordLoginAttempt(email, effectiveTenantId, ip, false);
      throw new Error('Invalid credentials');
    }

    await recordLoginAttempt(email, effectiveTenantId, ip, true);
    await clearLoginAttempts(email, effectiveTenantId);

    const { rows: mfaRows } = await adminPool.query(
      'SELECT * FROM usr_user_mfa WHERE user_id = $1 AND enabled = true',
      [foundUser.id],
    );
    if (mfaRows.length > 0) {
      return { user: foundUser, accessToken: '', refreshToken: '', requiresMfa: true };
    }

    const role = await getUserRole(foundUser.id, effectiveTenantId);
    const permissions = await getUserPermissions(foundUser.id, effectiveTenantId);
    const accessToken = generateAccessToken(foundUser.id, effectiveTenantId, role, permissions);
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(foundUser.id, refreshToken, userAgent, ip);

    return { user: foundUser, accessToken, refreshToken, requiresMfa: false };
  }

  if (!user.password_hash) {
    throw new Error('Invalid credentials');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await recordLoginAttempt(email, tenantId, ip, false);
    throw new Error('Invalid credentials');
  }

  // Successful login
  await recordLoginAttempt(email, tenantId, ip, true);
  await clearLoginAttempts(email, tenantId);

  // Check MFA status
  const { rows: mfaRows } = await adminPool.query(
    'SELECT * FROM usr_user_mfa WHERE user_id = $1 AND enabled = true',
    [user.id],
  );

  if (mfaRows.length > 0) {
    // Return partial auth — MFA required
    const tempToken = jwt.sign({ sub: user.id, tid: tenantId, mfa: true }, getJwtSecret(), { expiresIn: '5m' });
    return { user, accessToken: '', refreshToken: '', requiresMfa: true };
  }

  // Generate full tokens
  const role = await getUserRole(user.id, tenantId);
  const permissions = await getUserPermissions(user.id, tenantId);
  const accessToken = generateAccessToken(user.id, tenantId, role, permissions);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, refreshToken, userAgent, ip);

  return { user, accessToken, refreshToken, requiresMfa: false };
}

// --- Token refresh ---

export async function refreshAccessToken(
  token: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const stored = await validateRefreshToken(token);
  if (!stored) {
    throw new Error('Invalid or expired refresh token');
  }

  const user = await findUserById(stored.user_id);
  if (!user || user.status !== 'active') {
    throw new Error('User not found or inactive');
  }

  // Revoke old, issue new (rotation)
  await revokeRefreshToken(token);

  const role = await getUserRole(user.id, user.tenant_id);
  const permissions = await getUserPermissions(user.id, user.tenant_id);
  const accessToken = generateAccessToken(user.id, user.tenant_id, role, permissions);
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, newRefreshToken, '', '');

  return { accessToken, refreshToken: newRefreshToken };
}
