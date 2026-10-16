import { adminPool } from '../db/pool';
import { formatCurrency } from '@daystream/shared';
import { getArtifactType, isKnownArtifactType } from '@daystream/shared';
import { listTemplates, DocumentBrandingTemplate } from './document-branding.service';

/**
 * Document branding RESOLVER + RENDER layer (spec 10, task 6.2 / Requirement C12).
 *
 * Two responsibilities, kept separate from the CRUD surface
 * (document-branding.service.ts):
 *
 *   1. SELECT — given a business, an artifact/notification type, and optional
 *      language, pick the applicable template from the candidate rows. Falls back
 *      to a language-agnostic active template, then to a platform default when the
 *      business has no template at all.
 *
 *   2. RENDER — substitute {{placeholder}} tokens with real values (money
 *      formatted via the shared currency helper), then assemble a branded HTML
 *      email (logo + primary/secondary colors + subject + body + footer with a
 *      safe clickable link). The body is already stored as a sanitized HTML
 *      subset by the editor; we treat it as trusted-but-constrained here.
 *
 * Isolation follows Section C convention: adminPool, scoped by business_id.
 */

/**
 * Some notification types aren't 1:1 with artifact catalog keys. Map them to the
 * catalog key whose branding should apply. Anything not listed is used as-is.
 */
const TYPE_ALIASES: Record<string, string> = {
  // A paid-invoice receipt is branded as a Receipt.
  'invoice.paid': 'payment.receipt',
};

/** Resolve a notification type to its branding artifact key. */
export function resolveArtifactKey(notificationType: string): string {
  return TYPE_ALIASES[notificationType] ?? notificationType;
}

/**
 * Pick the applicable template for a business + artifact type. Selection order:
 *   1. active template whose language matches the requested language exactly
 *   2. active template with no language set (language-agnostic / default)
 *   3. any active template (first by name)
 * Returns null when the business has no active template for the type — callers
 * then fall back to a platform-default render.
 */
export async function selectTemplate(
  businessId: string,
  notificationType: string,
  language?: string | null,
): Promise<DocumentBrandingTemplate | null> {
  const artifactKey = resolveArtifactKey(notificationType);
  if (!isKnownArtifactType(artifactKey)) return null;

  const candidates = (await listTemplates(businessId, artifactKey)).filter((t) => t.isActive);
  if (candidates.length === 0) return null;

  if (language) {
    const exact = candidates.find((t) => (t.language ?? '').toLowerCase() === language.toLowerCase());
    if (exact) return exact;
  }
  const agnostic = candidates.find((t) => !t.language);
  if (agnostic) return agnostic;

  return candidates[0];
}

/** Business identity + locale, used as placeholder fallbacks and for formatting. */
interface BusinessIdentity {
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  locale: string;
}

async function getBusinessIdentity(businessId: string): Promise<BusinessIdentity> {
  const { rows } = await adminPool.query(
    `SELECT name, address, email, phone, currency, default_language
       FROM sys_businesses WHERE id = $1`,
    [businessId],
  );
  const r = rows[0] ?? {};
  return {
    name: r.name ?? '',
    address: r.address ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    currency: r.currency ?? process.env.PLATFORM_CURRENCY ?? 'EUR',
    locale: localeFor(r.default_language),
  };
}

/** Map a stored language tag to an Intl locale, defaulting sensibly. */
function localeFor(language?: string | null): string {
  if (!language) return 'en-US';
  // Stored tags are short (en, es, ...); Intl accepts them directly.
  return language;
}

/**
 * A date-ish value → a readable date string; passes through non-dates unchanged.
 *
 * Date-only strings (YYYY-MM-DD) are parsed as LOCAL dates, not UTC. `new Date('2026-10-29')`
 * is interpreted as UTC midnight, which in any timezone behind UTC renders as the
 * previous day — so we construct the date from its parts to keep it stable.
 */
