import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';

interface Territory {
  id: string;
  name: string;
  status: string;
  territory_lat: number;
  territory_lng: number;
  territory_address: string;
}

const COLORS = ['#C9A96E', '#4A90A4', '#2E7D32', '#D32F2F', '#7B1FA2', '#F57C00', '#00838F', '#5D4037'];

export function CoverageMap() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get('/v1/prospects/territories').then((res) => res.data.data || []),
      apiClient.get('/v1/prospects/maps-key').then((res) => res.data.data?.key || null).catch(() => null),
    ]).then(([terr, key]) => {
      setTerritories(terr);
      setApiKey(key);
    }).finally(() => setLoading(false));
  }, []);

  const initMap = useCallback(() => {
    if (!mapRef.current || !apiKey || territories.length === 0) return;
    if (mapInstanceRef.current) return;

    // Load Google Maps script if not already loaded
    if (!(window as any).google?.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
      script.async = true;
      script.onload = () => buildMap();
      script.onerror = () => console.error('Failed to load Google Maps script');
      document.head.appendChild(script);
    } else {
      buildMap();
    }
  }, [apiKey, territories]);

  useEffect(() => { if (!loading) initMap(); }, [loading, initMap]);

  function buildMap() {
    if (!mapRef.current || mapInstanceRef.current) return;
    const google = (window as any).google;
    if (!google?.maps) return;

    const map = new google.maps.Map(mapRef.current, {
      zoom: 4,
      center: { lat: territories[0]?.territory_lat || 39, lng: territories[0]?.territory_lng || -98 },
      mapTypeId: 'roadmap',
    });
    mapInstanceRef.current = map;

    const bounds = new google.maps.LatLngBounds();

    territories.forEach((t, idx) => {
      const color = COLORS[idx % COLORS.length];
      const position = { lat: t.territory_lat, lng: t.territory_lng };

      // Add marker
      const marker = new google.maps.Marker({
        position,
        map,
        label: {
          text: t.name,
          color: '#fff',
          fontSize: '11px',
          fontWeight: '600',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });

      // Info window on click
      const infoWindow = new google.maps.InfoWindow({
        content: `<div style="font-size:13px"><strong>${t.name}</strong><br/>${t.territory_address}<br/><span style="color:${t.status === 'active' ? '#2E7D32' : '#999'}">${t.status}</span></div>`,
      });
      marker.addListener('click', () => infoWindow.open(map, marker));

      bounds.extend(position);
    });

    if (territories.length > 0) {
      map.fitBounds(bounds, { padding: 50 });
    }
  }

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading territories...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Territory Coverage</h1>
        <span style={styles.count}>{territories.length} territory(ies) assigned</span>
      </div>

      {!apiKey && !loading && (
        <p style={styles.muted}>Google Maps API key not configured. Set it under Configuration → API Keys.</p>
      )}

      {territories.length === 0 && !loading && (
        <p style={styles.muted}>No territories assigned yet. Edit a tenant to assign their territory.</p>
      )}

      <div ref={mapRef} style={{ ...styles.map, display: territories.length === 0 ? 'none' : 'block' }} />

      {/* Legend */}
      {territories.length > 0 && (
        <div style={styles.legend}>
          {territories.map((t, idx) => (
            <div key={t.id} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: COLORS[idx % COLORS.length] }} />
              <span style={styles.legendName}>{t.name}</span>
              <span style={styles.legendDetail}>{t.territory_address}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1400px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: 0, color: 'var(--color-text)' },
  count: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  map: { width: '100%', height: '600px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' },
  legend: { marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  legendDot: { width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 },
  legendName: { fontWeight: 600, color: 'var(--color-text)' },
  legendDetail: { color: 'var(--color-text-secondary)' },
};
