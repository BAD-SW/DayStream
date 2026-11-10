import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { validateFormAnswers, isSignedForm, LANGUAGE_OPTIONS } from '@daystream/shared';
import type { FormDefinition, FormAnswer, FormValidationIssue } from '@daystream/shared';
import { FormRenderer } from '../components/forms/FormRenderer';
import { SignaturePad } from '../components/forms/SignaturePad';


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
  versions: { language: string | null; name: string; definition: FormDefinition }[];
}

const API = `${import.meta.env.VITE_API_URL || ''}/api/v1/public/forms`;

const TEXT: Record<string, Record<string, string>> = {
  en: { hello: 'Hello', submit: 'Submit', sending: 'Sending...', clear: 'Clear', language: 'Language', thanks: 'Thank you', received: 'Your form has been received.', device: 'Please hand the device back.', invalid: 'This link is no longer valid. Ask the business for a new one.', loading: 'Loading...', sign: 'Please sign in the box.', fix: 'Please check the answers marked below.', failed: 'The form could not be sent. Please try again.', required: '* required' },
  es: { hello: 'Hola', submit: 'Enviar', sending: 'Enviando...', clear: 'Borrar', language: 'Idioma', thanks: 'Gracias', received: 'Hemos recibido tu formulario.', device: 'Por favor, devuelve el dispositivo.', invalid: 'Este enlace ya no es válido. Pide uno nuevo al negocio.', loading: 'Cargando...', sign: 'Por favor, firma en el recuadro.', fix: 'Revisa las respuestas marcadas.', failed: 'No se pudo enviar el formulario. Inténtalo de nuevo.', required: '* obligatorio' },
  fr: { hello: 'Bonjour', submit: 'Envoyer', sending: 'Envoi...', clear: 'Effacer', language: 'Langue', thanks: 'Merci', received: 'Votre formulaire a bien été reçu.', device: 'Merci de rendre l\'appareil.', invalid: 'Ce lien n\'est plus valide. Demandez-en un nouveau à l\'établissement.', loading: 'Chargement...', sign: 'Veuillez signer dans le cadre.', fix: 'Vérifiez les réponses signalées.', failed: 'Le formulaire n\'a pas pu être envoyé. Réessayez.', required: '* obligatoire' },
  de: { hello: 'Hallo', submit: 'Absenden', sending: 'Wird gesendet...', clear: 'Löschen', language: 'Sprache', thanks: 'Vielen Dank', received: 'Ihr Formular ist eingegangen.', device: 'Bitte geben Sie das Gerät zurück.', invalid: 'Dieser Link ist nicht mehr gültig. Bitten Sie den Betrieb um einen neuen.', loading: 'Wird geladen...', sign: 'Bitte unterschreiben Sie im Feld.', fix: 'Bitte prüfen Sie die markierten Antworten.', failed: 'Das Formular konnte nicht gesendet werden. Bitte erneut versuchen.', required: '* Pflichtfeld' },
};

function logoSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^(https?:|data:)/i.test(url)) return url;
  return url.startsWith('/') ? url : `/storage/${url}`;
}

export function PublicForm() {
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
  const t = TEXT[(version?.language ?? 'en').slice(0, 2)] ?? TEXT.en;
  const signed = version ? isSignedForm(version.definition) : false;

  // The invalid-link message is shown in the browser's language when the server's is English only.
  const browserText = TEXT[(navigator.language || 'en').slice(0, 2)] ?? TEXT.en;

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
      if (sig) mapped[sig.id] = t.sign;
    }
    setErrors(mapped);
    if (Object.keys(mapped).length > 0) { setFormError(t.fix); return; }

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
      if (err.response?.status === 410) { setLoadError(browserText.invalid); setData(null); }
      else if (err.response?.data?.code === 'INVALID_ANSWERS' && err.response.data.details) {
        setErrors(mapIssues(err.response.data.details)); setFormError(t.fix);
      } else setFormError(t.failed);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <Shell business={data?.business ?? null}>
        <div style={s.center} role="status">
          <h1 style={s.title}>{t.thanks}</h1>
          <p style={s.text}>{t.received}</p>
          {next
            ? <button type="button" style={{ ...s.button, marginTop: 'var(--space-md)' }} onClick={() => window.location.assign(next)}>Continue</button>
            : data?.channel === 'device' && <p style={s.text}>{t.device}</p>}
        </div>
      </Shell>
    );
  }

  if (!data || !version) {
    return (
      <Shell business={null}>
        <p style={{ ...s.text, textAlign: 'center' }} role={loadError ? 'alert' : 'status'}>
          {loadError ?? (token ? browserText.loading : browserText.invalid)}
        </p>
      </Shell>
    );
  }

  const languagesOffered = data.versions.filter((v) => v.language);
  const langLabel = (code: string | null) =>
    code ? LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code : 'Default';

  return (
    <Shell business={data.business}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <h1 style={s.title}>{version.name}</h1>
        <p style={s.text}>{t.hello} {data.customerFirstName},</p>

        {data.versions.length > 1 && languagesOffered.length > 0 && (
          <div style={s.langRow}>
            <label htmlFor="form-lang" style={s.langLabel}>{t.language}</label>
            <select id="form-lang" style={s.select} value={version.language ?? ''}
              onChange={(e) => { setLanguage(e.target.value || null); setErrors({}); setFormError(null); }}>
              {data.versions.map((v) => (
                <option key={v.language ?? 'default'} value={v.language ?? ''}>{langLabel(v.language)}</option>
              ))}
            </select>
          </div>
        )}

        <p style={s.hint}>{t.required}</p>
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
              clearLabel={t.clear}
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
          {sending ? t.sending : t.submit}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ business, children }: { business: PublicFormData['business'] | null; children: React.ReactNode }) {
  const logo = logoSrc(business?.logoUrl ?? null);
  return (
    <div style={s.page}>
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
  page: { minHeight: '100vh', backgroundColor: 'var(--color-background)', fontFamily: 'var(--font-family)', padding: 'var(--space-md)', boxSizing: 'border-box' },
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
