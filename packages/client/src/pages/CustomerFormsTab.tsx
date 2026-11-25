import { askConfirm } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { FormRenderer } from '../components/forms/FormRenderer';
import { validateFormAnswers } from '@daystream/shared';
import type { FormAnswer } from '@daystream/shared';
import * as formsApi from '../api/forms';
import type { CustomerFormStatus, FormSubmission, FormStatus } from '../api/forms';
import { formatDate } from '../utils/format';

/**
 * The customer profile's Forms tab (spec 51, gap 1): which forms are missing or out of date,
 * ways to get one completed (on a device in the business, by email link, or by staff for an
 * unsigned form), and the forms the customer has completed with View, Print and Email a copy.
 * The status is information only; nothing here blocks a booking.
 */

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const when = (v?: string | null) =>
  v ? formatDate(v, { dateStyle: 'medium' }) : '—';

// The words for a status are formsTab.status.<status>, for how a form was completed formsTab.via.<how>.
const STATUS: Record<FormStatus, { variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  missing: { variant: 'warning' },
  out_of_date: { variant: 'warning' },
  done: { variant: 'success' },
  optional: { variant: 'neutral' },
  not_needed: { variant: 'neutral' },
};
const statusText = (t: TFunction, status: FormStatus) => t('formsTab.status.' + status);

