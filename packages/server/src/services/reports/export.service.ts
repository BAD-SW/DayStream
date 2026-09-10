import PDFDocument from 'pdfkit';
import { ReportRunResult } from '@daystream/shared';
import { formatForCsv, formatForPdf } from './formatter';

/** Escape a value for a CSV cell (RFC 4180 style). */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize a report result to CSV: header row, data rows, then a totals row. */
export function toCsv(result: ReportRunResult): string {
  const { columns, rows, totals } = result;

  const header = columns.map((c) => csvCell(c.header)).join(',');

  const dataLines = rows.map((row) =>
    columns.map((c) => csvCell(formatForCsv(row[c.key], c.type))).join(','),
  );

  const hasTotals = columns.some((c) => c.total);
  const totalLines: string[] = [];
  if (hasTotals) {
    const totalRow = columns.map((c, idx) => {
      if (idx === 0) return csvCell('Total');
      if (c.total && totals[c.key] != null) return csvCell(formatForCsv(totals[c.key], c.type));
      return '';
    });
    totalLines.push(totalRow.join(','));
  }

  return [header, ...dataLines, ...totalLines].join('\n');
}

/** Serialize a report result to a table-oriented PDF buffer. */
export function toPdf(result: ReportRunResult): Promise<Buffer> {
  const { columns, rows, totals, meta } = result;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const usableWidth = pageRight - pageLeft;

    // --- Header block ---
    doc.fontSize(18).font('Helvetica-Bold').text(meta.title, pageLeft, doc.y);
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#444444');
    doc.text(meta.businessName);
    doc.text(`Period: ${meta.dateRange.start} to ${meta.dateRange.end}`);
    doc.text(`Generated: ${new Date(meta.generatedAt).toLocaleString('en-US')}`);
    doc.fillColor('#000000');
    doc.moveDown(0.6);

    // --- Column widths (proportional; numeric columns get less room) ---
    const weights = columns.map((c) => (c.type === 'currency' || c.type === 'number' ? 0.8 : c.type === 'date' ? 0.8 : 1.2));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const colWidths = weights.map((w) => (w / weightSum) * usableWidth);

    const rowHeight = 18;
    const cellPad = 4;

    function isRight(type: string) {
      return type === 'currency' || type === 'number';
    }

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

    // --- Header row ---
    let y = doc.y;
    drawRow(columns.map((c) => c.header), y, { bold: true, fill: '#EEEEEE' });
    y += rowHeight;

    // --- Data rows with pagination ---
    const bottomLimit = doc.page.height - doc.page.margins.bottom - rowHeight;
    for (const row of rows) {
      if (y > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(columns.map((c) => c.header), y, { bold: true, fill: '#EEEEEE' });
        y += rowHeight;
      }
      drawRow(
        columns.map((c) => formatForPdf(row[c.key], c.type, meta.currency)),
        y,
      );
      y += rowHeight;
    }

    // --- Totals row ---
    const hasTotals = columns.some((c) => c.total);
    if (hasTotals) {
      if (y > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const totalCells = columns.map((c, idx) => {
        if (idx === 0) return 'Total';
        if (c.total && totals[c.key] != null) return formatForPdf(totals[c.key], c.type, meta.currency);
        return '';
      });
      drawRow(totalCells, y, { bold: true, fill: '#F5F5F5' });
      y += rowHeight;
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
