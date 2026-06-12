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
  select: {
    backgroundColor: '#242424',
    color: '#B0B0B0',
    border: '1px solid #333',
    borderRadius: '6px',
    padding: '4px 8px',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
  },
};
