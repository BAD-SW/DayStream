import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, isSupportedLanguage } from '@daystream/shared';
import { useAuth } from '../context/AuthContext';
import { useContextManager } from '../context/ContextManager';
import { apiClient } from '../api/client';
import { rememberChoice, showLanguage } from '../i18n';

/**
 * The menu bar's language choice (Phase 44, requirement 2): the one language list, each language named in
 * its own language. Hidden for the System persona (always English) and while only one language is offered.
 * Signed in, the choice is saved on the account so it follows the person to every device; signed out, it
 * is remembered on the device and saved to the account at the next sign-in.
 */
export function LanguageSwitcher({ languages }: { languages?: readonly string[] } = {}) {
  const { t, i18n } = useTranslation('common');
  const { user, setUserLanguage } = useAuth();
  const { persona } = useContextManager();

  const options = LANGUAGE_OPTIONS.filter((l) => !languages || languages.includes(l.code));
  if (options.length < 2) return null;
  if (user && persona === 'system') return null;

  async function handleChange(lang: string) {
    if (!isSupportedLanguage(lang)) return;
    rememberChoice(lang, !!user);
    await showLanguage(lang);
    if (user) {
      try {
        await apiClient.put('/v1/profile/language', { language: lang });
        setUserLanguage(lang);
      } catch { /* kept on the device; saved at the next sign-in */ rememberChoice(lang, false); }
    }
  }

  return (
    <select
      value={i18n.language}
      onChange={(e) => { void handleChange(e.target.value); }}
      style={styles.select}
      aria-label={t('language')}
    >
      {options.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>
      ))}
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
    minHeight: '44px',
    padding: '4px 12px',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--topbar-control-font-size, 13px)',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
