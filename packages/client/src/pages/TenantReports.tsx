export function TenantReports() {
  return (
    <div>
      <h2 style={styles.heading}>Reports</h2>
      <p style={styles.subtext}>Analytics and insights across your businesses.</p>

      <div style={styles.grid}>
        <div style={styles.card}>
          <span style={styles.cardIcon}>📊</span>
          <h3 style={styles.cardTitle}>Revenue Overview</h3>
          <p style={styles.cardText}>Total revenue across all businesses</p>
        </div>
        <div style={styles.card}>
          <span style={styles.cardIcon}>👥</span>
          <h3 style={styles.cardTitle}>Customer Growth</h3>
          <p style={styles.cardText}>New customer signups over time</p>
        </div>
        <div style={styles.card}>
          <span style={styles.cardIcon}>📅</span>
          <h3 style={styles.cardTitle}>Booking Activity</h3>
          <p style={styles.cardText}>Bookings and utilization rates</p>
        </div>
        <div style={styles.card}>
          <span style={styles.cardIcon}>⭐</span>
          <h3 style={styles.cardTitle}>Membership Metrics</h3>
          <p style={styles.cardText}>Active memberships and churn</p>
        </div>
      </div>

      <p style={{ ...styles.subtext, marginTop: '24px' }}>
        Detailed reporting will be populated as business data accumulates.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' },
  card: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '20px', textAlign: 'center' as const },
  cardIcon: { fontSize: '32px', display: 'block', marginBottom: '8px' },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px 0' },
  cardText: { fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 },
};
