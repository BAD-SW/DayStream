import { useTheme } from './ThemeProvider';

/**
 * Dark/light mode toggle button (sun/moon icon).
 */
export function ThemeModeToggle() {
  const { mode, toggleMode } = useTheme();

  return (
    <button
      onClick={toggleMode}
      style={styles.button}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {mode === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '4px 8px',
    fontSize: '16px',
    cursor: 'pointer',
    lineHeight: 1,
  },
};
