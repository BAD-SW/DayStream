import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import {
  previewTerritory, saveTerritoryComposition, getTerritory, hydrateTerritoryComponents,
  TerritoryCandidate,
} from '../api/territory';

/**
 * TerritoryPicker — define a tenant's franchise territory accurately, by COMPOSING
 * it from one or more recognized administrative areas (counties, regions, states).
 * Flow: search a place → add the right area to the territory → repeat → see the
 * combined boundary on the map → confirm. The component list is saved so a contract
 * can enumerate exactly which areas are included.
 *
 * Why composition: informal regions (e.g. "Florida Panhandle") have no boundary in
 * the data source, but their constituent counties do — so the admin builds the
 * region from its counties, which tile precisely and butt up against neighbors.
 */

interface Props {
  tenantId: string;
  onSaved?: (result: { territory_address: string; hexagons: number }) => void;
}

const KIND_LABEL: Record<string, string> = {
  country: 'Country', state: 'State', region: 'Region', province: 'Province',
  county: 'County', district: 'District', city: 'City', island: 'Island',
  area: 'Area', approximate: 'Approximate',
};
const COLORS = ['#4A90A4', '#C9A96E', '#2E7D32', '#7B1FA2', '#D32F2F', '#F57C00', '#00838F', '#5D4037'];

function shortName(label: string): string {
  return label.split(',').slice(0, 2).join(',').trim();
}

