import { useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as customersApi from '../api/customers';

type Step = 'upload' | 'mapping' | 'validation' | 'confirm';

export function CustomerImport() {
  const [step, setStep] = useState<Step>('upload');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validationResult, setValidationResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const CUSTOMER_FIELDS = [
    { value: '', label: '— Skip —' },
    { value: 'email', label: 'Email' },
    { value: 'first_name', label: 'First Name' },
    { value: 'last_name', label: 'Last Name' },
    { value: 'phone', label: 'Phone' },
    { value: 'date_of_birth', label: 'Date of Birth' },
    { value: 'gender', label: 'Gender' },
    { value: 'preferred_language', label: 'Language' },
    { value: 'country', label: 'Country' },
  ];

  // Step 1: File upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      // Parse headers
      const firstLine = text.split(/\r?\n/)[0];
      const parsedHeaders = firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      setHeaders(parsedHeaders);

      // Auto-map obvious columns
      const autoMap: Record<string, string> = {};
      for (const header of parsedHeaders) {
        const lower = header.toLowerCase().replace(/\s+/g, '_');
        const match = CUSTOMER_FIELDS.find((f) => f.value === lower);
        if (match) autoMap[header] = match.value;
      }
      setMapping(autoMap);
      setStep('mapping');
    };
    reader.readAsText(file);
  };

  // Step 2: Validate
  const handleValidate = async () => {
    setLoading(true);
    try {
      const result = await customersApi.validateImport({
        csv_text: csvText,
        mapping,
        business_id: businessId,
      });
      setValidationResult(result);
      setStep('validation');
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Execute import
  const handleImport = async () => {
    setLoading(true);
    try {
      const result = await customersApi.executeImport({
        csv_text: csvText,
        mapping,
        business_id: businessId,
      });
      setImportResult(result);
      setStep('confirm');
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Import Customers</h1>

      {/* Step indicator */}
      <div style={styles.steps}>
        {['Upload', 'Map Columns', 'Validate', 'Confirm'].map((label, i) => {
          const stepNames: Step[] = ['upload', 'mapping', 'validation', 'confirm'];
          const isActive = stepNames.indexOf(step) >= i;
          return (
            <div key={label} style={{ ...styles.step, ...(isActive ? styles.stepActive : {}) }}>
              <span style={styles.stepNum}>{i + 1}</span>
              <span style={styles.stepLabel}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div style={styles.stepContent}>
          <p style={styles.description}>Upload a CSV file with your customer data.</p>
          <input type="file" accept=".csv" onChange={handleFileUpload} style={styles.fileInput} />
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <div style={styles.stepContent}>
          <p style={styles.description}>Map your CSV columns to customer fields.</p>
          <div style={styles.mappingGrid}>
            {headers.map((header) => (
              <div key={header} style={styles.mappingRow}>
                <span style={styles.mappingHeader}>{header}</span>
                <span style={styles.mappingArrow}>→</span>
                <select
                  value={mapping[header] || ''}
                  onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                  style={styles.select}
                >
                  {CUSTOMER_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={styles.actions}>
            <Button onClick={() => setStep('upload')}>Back</Button>
            <Button onClick={handleValidate}>{loading ? 'Validating...' : 'Validate'}</Button>
          </div>
        </div>
      )}

      {/* Step 3: Validation Results */}
      {step === 'validation' && validationResult && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Validation Results</h2>
          <div style={styles.stats}>
            <span>Total rows: {validationResult.total}</span>
            <span>Errors: {validationResult.errors.length}</span>
          </div>
          {validationResult.valid ? (
            <Alert variant="success">All rows are valid and ready to import.</Alert>
          ) : (
            <>
              <Alert variant="warning">{validationResult.errors.length} error(s) found. These rows will be skipped.</Alert>
              <div style={styles.errorList}>
                {validationResult.errors.slice(0, 20).map((err: any, i: number) => (
                  <div key={i} style={styles.errorRow}>
                    <span>Row {err.row}</span>
                    <span>{err.field}: {err.message}</span>
                  </div>
                ))}
                {validationResult.errors.length > 20 && (
                  <p style={styles.moreErrors}>...and {validationResult.errors.length - 20} more errors</p>
                )}
              </div>
            </>
          )}
          <div style={styles.actions}>
            <Button onClick={() => setStep('mapping')}>Back</Button>
            <Button onClick={handleImport}>{loading ? 'Importing...' : 'Import'}</Button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm/Results */}
      {step === 'confirm' && importResult && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Import Complete</h2>
          <Alert variant="success">
            Successfully imported {importResult.imported} of {importResult.total} customers.
          </Alert>
          <div style={styles.stats}>
            <span>Total: {importResult.total}</span>
            <span>Imported: {importResult.imported}</span>
            <span>Skipped: {importResult.skipped}</span>
          </div>
          {importResult.errors.length > 0 && (
            <div style={styles.errorList}>
              <h3 style={styles.errorTitle}>Skipped Rows</h3>
              {importResult.errors.slice(0, 10).map((err: any, i: number) => (
                <div key={i} style={styles.errorRow}>
                  <span>Row {err.row}</span>
                  <span>{err.field}: {err.message}</span>
                </div>
              ))}
            </div>
          )}
          <Button onClick={() => { setStep('upload'); setCsvText(''); setHeaders([]); setMapping({}); setValidationResult(null); setImportResult(null); }}>
            Import More
          </Button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  steps: { display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' },
  step: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', opacity: 0.5 },
  stepActive: { opacity: 1 },
  stepNum: { width: '24px', height: '24px', borderRadius: 'var(--radius-full)', background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)' as any },
  stepLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  stepContent: { padding: 'var(--space-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' },
  fileInput: { fontSize: 'var(--font-size-sm)' },
  mappingGrid: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  mappingRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)' },
  mappingHeader: { minWidth: '150px', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  mappingArrow: { color: 'var(--color-text-secondary)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-lg)' },
  stats: { display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  errorList: { marginTop: 'var(--space-md)', maxHeight: '300px', overflow: 'auto' },
  errorTitle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, marginBottom: 'var(--space-sm)' },
  errorRow: { display: 'flex', gap: 'var(--space-md)', padding: 'var(--space-xs) 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' },
  moreErrors: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)', marginTop: 'var(--space-sm)' },
};
