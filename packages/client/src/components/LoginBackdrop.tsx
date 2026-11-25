import { CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './LoginBackdrop.css';

/** Soft colours from the design system; each word is also very faint, so none of them stands out. */
const COLOURS = [
  'var(--color-primary)',
  'var(--color-primary-hover)',
  'var(--color-accent)',
  'var(--color-accent-hover)',
  'var(--color-info-light)',
  'var(--color-success-light)',
  'var(--color-warning-light)',
  'var(--color-capacity-override)',
  'var(--color-text-secondary)',
];

type WordStyle = CSSProperties & Record<`--${string}`, string>;

interface Word {
  key: number;
  style: WordStyle;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A new arrangement of the wordmark, scattered over the whole screen. */
function scatter(width: number, height: number): Word[] {
  const count = Math.max(10, Math.min(36, Math.round((width * height) / 45000)));
  const words: Word[] = [];
  // Words may fall behind the sign-in panel; its solid background covers them (owner, 26 Nov 2026).
  while (words.length < count) {
    const size = between(1, 6.5); // rem
    const x = between(-5, 95); // % of the width, the word's left edge
    const y = between(-3, 97); // % of the height, the word's middle
    // Bigger words are fainter, so a large one never draws the eye.
    const opacity = between(0.05, 0.16) * (1 - (size - 1) / 9);
    const rotation = between(-35, 35);
    const duration = between(28, 60);
    words.push({
      key: words.length,
      style: {
        left: `${x}%`,
        top: `${y}%`,
        fontSize: `${size.toFixed(2)}rem`,
        color: COLOURS[Math.floor(Math.random() * COLOURS.length)],
        opacity: Number(opacity.toFixed(3)),
        '--login-word-rotate': `${rotation.toFixed(1)}deg`,
        '--login-word-turn': `${(rotation + between(-6, 6)).toFixed(1)}deg`,
        '--login-word-dx': `${between(-40, 40).toFixed(0)}px`,
        '--login-word-dy': `${between(-30, 30).toFixed(0)}px`,
        animationDuration: `${duration.toFixed(0)}s`,
        animationDelay: `-${between(0, duration).toFixed(0)}s`,
      },
    });
  }
  return words;
}

/**
 * Faint DayStream wordmarks scattered behind the sign-in panel, arranged differently on every visit
 * and drifting slowly (still when the device asks for reduced motion). Decoration only: hidden from
 * screen readers and never in the way of a click.
 */
export function LoginBackdrop() {
  const { t } = useTranslation('common');
  const words = useMemo(() => scatter(window.innerWidth, window.innerHeight), []);
  const name = t('app_name');
  return (
    <div className="login-backdrop" aria-hidden="true">
      {words.map((w) => (
        <span key={w.key} className="login-backdrop__word" style={w.style}>{name}</span>
      ))}
    </div>
  );
}