export function TerritoryPicker({ tenantId, onSaved }: Props) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TerritoryCandidate[]>([]);
  const [selected, setSelected] = useState<TerritoryCandidate[]>([]); // the composition being built
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [hydrateErr, setHydrateErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const shapesRef = useRef<any[]>([]);

  // Load current composition + maps key on open. The saved territory is pre-loaded
  // into the editable "Selected areas" list (and drawn on the map) by re-hydrating
  // its stored component refs back into full candidates with boundary geometry.
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/v1/prospects/maps-key').then((res) => { if (!cancelled) setApiKey(res.data.data?.key || null); }).catch(() => {});
    (async () => {
      try {
        const t = await getTerritory(tenantId);
        if (cancelled) return;
        setSavedLabel(t.territory_address || null);
        const comps = t.territory_components || [];
        if (comps.length === 0) return;
        setHydrating(true); setHydrateErr(null);
        try {
          const candidates = await hydrateTerritoryComponents(comps);
          if (!cancelled) setSelected(candidates);
        } catch (err: any) {
          if (cancelled) return;
          const code = err?.response?.data?.code;
          setHydrateErr(code === 'GEO_UNAVAILABLE'
            ? 'Boundary lookup is busy (rate limited). The saved areas could not be pre-loaded — try reopening in a moment.'
            : 'Could not pre-load the saved territory.');
        } finally {
          if (!cancelled) setHydrating(false);
        }
      } catch {
        // No current territory, or load failed — start empty.
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function handleSearch() {
    if (query.trim().length < 2) return;
    setSearching(true); setMsg(null); setResults([]);
    try {
      const found = await previewTerritory(tenantId, query.trim());
      setResults(found);
      if (found.length === 0) setMsg({ ok: false, text: 'No recognized area found. Try a county, region, or state name.' });
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'GEO_UNAVAILABLE') {
        setMsg({ ok: false, text: 'Boundary lookup is busy (rate limited). Wait a moment and click Find again.' });
      } else {
        setMsg({ ok: false, text: err?.response?.data?.error || 'Search failed.' });
      }
    } finally { setSearching(false); }
  }

  function addArea(c: TerritoryCandidate) {
    if (selected.some((s) => s.id === c.id)) return; // already added
    setSelected([...selected, c]);
    setMsg(null);
  }
  function removeArea(id: string) {
    setSelected(selected.filter((s) => s.id !== id));
  }

  async function handleConfirm() {
    if (selected.length === 0) return;
    setSaving(true); setMsg(null);
    try {
      const r = await saveTerritoryComposition(tenantId, selected);
      const warn = !r.hasBoundary ? ' (includes an approximate area)' : !r.complete ? ' (large area — coverage capped)' : '';
      setMsg({ ok: true, text: `Territory saved — ${selected.length} area(s), ${r.hexagons.toLocaleString()} cells${warn}.` });
      onSaved?.({ territory_address: r.territory_address, hexagons: r.hexagons });
      setSavedLabel(r.territory_address || null);
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.error || 'Failed to save territory.' });
    } finally { setSaving(false); }
  }

  const totalCells = selected.reduce((n, c) => n + c.hexCount, 0); // approximate (pre-union)

  // --- Map preview: draw every selected area's boundary (the union being built) ---
  const drawSelected = useCallback(() => {
    const google = (window as any).google;
    const map = mapInstanceRef.current;
    if (!google?.maps || !map) return;
    for (const s of shapesRef.current) s.setMap(null);
    shapesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    selected.forEach((c, idx) => {
      const color = COLORS[idx % COLORS.length];
      if (c.geojson) {
        const polys = c.geojson.type === 'Polygon' ? [c.geojson.coordinates] : c.geojson.coordinates;
        for (const poly of polys) {
          const path = poly[0].map(([lng, lat]: number[]) => ({ lat, lng }));
          const shape = new google.maps.Polygon({
            paths: path, map, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 2,
            fillColor: color, fillOpacity: 0.2,
          });
          shapesRef.current.push(shape);
          for (const p of path) bounds.extend(p);
        }
      } else {
        bounds.extend({ lat: c.lat, lng: c.lng });
      }
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 24 });
  }, [selected]);

  const initMap = useCallback(() => {
    if (!mapRef.current || !apiKey || mapInstanceRef.current) return;
    const google = (window as any).google;
    if (!google?.maps?.Map) return;
    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      zoom: 3, center: { lat: 25, lng: -40 }, mapTypeId: 'roadmap',
      streetViewControl: false, mapTypeControl: false,
    });
    drawSelected();
  }, [apiKey, drawSelected]);

  useEffect(() => {
    if (!apiKey) return;
    const build = () => { if ((window as any).google?.maps?.Map) initMap(); else setTimeout(build, 200); };
    if (!(window as any).google?.maps) {
      const existing = document.querySelector('script[src*="maps.googleapis.com"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
        script.async = true; script.onload = build;
        document.head.appendChild(script);
      } else { build(); }
    } else { build(); }
  }, [apiKey, initMap]);

  useEffect(() => { drawSelected(); }, [drawSelected]);

  return (
    <div style={styles.wrap}>
      <h3 style={styles.title}>Territory</h3>
      <p style={styles.help}>
        Build the franchise territory from recognized areas (county, region, province, state).
        Search a place, add the right area, repeat to compose a larger region, then confirm the
        combined boundary on the map. Informal names (e.g. "Florida Panhandle") have no precise
        boundary — compose them from their counties for a clean, contract-grade territory.
      </p>

      {hydrating && (
        <div style={styles.savedBox}>
          <span style={styles.savedLabel}>
            Loading current territory{savedLabel ? ` — ${savedLabel}` : ''} into Selected areas…
          </span>
        </div>
      )}
      {hydrateErr && (
        <p style={{ ...styles.msg, color: 'var(--color-error, #C4291C)' }}>{hydrateErr}</p>
      )}

      <div style={styles.searchRow}>
        <input
          style={styles.input}
          value={query}
          placeholder="e.g. Escambia County, Florida"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
        />
        <Button variant="outline" size="sm" loading={searching} onClick={handleSearch}>Find</Button>
      </div>

      {msg && (
        <p style={{ ...styles.msg, color: msg.ok ? 'var(--color-success, #17794A)' : 'var(--color-error, #C4291C)' }}>{msg.text}</p>
      )}

      {/* Search results: add to the composition */}
      {results.length > 0 && (
        <div style={styles.results}>
          {results.map((c) => {
            const added = selected.some((s) => s.id === c.id);
            return (
              <div key={c.id} style={styles.result}>
                <span style={styles.resultBody}>
                  <span style={styles.resultLabel}>{shortName(c.label)}</span>
                  <span style={styles.resultMeta}>
                    <span style={styles.kindBadge}>{KIND_LABEL[c.kind] || c.kind}</span>
                    <span>{c.hexCount.toLocaleString()} cells</span>
                    {!c.hasBoundary && <span style={styles.warn}>approximate — no precise boundary</span>}
                    {c.hasBoundary && !c.complete && <span style={styles.warn}>large — coverage capped</span>}
                  </span>
                </span>
                <Button variant={added ? 'ghost' : 'outline'} size="sm" disabled={added} onClick={() => addArea(c)}>
                  {added ? 'Added' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* The composition being built + map */}
      <div style={styles.body}>
        <div style={styles.selectedPane}>
          <div style={styles.selectedHeader}>
            Selected areas{selected.length > 0 ? ` (${selected.length})` : ''}
          </div>
          {selected.length === 0 ? (
            <p style={styles.help}>
              {hydrating ? 'Loading current territory…' : 'No areas added yet. Search above and click “Add”. Any saved territory loads here automatically.'}
            </p>
          ) : (
            <>
              <ul style={styles.selectedList}>
                {selected.map((c, idx) => (
                  <li key={c.id} style={styles.selectedItem}>
                    <span style={{ ...styles.dot, background: COLORS[idx % COLORS.length] }} />
                    <span style={styles.selectedName}>{shortName(c.label)}</span>
                    <span style={styles.selectedKind}>{KIND_LABEL[c.kind] || c.kind}</span>
                    <button type="button" style={styles.removeBtn} onClick={() => removeArea(c.id)} aria-label="Remove area">×</button>
                  </li>
                ))}
              </ul>
              <p style={styles.help}>≈ {totalCells.toLocaleString()} cells before union (overlaps removed on save)</p>
            </>
          )}
        </div>
        <div ref={mapRef} style={styles.map} />
      </div>

      {selected.length > 0 && (
        <div style={styles.actions}>
          <Button variant="primary" size="sm" loading={saving} onClick={handleConfirm}>
            Confirm &amp; save territory ({selected.length} area{selected.length === 1 ? '' : 's'})
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: '900px' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-xs)' },
  help: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-sm)' },
  savedBox: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', marginBottom: 'var(--space-sm)' },
  savedLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 'var(--font-weight-medium)' as any },
  searchRow: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-sm)' },
  input: { flex: 1, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  msg: { fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm)' },
  results: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: 'var(--space-md)', maxHeight: '200px', overflowY: 'auto' },
  result: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  resultBody: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 },
  resultLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontWeight: 'var(--font-weight-medium)' as any },
  resultMeta: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  kindBadge: { textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' },
  warn: { color: 'var(--color-warning, #B7791F)', fontWeight: 'var(--font-weight-medium)' as any },
  body: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: 'var(--space-md)', alignItems: 'start' },
  selectedPane: { display: 'flex', flexDirection: 'column', gap: '6px' },
  selectedHeader: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  selectedList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' },
  selectedItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  dot: { width: '10px', height: '10px', borderRadius: '3px', flexShrink: 0 },
  selectedName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selectedKind: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-lg)', lineHeight: 1, padding: '0 2px' },
  map: { width: '100%', height: '380px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)', alignItems: 'center' },
};
