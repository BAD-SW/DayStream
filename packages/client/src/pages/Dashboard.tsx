import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
}

export function Dashboard() {
  const { t } = useTranslation('calendar');
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    apiClient.get<HealthResponse>('/health')
      .then((res) => setHealth(res.data))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h2 style={styles.heading}>{t('dashboard.heading')}</h2>
      <p style={styles.text}>
        {t('dashboard.placeholder')}
      </p>

      {health && (
        <div style={styles.statusCard}>
          <p style={styles.statusLabel}>{t('dashboard.apiStatus')}</p>
          <p style={styles.statusValue}>{t('dashboard.apiStatusValue', { status: health.status, version: health.version, uptime: health.uptime })}</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 300,
    margin: '0 0 16px 0',
    color: 'var(--color-text)',
  },
  text: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-base)',
    lineHeight: 1.5,
  },
  statusCard: {
    marginTop: '32px',
    padding: '20px',
    backgroundColor: 'var(--color-surface)',
    borderRadius: '8px',
    border: '1px solid var(--color-border)',
  },
  statusLabel: {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '0 0 8px 0',
  },
  statusValue: {
    fontSize: 'var(--font-size-base)',
    color: '#66BB6A',
    margin: 0,
  },
};