export function CustomerFormsTab({ customerId, businessId, customerEmail, onChanged }: {
  customerId: string; businessId: string; customerEmail?: string | null;
  /** Called whenever the forms were (re)loaded, so other parts of the page can refresh. */
  onChanged?: () => void;
}) {
  const { t } = useTranslation('customers');
  const [forms, setForms] = useState<CustomerFormStatus[] | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fillFor, setFillFor] = useState<CustomerFormStatus | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  // Kept in a ref so a new callback each render doesn't reload the forms again.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(() => {
    formsApi.getCustomerForms(customerId, businessId)
      .then((d) => { setForms(d.forms); setSubmissions(d.submissions); onChangedRef.current?.(); })
      .catch(() => { setForms([]); setSubmissions([]); setMessage({ ok: false, text: t('formsTab.loadFailed') }); });
  }, [customerId, businessId, t]);
  useEffect(() => { load(); }, [load]);
  // A form is often completed on another tab or device; check again when staff come back.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  /** Open the form page on this device. A blank tab is opened first so the pop-up isn't blocked. */
  const openOnDevice = async (f: CustomerFormStatus) => {
    setMessage(null); setBusy(`device-${f.groupId}`);
    const tab = window.open('', '_blank');
    try {
      const r = await formsApi.startFormRequest(customerId, businessId, { group_id: f.groupId, channel: 'device' });
      if (tab && r.url) tab.location.href = r.url;
      else setMessage({ ok: true, text: t('formsTab.openLink', { url: r.url ?? '' }) });
    } catch (err) {
      tab?.close();
      setMessage({ ok: false, text: errorText(err, t('formsTab.startFailed')) });
    } finally { setBusy(null); }
  };

  const sendByEmail = async (f: CustomerFormStatus) => {
    setMessage(null); setBusy(`email-${f.groupId}`);
    try {
      const r = await formsApi.startFormRequest(customerId, businessId, { group_id: f.groupId, channel: 'email' });
      setMessage({ ok: true, text: t('formsTab.sent', { name: f.name, email: r.emailedTo }) });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t('formsTab.sendFailed')) });
    } finally { setBusy(null); }
  };

  const openPdf = async (s: FormSubmission, print: boolean) => {
    setMessage(null); setBusy(`pdf-${s.id}`);
    try {
      const blob = await formsApi.fetchSubmissionPdf(customerId, businessId, s.id);
      const url = URL.createObjectURL(blob);
      if (print) {
        // Print from a hidden frame; if the browser won't, the PDF opens in a tab to print from there.
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        frame.onload = () => {
          try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
          catch { window.open(url, '_blank'); }
          setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
        };
        document.body.appendChild(frame);
      } else {
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t('formsTab.openFailed')) });
    } finally { setBusy(null); }
  };

  const emailCopy = async (s: FormSubmission) => {
    if (!(await askConfirm({ message: t('formsTab.emailConfirm', { name: s.formName, email: customerEmail || t('formsTab.theCustomer') }), confirmLabel: t('common:action.send') }))) return;
    setMessage(null); setBusy(`mail-${s.id}`);
    try {
      const r = await formsApi.emailSubmissionCopy(customerId, businessId, s.id);
      setMessage({ ok: true, text: t('formsTab.copyEmailed', { email: r.sentTo }) });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t('formsTab.emailFailed')) });
    } finally { setBusy(null); }
  };

  const needed = (forms ?? []).filter((f) => f.status === 'missing' || f.status === 'out_of_date');
  const others = (forms ?? []).filter((f) => f.status !== 'missing' && f.status !== 'out_of_date');

  const FormRow = (f: CustomerFormStatus) => (
    <div key={f.groupId} role="row" style={s.row}>
      <span role="cell" style={s.name}>
        {f.name}
        {f.signed && <span style={s.tag}>{t('formsTab.signed')}</span>}
        {f.languages.filter(Boolean).map((l) => <span key={l} style={s.tag}>{l}</span>)}
      </span>
      <span role="cell"><Badge variant={STATUS[f.status].variant}>{statusText(t, f.status)}</Badge></span>
      <span role="cell" style={s.muted}>{f.lastCompletedAt ? t('formsTab.last', { date: when(f.lastCompletedAt) }) : t('formsTab.neverCompleted')}</span>
      <span role="cell" style={s.actions}>
        <Button size="sm" variant="secondary" loading={busy === `device-${f.groupId}`} onClick={() => openOnDevice(f)}>
          {t('formsTab.fillDevice')}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === `email-${f.groupId}`} onClick={() => sendByEmail(f)}
          disabled={!customerEmail}>
          {t('formsTab.sendEmail')}
        </Button>
        {!f.signed && (
          <Button size="sm" variant="secondary" onClick={() => setFillFor(f)}>{t('formsTab.fillForCustomer')}</Button>
        )}
      </span>
    </div>
  );

  return (
    <div style={s.tab}>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} style={{ ...s.notice, ...(message.ok ? s.noticeOk : s.noticeBad) }}>{message.text}</p>
      )}

      <div style={s.card}>
        <h3 style={s.title}>{t('formsTab.toComplete')}</h3>
        {forms === null && <p style={s.muted}>{t('formsTab.loading')}</p>}
        {forms !== null && forms.length === 0 && (
          <p style={s.empty}>{t('formsTab.noForms')}</p>
        )}
        {forms !== null && forms.length > 0 && needed.length === 0 && (
          <p style={s.empty}>{t('formsTab.nothingMissing')}</p>
        )}
        {needed.length > 0 && <div role="table" aria-label={t('formsTab.toComplete')}>{needed.map(FormRow)}</div>}
        {others.length > 0 && (
          <>
            <button type="button" style={s.link} onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
              {showOthers ? t('formsTab.hideOthers') : t('formsTab.otherForms', { n: others.length })}
            </button>
            {showOthers && <div role="table" aria-label={t('formsTab.otherFormsLabel')}>{others.map(FormRow)}</div>}
          </>
        )}
      </div>

      <div style={s.card}>
        <h3 style={s.title}>{t('formsTab.completed')}</h3>
        {submissions.length === 0 && forms !== null && <p style={s.empty}>{t('formsTab.noneCompleted')}</p>}
        {submissions.length > 0 && (
          <div role="table" aria-label={t('formsTab.completed')}>
            <div role="row" style={{ ...s.subRow, ...s.head }}>
              <span role="columnheader">{t('formsTab.col.form')}</span><span role="columnheader">{t('formsTab.col.completed')}</span>
              <span role="columnheader">{t('formsTab.col.version')}</span><span role="columnheader">{t('formsTab.col.how')}</span>
              <span role="columnheader">{t('formsTab.col.signed')}</span><span role="columnheader" aria-label={t('formsTab.col.actions')} />
            </div>
            {submissions.map((sub) => (
              <div key={sub.id} role="row" style={{ ...s.subRow, borderTop: '1px solid var(--color-border)' }}>
                <span role="cell" style={s.name}>
                  {sub.formName}{sub.language && <span style={s.tag}>{sub.language}</span>}
                </span>
                <span role="cell" style={s.muted}>{when(sub.createdAt)}</span>
                <span role="cell" style={s.muted}>v{sub.formVersion}</span>
                <span role="cell" style={s.muted}>{t('formsTab.via.' + sub.completedVia)}</span>
                <span role="cell">{sub.signed ? <Badge variant="success">{t('formsTab.signed')}</Badge> : <span style={s.muted}>{t('formsTab.no')}</span>}</span>
                <span role="cell" style={s.actions}>
                  <Button size="sm" variant="secondary" loading={busy === `pdf-${sub.id}`} onClick={() => openPdf(sub, false)}>{t('formsTab.view')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => openPdf(sub, true)}>{t('formsTab.print')}</Button>
                  <Button size="sm" variant="secondary" loading={busy === `mail-${sub.id}`} onClick={() => emailCopy(sub)}
                    disabled={!customerEmail}>{t('formsTab.emailCopy')}</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {fillFor && (
        <FillForCustomerDialog
          form={fillFor} customerId={customerId} businessId={businessId}
          onClose={() => setFillFor(null)}
          onDone={() => { setFillFor(null); setMessage({ ok: true, text: t('formsTab.saved', { name: fillFor.name }) }); load(); }}
        />
      )}
    </div>
  );
}

/** Staff complete an UNSIGNED form for the customer, for example an intake taken over the phone. */
function FillForCustomerDialog({ form, customerId, businessId, onClose, onDone }: {
  form: CustomerFormStatus; customerId: string; businessId: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation('customers');
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof formsApi.listForms>>>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswer | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    formsApi.listForms(businessId)
      .then((all) => {
        const mine = all.filter((f) => f.groupId === form.groupId && f.isActive);
        setVersions(mine);
        setLanguage((mine.find((v) => v.language === null) ?? mine[0])?.language ?? null);
      })
      .catch(() => setError(t('formsTab.loadOneFailed')));
  }, [businessId, form.groupId, t]);

  const version = versions.find((v) => v.language === language) ?? versions[0];

  const save = async () => {
    if (!version) return;
    const issues = validateFormAnswers(version.definition, answers);
    const mapped: Record<string, string> = {};
    for (const i of issues) if (i.itemId) mapped[i.itemId] = i.message;
    setErrors(mapped);
    if (issues.length > 0) { setError(t('formsTab.checkAnswers')); return; }
    setSaving(true); setError(null);
    try {
      await formsApi.completeFormForCustomer(customerId, businessId, { group_id: form.groupId, language: version.language, answers });
      onDone();
    } catch (err) {
      setError(errorText(err, t('formsTab.saveFailed')));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('formsTab.fillTitle', { name: form.name })} size="lg" footer={(
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common:cancel')}</Button>
        <Button onClick={save} loading={saving} disabled={!version}>{t('formsTab.saveForm')}</Button>
      </div>
    )}>
      <p style={s.muted}>
        {t('formsTab.staffNote')}
      </p>
      {versions.length > 1 && (
        <div style={{ margin: 'var(--space-sm) 0' }}>
          <label htmlFor="fill-lang" style={s.muted}>{t('formsTab.language')}{' '}</label>
          <select id="fill-lang" value={language ?? ''} onChange={(e) => { setLanguage(e.target.value || null); setErrors({}); }}
            style={s.select}>
            {versions.map((v) => <option key={v.id} value={v.language ?? ''}>{v.language ?? t('formsTab.default')}</option>)}
          </select>
        </div>
      )}
      {error && <p role="alert" style={s.noticeBad}>{error}</p>}
      {version && (
        <FormRenderer definition={version.definition} answers={answers} errors={errors} idPrefix="staff"
          onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} />
      )}
    </Modal>
  );
}

const s: Record<string, React.CSSProperties> = {
  tab: { padding: 'var(--space-md) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', minWidth: 0 },
  title: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  muted: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-md)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap', padding: 'var(--space-sm) 0', borderTop: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' },
  subRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 60px 110px 80px auto', gap: 'var(--space-sm)', alignItems: 'center', padding: 'var(--space-sm) 0', fontSize: 'var(--font-size-sm)' },
  head: { fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  name: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flex: 1, minWidth: '160px', fontWeight: 600, color: 'var(--color-text)', flexWrap: 'wrap' },
  tag: { fontSize: 'var(--font-size-xs)', fontWeight: 400, padding: '1px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', flexWrap: 'wrap' },
  link: { background: 'none', border: 'none', padding: 'var(--space-sm) 0 0 0', color: 'var(--color-accent)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--font-size-xs)', fontWeight: 700 },
  notice: { margin: 0, padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' },
  noticeOk: { background: 'var(--color-success-bg)', color: 'var(--color-success-dark)', fontWeight: 600 },
  noticeBad: { background: 'var(--color-error-bg)', color: 'var(--color-error)' },
  select: { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
};
