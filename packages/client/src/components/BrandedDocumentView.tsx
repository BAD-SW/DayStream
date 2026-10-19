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

export interface BrandedDocumentFields {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  businessName: string;
  /** Subject heading, placeholders already filled. */
  subject: string;
  /** Body HTML (sanitized), placeholders already filled. */
  bodyHtml: string;
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
}

const DEFAULT_PRIMARY = '#1A1A1A';
const DEFAULT_SECONDARY = '#C9A96E';

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
        <div
          style={s.body}
          // Body is a sanitized HTML subset, already placeholder-filled.
          dangerouslySetInnerHTML={{ __html: fields.bodyHtml || '<p style="color:#999">(No body content)</p>' }}
        />
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
};
