import { entriesByColumn } from '@daystream/shared';
import type { FormAnswer, FormDefinition } from '@daystream/shared';

/**
 * Draws a completed form as a PDF (spec 51, gap 1). The PDF is the only record of the answers;
 * they are never stored in the database. It shows exactly the wording that was signed, the
 * customer's answers, the signature and the facts of the signing.
 *
 * pdfkit's built-in font covers Western European languages (English, Spanish, French, German,
 * Italian, Portuguese). Text outside that range would need an embedded font.
 */

export interface FormPdfInput {
  businessName: string;
  logo: Buffer | null;
  primaryColor: string;
  formName: string;
  formVersion: number;
  language: string | null;
  definition: FormDefinition;
  answers: Record<string, FormAnswer | undefined>;
  customerName: string;
  /** A PNG of the drawn signature, for a signed form. */
  signaturePng: Buffer | null;
  /** When the form was completed. */
  completedAt: Date;
  timezone: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** The submission id, printed as the reference. */
  reference: string;
  /** How it was completed. */
  completedVia: 'device' | 'link' | 'staff';
  /** The staff member who filled it in for the customer, when completedVia is 'staff'. */
  completedByName: string | null;
  /** Set for a treatment chart (spec 51, gap 2): drawn as a record signed off by a practitioner. */
  chart?: { practitioner: string; signedAt: Date; amendments: { at: Date; by: string; text: string }[] };
}

const WORDS: Record<string, Record<string, string>> = {
  en: { yes: 'Yes', no: 'No', none: 'Not answered', customer: 'Customer', completed: 'Completed', signed: 'Signed by', agreed: 'Agreed', ref: 'Reference', version: 'Version', via: 'Completed', device: 'on a device at the business', link: 'from an emailed link', staff: 'by staff on the customer\'s behalf', ip: 'IP address', dev: 'Device', page: 'Page' },
  es: { yes: 'Sí', no: 'No', none: 'Sin respuesta', customer: 'Cliente', completed: 'Completado', signed: 'Firmado por', agreed: 'Aceptado', ref: 'Referencia', version: 'Versión', via: 'Completado', device: 'en un dispositivo del negocio', link: 'desde un enlace por correo', staff: 'por el personal en nombre del cliente', ip: 'Dirección IP', dev: 'Dispositivo', page: 'Página' },
  fr: { yes: 'Oui', no: 'Non', none: 'Sans réponse', customer: 'Client', completed: 'Rempli', signed: 'Signé par', agreed: 'Accepté', ref: 'Référence', version: 'Version', via: 'Rempli', device: 'sur un appareil de l\'établissement', link: 'depuis un lien envoyé par e-mail', staff: 'par le personnel au nom du client', ip: 'Adresse IP', dev: 'Appareil', page: 'Page' },
  de: { yes: 'Ja', no: 'Nein', none: 'Nicht beantwortet', customer: 'Kunde', completed: 'Ausgefüllt', signed: 'Unterschrieben von', agreed: 'Zugestimmt', ref: 'Referenz', version: 'Version', via: 'Ausgefüllt', device: 'auf einem Gerät im Betrieb', link: 'über einen E-Mail-Link', staff: 'vom Personal im Namen des Kunden', ip: 'IP-Adresse', dev: 'Gerät', page: 'Seite' },
};
const wordsFor = (lang: string | null) => WORDS[(lang ?? 'en').slice(0, 2)] ?? WORDS.en;

/** "5 Jul 2026, 14:32" in the business's time zone (falls back to UTC for an unknown zone). */
export function formatInZone(date: Date, timezone: string, lang: string | null): string {
  const locale = lang && /^[a-z]{2}/.test(lang) ? lang : 'en';
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(date);
  }
}

function answerText(
  item: FormDefinition['items'][number], answer: FormAnswer | undefined, w: Record<string, string>,
): string {
  if (answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)) return w.none;
  if (item.type === 'yes_no') return answer === 'yes' ? w.yes : w.no;
  if (Array.isArray(answer)) return answer.join(', ');
  return String(answer);
}

