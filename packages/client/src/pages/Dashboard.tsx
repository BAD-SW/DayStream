import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    apiClient.get<HealthResponse>('/health')
      .then((res) => setHealth(res.data))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h2 style={styles.heading}>Dashboard</h2>
      <p style={styles.text}>
        You're signed in. This is a placeholder until Phase 04 (Design System) is implemented.
      </p>

      {health && (
        <div style={styles.statusCard}>
          <p style={styles.statusLabel}>API Status</p>
          <p style={styles.statusValue}>✓ {health.status} — v{health.version} — uptime {health.uptime}s</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: {
    fontSize: '24px',
    fontWeight: 300,
    margin: '0 0 16px 0',
    color: '#F5F5F3',
  },
  text: {
    color: '#B0B0B0',
    fontSize: '14px',
    lineHeight: 1.5,
  },
  statusCard: {
    marginTop: '32px',
    padding: '20px',
    backgroundColor: '#242424',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  statusLabel: {
    fontSize: '12px',
    color: '#8A8A8A',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '0 0 8px 0',
  },
  statusValue: {
    fontSize: '14px',
    color: '#66BB6A',
    margin: 0,
  },
};
