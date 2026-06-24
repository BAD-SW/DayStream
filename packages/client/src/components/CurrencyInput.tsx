import { useState, useCallback } from 'react';

interface CurrencyInputProps {
  value: number; // value in cents
  onChange: (cents: number) => void;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Currency input that auto-formats with 2 decimal places.
 * As the user types digits, the decimal is always 2 places from the right.
 * e.g., typing "15199" displays as "151.99"
 * 
 * Uses the browser's locale for decimal separator (. or ,).
 */
export function CurrencyInput({ value, onChange, style, placeholder, disabled }: CurrencyInputProps) {
  const [focused, setFocused] = useState(false);

  const formatDisplay = useCallback((cents: number): string => {
    const abs = Math.abs(cents);
    const intPart = Math.floor(abs / 100);
    const decPart = String(abs % 100).padStart(2, '0');
    // Use locale-aware decimal separator
    const sep = (1.1).toLocaleString().charAt(1);
    return `${intPart}${sep}${decPart}`;
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow: backspace, delete, tab, escape, enter
    if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        // Remove last digit
        const newValue = Math.floor(value / 10);
        onChange(newValue);
      }
      return;
    }

    // Only allow digits
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    // Append digit to the right
    const newValue = value * 10 + parseInt(e.key);
    // Cap at a reasonable max (999,999,999.99)
    if (newValue <= 99999999999) {
      onChange(newValue);
    }
  }, [value, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/[^\d]/g, '');
    if (text) {
      const pasted = parseInt(text);
      if (!isNaN(pasted) && pasted <= 99999999999) {
        onChange(pasted);
      }
    }
  }, [onChange]);

  return (
    <input
      style={style}
      value={formatDisplay(value)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder || '0.00'}
      disabled={disabled}
      inputMode="numeric"
    />
  );
}
