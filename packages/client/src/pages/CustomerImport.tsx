import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as customersApi from '../api/customers';

type Step = 'upload' | 'mapping' | 'validation' | 'confirm';

const REQUIRED_FIELDS = ['email', 'first_name', 'last_name'];

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((cell) => {
    const str = String(cell ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function CustomerImport() {
  const { t } = useTranslation('customers');
  const [step, setStep] = useState<Step>('upload');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validationResult, setValidationResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  // The values are the field ids the import matches on; their words are import.field.<id> (skip for the empty one).
  const CUSTOMER_FIELDS = ['', 'email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country'];
  const fieldLabel = (value: string) => t('import.field.' + (value || 'skip'));

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
        const match = CUSTOMER_FIELDS.find((f) => f === lower);
        if (match) autoMap[header] = match;
      }
      setMapping(autoMap);
      setStep('mapping');
    };
    reader.readAsText(file);
  };

  const missingRequired = REQUIRED_FIELDS.filter((field) => !Object.values(mapping).includes(field));

  // Step 2: Validate
  const handleValidate = async () => {
    if (missingRequired.length > 0) return;
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
      <h1 style={styles.title}>{t('import.title')}</h1>

      {/* Step indicator */}
      <div style={styles.steps}>
        {(['upload', 'mapping', 'validation', 'confirm'] as Step[]).map((name, i) => {
          const stepNames: Step[] = ['upload', 'mapping', 'validation', 'confirm'];
          const isActive = stepNames.indexOf(step) >= i;
          return (
            <div key={name} style={{ ...styles.step, ...(isActive ? styles.stepActive : {}) }}>
              <span style={styles.stepNum}>{i + 1}</span>
              <span style={styles.stepLabel}>{t('import.step.' + name)}</span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div style={styles.stepContent}>
          <p style={styles.description}>{t('import.uploadHelp')}</p>
          <input type="file" accept=".csv" onChange={handleFileUpload} style={styles.fileInput} />
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <div style={styles.stepContent}>
          <p style={styles.description}>{t('import.mapHelp')}</p>
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
                    <option key={f} value={f}>{fieldLabel(f)}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <Alert variant="error">
              {t('import.missingRequired', { fields: missingRequired.map((f) => fieldLabel(f)).join(', ') })}
            </Alert>
          )}
          <div style={styles.actions}>
            <Button onClick={() => setStep('upload')}>{t('common:back')}</Button>
            <Button onClick={handleValidate} disabled={missingRequired.length > 0}>{loading ? t('import.validating') : t('import.validate')}</Button>
          </div>
        </div>
      )}

      {/* Step 3: Validation Results */}
      {step === 'validation' && validationResult && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>{t('import.validationResults')}</h2>
          <div style={styles.stats}>
            <span>{t('import.totalRows', { n: validationResult.total })}</span>
            <span>{t('import.errorsCount', { n: validationResult.errors.length })}</span>
          </div>
          {validationResult.valid ? (
            <Alert variant="success">{t('import.allValid')}</Alert>
          ) : (
            <>
              <Alert variant="warning">{t('import.errorsFound', { n: validationResult.errors.length })}</Alert>
              <div style={styles.errorList}>
                {validationResult.errors.slice(0, 20).map((err: any, i: number) => (
                  <div key={i} style={styles.errorRow}>
                    <span>{t('import.row', { n: err.row })}</span>
                    <span>{err.field}: {err.message}</span>
                  </div>
                ))}
                {validationResult.errors.length > 20 && (
                  <p style={styles.moreErrors}>{t('import.moreErrors', { n: validationResult.errors.length - 20 })}</p>
                )}
              </div>
            </>
          )}
          <div style={styles.actions}>
            <Button onClick={() => setStep('mapping')}>{t('common:back')}</Button>
            <Button onClick={handleImport}>{loading ? t('import.importing') : t('import.import')}</Button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm/Results */}
      {step === 'confirm' && importResult && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>{t('import.complete')}</h2>
          <Alert variant="success">
            {t('import.imported', { imported: importResult.imported, total: importResult.total })}
          </Alert>
          <div style={styles.stats}>
            <span>{t('import.statTotal', { n: importResult.total })}</span>
            <span>{t('import.statImported', { n: importResult.imported })}</span>
            <span>{t('import.statSkipped', { n: importResult.skipped })}</span>
          </div>
          {importResult.errors.length > 0 && (
            <div style={styles.errorList}>
              <div style={styles.errorListHeader}>
                <h3 style={styles.errorTitle}>{t('import.skippedRows')}</h3>
                <Button
                  variant="outline"
                  onClick={() => downloadCsv(
                    `customer-import-errors-${new Date().toISOString().split('T')[0]}.csv`,
                    [['row', 'field', 'reason'], ...importResult.errors.map((err: any) => [String(err.row), err.field, err.message])],
                  )}
                >
                  {t('import.downloadErrors')}
                </Button>
              </div>
              {importResult.errors.slice(0, 10).map((err: any, i: number) => (
                <div key={i} style={styles.errorRow}>
                  <span>{t('import.row', { n: err.row })}</span>
                  <span>{err.field}: {err.message}</span>
                </div>
              ))}
              {importResult.errors.length > 10 && (
                <p style={styles.moreErrors}>{t('import.moreSkipped', { n: importResult.errors.length - 10 })}</p>
              )}
            </div>
          )}
          <Button onClick={() => { setStep('upload'); setCsvText(''); setHeaders([]); setMapping({}); setValidationResult(null); setImportResult(null); }}>
            {t('import.importMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
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
  errorListHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' },
  errorTitle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' as any, marginBottom: 'var(--space-sm)' },
  errorRow: { display: 'flex', gap: 'var(--space-md)', padding: 'var(--space-xs) 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' },
  moreErrors: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)', marginTop: 'var(--space-sm)' },
};
