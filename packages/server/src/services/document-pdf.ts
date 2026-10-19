import sharp from 'sharp';
import { formatCurrency, DETAILS_TABLE_TOKEN } from '@daystream/shared';
import type { DocumentDetailsTable } from '@daystream/shared';
import { selectTemplate, buildTokensForBusiness, substitute } from './document-branding-resolver.service';

/** pdfkit's document instance type (the default export is the constructor value). */
type PdfDoc = PDFKit.PDFDocument;
import type { DocumentBrandingTemplate } from './document-branding.service';

/**
 * Shared branding helpers for PDF documents (spec 10, task 6.3b).
 *
 * The invoice and receipt renderers (and future document PDFs) all apply the same
 * branding chrome from a `pay_document_branding` template — logo, primary/secondary
 * colors, an optional intro note from the body, and a footer with a clickable link.
 * Keeping this in one place means every document PDF brands identically and the
 * email/PDF placeholder substitution stays consistent.
 */

/** A hex color safe to hand pdfkit; falls back when blank/invalid. */
export function safeColor(hex: string | null | undefined, fallback: string): string {
  return hex && /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : fallback;
}

/**
 * Fetch a remote logo and normalize it to a PNG buffer pdfkit can embed. http(s)
 * only, size-capped, with a short timeout. CDNs often content-negotiate to WebP
 * even for a ".png" URL (pdfkit supports only PNG/JPEG), so whatever comes back is
 * run through sharp → PNG. Any failure returns null and the caller falls back to
 * the business-name text — a bad/missing logo never breaks (or slows) the PDF.
 */
export async function fetchLogo(url: string | null | undefined): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/^image\//i.test(type)) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length > 5_000_000) return null; // cap the download at ~5MB
    return await sharp(raw).resize({ width: 600, height: 240, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

/** Flatten the sanitized HTML body to plain text for a pdfkit intro block. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|h3|h4|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The resolved branding chrome for a document PDF, ready to draw. */
export interface ResolvedPdfBranding {
  template: DocumentBrandingTemplate | null;
  primary: string;
  secondary: string;
  logo: Buffer | null;
  /** Business display name, for the header when there's no logo. */
  businessName: string;
  /** Subject line with placeholders substituted (rendered as the document heading). */
  subjectText: string;
  /**
   * Body with placeholders substituted, flattened to text (the document message).
   * May contain the literal `{{details_table}}` marker; the renderer splits on it
   * and draws `detailsTable` at that position.
   */
  introText: string;
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
  /** Line-item table to draw where `{{details_table}}` sits (null = none). */
  detailsTable: DocumentDetailsTable | null;
}

/**
 * Resolve the branding template for an artifact + business and prepare everything
 * a PDF renderer needs: colors (with defaults), the fetched logo, the business
 * name, and the subject / body / footer text with `{{placeholders}}` already
 * substituted from `data`. `detailsTable` is drawn where the `{{details_table}}`
 * token appears in the body.
 */
export async function resolvePdfBranding(
  businessId: string,
  artifactType: string,
  data: Record<string, unknown>,
  detailsTable: DocumentDetailsTable | null = null,
): Promise<ResolvedPdfBranding> {
  const template = await selectTemplate(businessId, artifactType, null);
  const tokens = await buildTokensForBusiness(businessId, data);
  return {
    template,
    primary: safeColor(template?.colorPrimary, '#1A1A1A'),
    secondary: safeColor(template?.colorSecondary, '#C9A96E'),
    logo: await fetchLogo(template?.logoUrl),
    businessName: tokens.business_name || '',
    subjectText: substitute(template?.subjectTemplate, tokens),
    introText: template?.bodyTemplate ? htmlToPlainText(substitute(template.bodyTemplate, tokens)) : '',
    footerText: substitute(template?.footerText, tokens),
    footerLinkText: substitute(template?.footerLinkText, tokens),
    footerLinkUrl: substitute(template?.footerLinkUrl, tokens),
    detailsTable,
  };
}

/**
 * Render a PURE-TEMPLATE document PDF — the exact structure the editor preview
 * shows: a primary-color header band (logo, or the business name in white), the
 * subject as a heading, the body message, and a footer (secondary-color rule +
 * optional clickable link). Nothing else — no structured tables, no separate
 * identity block. What the business designs in the template is the whole document.
 *
 * Returns a PDF buffer. Used for receipts (and any artifact that wants the
 * template to BE the document rather than branding wrapped around structured data).
 */
export function renderTemplateDocumentPdf(branding: ResolvedPdfBranding): Promise<Buffer> {
  const { primary, secondary, logo, businessName, subjectText, introText, footerText, footerLinkText, footerLinkUrl, detailsTable } = branding;

  // Lazy import keeps pdfkit out of modules that only resolve branding.
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;       // A4 ≈ 595pt
    const pad = 40;
    const contentWidth = pageWidth - pad * 2;

    // --- Header band (full-width, primary color) ---
    const bandHeight = 90;
    doc.rect(0, 0, pageWidth, bandHeight).fill(primary);
    if (logo) {
      try { doc.image(logo, pad, 24, { fit: [200, 48] }); }
      catch { doc.fillColor('#ffffff').fontSize(22).text(businessName || 'Document', pad, 34, { width: contentWidth }); }
    } else {
      doc.fillColor('#ffffff').fontSize(22).text(businessName || 'Document', pad, 34, { width: contentWidth });
    }

    // --- Body area ---
    doc.fillColor('#1a1a1a');
    let y = bandHeight + 28;

    if (subjectText) {
      doc.fontSize(16).fillColor(primary).text(subjectText, pad, y, { width: contentWidth });
      doc.fillColor('#1a1a1a');
      y = doc.y + 14;
    }

    // The body may contain the {{details_table}} marker. Split on it and draw the
    // body text around a natively-drawn line-item table at that position.
    const marker = `{{${DETAILS_TABLE_TOKEN}}}`;
    const segments = introText ? introText.split(marker) : [''];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      if (seg) {
        doc.fontSize(11).fillColor('#1a1a1a').text(seg, pad, y, { width: contentWidth, lineGap: 3 });
        y = doc.y;
      }
      // A table goes between segments (i.e. wherever the marker appeared).
      if (i < segments.length - 1 && detailsTable) {
        y += 12;
        y = drawDetailsTable(doc, detailsTable, pad, y, contentWidth, primary, secondary);
      }
    }

    // --- Footer (secondary-color rule + text + link) ---
    if (footerText || (footerLinkText && footerLinkUrl)) {
      y += 24;
      doc.moveTo(pad, y).lineTo(pageWidth - pad, y).lineWidth(2).strokeColor(secondary).stroke().strokeColor('#000');
      y += 10;
      doc.fontSize(9).fillColor('#666');
      if (footerText) { doc.text(footerText, pad, y, { width: contentWidth }); y = doc.y + 2; }
      if (footerLinkText && footerLinkUrl && /^https?:\/\//i.test(footerLinkUrl)) {
        doc.fillColor(secondary).text(footerLinkText, pad, y, { width: contentWidth, link: footerLinkUrl, underline: true });
      }
      doc.fillColor('#000');
    }

    doc.end();
  });
}

