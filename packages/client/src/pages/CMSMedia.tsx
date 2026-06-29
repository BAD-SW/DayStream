import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as cmsApi from '../api/cms';

export function CMSMedia() {
  const navigate = useNavigate();
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cmsApi.getMedia().then(setMedia).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/cms')}>← Back to CMS</button>
      <div style={styles.header}>
        <h1 style={styles.title}>Media Library</h1>
      </div>

      {loading ? <p style={styles.loading}>Loading...</p> : media.length === 0 ? (
        <p style={styles.loading}>No media files uploaded yet.</p>
      ) : (
        <div style={styles.grid}>
          {media.map((item: any) => (
            <div key={item.id} style={styles.card}>
              {item.url || item.file_path ? (
                <div style={styles.preview}>
                  <img
                    src={item.url || item.file_path}
                    alt={item.alt_text || item.filename || 'Media'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div style={{ ...styles.preview, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                  {item.mime_type || 'File'}
                </div>
              )}
              <div style={{ fontSize: '12px', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.filename || item.name || 'Untitled'}
              </div>
              {item.size && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{(item.size / 1024).toFixed(1)} KB</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-md)' },
  card: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  preview: { width: '100%', height: '120px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
