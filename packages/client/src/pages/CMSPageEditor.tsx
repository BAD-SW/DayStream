import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import * as cmsApi from '../api/cms';

export function CMSPageEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', slug: '', content: '', meta_title: '', meta_description: '' });

  useEffect(() => {
    if (!id) return;
    cmsApi.getPage(id).then((p) => {
      setPage(p);
      setForm({
        title: p.title || '',
        slug: p.slug || '',
        content: p.content || '',
        meta_title: p.meta_title || '',
        meta_description: p.meta_description || '',
      });
    }).catch(() => setError('Page not found.')).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setError('');
    try {
      const updated = await cmsApi.updatePage(id, form);
      setPage(updated);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

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
      <button style={styles.back} onClick={() => navigate('/cms')}>← Back to CMS</button>
      <div style={styles.header}>
        <h1 style={styles.title}>Edit Page</h1>
        {page?.status && <Badge variant={page.status === 'published' ? 'success' : 'neutral'}>{page.status}</Badge>}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div style={styles.form}>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Title</label>
            <input style={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Slug</label>
            <input style={styles.input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
        </div>
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Content</label>
          <textarea style={{ ...styles.input, minHeight: '200px' }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </div>
        <div style={styles.row}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>SEO Title</label>
            <input style={styles.input} value={form.meta_title} onChange={(e) => setForm({ ...form, meta_title: e.target.value })} />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>SEO Description</label>
            <input style={styles.input} value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} />
          </div>
        </div>
        <div style={styles.actions}>
          {page?.status !== 'published' && <Button onClick={handlePublish}>Publish</Button>}
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
};
