import { useState, useEffect, useCallback } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Button } from '../design-system/components/actions/Button';
import * as payApi from '../api/payments';
import type { ProviderDefinition, SavedConfigView, MethodOwnerParams, OwnerLevel } from '../api/payments';

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
}

export function ProcessorConfigForm({ owner, onSaved }: Props) {
  const [schemas, setSchemas] = useState<ProviderDefinition[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedConfigView | null>(null);
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
      setProvider(activeProvider);
      setSaved(current);
      // Seed form with saved non-secret values; secrets stay blank (shown via placeholder).
      setValues({ ...(current?.config || {}) });
    } catch {
      setMessage({ ok: false, text: 'Failed to load provider configuration.' });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.owner_level, owner.tenant_id, owner.business_id]);

  useEffect(() => { load(); }, [load]);

  const def = schemas.find((s) => s.name === provider);

  function onProviderChange(next: string) {
    setProvider(next);
    // If switching to the already-saved provider, restore its saved config; else clear.
    setValues(saved?.provider === next ? { ...(saved.config || {}) } : {});
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
        setMessage({ ok: false, text: `✗ ${probe.message || 'Connection test failed.'}` });
        return;
      }

      // Step 2 (Stripe): verify the publishable key end-to-end by loading Stripe.js
      // with it and retrieving the SetupIntent the secret key just created. This
      // only succeeds if the publishable key is valid AND from the same account/mode
      // as the secret key — catching bogus, corrupted, or mismatched keys.
      if (probe.provider === 'stripe' && probe.clientSecret) {
        if (!probe.publishableKey) {
          setMessage({ ok: false, text: '✗ Enter the publishable key so it can be verified.' });
          return;
        }
        const stripe = await stripeFor(probe.publishableKey);
        if (!stripe) {
          setMessage({ ok: false, text: '✗ The publishable key was rejected by Stripe (it could not initialize). Check for typos.' });
          return;
        }
        const result = await stripe.retrieveSetupIntent(probe.clientSecret);
        if (result.error || !result.setupIntent) {
          const raw = result.error?.message || 'The publishable key could not verify against Stripe. Check that it matches your secret key and mode.';
          setMessage({ ok: false, text: `✗ ${cleanStripeError(raw)}` });
          return;
        }
        const modeText = probe.mode ? ` (${probe.mode} mode)` : '';
        setMessage({ ok: true, text: `✓ Both keys are valid and connected to Stripe${modeText}. Card capture will work.` });
        return;
      }

      // Non-Stripe (mock) or no client-side step needed.
      setMessage({ ok: true, text: `✓ ${probe.message || 'Connection verified.'}` });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.response?.data?.error || 'Could not test the connection.' });
    } finally { setTesting(false); }
  }

  async function handleSave() {
    if (!def) return;
    setSaving(true); setMessage(null);
    try {
      const view = await payApi.saveProcessorConfig(owner, provider, values);
      setSaved(view);
      // Keep non-secret values populated; clear secret inputs (now shown as masked/stored).
      setValues({ ...(view.config || {}) });
      setMessage({ ok: true, text: 'Configuration saved.' });
      onSaved?.(view);
    } catch (err: any) {
      const details = err?.response?.data?.details;
      setMessage({ ok: false, text: err?.response?.data?.error || (details ? `Missing: ${details.join(', ')}` : 'Failed to save configuration.') });
    } finally { setSaving(false); }
  }

  if (loading) return <p style={styles.muted}>Loading…</p>;

  return (
    <div style={styles.wrap}>
      <div style={styles.field}>
        <label style={styles.label}>Provider</label>
        <select style={styles.input} value={provider} onChange={(e) => onProviderChange(e.target.value)}>
          {schemas.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
        </select>
      </div>

      {def?.fields.map((f) => {
        const isSetSecret = f.secret && saved?.provider === provider && saved?.secretsSet?.[f.key];
        const placeholder = isSetSecret
          ? `${saved?.secretsMasked?.[f.key] ?? '••••'} (leave blank to keep)`
          : (f.placeholder || '');
        return (
          <div key={f.key} style={styles.field}>
            <label style={styles.label}>
              {f.label}{f.required && <span style={styles.req}> *</span>}
            </label>
            {f.type === 'select' ? (
              <select
                style={styles.input}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                <option value="" disabled>Select…</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                style={styles.input}
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
        <Button variant="outline" loading={testing} onClick={handleTest}>Test connection</Button>
        <Button variant="primary" loading={saving} onClick={handleSave}>Save configuration</Button>
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
