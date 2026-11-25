import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { validateFormAnswers, isSignedForm, LANGUAGE_OPTIONS } from '@daystream/shared';
import type { FormDefinition, FormAnswer, FormValidationIssue } from '@daystream/shared';
import { FormRenderer } from '../components/forms/FormRenderer';
import { SignaturePad } from '../components/forms/SignaturePad';
import { PublicLanguageBar } from '../components/PublicLanguageBar';


/**
 * The page a customer completes a form on (spec 51, gap 1): reached from an emailed link, or
 * opened by staff on a device in the business. No sign-in; the token in the address is the key.
 * It works once and expires. Outside the app layout, so it is just the form.
 */

interface PublicFormData {
  channel: 'device' | 'email';
  expiresAt: string;
  business: { name: string; logoUrl: string | null; primaryColor: string | null };
  customerFirstName: string;
  initialLanguage: string | null;
  /** The business's languages, for the language menu. */
  languages?: string[];
  versions: { language: string | null; name: string; definition: FormDefinition }[];
}

const API = `${import.meta.env.VITE_API_URL || ''}/api/v1/public/forms`;

function logoSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^(https?:|data:)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/storage/${url}`;
}

export function PublicForm() {
  const { t } = useTranslation('forms');
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicFormData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswer | undefined>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // From self check-in, the customer is sent back to the kiosk or phone page afterwards. Only those
  // pages are allowed, so the address cannot be used to send anyone elsewhere.
  const next = useMemo(() => {
    const n = new URLSearchParams(window.location.search).get('next');
    return n && /^\/(kiosk|check-in\/DSCI-[0-9a-f]{20,})$/.test(n) ? n : null;
  }, []);
  // Shown inside a window over a staff page (spec 51, gap 3): tell that page when the form is submitted.
  const embedded = useMemo(() => new URLSearchParams(window.location.search).get('embedded') === '1' && window.parent !== window, []);
  useEffect(() => {
    if (done && embedded) window.parent.postMessage({ type: 'daystream:form-complete' }, window.location.origin);
  }, [done, embedded]);
  useEffect(() => {
    if (!done || !next) return;
    const timer = window.setTimeout(() => window.location.assign(next), 2500);
    return () => window.clearTimeout(timer);
  }, [done, next]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data.data as PublicFormData;
        setData(d);
        setLanguage(d.initialLanguage);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e?.response?.data?.error || null);
      });
    return () => { cancelled = true; };
  }, [token]);

  const version = useMemo(
    () => data?.versions.find((v) => v.language === language) ?? data?.versions[0] ?? null,
    [data, language],
  );
  const signed = version ? isSignedForm(version.definition) : false;


  const mapIssues = (issues: FormValidationIssue[]) => {
    const next: Record<string, string> = {};
    for (const i of issues) if (i.itemId) next[i.itemId] = i.message;
    return next;
  };

  const submit = async () => {
    if (!version) return;
    setFormError(null);
    const issues = validateFormAnswers(version.definition, answers);
    const mapped = mapIssues(issues);
    if (signed && !signature) {
      const sig = version.definition.items.find((i) => i.type === 'signature');
      if (sig) mapped[sig.id] = t('publicForm.sign');
    }
    setErrors(mapped);
    if (Object.keys(mapped).length > 0) { setFormError(t('publicForm.fix')); return; }

    setSending(true);
    try {
      await axios.post(`${API}/${encodeURIComponent(token)}`, {
        language: version.language,
        answers,
        ...(signed ? { signature } : {}),
      });
      setDone(true);
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { code?: string; details?: FormValidationIssue[] } } };
      if (err.response?.status === 410) { setLoadError(t('publicForm.invalid')); setData(null); }
      else if (err.response?.data?.code === 'INVALID_ANSWERS' && err.response.data.details) {
        setErrors(mapIssues(err.response.data.details)); setFormError(t('publicForm.fix'));
      } else setFormError(t('publicForm.failed'));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <Shell business={data?.business ?? null} languages={data?.languages}>
        <div style={s.center} role="status">
          <h1 style={s.title}>{t('publicForm.thanks')}</h1>
          <p style={s.text}>{t('publicForm.received')}</p>
          {embedded ? null : next
            ? <button type="button" style={{ ...s.button, marginTop: 'var(--space-md)' }} onClick={() => window.location.assign(next)}>{t('publicForm.continue')}</button>
            : data?.channel === 'device' && <p style={s.text}>{t('publicForm.device')}</p>}
        </div>
      </Shell>
    );
  }

  if (!data || !version) {
    return (
      <Shell business={null}>
        <p style={{ ...s.text, textAlign: 'center' }} role={loadError ? 'alert' : 'status'}>
          {loadError ?? (token ? t('publicForm.loading') : t('publicForm.invalid'))}
        </p>
      </Shell>
    );
  }

  const languagesOffered = data.versions.filter((v) => v.language);
  const langLabel = (code: string | null) =>
    code ? LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code : t('publicForm.defaultLanguage');

  return (
    <Shell business={data.business} languages={data.languages}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <h1 style={s.title}>{version.name}</h1>
        <p style={s.text}>{t('publicForm.hello', { name: data.customerFirstName })}</p>

        {data.versions.length > 1 && languagesOffered.length > 0 && (
          <div style={s.langRow}>
            <label htmlFor="form-lang" style={s.langLabel}>{t('publicForm.language')}</label>
            <select id="form-lang" style={s.select} value={version.language ?? ''}
              onChange={(e) => { setLanguage(e.target.value || null); setErrors({}); setFormError(null); }}>
              {data.versions.map((v) => (
                <option key={v.language ?? 'default'} value={v.language ?? ''}>{langLabel(v.language)}</option>
              ))}
            </select>
          </div>
        )}

        <p style={s.hint}>{t('publicForm.required')}</p>
        <FormRenderer
          definition={version.definition}
          answers={answers}
          errors={errors}
          disabled={sending}
          idPrefix="public"
          onChange={(id, v) => {
            setAnswers((a) => ({ ...a, [id]: v }));
            if (errors[id]) setErrors((er) => { const n = { ...er }; delete n[id]; return n; });
          }}
          renderSignature={(item) => (
            <SignaturePad
              label={item.label}
              clearLabel={t('publicForm.clear')}
              disabled={sending}
              hasError={!!errors[item.id]}
              onChange={(png) => {
                setSignature(png);
                if (png && errors[item.id]) setErrors((er) => { const n = { ...er }; delete n[item.id]; return n; });
              }}
            />
          )}
        />

        {formError && <p style={s.error} role="alert">{formError}</p>}
        <button type="submit" style={{ ...s.button, opacity: sending ? 0.7 : 1 }} disabled={sending}>
          {sending ? t('publicForm.sending') : t('publicForm.submit')}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ business, languages, children }: { business: PublicFormData['business'] | null; languages?: readonly string[]; children: React.ReactNode }) {
  const logo = logoSrc(business?.logoUrl ?? null);
  return (
    <div style={s.page}>
      <PublicLanguageBar languages={languages} />
      <main style={s.card}>
        {business && (
          <header style={s.header}>
            {logo
              ? <img src={logo} alt={business.name} style={s.logo} />
              : <span style={s.bizName}>{business.name}</span>}
          </header>
        )}
        {children}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { position: 'relative', minHeight: '100vh', backgroundColor: 'var(--color-background)', fontFamily: 'var(--font-family)', padding: 'var(--space-md)', paddingTop: 'calc(var(--space-xl) + var(--space-lg))', boxSizing: 'border-box' },
  card: { maxWidth: '640px', margin: '0 auto', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: 'var(--space-lg)', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-lg)' },
  logo: { maxHeight: '56px', maxWidth: '240px', objectFit: 'contain' },
  bizName: { fontSize: 'var(--font-size-h3, 1.25rem)', fontWeight: 600, color: 'var(--color-text)' },
  title: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-h2, 1.5rem)', fontWeight: 600, color: 'var(--color-text)' },
  text: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', lineHeight: 1.5 },
  hint: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  center: { textAlign: 'center', padding: 'var(--space-lg) 0' },
  langRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  langLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  select: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', minHeight: '44px' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-base)', margin: 'var(--space-md) 0 0 0' },
  button: { marginTop: 'var(--space-lg)', width: '100%', backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', padding: '14px 24px', fontSize: 'var(--font-size-base)', fontWeight: 600, cursor: 'pointer', minHeight: '48px', fontFamily: 'var(--font-family)' },
};
