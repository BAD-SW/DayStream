import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, applyTableFilters } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

/**
 * ProspectsList — the reusable prospect list/manage UI (filters, sortable table,
 * status/notes editing, dismiss, manual add). Parameterized by `apiBase` so it
 * serves BOTH the tenant's own page (`/v1/prospects`) and the system admin viewing
 * a specific tenant (`/v1/prospects/:tenantId`). It contains NO generation UI —
 * generation is system-admin-only and lives in TenantProspectsPanel.
 */

interface Prospect {
  id: string;
  name: string;
  address: string;
  city?: string;
  phone?: string;
  website?: string;
  category: string;
  rating?: number;
  status: string;
  notes?: string;
  // Overture-engine fields (null for Google/manual rows).
  source?: string;
  confidence?: number | string | null;
  fit_score?: number | null;
  fit_tier?: 'strong' | 'moderate' | 'weak' | null;
  inclusion?: 'included' | 'held' | null;
  hold_reason?: string | null;
  lat?: number | null;
  lng?: number | null;
  country?: string | null;
  email?: string | null;
  operating_status?: string | null;
}


const STATUS_OPTIONS = [
  { value: 'new' },
  { value: 'contacted' },
  { value: 'demo_scheduled' },
  { value: 'signed' },
  { value: 'declined' },
  { value: 'dismissed' },
];

/** Fit-tier colors (semantic, from the design system). */
const TIER_COLOR: Record<'strong' | 'moderate' | 'weak', string> = {
  strong: 'var(--color-success, #2E7D32)',
  moderate: 'var(--color-warning, #E6A817)',
  weak: 'var(--color-text-secondary, #8A8A8A)',
};
const TIER_TEXT: Record<'strong' | 'moderate' | 'weak', string> = {
  strong: '#FFFFFF',
  moderate: '#1A1A1A',
  weak: '#FFFFFF',
};

/**
 * Build a Google Maps link that opens the specific business.
 *
 * Uses a NAME + ADDRESS + CITY + COUNTRY text query, NOT the stored coordinates. Overture's
 * coordinates are sometimes mis-geocoded (observed: a business correctly addressed at "636 N
 * French Rd" whose point was ~4km off in an empty field), so pinning the raw lat/lng can land
 * on the wrong spot. The address text is the more reliable signal — Google resolves it to the
 * right place. Including city + country (not just name + partial address, as the old link did)
 * keeps the query specific enough to avoid a broad-area search. Coordinates are only a
 * last-resort fallback when there is no address text at all.
 */
