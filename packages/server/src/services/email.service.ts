import nodemailer from 'nodemailer';
import { logger } from '../middleware/logger';

let transporter: nodemailer.Transporter | null = null;

/**
 * Initialize the email transporter.
 * In development, uses Ethereal (fake SMTP) so emails can be previewed
 * without sending real mail. In production, uses real SMTP credentials.
 *
 * Ethereal: https://ethereal.email
 *   - Emails are captured and viewable at the URL logged after each send.
 *   - No real emails are delivered.
 */
async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  const nodeEnv = process.env.NODE_ENV || 'development';

  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    // Production: use configured SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Development: use Ethereal
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      // Use pre-configured Ethereal credentials from .env
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Auto-create Ethereal account on first use
      const testAccount = await nodemailer.createTestAccount();
      logger.info('Ethereal test account created', {
        user: testAccount.user,
        pass: testAccount.pass,
        web: 'https://ethereal.email',
      });

      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }
  }

  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/**
 * Send an email. In development, logs the Ethereal preview URL.
 */
export async function sendEmail(options: EmailOptions): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await getTransporter();

  const from = process.env.EMAIL_FROM || 'DayStream <noreply@daystream.app>';

  const info = await transport.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
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
