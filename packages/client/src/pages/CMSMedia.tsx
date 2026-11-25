import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import * as cmsApi from '../api/cms';
import { formatNumber } from '../utils/format';

export function CMSMedia() {
  const { t } = useTranslation('cms');
  const navigate = useNavigate();
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cmsApi.getMedia().then(setMedia).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/cms')}>{t('backToCms')}</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('media.title')}</h1>
      </div>

      {loading ? <p style={styles.loading}>{t('common:loading')}</p> : media.length === 0 ? (
        <p style={styles.loading}>{t('media.empty')}</p>
      ) : (
        <div style={styles.grid}>
          {media.map((item: any) => (
            <div key={item.id} style={styles.card}>
              {item.url || item.file_path ? (
                <div style={styles.preview}>
                  <img
                    src={item.url || (/^(https?:)?\//.test(item.file_path) ? item.file_path : `/storage/${item.file_path}`)}
                    alt={item.alt_text || item.filename || t('media.alt')}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ) : (
                <div style={{ ...styles.preview, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {item.mime_type || t('media.file')}
                </div>
              )}
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.filename || item.name || t('media.untitled')}
              </div>
              {item.size && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('media.sizeKb', { size: formatNumber(item.size / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</div>}
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
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-md)' },
  card: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  preview: { width: '100%', height: '120px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' },
  loading: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
