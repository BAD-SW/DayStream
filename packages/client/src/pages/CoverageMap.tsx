import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';
import { cellToBoundary } from 'h3-js';

interface Territory {
  tenantId: string;
  name: string;
  status: string;
  location: string;
  hexagons: string[];
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

    const tryBuild = () => {
      if ((window as any).google?.maps?.Map) {
        buildMap();
      } else {
        setTimeout(tryBuild, 200);
      }
    };

    if (!(window as any).google?.maps) {
      // Check if script already exists
      const existing = document.querySelector('script[src*="maps.googleapis.com"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
        script.async = true;
        script.onload = () => tryBuild();
        script.onerror = () => console.error('Failed to load Google Maps script');
        document.head.appendChild(script);
      } else {
        tryBuild();
      }
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
      center: { lat: 39, lng: -98 }, // US center default
      mapTypeId: 'roadmap',
    });
    mapInstanceRef.current = map;

    const bounds = new google.maps.LatLngBounds();

    territories.forEach((territory, idx) => {
      const color = COLORS[idx % COLORS.length];

      // Render each hexagon as a polygon
      for (const hexId of territory.hexagons) {
        try {
          const boundary = cellToBoundary(hexId);
          const paths = boundary.map(([lat, lng]) => ({ lat, lng }));

          const polygon = new google.maps.Polygon({
            paths,
            map,
            strokeColor: color,
            strokeOpacity: 0.8,
            strokeWeight: 1,
            fillColor: color,
            fillOpacity: 0.25,
          });

          // Extend bounds
          for (const point of paths) {
            bounds.extend(point);
          }

          // Info window on click
          polygon.addListener('click', (event: any) => {
            const infoWindow = new google.maps.InfoWindow({
              content: `<div style="font-size:13px"><strong>${territory.name}</strong><br/>${territory.location}<br/><span style="color:${territory.status === 'active' ? '#2E7D32' : '#999'}">${territory.status}</span></div>`,
              position: event.latLng,
            });
            infoWindow.open(map);
          });
        } catch { /* skip invalid hexagons */ }
      }
    });

    if (territories.length > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 30 });
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

      <div ref={mapRef} style={{ ...styles.map, display: territories.length === 0 || !apiKey ? 'none' : 'block' }} />

      {/* Legend */}
      {territories.length > 0 && (
        <div style={styles.legend}>
          {territories.map((t, idx) => (
            <div key={t.tenantId} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: COLORS[idx % COLORS.length] }} />
              <span style={styles.legendName}>{t.name}</span>
              <span style={styles.legendDetail}>{t.location} ({t.hexagons.length} hexagons)</span>
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
