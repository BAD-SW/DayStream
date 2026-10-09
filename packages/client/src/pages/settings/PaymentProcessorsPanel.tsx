import { ProcessorConfigForm } from '../../components/ProcessorConfigForm';

/**
 * PaymentProcessorsPanel — the DayStream platform provider configuration
 * (spec phase 10). This is the provider DayStream uses to charge tenants for
 * platform billing (Phase 2 / Section A).
 *
 * Each tenant configures its OWN provider at the tenant level, and each business
 * at the business level — not here. The card DayStream charges a given tenant is
 * managed on that tenant's definition (Edit Tenant → Payment Source).
 */
export function PaymentProcessorsPanel() {
  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>Payment Processors</h3>
      <p style={styles.subtext}>
        Configure the payment provider DayStream uses to charge tenants for platform billing.
        Credentials are stored encrypted; secret values are never shown after saving. Each tenant
        and business configures its own provider separately.
      </p>
      <ProcessorConfigForm owner={{ owner_level: 'platform' }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { maxWidth: '720px' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-xs)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' },
};
