import nodemailer from 'nodemailer';
import { logger } from '../middleware/logger';
import { adminPool } from '../db/pool';

/**
 * System (transactional) email transport.
 *
 * Config precedence for the SMTP relay:
 *   1. DB — the Email Server (SMTP) config saved via the system-persona UI
 *      (sys_system_configurations, category 'email'). Source of truth for a
 *      deployed install, so an operator can change the relay from the UI.
 *   2. Env (SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS) — for deploys
 *      that prefer env config.
 *   3. Ethereal dev auto-account — when neither is set (local dev), a fake SMTP
 *      account is created so mail is captured and previewable, never delivered.
 *
 * The transporter is cached and rebuilt lazily; `invalidateTransport()` clears the
 * cache so saving new config in the UI takes effect without a restart.
 *
 * Transport seam: system mail goes through nodemailer SMTP (a hosted relay, or
 * SES-SMTP later); swapping relays is a config change. Marketing email
 * (SendGrid/Listrak) is a separate pipeline, out of scope here.
 */

interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  fromAddress?: string;
  fromName?: string;
  /** Platform-wide send ceiling (emails/hour); 0/undefined = unlimited. */
  rateLimitPerHour?: number;
}

let transporter: nodemailer.Transporter | null = null;
let cachedFrom: string | null = null;

/** The saved Email Server config from the DB (null when unconfigured). */
async function loadDbEmailConfig(): Promise<Record<string, any> | null> {
  try {
    const { rows } = await adminPool.query(
      `SELECT config_data FROM sys_system_configurations WHERE category = 'email'`,
    );
    return rows[0]?.config_data || null;
  } catch {
    return null;  // table/connection not ready — fall through to env/Ethereal
  }
}

/** Resolve the effective SMTP config from DB -> env -> (caller handles Ethereal). */
async function resolveSmtpConfig(): Promise<ResolvedSmtpConfig | null> {
  const db = await loadDbEmailConfig();
  if (db?.smtp_host && db?.smtp_user) {
    return {
      host: String(db.smtp_host),
      port: parseInt(String(db.smtp_port || 587), 10),
      secure: db.use_ssl === true || String(db.smtp_port) === '465',
      user: db.smtp_user ? String(db.smtp_user) : undefined,
      pass: db.smtp_password ? String(db.smtp_password) : undefined,
      fromAddress: db.from_email ? String(db.from_email) : undefined,
      fromName: db.from_name ? String(db.from_name) : undefined,
      rateLimitPerHour: db.rate_limit != null ? parseInt(String(db.rate_limit), 10) : undefined,
    };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      fromAddress: process.env.EMAIL_FROM,
    };
  }
  return null;
}

/** Build a nodemailer transporter from a resolved SMTP config. */
export function buildTransport(cfg: ResolvedSmtpConfig): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });
}

/** Clear the cached transporter so the next send rebuilds from current config. */
export function invalidateTransport(): void {
  transporter = null;
  cachedFrom = null;
}

/** The resolved platform-wide send ceiling (emails/hour); 0 = unlimited. */
export async function getRateLimitPerHour(): Promise<number> {
  const cfg = await resolveSmtpConfig();
  return cfg?.rateLimitPerHour && cfg.rateLimitPerHour > 0 ? cfg.rateLimitPerHour : 0;
}

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  const cfg = await resolveSmtpConfig();
  if (cfg) {
    transporter = buildTransport(cfg);
    cachedFrom = cfg.fromAddress
      ? (cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress)
      : null;
    return transporter;
  }

  // No DB/env config — dev fallback: a captured-only Ethereal account.
  const testAccount = await nodemailer.createTestAccount();
  logger.info('Ethereal test account created', {
    user: testAccount.user, pass: testAccount.pass, web: 'https://ethereal.email',
  });
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email', port: 587, secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  /**
   * Optional sender override. When set, it takes precedence over the EMAIL_FROM
   * default — used to honor a business's branded `sender_name` on documents.
   * Pass a display name; the address falls back to the platform default address.
   */
  from?: string;
  /** Optional Reply-To, e.g. a business's branded reply-to address. */
  replyTo?: string;
}

/**
 * Send an email. In development, logs the Ethereal preview URL.
 */
export async function sendEmail(options: EmailOptions): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await getTransporter();

  // From precedence: per-message override (a business's branded sender_name) → the
  // configured Email Server From (from_name/from_email) → env → platform default.
  // A branded override is usually a display NAME only (no address); pair it with
  // the configured/default address so nodemailer gets a valid From.
  const baseFrom = cachedFrom || process.env.EMAIL_FROM || 'DayStream <noreply@daystream.app>';
  let from = baseFrom;
  if (options.from) {
    if (options.from.includes('<') || options.from.includes('@')) {
      from = options.from;  // already a full address or "Name <addr>"
    } else {
      // Display-name-only override: keep the configured address, swap the name.
      const addrMatch = baseFrom.match(/<([^>]+)>/);
      const addr = addrMatch ? addrMatch[1] : baseFrom;
      from = `${options.from} <${addr}>`;
    }
  }

  const info = await transport.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

  if (previewUrl) {
    logger.info(`📧 Email preview: ${previewUrl}`);
  }

  logger.info('Email sent', {
    to: options.to,
    subject: options.subject,
    messageId: info.messageId,
    previewUrl,
  });

  return { messageId: info.messageId, previewUrl };
}

/**
 * Send a password reset email with a time-limited token link.
 */
export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:4000';
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  await sendEmail({
    to: email,
    subject: 'DayStream — Password Reset',
    html: `
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 15 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
    text: `Password Reset Request\n\nClick this link to reset your password: ${resetUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

/**
 * Send a data export ready notification.
 */
export async function sendDataExportReadyEmail(email: string, downloadUrl: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'DayStream — Your Data Export is Ready',
    html: `
      <h2>Data Export Ready</h2>
      <p>Your data export is ready for download:</p>
      <p><a href="${downloadUrl}">Download your data</a></p>
      <p>This link expires in 48 hours.</p>
    `,
    text: `Your data export is ready for download: ${downloadUrl}\n\nThis link expires in 48 hours.`,
  });
}

/**
 * Send account deletion confirmation.
 */
export async function sendDeletionConfirmationEmail(email: string, gracePeriodDays: number): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'DayStream — Account Deletion Requested',
    html: `
      <h2>Account Deletion Requested</h2>
      <p>Your account deletion has been scheduled. Your data will be permanently removed after ${gracePeriodDays} days.</p>
      <p>If you change your mind, log in before the grace period ends to cancel the deletion.</p>
    `,
    text: `Account Deletion Requested\n\nYour account deletion has been scheduled. Your data will be permanently removed after ${gracePeriodDays} days.\n\nIf you change your mind, log in before the grace period ends to cancel the deletion.`,
  });
}
