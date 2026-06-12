import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get<HealthResponse>('/health')
      .then((res) => setHealth(res.data))
      .catch(() => {});
  }, []);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    navigate('/login');
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.logo}>DayStream</h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign Out</button>
      </header>

      <main style={styles.main}>
        <h2 style={styles.heading}>Dashboard</h2>
        <p style={styles.text}>You're signed in. This is a placeholder until Phase 04 (Design System) is implemented.</p>

        {health && (
          <div style={styles.statusCard}>
            <p style={styles.statusLabel}>API Status</p>
            <p style={styles.statusValue}>✓ {health.status} — v{health.version} — uptime {health.uptime}s</p>
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1A1A1A',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#F5F5F3',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 32px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  logo: {
    fontSize: '20px',
    fontWeight: 600,
    margin: 0,
    color: '#C9A96E',
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid #333',
    borderRadius: '8px',
    color: '#B0B0B0',
    padding: '8px 16px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  main: {
    padding: '48px 32px',
    maxWidth: '768px',
  },
  heading: {
    fontSize: '24px',
    fontWeight: 300,
    margin: '0 0 16px 0',
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
