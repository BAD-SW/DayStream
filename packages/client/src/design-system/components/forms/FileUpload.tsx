import { useRef, useState } from 'react';
import { FormField } from './FormField';

interface FileUploadProps {
  label: string;
  name: string;
  onChange: (files: FileList | null) => void;
  accept?: string; // e.g., "image/*,.pdf"
  multiple?: boolean;
  maxSizeMB?: number;
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FileUpload({ label, name, onChange, accept, multiple, maxSizeMB = 10, error, helperText, required, disabled }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sizeError, setSizeError] = useState<string>('');

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && maxSizeMB) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].size > maxSizeMB * 1024 * 1024) {
          setSizeError(`File exceeds ${maxSizeMB}MB limit`);
          return;
        }
      }
    }
    setSizeError('');
    setFileName(files ? Array.from(files).map(f => f.name).join(', ') : '');
    onChange(files);
  }

  return (
    <FormField label={label} name={name} error={error || sizeError} helperText={helperText} required={required}>
      <div style={styles.dropzone} onClick={() => inputRef.current?.click()}>
        <input
          ref={inputRef}
          id={name}
          name={name}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleChange}
          disabled={disabled}
          style={styles.hiddenInput}
          aria-invalid={!!(error || sizeError)}
        />
        {fileName ? (
          <span style={styles.fileName}>{fileName}</span>
        ) : (
          <span style={styles.placeholder}>Click to upload or drag and drop</span>
        )}
      </div>
    </FormField>
  );
}

const styles: Record<string, React.CSSProperties> = {
  dropzone: {
    border: '2px dashed var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-lg)',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color var(--duration-fast) var(--ease-default)',
  },
  hiddenInput: { display: 'none' },
  placeholder: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  fileName: { color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' },
};
