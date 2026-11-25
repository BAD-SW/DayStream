import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, isSupportedLanguage } from '@daystream/shared';

/**
 * THE language dropdown. Every place that asks for a language uses this. It lists the languages on the
 * shared list, or only those given in `languages` (a business's languages, Phase 44 requirement 8).
 *
 * `blankLabel` adds a first option with an empty value (for example "Default (no language)").
 * A stored value that is not offered is still shown, marked as such, so it is never silently lost;
 * choosing an offered language replaces it.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  style?: CSSProperties;
  blankLabel?: string;
  /** The languages to offer (codes); all of DayStream's languages when not given. */
  languages?: readonly string[];
  /** Languages to leave out, for example ones a form already has. */
  exclude?: readonly string[];
  disabled?: boolean;
  'aria-label'?: string;
}

export function LanguageSelect({ value, onChange, id, style, blankLabel, languages, exclude = [], disabled, ...rest }: Props) {
  const { t } = useTranslation('common');
  const options = LANGUAGE_OPTIONS.filter((o) => !exclude.includes(o.code) && (!languages || languages.includes(o.code)));
  const offered = options.some((o) => o.code === value);
  const notOffered = !!value && !offered && !exclude.includes(value);
  return (
    <select id={id} style={style} value={value} disabled={disabled} aria-label={rest['aria-label']}
      onChange={(e) => onChange(e.target.value)}>
      {blankLabel !== undefined && <option value="">{blankLabel}</option>}
      {options.map((o) => <option key={o.code} value={o.code} lang={o.code}>{o.label}</option>)}
      {notOffered && (
        <option value={value}>
          {t('languageSelect.notOffered', { language: isSupportedLanguage(value) ? LANGUAGE_OPTIONS.find((o) => o.code === value)?.label ?? value : value })}
        </option>
      )}
    </select>
  );
}
