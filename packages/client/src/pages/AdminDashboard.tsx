export function AdminDashboard() {
  return (
    <div>
      <h2 style={styles.heading}>Admin Dashboard</h2>
      <p style={styles.text}>
        Admin functionality placeholder. Tenant management, configuration, and feature flags are available via the sidebar.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 16px 0', color: 'var(--color-text)' },
  text: { color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.5 },
};