function fmtDate(value: unknown, locale: string): string {
  if (value == null || value === '') return '';
  const raw = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Build the flat token→string map the renderer substitutes. This is the single
 * place that knows how raw queued `data` (with *_cents integers and ISO dates)
 * becomes catalog placeholder tokens. Business-identity tokens fall back to
 * sys_businesses when the queued data / branding doesn't override them.
 */
export function buildTokenMap(
  data: Record<string, unknown>,
  identity: BusinessIdentity,
): Record<string, string> {
  const currency = typeof data.currency === 'string' ? data.currency : identity.currency;
  const locale = identity.locale;

  const money = (cents: unknown): string =>
    typeof cents === 'number' ? formatCurrency(cents, currency, locale) : '';

  const str = (v: unknown): string => (v == null ? '' : String(v));

  // Derive a first name from a full "customer_name" when not given explicitly.
  const customerName = str(data.customer_name);
  const customerFirst = str(data.customer_first_name) || customerName.split(' ')[0] || '';

  const map: Record<string, string> = {
    // Business identity (queued data may override; otherwise sys_businesses).
    business_name: str(data.business_name) || identity.name,
    business_address: str(data.business_address) || str(identity.address),
    business_email: str(data.business_email) || str(identity.email),
    business_phone: str(data.business_phone) || str(identity.phone),
    // Recipient.
    customer_name: customerName,
    customer_first_name: customerFirst,
    customer_email: str(data.customer_email),
    // Common money/date/reference fields across artifacts (formatted).
    amount_due: money(data.total_cents ?? data.amount_due_cents ?? data.amount_cents),
    amount_paid: money(data.amount_cents ?? data.amount_paid_cents),
    credit_amount: money(data.credit_amount_cents ?? data.amount_cents),
    refund_amount: money(data.refund_amount_cents ?? data.amount_cents),
    renewal_amount: money(data.renewal_amount_cents ?? data.amount_cents),
    gift_card_amount: money(data.gift_card_amount_cents ?? data.amount_cents),
    invoice_number: str(data.invoice_number),
    receipt_number: str(data.receipt_number ?? data.reference_number),
    credit_note_number: str(data.credit_note_number),
    reference_number: str(data.reference_number),
    original_invoice_number: str(data.original_invoice_number),
    invoice_date: fmtDate(data.invoice_date ?? data.issue_date, locale),
    credit_note_date: fmtDate(data.credit_note_date, locale),
    due_date: fmtDate(data.due_date, locale),
    payment_date: fmtDate(data.payment_date, locale),
    refund_date: fmtDate(data.refund_date, locale),
    original_payment_date: fmtDate(data.original_payment_date, locale),
    retry_date: fmtDate(data.retry_date, locale),
    renewal_date: fmtDate(data.renewal_date, locale),
    expiry_date: fmtDate(data.expiry_date, locale),
    payment_method: str(data.payment_method ?? data.method),
    failure_reason: str(data.failure_reason),
    reason: str(data.reason),
    membership_name: str(data.membership_name),
    gift_card_code: str(data.gift_card_code),
    recipient_name: str(data.recipient_name),
    sender_name: str(data.sender_name),
    // Links (pass through; validated at save time).
    payment_link: str(data.payment_link),
    update_payment_link: str(data.update_payment_link),
    manage_link: str(data.manage_link),
    redeem_link: str(data.redeem_link),
  };
  return map;
}

/**
 * Build the token map for a business from a data bag, doing the identity lookup
 * internally. Shared entry point so email (resolver) and PDF (invoice renderer)
 * fill placeholders identically.
 */
export async function buildTokensForBusiness(
  businessId: string,
  data: Record<string, unknown>,
): Promise<Record<string, string>> {
  const identity = await getBusinessIdentity(businessId);
  return buildTokenMap(data, identity);
}

/** The established {{token}} substitution (tolerates inner whitespace). */
export function substitute(text: string | null | undefined, tokens: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : '',
  );
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only allow http(s) URLs through to an href; anything else becomes empty. */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

export interface RenderedDocument {
  subject: string;
  /** Full HTML email document. */
  html: string;
  /** Plain-text fallback for email clients without HTML. */
  text: string;
  /** Sender identity for the transport, when branded. */
  senderName: string | null;
  replyTo: string | null;
}

/**
 * Render a resolved template (or a platform default when template is null) into
 * a branded HTML email for a given data bag.
 */
export async function renderDocument(
  businessId: string,
  notificationType: string,
  data: Record<string, unknown>,
  template: DocumentBrandingTemplate | null,
  language?: string | null,
): Promise<RenderedDocument> {
  const identity = await getBusinessIdentity(businessId);
  const tokens = buildTokenMap(data, identity);

  const primary = template?.colorPrimary || '#1A1A1A';
  const secondary = template?.colorSecondary || '#C9A96E';
  const logoUrl = safeUrl(template?.logoUrl || '');

  // Subject: branded template if present, else a sensible default per artifact.
  const artifact = getArtifactType(resolveArtifactKey(notificationType));
  const defaultSubject = artifact ? `${identity.name} — ${artifact.label}` : identity.name;
  const subject = template?.subjectTemplate
    ? substitute(template.subjectTemplate, tokens)
    : defaultSubject;

  // Body: branded HTML (already a sanitized subset), else a minimal default.
  const bodyHtml = template?.bodyTemplate
    ? substitute(template.bodyTemplate, tokens)
    : `<p>Hi ${escapeHtml(tokens.customer_first_name || 'there')},</p>`;

  // Footer text + optional safe clickable link.
  const footerText = substitute(template?.footerText, tokens);
  const footerLinkText = substitute(template?.footerLinkText, tokens);
  const footerLinkUrl = safeUrl(substitute(template?.footerLinkUrl, tokens));
  const footerLinkHtml = footerLinkText && footerLinkUrl
    ? `<a href="${escapeHtml(footerLinkUrl)}" style="color:${escapeHtml(secondary)};font-weight:600;">${escapeHtml(footerLinkText)}</a>`
    : '';

  const headerInner = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(identity.name)}" style="max-height:48px;max-width:220px;" />`
    : `<span style="color:#ffffff;font-size:20px;font-weight:600;">${escapeHtml(tokens.business_name)}</span>`;

  const footerInner = (footerText || footerLinkHtml)
    ? `<div style="margin-top:24px;padding-top:12px;border-top:2px solid ${escapeHtml(secondary)};font-size:12px;color:#666666;">
         ${footerText ? escapeHtml(footerText) : ''}${footerText && footerLinkHtml ? ' ' : ''}${footerLinkHtml}
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:${escapeHtml(primary)};padding:20px 24px;display:flex;align-items:center;min-height:64px;">
      ${headerInner}
    </div>
    <div style="padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6;">
      ${bodyHtml}
      ${footerInner}
    </div>
  </div>
</body>
</html>`;

  // Plain-text fallback: strip tags from the body, keep footer text + link URL.
  const text = [
    stripTags(bodyHtml),
    footerText,
    footerLinkText && footerLinkUrl ? `${footerLinkText}: ${footerLinkUrl}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    subject,
    html,
    text,
    senderName: template?.senderName ?? null,
    replyTo: template?.replyTo ?? null,
  };
}

/** Crude tag strip for the plain-text fallback (body is a constrained subset). */
function stripTags(html: string): string {
  return html
    .replace(/<\/(p|div|h3|h4|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * One-shot convenience: select the applicable template and render it. Used by the
 * notification dispatch seam.
 */
export async function resolveAndRender(
  businessId: string,
  notificationType: string,
  data: Record<string, unknown>,
  language?: string | null,
): Promise<RenderedDocument> {
  const template = await selectTemplate(businessId, notificationType, language);
  return renderDocument(businessId, notificationType, data, template, language);
}