export function renderFormPdf(input: FormPdfInput): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');
  const w = wordsFor(input.language);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const pad = 44;
    const contentWidth = pageWidth - pad * 2;
    const bottom = pageHeight - 60;
    const primary = /^#[0-9a-fA-F]{6}$/.test(input.primaryColor) ? input.primaryColor : '#1a1a1a';

    const ensure = (needed: number) => { if (doc.y + needed > bottom) doc.addPage(); };

    // Header band
    doc.rect(0, 0, pageWidth, 80).fill(primary);
    let drewLogo = false;
    if (input.logo) {
      try { doc.image(input.logo, pad, 18, { fit: [180, 44] }); drewLogo = true; } catch { drewLogo = false; }
    }
    if (!drewLogo) doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(input.businessName, pad, 30, { width: contentWidth });

    // Title block
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(18).text(input.formName, pad, 104, { width: contentWidth });
    doc.fillColor('#666666').font('Helvetica').fontSize(10)
      .text(`${w.customer}: ${input.customerName}`, pad, doc.y + 4, { width: contentWidth })
      .text(`${w.completed}: ${formatInZone(input.completedAt, input.timezone, input.language)}`, pad, doc.y + 2, { width: contentWidth });
    doc.moveDown(0.8);
    doc.moveTo(pad, doc.y).lineTo(pageWidth - pad, doc.y).lineWidth(1).strokeColor('#dddddd').stroke();
    doc.y += 14;

    // Items
    for (const item of input.definition.items) {
      switch (item.type) {
        case 'heading':
          ensure(40);
          doc.fillColor(primary).font('Helvetica-Bold').fontSize(13).text(item.text, pad, doc.y + 6, { width: contentWidth });
          doc.moveDown(0.4);
          break;
        case 'text':
          ensure(30);
          doc.fillColor('#1a1a1a').font('Helvetica').fontSize(10).text(item.text, pad, doc.y, { width: contentWidth, lineGap: 2 });
          doc.moveDown(0.6);
          break;
        case 'agree': {
          ensure(40);
          const ticked = input.signaturePng !== null || input.answers[item.id] === true;
          doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
            .text(`${ticked ? '[x]' : '[ ]'}  ${item.label}`, pad, doc.y + 4, { width: contentWidth });
          doc.moveDown(0.6);
          break;
        }
        case 'signature': {
          ensure(130);
          doc.fillColor('#666666').font('Helvetica').fontSize(9).text(item.label, pad, doc.y + 6, { width: contentWidth });
          const boxY = doc.y + 4;
          doc.rect(pad, boxY, 260, 80).lineWidth(0.5).strokeColor('#bbbbbb').stroke();
          if (input.signaturePng) {
            try { doc.image(input.signaturePng, pad + 4, boxY + 4, { fit: [252, 72] }); } catch { /* unreadable image: leave the box empty */ }
          }
          doc.y = boxY + 88;
          if (input.signaturePng) {
            doc.fillColor('#1a1a1a').font('Helvetica').fontSize(10)
              .text(`${w.signed}: ${input.customerName}`, pad, doc.y, { width: contentWidth });
          }
          doc.moveDown(0.6);
          break;
        }
        case 'multi_choice': {
          // A table of tick boxes: every entry is shown, ticked or not, in the columns the form defines,
          // so the record shows what was offered as well as what was chosen.
          const ticked = new Set(Array.isArray(input.answers[item.id]) ? (input.answers[item.id] as string[]) : []);
          const columns = entriesByColumn(item.options, item.columns ?? 1);
          const gap = 16;
          const colWidth = (contentWidth - gap * (columns.length - 1)) / Math.max(1, columns.length);
          const rowHeight = 14;
          ensure(40);
          doc.fillColor('#666666').font('Helvetica').fontSize(9).text(item.label, pad, doc.y + 2, { width: contentWidth });
          let y = doc.y + 4;
          const rows = Math.max(...columns.map((c) => c.length), 0);
          for (let r = 0; r < rows; r++) {
            if (y + rowHeight > bottom) { doc.addPage(); y = 50; }
            columns.forEach((col, c) => {
              const entry = col[r];
              if (entry === undefined) return;
              doc.fillColor('#1a1a1a').font(ticked.has(entry) ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
                .text(`${ticked.has(entry) ? '[x]' : '[ ]'}  ${entry}`, pad + c * (colWidth + gap), y, { width: colWidth, lineBreak: false, ellipsis: true });
            });
            y += rowHeight;
          }
          doc.y = y + 6;
          break;
        }
        default: {
          ensure(40);
          doc.fillColor('#666666').font('Helvetica').fontSize(9).text(item.label, pad, doc.y + 2, { width: contentWidth });
          doc.fillColor('#1a1a1a').font('Helvetica').fontSize(11)
            .text(answerText(item, input.answers[item.id], w), pad, doc.y + 1, { width: contentWidth, lineGap: 2 });
          doc.moveDown(0.5);
        }
      }
    }

    if (input.chart) {
      // Sign-off block and amendments of a treatment chart.
      const chart = input.chart;
      ensure(90);
      doc.y += 8;
      doc.moveTo(pad, doc.y).lineTo(pageWidth - pad, doc.y).lineWidth(1).strokeColor('#dddddd').stroke();
      doc.y += 8;
      doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
        .text(`Signed off by ${chart.practitioner}, ${formatInZone(chart.signedAt, input.timezone, input.language)}`, pad, doc.y + 1, { width: contentWidth });
      doc.fillColor('#666666').font('Helvetica').fontSize(8.5)
        .text(`Reference: ${input.reference}  |  Template version: ${input.formVersion}`, pad, doc.y + 2, { width: contentWidth });
      if (chart.amendments.length > 0) {
        doc.moveDown(0.8);
        doc.fillColor(primary).font('Helvetica-Bold').fontSize(12).text('Amendments', pad, doc.y, { width: contentWidth });
        for (const a of chart.amendments) {
          ensure(50);
          doc.fillColor('#666666').font('Helvetica').fontSize(8.5)
            .text(`Added by ${a.by}, ${formatInZone(a.at, input.timezone, input.language)}`, pad, doc.y + 4, { width: contentWidth });
          doc.fillColor('#1a1a1a').font('Helvetica').fontSize(10).text(a.text, pad, doc.y + 1, { width: contentWidth, lineGap: 2 });
        }
      }
    } else {
    // Evidence block
    ensure(110);
    doc.y += 8;
    doc.moveTo(pad, doc.y).lineTo(pageWidth - pad, doc.y).lineWidth(1).strokeColor('#dddddd').stroke();
    doc.y += 8;
    doc.fillColor('#666666').font('Helvetica').fontSize(8.5);
    const how = input.completedVia === 'staff' && input.completedByName
      ? `${w.staff} (${input.completedByName})`
      : w[input.completedVia];
    const lines = [
      `${w.ref}: ${input.reference}`,
      `${w.version}: ${input.formVersion}${input.language ? ` (${input.language})` : ''}`,
      `${w.via}: ${how}`,
    ];
    if (input.ipAddress) lines.push(`${w.ip}: ${input.ipAddress}`);
    if (input.userAgent) lines.push(`${w.dev}: ${input.userAgent.slice(0, 140)}`);
    for (const l of lines) doc.text(l, pad, doc.y + 1, { width: contentWidth });
    }

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor('#999999').font('Helvetica').fontSize(8)
        .text(`${input.businessName}  |  ${w.page} ${i + 1}/${range.count}`, pad, pageHeight - 40, { width: contentWidth, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
