export function TenantBilling() {
  return (
    <div>
      <h2 style={styles.heading}>Billing</h2>
      <p style={styles.subtext}>Manage your subscription, invoices, and payment methods.</p>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Current Plan</h3>
        <p style={styles.cardText}>Plan details will be available once payment processing is configured (Phase 10).</p>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Invoices</h3>
        <p style={styles.cardText}>No invoices available yet.</p>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Payment Methods</h3>
        <p style={styles.cardText}>No payment methods on file.</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  card: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '20px', marginBottom: '16px' },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px 0' },
  cardText: { fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 },
};
