import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { ProspectsList } from './ProspectsList';

/**
 * TenantProspectsPanel — SYSTEM ADMIN control to generate a tenant's prospect list
 * (the costly Google Places search). Generation lives here, in the tenant-definition
 * window, rather than in the tenant's own app — so a tenant can't repeatedly trigger
 * cost. The tenant still VIEWS the resulting prospects in their own Prospects page.
 *
 * Depends on the tenant having a territory assigned (the TerritoryPicker above).
 */

interface Props {
  tenantId: string;
}

interface CategoryMapping { id: string; ui_category_name: string }

export function TenantProspectsPanel({ tenantId }: Props) {
  const [categories, setCategories] = useState<CategoryMapping[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<{ total: number; added: number; inactive: number; calls?: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const [listCount, setListCount] = useState<number | null>(null);

  useEffect(() => {
    apiClient.get('/v1/prospects/categories')
      .then((res) => {
        const cats: CategoryMapping[] = res.data.data || [];
        setCategories(cats);
        setSelectedIds(cats.map((c) => c.id));
      })
      .catch(() => {});
  }, []);

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function handleGenerate() {
    if (selectedIds.length === 0) { setMsg({ ok: false, text: 'Select at least one category.' }); return; }
    setMsg(null);

    // Preview the search plan + cost range first and confirm.
    try {
      const preview = await apiClient.get(
        `/v1/prospects/${tenantId}/generate/preview?category_ids=${selectedIds.join(',')}`,
      );
      const plan = preview.data.data;
      const minCalls = plan.estimated_api_calls_min ?? plan.estimated_api_calls;
      const maxCalls = plan.estimated_api_calls_max ?? plan.estimated_api_calls;
      const minCost = plan.estimated_cost_usd_min ?? plan.estimated_cost_usd;
      const maxCost = plan.estimated_cost_usd_max ?? plan.estimated_cost_usd;
      const ok = window.confirm(
        `Search Plan:\n\n` +
        `• ${plan.search_centers} search areas across ${plan.categories} categor${plan.categories === 1 ? 'y' : 'ies'}\n` +
        `• Dense areas are searched in finer detail to capture the full list\n` +
        `• Estimated API calls: ${minCalls.toLocaleString()}–${maxCalls.toLocaleString()}\n` +
        `• Estimated cost: $${minCost}–$${maxCost}\n\n` +
        `This runs a paid Google Places search. Proceed?`,
      );
      if (!ok) return;
    } catch (err: any) {
      const text = err?.response?.data?.error || 'Could not load the search plan.';
      if (!window.confirm(`${text}\n\nProceed with generation anyway?`)) return;
    }

    setGenerating(true);
    try {
      const res = await apiClient.post(`/v1/prospects/${tenantId}/generate`, { category_ids: selectedIds });
      const r = res.data.data || res.data;
      setLastRun({ total: r.total_returned ?? 0, added: r.new_added ?? 0, inactive: r.inactive_marked ?? 0, calls: r.api_calls });
      setMsg({ ok: true, text: 'Prospect list generated.' });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.error || 'Failed to generate prospects.' });
    } finally { setGenerating(false); }
  }

  return (
    <div style={styles.wrap}>
      <p style={styles.help}>
        Generate the prospect list for this tenant from Google Places, scoped to the territory
        above. This is a paid search run by DayStream admins — the tenant views the results in
        their own Prospects page but cannot run it themselves.
      </p>

      {categories.length === 0 ? (
        <p style={styles.muted}>No prospect categories configured.</p>
      ) : (
        <>
          <div style={styles.chips}>
            {categories.map((c) => {
              const on = selectedIds.includes(c.id);
              return (
                <button
                  key={c.id} type="button" onClick={() => toggle(c.id)}
                  style={{ ...styles.chip, ...(on ? styles.chipOn : {}) }}
                >
                  {c.ui_category_name}
                </button>
              );
            })}
          </div>
          <div style={styles.actions}>
            <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
              {generating ? 'Generating…' : 'Generate prospects'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowList(true)}>View prospects</Button>
            <span style={styles.muted}>{selectedIds.length} of {categories.length} categories selected</span>
          </div>
        </>
      )}

      {msg && (
        <p style={{ ...styles.msg, color: msg.ok ? 'var(--color-success, #17794A)' : 'var(--color-error, #C4291C)' }}>{msg.text}</p>
      )}
      {lastRun && (
        <p style={styles.muted}>
          {lastRun.total} prospects found · {lastRun.added} added · {lastRun.inactive} marked inactive
          {lastRun.calls != null ? ` · ${lastRun.calls.toLocaleString()} API calls` : ''}
        </p>
      )}

      {/* System-admin view of this tenant's prospect list — same detail/functionality
          the tenant sees on their own Prospects page. */}
      {showList && (
        <div style={styles.overlay} onClick={() => setShowList(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                Prospects{listCount != null ? ` (${listCount})` : ''}
              </h3>
              <button style={styles.closeBtn} onClick={() => setShowList(false)} aria-label="Close">&times;</button>
            </div>
            <p style={styles.muted}>Viewing this tenant&rsquo;s prospect list. Changes here (status, notes, dismiss) apply to the tenant.</p>
            <ProspectsList apiBase={`/v1/prospects/${tenantId}`} ownTenant={false} onCountChange={setListCount} />
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxWidth: '860px' },
  help: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  muted: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0 },
  msg: { fontSize: 'var(--font-size-sm)', margin: '4px 0 0' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: { padding: '4px 12px', fontSize: 'var(--font-size-sm)', borderRadius: '16px', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  chipOn: { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: '4px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', width: '95vw', maxWidth: '1200px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '0 8px', lineHeight: 1 },
};
