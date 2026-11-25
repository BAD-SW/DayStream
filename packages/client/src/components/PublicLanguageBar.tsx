import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * The language menu on pages shown before sign-in or without the app's menu bar: sign-in, password
 * reset, the booking widget, self check-in, public forms (Phase 44, requirement 2.5). It sits in the
 * top corner of the page. The choice is remembered on the device and saved to the account at the next
 * sign-in. It shows nothing while only one language is offered.
 */
export function PublicLanguageBar({ languages }: { languages?: readonly string[] }) {
  return (
    <div style={styles.bar}>
      <LanguageSwitcher languages={languages} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    top: 'var(--space-md)',
    right: 'var(--space-md)',
    zIndex: 10,
  },
};
