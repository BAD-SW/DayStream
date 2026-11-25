import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Button } from '../design-system/components/actions/Button';
import * as payApi from '../api/payments';
import type { ProviderDefinition, SavedConfigView, MethodOwnerParams, OwnerLevel } from '../api/payments';
import { useDraft, fieldMark, draftBox } from './unsaved/DraftSections';

// Cache Stripe.js instances per publishable key (loadStripe should run once per key).
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string): Promise<Stripe | null> {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

/**
 * Stripe echoes the offending key in messages like
 * "Invalid API Key provided: pk_test_****...7Pqv". Strip the trailing ": <key>"
 * so we don't display the (partial) key back to the user.
 */
function cleanStripeError(message: string): string {
  return message.replace(/:\s*(pk|sk|rk)_[^\s]*$/i, '').trim();
}

/**
 * ProcessorConfigForm — reusable provider-configuration form (spec phase 10,
 * Phase 1 UI correction). Renders a dynamic form from the selected provider's
 * schema (fetched from the server), with required markers and masked secret
 * inputs. Reused at every level (platform/tenant/business) by passing the owner.
 *
 * Secret fields: a stored secret is shown as a masked placeholder; leaving the
 * field blank on save keeps the existing value, so re-saving never wipes a
 * secret the admin didn't retype.
 */

interface Props {
  owner: { owner_level: OwnerLevel; tenant_id?: string | null; business_id?: string | null };
  onSaved?: (view: SavedConfigView) => void;
  /** On a page with one Save for everything (business Settings): the form has no Save button of
   *  its own, marks the fields that changed, and is saved by the page's Save changes. */
  sharedSave?: { id: string; label: string };
}

export function ProcessorConfigForm({ owner, onSaved, sharedSave }: Props) {
  const { t } = useTranslation('tenant');
  const [schemas, setSchemas] = useState<ProviderDefinition[]>([]);
  const [saved, setSaved] = useState<SavedConfigView | null>(null);
  // The provider and its field values as edited; compared with what is stored to mark changes.
  const draft = useDraft<{ provider: string; values: Record<string, string> }>(
    sharedSave?.id || 'processor-config', sharedSave?.label || t('processor.draftLabel'), { provider: '', values: {} },
    async (d) => {
      const view = await payApi.saveProcessorConfig(owner, d.provider, d.values);
      setSaved(view);
      onSaved?.(view);
      // Keep non-secret values populated; clear secret inputs (now shown as masked/stored).
      return { provider: d.provider, values: { ...(view.config || {}) } };
    },
  );
  const { provider, values } = draft.value;
  const setValues = (next: Record<string, string>) => draft.setValue({ provider, values: next });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const ownerParams: MethodOwnerParams = { owner_level: owner.owner_level, tenant_id: owner.tenant_id, business_id: owner.business_id };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [defs, current] = await Promise.all([
        payApi.getProviderSchemas(),
        payApi.getProcessorConfig(ownerParams),
      ]);
      setSchemas(defs);
      const activeProvider = current?.provider || defs[0]?.name || '';
      setSaved(current);
      // Seed form with saved non-secret values; secrets stay blank (shown via placeholder).
      draft.load({ provider: activeProvider, values: { ...(current?.config || {}) } });
    } catch {
      setMessage({ ok: false, text: t('processor.loadFailed') });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.owner_level, owner.tenant_id, owner.business_id]);

  useEffect(() => { load(); }, [load]);

  const def = schemas.find((s) => s.name === provider);

  function onProviderChange(next: string) {
    // If switching to the already-saved provider, restore its saved config; else clear.
    draft.setValue({ provider: next, values: saved?.provider === next ? { ...(saved.config || {}) } : {} });
    setMessage(null);
  }

  async function handleTest() {
    if (!def) return;
    setTesting(true); setMessage(null);
    try {
      // Step 1: server validates the secret key (reaches the provider) and, for
      // Stripe, returns a throwaway SetupIntent client_secret + publishable key.
      const probe = await payApi.prepareConnectionProbe(owner, provider, values);
      if (!probe.ok) {
        setMessage({ ok: false, text: `✗ ${probe.message || t('processor.testFailed')}` });
        return;
      }

      // Step 2 (Stripe): verify the publishable key end-to-end by loading Stripe.js
      // with it and retrieving the SetupIntent the secret key just created. This
      // only succeeds if the publishable key is valid AND from the same account/mode
      // as the secret key — catching bogus, corrupted, or mismatched keys.
      if (probe.provider === 'stripe' && probe.clientSecret) {
        if (!probe.publishableKey) {
          setMessage({ ok: false, text: `✗ ${t('processor.enterPublishable')}` });
          return;
        }
        const stripe = await stripeFor(probe.publishableKey);
        if (!stripe) {
          setMessage({ ok: false, text: `✗ ${t('processor.publishableRejected')}` });
          return;
        }
        const result = await stripe.retrieveSetupIntent(probe.clientSecret);
        if (result.error || !result.setupIntent) {
          const raw = result.error?.message || t('processor.publishableUnverified');
          setMessage({ ok: false, text: `✗ ${cleanStripeError(raw)}` });
          return;
        }
        const modeText = probe.mode ? t('processor.modeSuffix', { mode: probe.mode }) : '';
        setMessage({ ok: true, text: `✓ ${t('processor.bothValid', { mode: modeText })}` });
        return;
      }

      // Non-Stripe (mock) or no client-side step needed.
      setMessage({ ok: true, text: `✓ ${probe.message || t('processor.verified')}` });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.error || t('processor.testError') });
    } finally { setTesting(false); }
  }

  async function handleSave() {
    if (!def) return;
    setSaving(true); setMessage(null);
    try {
      await draft.save();
      setMessage({ ok: true, text: t('processor.saved') });
    } catch (err: any) {
      const details = err?.response?.data?.details;
      setMessage({ ok: false, text: err?.response?.data?.error || (details ? t('processor.missing', { fields: details.join(', ') }) : t('processor.saveFailed')) });
    } finally { setSaving(false); }
  }

  if (loading) return <p style={styles.muted}>{t('processor.loading')}</p>;

  return (
    <div style={{ ...styles.wrap, ...(sharedSave ? draftBox(draft.dirty) : {}) }}>
      <div style={styles.field}>
        <label style={styles.label}>{t('processor.provider')}</label>
        <select style={{ ...styles.input, ...(sharedSave ? fieldMark(draft.changed((v) => v.provider)) : {}) }} value={provider} onChange={(e) => onProviderChange(e.target.value)}>
          {schemas.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
        </select>
      </div>

      {def?.fields.map((f) => {
        const isSetSecret = f.secret && saved?.provider === provider && saved?.secretsSet?.[f.key];
        const placeholder = isSetSecret
          ? t('processor.keepBlank', { masked: saved?.secretsMasked?.[f.key] ?? '••••' })
          : (f.placeholder || '');
        const mark = sharedSave ? fieldMark((values[f.key] ?? '') !== (draft.saved.values[f.key] ?? '')) : {};
        return (
          <div key={f.key} style={styles.field}>
            <label style={styles.label}>
              {f.label}{f.required && <span style={styles.req}> *</span>}
            </label>
            {f.type === 'select' ? (
              <select
                style={{ ...styles.input, ...mark }}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                <option value="" disabled>{t('processor.select')}</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                style={{ ...styles.input, ...mark }}
                type={f.type === 'password' ? 'password' : 'text'}
                name={`pay_cfg_${f.key}`}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                placeholder={placeholder}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                data-lpignore="true"
                data-1p-ignore="true"
              />
            )}
            {f.help && <span style={styles.help}>{f.help}</span>}
          </div>
        );
      })}

      {message && (
        <p style={{ ...styles.msg, color: message.ok ? 'var(--color-success, #17794A)' : 'var(--color-error, #C4291C)' }}>
          {message.text}
        </p>
      )}

      <div style={styles.actions}>
        <Button variant="outline" loading={testing} onClick={handleTest}>{t('processor.testConnection')}</Button>
        {!sharedSave && <Button variant="primary" loading={saving} onClick={handleSave}>{t('processor.saveConfiguration')}</Button>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxWidth: '560px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  req: { color: 'var(--color-error, #C4291C)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  help: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  msg: { fontSize: 'var(--font-size-sm)', margin: 0 },
};
