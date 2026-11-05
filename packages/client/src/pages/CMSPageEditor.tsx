import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, useDraftSections, useDraft, fieldMark } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import * as cmsApi from '../api/cms';

// One Save for the page (David, 2026-11-02, as in Settings, Events and People): changed fields are
// marked and leaving asks first; Publish acts straight away.
export function CMSPageEditor() {
  return (
    <DraftSectionsProvider>
      <CMSPageEditorPage />
    </DraftSectionsProvider>
  );
}

// A page stores its content as blocks and its SEO as seo_config. The Content box edits the page's
// text block (the other blocks, e.g. a hero, are left as they are); the SEO fields edit seo_config.
// Before, the editor sent content / meta_title / meta_description, which the server ignored, so
// they were never saved (THE-22 test, David 2026-11-04).
const isTextBlock = (b: any) => b?.type === 'text_section' || b?.type === 'text-block';
const blocksOf = (p: any): any[] => (Array.isArray(p?.content_blocks) ? p.content_blocks : []);
const toForm = (p: any) => ({
  title: p?.title || '',
  slug: p?.slug || '',
  content: blocksOf(p).find(isTextBlock)?.config?.html || '',
  meta_title: p?.seo_config?.title || '',
  meta_description: p?.seo_config?.description || '',
});
function toUpdate(p: any, f: ReturnType<typeof toForm>) {
  const blocks = blocksOf(p).map((b) => ({ ...b }));
  const i = blocks.findIndex(isTextBlock);
  if (i >= 0) blocks[i] = { ...blocks[i], type: 'text_section', config: { ...(blocks[i].config || {}), html: f.content } };
  else if (f.content) blocks.push({ type: 'text_section', config: { html: f.content } });
  return {
    title: f.title, slug: f.slug, contentBlocks: blocks,
    seoConfig: { ...(p?.seo_config || {}), title: f.meta_title, description: f.meta_description },
  };
}

function CMSPageEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [page, setPage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { dirtySections } = useDraftSections();
  const pageRef = useRef<any>(null);
  pageRef.current = page;
  const draft = useDraft('cms-page', 'Page', toForm(null), async (values) => {
    const updated = await cmsApi.updatePage(id!, toUpdate(pageRef.current, values));
    setPage(updated);
    return toForm(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));

  useEffect(() => {
    if (!id) return;
    cmsApi.getPage(id).then((p) => {
      setPage(p);
      draft.load(toForm(p));
    }).catch(() => setError('Page not found.')).finally(() => setLoading(false));
  }, [id, draft.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePublish = async () => {
    if (!id || !confirm('Publish this page?')) return;
    try {
      const updated = await cmsApi.publishPage(id);
      setPage(updated);
    } catch { alert('Publish failed'); }
  };

  if (loading) return <div style={styles.page}><p>Loading...</p></div>;
  if (!page && error) return <div style={styles.page}><p>{error}</p></div>;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/cms')}>← Back to CMS</button>
        <div style={styles.header}>
          <h1 style={styles.title}>Edit Page</h1>
          {page?.status && <Badge variant={page.status === 'published' ? 'success' : 'neutral'}>{page.status}</Badge>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <SaveChanges />
            {page?.status !== 'published' && <Button size="sm" variant="secondary" onClick={handlePublish}>Publish</Button>}
          </div>
        </div>
      </StickyPageTop>

      {error && <Alert variant="error">{error}</Alert>}

      <div style={styles.form}>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Title</label>
            <input style={{ ...styles.input, ...mark('title') }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Slug</label>
            <input style={{ ...styles.input, ...mark('slug') }} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Content</label>
          <textarea style={{ ...styles.input, minHeight: '200px', ...mark('content') }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>SEO Title</label>
            <input style={{ ...styles.input, ...mark('meta_title') }} value={form.meta_title} onChange={(e) => setForm({ ...form, meta_title: e.target.value })} />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>SEO Description</label>
            <input style={{ ...styles.input, ...mark('meta_description') }} value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  );
}
const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
