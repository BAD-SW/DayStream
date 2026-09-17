import { useState, useEffect } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { apiClient } from '../../api/client';
import { applyTheme } from '../../api/themes';
import { ThemeListItem, ThemeScope } from '@daystream/shared';

interface ApplyThemeDialogProps {
  theme: ThemeListItem;
  persona: 'business' | 'tenant' | 'system';
  onClose: () => void;
  onApplied: () => void;
}

interface Option { id: string; name: string }

export function ApplyThemeDialog({ theme, persona, onClose, onApplied }: ApplyThemeDialogProps) {
  const scopeOptions: ThemeScope[] = persona === 'business' ? ['business'] : persona === 'tenant' ? ['tenant', 'business'] : ['system', 'tenant', 'business'];
  const [scope, setScope] = useState<ThemeScope>(scopeOptions[0]);
  const [ownTenantId, setOwnTenantId] = useState<string | null>(null);
  const [ownBusinessId] = useState<string | null>(() => localStorage.getItem('business_id'));
  const [tenants, setTenants] = useState<Option[]>([]);
  const [businesses, setBusinesses] = useState<Option[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/v1/admin/my-context').then((res) => {
      setOwnTenantId(res.data.data?.tenant?.id || null);
    }).catch(() => {});
    if (persona === 'system') {
      apiClient.get('/v1/admin/tenants').then((res) => setTenants(res.data.data || [])).catch(() => {});
    }
  }, [persona]);

  useEffect(() => {
    if (scope !== 'business') return;
    const tenantIdForBusinesses = persona === 'system' ? selectedTenantId : undefined;
    if (persona === 'system' && !tenantIdForBusinesses) { setBusinesses([]); return; }
    apiClient.get('/v1/admin/businesses', tenantIdForBusinesses ? { headers: { 'X-Context-Tenant-Id': tenantIdForBusinesses } } : undefined)
      .then((res) => setBusinesses(res.data.data || []))
      .catch(() => setBusinesses([]));
  }, [scope, selectedTenantId, persona]);

  function resolveScopeId(): string | null {
    if (scope === 'system') return null;
    if (scope === 'tenant') return persona === 'system' ? (selectedTenantId || null) : ownTenantId;
    // scope === 'business'
    if (persona === 'business') return ownBusinessId;
    return selectedBusinessId || null;
  }

  const scopeId = resolveScopeId();
  const canConfirm = scope === 'system' || !!scopeId;

  async function handleConfirm() {
    setSaving(true); setErrorMsg(null);
    try {
      await applyTheme(theme.id, { scope, scope_id: scopeId });
      onApplied();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to apply theme.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Apply &ldquo;{theme.name}&rdquo;</h3>

        {scopeOptions.length > 1 && (
          <div style={styles.scopeRow}>
            {scopeOptions.map((s) => (
              <button key={s} type="button"
                style={{ ...styles.scopeBtn, ...(scope === s ? styles.scopeBtnActive : {}) }}
                onClick={() => { setScope(s); setSelectedTenantId(''); setSelectedBusinessId(''); }}
              >
                {s === 'system' ? 'System (platform default)' : s === 'tenant' ? 'Tenant' : 'Business'}
              </button>
            ))}
          </div>
        )}

        {scope === 'tenant' && persona === 'system' && (
          <select style={styles.select} value={selectedTenantId} onChange={(e) => setSelectedTenantId(e.target.value)}>
            <option value="">Select a tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        {scope === 'business' && persona !== 'business' && (
          <>
            {persona === 'system' && (
              <select style={styles.select} value={selectedTenantId} onChange={(e) => { setSelectedTenantId(e.target.value); setSelectedBusinessId(''); }}>
                <option value="">Select a tenant…</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <select style={styles.select} value={selectedBusinessId} onChange={(e) => setSelectedBusinessId(e.target.value)}
              disabled={persona === 'system' && !selectedTenantId}>
              <option value="">Select a business…</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )}

        {errorMsg && <p style={styles.errorText}>{errorMsg}</p>}

        <div style={styles.actions}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} loading={saving} disabled={!canConfirm}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', width: '380px', maxWidth: '90vw', border: '1px solid var(--color-border)' },
  title: { fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 var(--space-lg) 0' },
  scopeRow: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: 'var(--space-md)' },
  scopeBtn: { textAlign: 'left', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', cursor: 'pointer', fontSize: '13.5px' },
  scopeBtnActive: { borderColor: 'var(--color-primary)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', fontWeight: 600 },
  select: { width: '100%', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '13.5px', marginBottom: '8px' },
  errorText: { fontSize: '13px', color: 'var(--color-error)', margin: '4px 0 0' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--space-lg)' },
};
