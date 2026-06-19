export function FeatureFlags() {
  return (
    <div>
      <h2 style={styles.heading}>Feature Flags</h2>
      <p style={styles.text}>
        Feature flag management will be available here. This page is under development.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 16px 0', color: 'var(--color-text)' },
  text: { color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: 1.5 },
};
