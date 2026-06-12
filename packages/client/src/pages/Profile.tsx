import { useAuth } from '../context/AuthContext';

export function Profile() {
  const { user } = useAuth();

  return (
    <div>
      <h2 style={styles.heading}>Profile</h2>
      <div style={styles.card}>
        <div style={styles.field}>
          <span style={styles.label}>Name</span>
          <span style={styles.value}>{user?.first_name} {user?.last_name}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>Email</span>
          <span style={styles.value}>{user?.email}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>Role</span>
          <span style={styles.value}>{user?.role}</span>
        </div>
      </div>
      <p style={styles.hint}>Profile editing will be available in a future phase.</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 24px 0', color: '#F5F5F3' },
  card: {
    backgroundColor: '#242424',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '12px', color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  value: { fontSize: '14px', color: '#F5F5F3' },
  hint: { fontSize: '13px', color: '#8A8A8A', marginTop: '16px' },
};
