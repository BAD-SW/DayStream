import { useState, useEffect, useRef } from 'react';

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function SearchInput({ placeholder = 'Search...', value: controlledValue, onChange, debounceMs = 300 }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(controlledValue || '');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (controlledValue !== undefined) setLocalValue(controlledValue);
  }, [controlledValue]);

  function handleChange(val: string) {
    setLocalValue(val);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(val), debounceMs);
  }

  function handleClear() {
    setLocalValue('');
    onChange('');
  }

  return (
    <div style={containerStyle}>
      <span style={iconStyle}>🔍</span>
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
        aria-label={placeholder}
      />
      {localValue && (
        <button onClick={handleClear} style={clearStyle} aria-label="Clear search">✕</button>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '0 var(--space-sm)',
  height: '40px',
};

const iconStyle: React.CSSProperties = { fontSize: '14px', color: 'var(--color-text-secondary)' };

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-family)',
};

const clearStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: '14px',
  padding: '4px',
};
