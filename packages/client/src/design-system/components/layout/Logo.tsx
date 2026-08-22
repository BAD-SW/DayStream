import { CSSProperties } from 'react';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * The DayStream mark: a calendar day-cell with the day's schedule flowing
 * through it as a wave, plus an accent "today" dot. Uses the app's own
 * design tokens (--color-primary for the cell/wave, --color-accent for the
 * dot) so it automatically follows the dark/light theme toggle without any
 * extra logic — no separate light/dark asset needed.
 */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="20" y="20" width="60" height="60" rx="16" fill="none" stroke="var(--color-primary)" strokeWidth="7" />
      <circle cx="68" cy="32" r="7" fill="var(--color-accent)" />
      <path d="M28,58 Q39,49 50,58 T72,58" stroke="var(--color-primary)" strokeWidth="7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps extends LogoMarkProps {
  showWordmark?: boolean;
  wordmarkStyle?: CSSProperties;
}

/**
 * Full DayStream lockup: the mark plus the "DayStream" wordmark, set in
 * Outfit (loaded via the Google Fonts link in index.html) so the brand
 * name reads as a mark rather than as more UI copy in Inter.
 */
export function Logo({ size = 28, showWordmark = true, wordmarkStyle, className }: LogoProps) {
  return (
    <span style={styles.lockup}>
      <LogoMark size={size} className={className} />
      {showWordmark && (
        <span style={{ ...styles.wordmark, ...wordmarkStyle }}>DayStream</span>
      )}
    </span>
  );
}

const styles: Record<string, CSSProperties> = {
  lockup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
  },
  wordmark: {
    fontFamily: "'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontWeight: 700,
    fontSize: '19px',
    letterSpacing: '-0.01em',
    color: 'var(--color-text)',
  },
};
