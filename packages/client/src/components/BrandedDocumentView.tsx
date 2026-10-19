/**
 * BrandedDocumentView — the ONE on-screen renderer for a branded document
 * (receipt, invoice email body, etc). Both the template editor's Preview and any
 * page that shows a real document (e.g. the order receipt page) render through
 * this, so what a user sees always matches the template they built.
 *
 * It renders the "pure template" structure: a primary-color header band (logo or
 * business name), the subject as a heading, the body (sanitized HTML), and a
 * footer with a secondary-color rule and optional link. Values passed in are
 * already placeholder-filled (sample values in the editor, real values on a page).
 */

export interface BrandedDocumentTableRow {
  description: string;
  qty: number;
  amountCents: number;
}

export interface BrandedDocumentTable {
  rows: BrandedDocumentTableRow[];
  totalCents: number;
  currency: string;
}

export interface BrandedDocumentFields {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  businessName: string;
  /** Subject heading, placeholders already filled. */
  subject: string;
  /**
   * Body HTML (sanitized), placeholders already filled. May contain the literal
   * `{{details_table}}` marker; the view splits on it and draws `detailsTable`.
   */
  bodyHtml: string;
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
  /** Line-item table drawn where `{{details_table}}` sits (null/undefined = none). */
  detailsTable?: BrandedDocumentTable | null;
}

const DEFAULT_PRIMARY = '#1A1A1A';
const DEFAULT_SECONDARY = '#C9A96E';
const DETAILS_MARKER = '{{details_table}}';

function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

/** The Description/Qty/Amount table (+ Total) drawn where the marker appears. */
function DetailsTable({ table, primary, secondary }: { table: BrandedDocumentTable; primary: string; secondary: string }) {
  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={{ ...s.th, color: primary, borderBottomColor: primary }}>Description</th>
          <th style={{ ...s.th, ...s.thRight, color: primary, borderBottomColor: primary }}>Qty</th>
          <th style={{ ...s.th, ...s.thRight, color: primary, borderBottomColor: primary }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>
            <td style={s.td}>{r.description || '—'}</td>
            <td style={{ ...s.td, ...s.tdRight }}>{r.qty}</td>
            <td style={{ ...s.td, ...s.tdRight }}>{fmtMoney(r.amountCents, table.currency)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td style={s.totalSpacer} />
          <td style={{ ...s.totalLabel, borderTopColor: secondary }}>Total</td>
          <td style={{ ...s.totalValue, borderTopColor: secondary }}>{fmtMoney(table.totalCents, table.currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Render the body, drawing the details table where the `{{details_table}}` marker
 * sits. The body HTML is split on the marker; each half is rendered as sanitized
 * HTML and the app-generated table is placed between them.
 */
function renderBody(fields: BrandedDocumentFields, primary: string, secondary: string) {
  const html = fields.bodyHtml || '';
  const table = fields.detailsTable;

  if (!html.includes(DETAILS_MARKER) || !table) {
    // No marker (or no data) — strip any stray marker and render the body as-is.
    const clean = html.replace(DETAILS_MARKER, '') || '<p style="color:#999">(No body content)</p>';
    return <div style={s.body} dangerouslySetInnerHTML={{ __html: clean }} />;
  }

  const [before, after] = html.split(DETAILS_MARKER);
  return (
    <div style={s.body}>
      {before && <div dangerouslySetInnerHTML={{ __html: before }} />}
      <DetailsTable table={table} primary={primary} secondary={secondary} />
      {after && <div dangerouslySetInnerHTML={{ __html: after }} />}
    </div>
  );
}

export function BrandedDocumentView({ fields }: { fields: BrandedDocumentFields }) {
  const primary = fields.primaryColor || DEFAULT_PRIMARY;
  const secondary = fields.secondaryColor || DEFAULT_SECONDARY;
  const hasFooter = Boolean(fields.footerText || (fields.footerLinkText && fields.footerLinkUrl));

  return (
    <div style={s.doc}>
      <div style={{ ...s.header, background: primary }}>
        {fields.logoUrl
          ? <img src={fields.logoUrl} alt="Logo" style={s.logo} />
          : <span style={s.logoText}>{fields.businessName}</span>}
      </div>
      <div style={s.bodyWrap}>
        {fields.subject && <div style={{ ...s.subject, color: primary }}>{fields.subject}</div>}
        {renderBody(fields, primary, secondary)}
        {hasFooter && (
          <div style={{ ...s.footer, borderTopColor: secondary }}>
            {fields.footerText && <span>{fields.footerText}</span>}
            {fields.footerLinkText && fields.footerLinkUrl && (
              <>
                {fields.footerText ? ' ' : null}
                <a href={fields.footerLinkUrl} target="_blank" rel="noreferrer" style={{ ...s.link, color: secondary }}>
                  {fields.footerLinkText}
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  doc: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', overflow: 'hidden', background: '#ffffff', color: '#1a1a1a' },
  header: { padding: '20px 24px', display: 'flex', alignItems: 'center', minHeight: '64px' },
  logo: { maxHeight: '48px', maxWidth: '220px', objectFit: 'contain' as const },
  logoText: { color: '#ffffff', fontSize: '1.25rem', fontWeight: 600 },
  bodyWrap: { padding: '24px' },
  subject: { fontSize: '1.125rem', fontWeight: 600, marginBottom: '16px' },
  body: { fontSize: '0.95rem', lineHeight: 1.6, color: '#1a1a1a' },
  footer: { marginTop: '24px', paddingTop: '12px', borderTop: '2px solid', fontSize: '0.8rem', color: '#666666' },
  link: { textDecoration: 'underline', fontWeight: 600 },
  // Details table
  table: { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0', fontSize: '0.9rem' },
  th: { textAlign: 'left' as const, fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', padding: '6px 0', borderBottom: '1px solid' },
  thRight: { textAlign: 'right' as const },
  td: { padding: '8px 0', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' },
  tdRight: { textAlign: 'right' as const },
  totalSpacer: { borderBottom: 'none' },
  totalLabel: { textAlign: 'right' as const, fontWeight: 700, padding: '8px 12px 0 0', borderTop: '2px solid' },
  totalValue: { textAlign: 'right' as const, fontWeight: 700, padding: '8px 0 0 0', borderTop: '2px solid' },
};