/** Draw a Description/Qty/Amount table (+ Total) at `y`; returns the new `y`. */
function drawDetailsTable(
  doc: PdfDoc, table: DocumentDetailsTable, pad: number, startY: number, width: number,
  primary: string, secondary: string,
): number {
  const left = pad;
  const qtyX = pad + width - 180;
  const amtX = pad + width - 90;
  let y = startY;

  const money = (cents: number) => formatCurrency(cents, table.currency, 'en-US');

  // Header row (primary color) + rule.
  doc.fontSize(9).fillColor(primary);
  doc.text('DESCRIPTION', left, y, { width: qtyX - left - 8 });
  doc.text('QTY', qtyX, y, { width: 50, align: 'right' });
  doc.text('AMOUNT', amtX, y, { width: 90, align: 'right' });
  doc.fillColor('#000');
  y += 14;
  doc.moveTo(left, y).lineTo(pad + width, y).lineWidth(1).strokeColor(primary).stroke().strokeColor('#000');
  y += 6;

  // Rows.
  doc.fontSize(10).fillColor('#1a1a1a');
  for (const row of table.rows) {
    const rowTop = y;
    doc.text(row.description || '—', left, rowTop, { width: qtyX - left - 8 });
    const descBottom = doc.y;
    doc.text(String(row.qty), qtyX, rowTop, { width: 50, align: 'right' });
    doc.text(money(row.amountCents), amtX, rowTop, { width: 90, align: 'right' });
    y = Math.max(descBottom, rowTop + 12) + 4;
  }

  // Total (secondary-color rule).
  y += 4;
  doc.moveTo(qtyX, y).lineTo(pad + width, y).lineWidth(2).strokeColor(secondary).stroke().strokeColor('#000');
  y += 8;
  doc.fontSize(11).fillColor('#1a1a1a');
  doc.text('Total', qtyX, y, { width: 50, align: 'right' });
  doc.text(money(table.totalCents), amtX, y, { width: 90, align: 'right' });
  return y + 18;
}

/**
 * Draw the branded header (logo or business name in the primary color) plus the
 * business identity lines. Leaves the cursor below the identity block.
 */
export function drawBrandedHeader(
  doc: PdfDoc,
  branding: ResolvedPdfBranding,
  identity: { name: string; address?: string | null; email?: string | null; phone?: string | null; taxId?: string | null },
  startX = 50,
): void {
  if (branding.logo) {
    try { doc.image(branding.logo, startX, doc.y, { fit: [180, 56] }); doc.moveDown(); doc.y = Math.max(doc.y, 56 + 50); }
    catch { doc.fontSize(20).fillColor(branding.primary).text(identity.name || 'Document').fillColor('#000'); }
  } else {
    doc.fontSize(20).fillColor(branding.primary).text(identity.name || 'Document').fillColor('#000');
  }
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#555');
  if (identity.address) doc.text(identity.address, startX);
  if (identity.email) doc.text(identity.email, startX);
  if (identity.phone) doc.text(identity.phone, startX);
  if (identity.taxId) doc.text(`Tax ID: ${identity.taxId}`, startX);
  doc.fillColor('#000');
}

/**
 * Draw the branded footer (secondary-color divider, footer text, and a clickable
 * link in the primary color). No-op when there's nothing to show.
 */
export function drawBrandedFooter(doc: PdfDoc, branding: ResolvedPdfBranding, startX = 50): void {
  const { footerText, footerLinkText, footerLinkUrl, secondary, primary } = branding;
  if (!footerText && !(footerLinkText && footerLinkUrl)) return;
  doc.moveDown(2);
  const fy = doc.y;
  doc.moveTo(startX, fy).lineTo(545, fy).strokeColor(secondary).stroke().strokeColor('#000');
  doc.moveDown(0.5).fontSize(9).fillColor('#666');
  if (footerText) doc.text(footerText, startX, undefined, { width: 495 });
  if (footerLinkText && footerLinkUrl && /^https?:\/\//i.test(footerLinkUrl)) {
    doc.fillColor(primary).text(footerLinkText, startX, undefined, { width: 495, link: footerLinkUrl, underline: true });
  }
  doc.fillColor('#000');
}
