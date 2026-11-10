import type { CSSProperties } from 'react';
import { LANGUAGE_OPTIONS, isSupportedLanguage } from '@daystream/shared';

/**
 * THE language dropdown. Every place that asks for a language uses this, and it lists exactly the
 * languages on the shared supported list, so adding a language is a one-place change.
 *
 * `blankLabel` adds a first option with an empty value (for example "Default (no language)").
 * A stored value that is no longer on the list is still shown, marked as not supported, so it is
 * never silently lost; choosing a supported language replaces it.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  style?: CSSProperties;
  blankLabel?: string;
  /** Languages to leave out, for example ones a form already has. */
  exclude?: readonly string[];
  disabled?: boolean;
  'aria-label'?: string;
}

export function LanguageSelect({ value, onChange, id, style, blankLabel, exclude = [], disabled, ...rest }: Props) {
  const options = LANGUAGE_OPTIONS.filter((o) => !exclude.includes(o.code));
  const unsupported = !!value && !isSupportedLanguage(value);
  return (
    <select id={id} style={style} value={value} disabled={disabled} aria-label={rest['aria-label']}
      onChange={(e) => onChange(e.target.value)}>
      {blankLabel !== undefined && <option value="">{blankLabel}</option>}
      {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      {unsupported && <option value={value}>{`${value} (not supported, choose a language)`}</option>}
    </select>
  );
}
