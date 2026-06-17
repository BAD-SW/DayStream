/**
 * Provider abstraction layer for messaging channels.
 * Currently uses mock implementations; swap in real providers (SendGrid, Twilio, etc.) per tenant config.
 */

// ============================================================
// Interfaces
// ============================================================

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SendResult {
  messageId: string;
  success: boolean;
}

export interface MessageAdapter {
  sendEmail(to: string, subject: string, html: string, text?: string): Promise<SendResult>;
  sendBulkEmail(messages: EmailMessage[]): Promise<SendResult[]>;
}

export interface SmsAdapter {
  sendSms(to: string, body: string): Promise<SendResult>;
  sendBulkSms(messages: SmsMessage[]): Promise<SendResult[]>;
}

// ============================================================
// Mock Implementations
// ============================================================

function generateMockId(): string {
  return `mock_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export class MockEmailAdapter implements MessageAdapter {
  async sendEmail(to: string, subject: string, html: string, text?: string): Promise<SendResult> {
    const messageId = generateMockId();
    console.log(`[MockEmail] Sending to=${to} subject="${subject}" messageId=${messageId}`);
    return { messageId, success: true };
  }

  async sendBulkEmail(messages: EmailMessage[]): Promise<SendResult[]> {
    console.log(`[MockEmail] Sending bulk: ${messages.length} messages`);
    return messages.map((msg) => {
      const messageId = generateMockId();
      console.log(`[MockEmail] Bulk to=${msg.to} subject="${msg.subject}" messageId=${messageId}`);
      return { messageId, success: true };
    });
  }
}

export class MockSmsAdapter implements SmsAdapter {
  async sendSms(to: string, body: string): Promise<SendResult> {
    const messageId = generateMockId();
    console.log(`[MockSms] Sending to=${to} body="${body.substring(0, 50)}..." messageId=${messageId}`);
    return { messageId, success: true };
  }

  async sendBulkSms(messages: SmsMessage[]): Promise<SendResult[]> {
    console.log(`[MockSms] Sending bulk: ${messages.length} messages`);
    return messages.map((msg) => {
      const messageId = generateMockId();
      console.log(`[MockSms] Bulk to=${msg.to} messageId=${messageId}`);
      return { messageId, success: true };
    });
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Get the email adapter for a tenant.
 * Placeholder: returns MockEmailAdapter. In production, resolve provider from tenant config.
 */
export function getEmailAdapter(_tenantId: string): MessageAdapter {
  // Future: look up tenant's configured email provider (SendGrid, SES, etc.)
  return new MockEmailAdapter();
}

/**
 * Get the SMS adapter for a tenant.
 * Placeholder: returns MockSmsAdapter. In production, resolve provider from tenant config.
 */
export function getSmsAdapter(_tenantId: string): SmsAdapter {
  // Future: look up tenant's configured SMS provider (Twilio, etc.)
  return new MockSmsAdapter();
}
