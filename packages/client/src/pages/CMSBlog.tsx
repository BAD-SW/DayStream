import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as cmsApi from '../api/cms';
import { formatDate } from '../utils/format';

export function CMSBlog() {
  const { t } = useTranslation('cms');
  const navigate = useNavigate();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', slug: '', content: '', status: 'draft' });

  useEffect(() => {
    cmsApi.getBlogPosts().then((res) => setPosts(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const post = await cmsApi.createBlogPost(form);
      setPosts([post, ...posts]);
      setShowCreate(false);
      setForm({ title: '', slug: '', content: '', status: 'draft' });
    } catch { void showMessage({ message: t('blog.createFailed'), tone: 'error' }); }
  };

  const handlePublish = async (id: string) => {
    try {
      await cmsApi.publishBlogPost(id);
      setPosts(posts.map((p) => p.id === id ? { ...p, status: 'published' } : p));
    } catch { void showMessage({ message: t('blog.publishFailed'), tone: 'error' }); }
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/cms')}>{t('backToCms')}</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('blog.title')}</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? t('common:cancel') : t('blog.newPost')}</Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.card}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('blog.titleField')}</label>
            <input style={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('blog.slug')}</label>
            <input style={styles.input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder={t('blog.slugPlaceholder')} />
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>{t('blog.content')}</label>
            <textarea style={{ ...styles.input, minHeight: '120px' }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          </div>
          <Button type="submit">{t('blog.create')}</Button>
        </form>
      )}

      {loading ? <p style={styles.loading}>{t('common:loading')}</p> : posts.length === 0 ? (
        <p style={styles.loading}>{t('blog.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {posts.map((post: any) => (
            <div key={post.id} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{post.title}</span>
                <Badge variant={post.status === 'published' ? 'success' : 'neutral'}>{t(`status.${post.status}`, { defaultValue: post.status })}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                <span>{post.created_at ? formatDate(post.created_at) : ''}</span>
                {post.status !== 'published' && <Button size="sm" variant="ghost" onClick={() => handlePublish(post.id)}>{t('blog.publish')}</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
