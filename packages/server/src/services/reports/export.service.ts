import PDFDocument from 'pdfkit';
import { ReportColumn, ReportRunResult } from '@daystream/shared';
import { formatForCsv, formatForPdf } from './formatter';

/** Escape a value for a CSV cell (RFC 4180 style). */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A renderable block of a report: one table. Multi-section reports have several. */
interface ExportBlock {
  title?: string;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals: Record<string, number>;
}

/** Normalize a result into one or more blocks (single-table => one block). */
function toBlocks(result: ReportRunResult): ExportBlock[] {
  if (result.sections && result.sections.length > 0) {
    return result.sections.map((s) => ({ title: s.title, columns: s.columns, rows: s.rows, totals: s.totals }));
  }
  return [{ columns: result.columns, rows: result.rows, totals: result.totals }];
}

/** Serialize a report result to CSV: per block, a header row, data rows, then a totals row. */
export function toCsv(result: ReportRunResult): string {
  const blocks = toBlocks(result);
  const lines: string[] = [];

  blocks.forEach((block, blockIdx) => {
    if (blockIdx > 0) lines.push('');
    if (block.title) lines.push(csvCell(block.title));

    const { columns, rows, totals } = block;
    lines.push(columns.map((c) => csvCell(c.header)).join(','));

    for (const row of rows) {
      lines.push(columns.map((c) => csvCell(formatForCsv(row[c.key], c.type))).join(','));
    }

    if (columns.some((c) => c.total)) {
      const totalRow = columns.map((c, idx) => {
        if (idx === 0) return csvCell('Total');
        if (c.total && totals[c.key] != null) return csvCell(formatForCsv(totals[c.key], c.type));
        return '';
      });
      lines.push(totalRow.join(','));
    }
  });

  return lines.join('\n');
}

/** Serialize a report result to a table-oriented PDF buffer. */
export function toPdf(result: ReportRunResult): Promise<Buffer> {
  const { meta } = result;
  const blocks = toBlocks(result);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const usableWidth = pageRight - pageLeft;
    const rowHeight = 18;
    const cellPad = 4;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - rowHeight;

    function isRight(type: string) {
      return type === 'currency' || type === 'number';
    }

    // --- Report header block ---
    doc.fontSize(18).font('Helvetica-Bold').text(meta.title, pageLeft, doc.y);
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#444444');
    doc.text(meta.businessName);
    doc.text(`Period: ${meta.dateRange.start} to ${meta.dateRange.end}`);
    doc.text(`Generated: ${new Date(meta.generatedAt).toLocaleString('en-US')}`);
    doc.fillColor('#000000');
    doc.moveDown(0.6);

    for (const block of blocks) {
      const { columns, rows, totals } = block;
      const weights = columns.map((c) => (c.type === 'currency' || c.type === 'number' ? 0.8 : c.type === 'date' ? 0.8 : 1.2));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const colWidths = weights.map((w) => (w / weightSum) * usableWidth);

      function drawRow(cells: string[], y: number, opts: { bold?: boolean; fill?: string } = {}) {
        if (opts.fill) {
          doc.rect(pageLeft, y, usableWidth, rowHeight).fill(opts.fill);
          doc.fillColor('#000000');
        }
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        let x = pageLeft;
        cells.forEach((text, i) => {
          const w = colWidths[i];
          doc.text(text, x + cellPad, y + cellPad, {
            width: w - cellPad * 2,
            align: isRight(columns[i].type) ? 'right' : 'left',
            lineBreak: false,
            ellipsis: true,
          });
          x += w;
        });
      }

      let y = doc.y;
      if (y > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }

      // Section title (multi-section reports)
      if (block.title) {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text(block.title, pageLeft, y);
        y = doc.y + 4;
      }

      // Header row
      drawRow(columns.map((c) => c.header), y, { bold: true, fill: '#EEEEEE' });
      y += rowHeight;

      // Data rows with pagination
      for (const row of rows) {
        if (y > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
          drawRow(columns.map((c) => c.header), y, { bold: true, fill: '#EEEEEE' });
          y += rowHeight;
        }
        drawRow(columns.map((c) => formatForPdf(row[c.key], c.type, meta.currency)), y);
        y += rowHeight;
      }

      // Totals row
      if (columns.some((c) => c.total)) {
        if (y > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
        const totalCells = columns.map((c, idx) => {
          if (idx === 0) return 'Total';
          if (c.total && totals[c.key] != null) return formatForPdf(totals[c.key], c.type, meta.currency);
          return '';
        });
        drawRow(totalCells, y, { bold: true, fill: '#F5F5F5' });
        y += rowHeight;
      }

      doc.y = y + 12; // gap before next section
    }

    // --- Page numbers ---
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#888888');
      doc.text(
        `Page ${i - range.start + 1} of ${range.count}`,
        pageLeft,
        doc.page.height - doc.page.margins.bottom + 6,
        { width: usableWidth, align: 'right' },
      );
    }

    doc.end();
  });
}

/** Build a download filename like `revenue_2026-06-01_2026-06-30.pdf`. */
export function exportFilename(result: ReportRunResult, format: 'csv' | 'pdf'): string {
  const { reportId, dateRange } = result.meta;
  return `${reportId}_${dateRange.start}_${dateRange.end}.${format}`;
}