function mapsUrl(p: { name: string; address?: string; city?: string; country?: string | null; lat?: number | null; lng?: number | null }): string {
  const parts = [p.name, p.address, p.city, p.country].filter(Boolean).join(' ').trim();
  if (parts) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
  }
  // No usable address text — fall back to coordinates if present.
  const hasCoords = typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  if (hasCoords) return `https://www.google.com/maps/search/?api=1&query=${p.lat}%2C${p.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
}

/** Render Overture confidence (0..1, may arrive as a numeric string) as a percentage. */
function formatConfidence(c: number | string | null | undefined): string {
  if (c === null || c === undefined || c === '') return '—';
  const n = Number(c);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

interface Props {
  /** API base for this list's data, e.g. '/v1/prospects' (own tenant) or
   *  '/v1/prospects/<tenantId>' (system admin viewing a tenant). The /prospects
   *  suffix for list/add is appended as needed per the route shapes. */
  apiBase: string;
  /** When true (tenant's own page), list is GET `${apiBase}` and item routes are
   *  `${apiBase}/:id`. When false (admin per-tenant), list is `${apiBase}/prospects`
   *  and item routes are `${apiBase}/prospects/:id`. */
  ownTenant: boolean;
  /** Show the manual Add Prospect form (default true). */
  allowAdd?: boolean;
  onCountChange?: (n: number) => void;
}

// Columns the list filters on screen (same keys as the table).
const FILTER_COLUMNS = (['name', 'address', 'city', 'category', 'fit_score', 'confidence', 'status', 'notes'] as const).map((key) => ({
  key, kind: (key === 'fit_score' || key === 'confidence' ? 'number' : 'values') as 'number' | 'values',
  value: (p: Prospect) => (key === 'confidence' ? (p.confidence == null || p.confidence === '' ? null : Number(p.confidence)) : (p as any)[key]),
}));

export function ProspectsList({ apiBase, ownTenant, allowAdd = true, onCountChange }: Props) {
  const { t } = useTranslation('prospects');
  // Stored statuses and fit tiers are shown through a key, never printed raw.
  const statusLabel = (value: string) => t(`status.${value}`, { defaultValue: value });
  const tierLabel = (tier: string) => t(`tier.${tier}`, { defaultValue: tier });
  // URL helpers derived from apiBase + mode.
  const listUrl = ownTenant ? apiBase : `${apiBase}/prospects`;
  const addUrl = listUrl;
  const itemUrl = (id: string) => (ownTenant ? `${apiBase}/${id}` : `${apiBase}/prospects/${id}`);
  const exportUrl = ownTenant ? `${apiBase}/export` : `${apiBase}/prospects/export`;

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [tierFilter, setTierFilter] = useState<Set<'strong' | 'moderate' | 'weak'>>(new Set());
  // Column filters beside the sort icon (David, 2026-11-02); Export CSV follows them.
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (showDismissed) params.append('show_dismissed', 'true');
      if (showHeld) params.append('show_held', 'true');
      const res = await apiClient.get(`${listUrl}?${params.toString()}`);
      const data: Prospect[] = res.data.data || res.data || [];
      setProspects(data);
      onCountChange?.(data.length);
    } catch {
      setProspects([]);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl, search, showDismissed, showHeld]);

  useEffect(() => { fetchProspects(); }, [fetchProspects]);

  // Client-side fit-tier filter (chips). Empty set = show all tiers. Applied before the column filters.
  const tierFiltered = useMemo(() => (tierFilter.size === 0
    ? prospects
    : prospects.filter((p) => p.fit_tier != null && tierFilter.has(p.fit_tier))), [prospects, tierFilter]);
  const visibleProspects = useMemo(() => applyTableFilters(tierFiltered, FILTER_COLUMNS, tableFilters), [tierFiltered, tableFilters]);

  const toggleTier = (tier: 'strong' | 'moderate' | 'weak') =>
    setTierFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier); else next.add(tier);
      return next;
    });

  // Descriptive territory valuation over the CURRENTLY-LISTED Overture prospects
  // (spec 31 §7 — counts by fit tier, not a $ figure). Only meaningful when the list
  // contains Overture rows; hidden otherwise.
  const overtureRows = prospects.filter((p) => p.source === 'overture');
  const valuation = overtureRows.length > 0 ? {
    total: overtureRows.length,
    strong: overtureRows.filter((p) => p.fit_tier === 'strong').length,
    moderate: overtureRows.filter((p) => p.fit_tier === 'moderate').length,
    weak: overtureRows.filter((p) => p.fit_tier === 'weak').length,
    held: overtureRows.filter((p) => p.inclusion === 'held').length,
  } : null;


  const handleStatusChange = async (id: string, status: string) => {
    try {
      await apiClient.put(itemUrl(id), { status });
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('error.updateStatus'), tone: 'error' }); }
  };

  const handleNotesBlur = async (id: string) => {
    const notes = editingNotes[id];
    if (notes === undefined) return;
    try {
      await apiClient.put(itemUrl(id), { notes });
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, notes } : p)));
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('error.updateNotes'), tone: 'error' }); }
    setEditingNotes((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const handleDismiss = async (id: string) => {
    try {
      await apiClient.put(`${itemUrl(id)}/dismiss`);
      setProspects((prev) => prev.filter((p) => p.id !== id));
      onCountChange?.(prospects.length - 1);
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('error.dismiss'), tone: 'error' }); }
  };

  const handleAddSubmit = async () => {
    if (!formData.name.trim()) { void showMessage({ message: t('error.nameRequired'), tone: 'info' }); return; }
    try {
      await apiClient.post(addUrl, formData);
      setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
      setShowAddForm(false);
      fetchProspects();
    } catch (err: any) { void showMessage({ message: err.response?.data?.error || t('error.add'), tone: 'error' }); }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    // Fetch via apiClient so the Bearer token is attached (a plain window.open to
    // the API would not carry it), then download the returned CSV as a blob.
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (tierFilter.size > 0 || Object.values(tableFilters).some((f) => f.values?.length || f.contains || f.from || f.to || f.min != null || f.max != null)) params.append('ids', visibleProspects.map((p) => p.id).join(','));
      if (showHeld) params.append('show_held', 'true');
      const url = `${exportUrl}?${params.toString()}`;
      const res = await apiClient.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'prospects.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch {
      void showMessage({ message: t('error.export'), tone: 'error' });
    } finally { setExporting(false); }
  };

  return (
    <div>
      {/* Filters */}
      <div style={styles.filters}>
        <input type="text" placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} style={styles.checkbox} />
          {t('filter.showDismissed')}
        </label>
        <label style={styles.checkboxLabel} title={t('filter.showHeldTitle')}>
          <input type="checkbox" checked={showHeld} onChange={(e) => setShowHeld(e.target.checked)} style={styles.checkbox} />
          {t('filter.showHeld')}
        </label>
        <button style={styles.exportLink} onClick={handleExport} disabled={exporting}>
          {exporting ? t('export.exporting') : t('export.csv')}
        </button>
      </div>

      {allowAdd && (
        <>
          <div style={styles.addFormToggle}>
            <button style={styles.toggleButton} onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? t('add.cancelToggle') : t('add.toggle')}
            </button>
          </div>
          {showAddForm && (
            <div style={styles.addForm}>
              <div style={styles.formGrid}>
                <input type="text" placeholder={t('add.name')} aria-label={t('add.name')} value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder={t('add.address')} aria-label={t('add.address')} value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder={t('add.phone')} aria-label={t('add.phone')} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder={t('add.website')} aria-label={t('add.website')} value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder={t('add.category')} aria-label={t('add.category')} value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder={t('add.notes')} aria-label={t('add.notes')} value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} style={styles.formInput} />
              </div>
              <div style={styles.formActions}>
                <Button onClick={handleAddSubmit}>{t('common:save')}</Button>
                <button style={styles.cancelButton} onClick={() => { setShowAddForm(false); setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' }); }}>{t('common:cancel')}</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Territory valuation (descriptive) — fit-tier counts over Overture prospects.
          The tier counts double as toggle filter chips: click to show only that tier. */}
      {valuation && (
        <div style={styles.valuation}>
          <span style={styles.valuationTitle}>{t('valuation.title')}</span>
          {(['strong', 'moderate', 'weak'] as const).map((tier) => {
            const on = tierFilter.has(tier);
            return (
              <button
                key={tier}
                type="button"
                onClick={() => toggleTier(tier)}
                aria-pressed={on}
                title={t(`valuation.filterTo.${tier}`)}
                style={{
                  ...styles.tierChip,
                  ...(on ? { background: TIER_COLOR[tier], color: TIER_TEXT[tier], borderColor: TIER_COLOR[tier] } : {}),
                }}
              >
                <span style={{ ...styles.tierDot, background: on ? TIER_TEXT[tier] : TIER_COLOR[tier] }} />
                {t(`valuation.tierCount.${tier}`, { n: valuation[tier] })}
              </button>
            );
          })}
          {tierFilter.size > 0 && (
            <button type="button" onClick={() => setTierFilter(new Set())} style={styles.tierClear}>{t('valuation.clear')}</button>
          )}
          <span style={styles.valuationSep}>·</span>
          <span style={styles.valuationMuted}>{valuation.held > 0 ? t('valuation.totalHeld', { count: valuation.total, held: valuation.held }) : t('valuation.total', { count: valuation.total })}</span>
        </div>
      )}

      {/* Table */}
      <Table
        rowId={(p: Prospect) => p.id}
        data={visibleProspects}
        filterSource={prospects}
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        loading={loading}
        emptyMessage={t('table.empty')}
        clientSort
        columns={[
          { key: 'name', header: t('table.name'), sortable: true, render: (_: any, p: Prospect) => (
            <>
              <a href={mapsUrl(p)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text)', textDecoration: 'underline' }}>{p.name}</a>
              {p.inclusion === 'held' && (
                <span style={styles.heldBadge} title={t('table.heldTitle', { reason: p.hold_reason || t('table.heldDefaultReason') })}>{t('table.held')}</span>
              )}
            </>
          ) },
          { key: 'address', header: t('table.address'), sortable: true },
          { key: 'city', header: t('table.city'), sortable: true, render: (v: string) => v || '—' },
          { key: 'category', header: t('table.category'), sortable: true },
          { key: 'fit_score', header: t('table.fit'), sortable: true, filter: 'number' as const, render: (_: any, p: Prospect) => (p.fit_tier ? (
            <span style={styles.fitCell}>
              <span style={{ ...styles.tierBadge, background: TIER_COLOR[p.fit_tier], color: TIER_TEXT[p.fit_tier] }}>{tierLabel(p.fit_tier)}</span>
              <span style={styles.fitScore}>{p.fit_score ?? '—'}</span>
            </span>
          ) : '—') },
          { key: 'confidence', header: t('table.confidence'), sortable: true, filter: 'number' as const, filterValue: (p: Prospect) => (p.confidence == null || p.confidence === '' ? null : Number(p.confidence)), filterLabel: (v: any) => formatConfidence(v), render: (_: any, p: Prospect) => formatConfidence(p.confidence) },
          { key: 'status', header: t('table.status'), sortable: true, filterLabel: (v: string) => statusLabel(v), render: (_: any, p: Prospect) => (
            <select value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} onClick={(e) => e.stopPropagation()} style={styles.statusSelect} aria-label={t('table.statusFor', { name: p.name })}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{statusLabel(s.value)}</option>)}
            </select>
          ) },
          { key: 'notes', header: t('table.notes'), sortable: true, render: (_: any, p: Prospect) => (
            <input type="text" value={editingNotes[p.id] ?? p.notes ?? ''} onChange={(e) => setEditingNotes({ ...editingNotes, [p.id]: e.target.value })} onBlur={() => handleNotesBlur(p.id)} style={styles.notesInput} placeholder={t('table.addNotes')} aria-label={t('table.notesFor', { name: p.name })} />
          ) },
          { key: 'actions', header: '', filter: false as const, render: (_: any, p: Prospect) => (
            <button style={styles.dismissButton} onClick={() => handleDismiss(p.id)} title={t('table.dismiss')} aria-label={t('table.dismiss')}>✕</button>
          ) },
        ]}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  filters: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const },
  searchInput: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', minWidth: '200px' },
  select: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' },
  checkbox: { width: '16px', height: '16px', cursor: 'pointer' },
  exportLink: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', textDecoration: 'underline', padding: 0 },
  addFormToggle: { marginBottom: 'var(--space-md)' },
  toggleButton: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 500, padding: 0 },
  addForm: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-background)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  formInput: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  formActions: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  cancelButton: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  tableWrapper: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left' as const, padding: '12px 16px', borderBottom: '2px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, userSelect: 'none' as const },
  td: { padding: '10px 16px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'middle' as const },
  rowEven: { background: 'transparent' },
  rowOdd: { background: 'rgba(0,0,0,0.02)' },
  rowHeld: { opacity: 0.6 },
  heldBadge: { marginLeft: '8px', fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  fitCell: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
  tierBadge: { fontSize: 'var(--font-size-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full, 9999px)', textTransform: 'capitalize' as const },
  fitScore: { fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' },
  valuation: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' as const, padding: '10px 14px', marginBottom: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface, transparent)', fontSize: 'var(--font-size-sm)' },
  valuationTitle: { fontWeight: 600, color: 'var(--color-text)' },
  valuationItem: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-text)' },
  tierChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', textTransform: 'capitalize' as const, fontFamily: 'var(--font-family)' },
  tierClear: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', textDecoration: 'underline', padding: '0 4px' },
  valuationSep: { color: 'var(--color-text-secondary)' },
  valuationMuted: { color: 'var(--color-text-secondary)' },
  tierDot: { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' },
  statusSelect: { padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  notesInput: { padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', width: '100%', minWidth: '120px' },
  dismissButton: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 'var(--font-size-base)', fontWeight: 700, padding: '4px 8px', borderRadius: 'var(--radius-md)' },
  empty: { textAlign: 'center' as const, padding: 'var(--space-lg)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
};
