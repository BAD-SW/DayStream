import { useEffect, useState } from 'react';
import { apiClient } from './api/client';

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<HealthResponse>('/health')
      .then((res) => setHealth(res.data))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <h1>DayStream</h1>
      {health && (
        <div>
          <p style={{ color: 'green', fontSize: '1.2rem' }}>✓ System Ready</p>
          <p>API Status: {health.status}</p>
          <p>Version: {health.version}</p>
          <p>Uptime: {health.uptime}s</p>
        </div>
      )}
      {error && (
        <div>
          <p style={{ color: 'red' }}>✗ Cannot reach API</p>
          <p>{error}</p>
        </div>
      )}
      {!health && !error && <p>Connecting to API...</p>}
    </div>
  );
}
