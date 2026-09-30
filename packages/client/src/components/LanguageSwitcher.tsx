import { useTranslation } from 'react-i18next';

/**
 * Language switcher dropdown.
 * Persists selection to localStorage so it's remembered across sessions.
 */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  }

  return (
    <select
      value={i18n.language}
      onChange={handleChange}
      style={styles.select}
      aria-label="Language"
    >
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // Sized by the host bar via --topbar-control-* (THE-7); falls back to the old compact size.
  select: {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--topbar-control-radius, 6px)',
    height: 'var(--topbar-control-size, auto)',
    padding: '4px 12px',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--topbar-control-font-size, 13px)',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
