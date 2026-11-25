import { askConfirm } from '../../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { FormRenderer } from '../forms/FormRenderer';
import { validateFormAnswers } from '@daystream/shared';
import type { FormAnswer } from '@daystream/shared';
import { formatDateTime } from '../../utils/format';
import * as chartsApi from '../../api/charts';
import * as formsApi from '../../api/forms';
import type { Chart, ChartSummary, ChartAnswers } from '../../api/charts';
import type { Form } from '../../api/forms';

/**
 * Treatment charts for a customer (spec 51, gap 2), on the customer profile and on a booking.
 * Only shown to clinical roles. On a booking it separates this visit's charts from the previous
 * ones, so the practitioner sees the history at the next visit. Opening a chart is audited by
 * the server.
 */
interface Props {
  businessId: string;
  customerId: string;
  /** Set on a booking: new charts are made against it, and its charts are listed first. */
  bookingId?: string | null;
  /** The service's suggested chart template (its group id), selected by default. */
  defaultChartGroupId?: string | null;
}

const when = (iso: string | null) => (iso ? formatDateTime(iso) : '');

function errorText(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

export function ChartsPanel({ businessId, customerId, bookingId = null, defaultChartGroupId = null }: Props) {
  const { t } = useTranslation('customers');
  const [templates, setTemplates] = useState<Form[]>([]);
  const [charts, setCharts] = useState<ChartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tpl, c] = await Promise.all([
        formsApi.listForms(businessId, 'chart'),
        chartsApi.listCustomerCharts(businessId, customerId),
      ]);
      const active = tpl.filter((x) => x.isActive);
      setTemplates(active);
      setCharts(c);
      setTemplateId((cur) => {
        if (cur && active.some((x) => x.id === cur)) return cur;
        const suggested = defaultChartGroupId ? active.find((x) => x.groupId === defaultChartGroupId) : undefined;
        return (suggested ?? active[0])?.id ?? '';
      });
      setError(null);
    } catch (e) {
      setError(errorText(e, t('charts.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [businessId, customerId, defaultChartGroupId, t]);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    if (!templateId) return;
    setCreating(true); setError(null);
    try {
      const chart = await chartsApi.createChart(businessId, { customerId, formId: templateId, bookingId });
      await load();
      setOpenId(chart.id);
    } catch (e) { setError(errorText(e, t('charts.startFailed'))); } finally { setCreating(false); }
  };

  if (loading) return <p style={s.muted}>{t('charts.loading')}</p>;

  const thisVisit = bookingId ? charts.filter((c) => c.bookingId === bookingId) : [];
  const others = bookingId ? charts.filter((c) => c.bookingId !== bookingId) : charts;

  const row = (c: ChartSummary) => (
    <li key={c.id} style={s.row}>
      <div style={s.rowInfo}>
        <span style={s.name}>{c.formName}</span>
        <span style={{ ...s.tag, color: c.status === 'signed' ? 'var(--color-success)' : 'var(--color-warning)' }}>
          {c.status === 'signed' ? t('charts.signedOff') : t('charts.draft')}
        </span>
        {c.amendmentCount > 0 && <span style={s.tag}>{t('charts.amendmentCount', { count: c.amendmentCount })}</span>}
        <span style={s.meta}>
          {when(c.signedAt ?? c.createdAt)}{(c.signedByName ?? c.createdByName) ? ` ${t('charts.by', { name: c.signedByName ?? c.createdByName })}` : ''}
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpenId(c.id)}>{c.status === 'draft' ? t('charts.continue') : t('charts.open')}</Button>
    </li>
  );

  return (
    <div>
      <p style={s.helper}>{t('charts.privacy')}</p>
      {error && <p style={s.error} role="alert">{error}</p>}

      <div style={s.newRow}>
        {templates.length === 0 ? (
          <span style={s.muted}>{t('charts.noTemplates')}</span>
        ) : (
          <>
            <label htmlFor="chart-template" style={s.label}>{t('charts.newChart')}</label>
            <select id="chart-template" style={s.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </select>
            <Button size="sm" onClick={start} loading={creating} disabled={!templateId}>{t('charts.startChart')}</Button>
          </>
        )}
      </div>

      {bookingId && (
        <>
          <h4 style={s.heading}>{t('charts.thisVisit')}</h4>
          {thisVisit.length === 0 ? <p style={s.muted}>{t('charts.noneThisVisit')}</p> : <ul style={s.list}>{thisVisit.map(row)}</ul>}
        </>
      )}

      <h4 style={s.heading}>{bookingId ? t('charts.previous') : t('charts.heading')}</h4>
      {others.length === 0
        ? <p style={s.muted}>{bookingId ? t('charts.nonePrevious') : t('charts.noneYet')}</p>
        : <ul style={s.list}>{others.map(row)}</ul>}

      {openId && (
        <ChartModal businessId={businessId} chartId={openId}
          onClose={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChartModal({ businessId, chartId, onClose }: { businessId: string; chartId: string; onClose: () => void }) {
  const { t } = useTranslation('customers');
  const [chart, setChart] = useState<Chart | null>(null);
  const [answers, setAnswers] = useState<ChartAnswers>({});
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [amendment, setAmendment] = useState('');

  useEffect(() => {
    let live = true;
    chartsApi.getChart(businessId, chartId)
      .then((c) => { if (live) { setChart(c); setAnswers(c.answers); } })
      .catch((e) => { if (live) setError(errorText(e, t('charts.openFailed'))); });
    return () => { live = false; };
  }, [businessId, chartId, t]);

  const isDraft = chart?.status === 'draft';

  const persist = useCallback(async (value: ChartAnswers): Promise<boolean> => {
    setSaveState('saving');
    try {
      await chartsApi.saveChart(businessId, chartId, value);
      setSaveState('saved'); setDirty(false);
      return true;
    } catch (e) {
      setSaveState('error'); setError(errorText(e, t('charts.saveFailed')));
      return false;
    }
  }, [businessId, chartId, t]);

  // Save a moment after the practitioner stops typing.
  useEffect(() => {
    if (!isDraft || !dirty) return;
    const timer = setTimeout(() => { persist(answers); }, 1500);
    return () => clearTimeout(timer);
  }, [answers, dirty, isDraft, persist]);

  const change = (id: string, value: FormAnswer) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setDirty(true); setSaveState('idle');
  };

  const close = async () => {
    if (isDraft && dirty) await persist(answers);
    onClose();
  };

  const signOff = async () => {
    if (!chart) return;
    const found = validateFormAnswers(chart.definition, answers);
    if (found.length > 0) {
      const map: Record<string, string> = {};
      for (const i of found) if (i.itemId) map[i.itemId] = i.message;
      setErrors(map); setError(t('charts.needAttention'));
      return;
    }
    if (!(await askConfirm({ message: t('charts.signOffConfirm') }))) return;
    setBusy(true); setError(null); setErrors({});
    try {
      if (!(await persist(answers))) return;
      const signed = await chartsApi.signOffChart(businessId, chartId);
      setChart(signed); setAnswers(signed.answers);
    } catch (e) { setError(errorText(e, t('charts.signOffFailed'))); } finally { setBusy(false); }
  };

  const deleteDraft = async () => {
    if (!(await askConfirm({ message: t('charts.deleteConfirm'), confirmLabel: t('common:action.delete'), destructive: true }))) return;
    setBusy(true); setError(null);
    try { await chartsApi.deleteChart(businessId, chartId); onClose(); }
    catch (e) { setError(errorText(e, t('charts.deleteFailed'))); setBusy(false); }
  };

  const addAmendment = async () => {
    if (!amendment.trim()) return;
    setBusy(true); setError(null);
    try {
      const updated = await chartsApi.amendChart(businessId, chartId, amendment.trim());
      setChart(updated); setAmendment('');
    } catch (e) { setError(errorText(e, t('charts.amendFailed'))); } finally { setBusy(false); }
  };

  const openPdf = async () => {
    setError(null);
    try {
      const blob = await chartsApi.fetchChartPdf(businessId, chartId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(errorText(e, t('charts.pdfFailed'))); }
  };

  return (
    <Modal open onClose={close} title={chart ? chart.formName : t('charts.chart')} size="lg">
      {error && <p style={s.error} role="alert">{error}</p>}
      {!chart ? (!error && <p style={s.muted}>{t('common:loading')}</p>) : (
        <>
          <p style={s.helper}>
            {isDraft
              ? t('charts.draftHelp')
              : t('charts.signedHelp', { name: chart.signedByName ?? t('charts.unknown'), when: when(chart.signedAt) })}
          </p>
          <FormRenderer definition={chart.definition} idPrefix={`chart-${chart.id}`} answers={answers}
            onChange={change} errors={errors} disabled={!isDraft || busy} />

          {isDraft ? (
            <div style={s.actions}>
              <Button onClick={signOff} loading={busy}>{t('charts.signOff')}</Button>
              <Button variant="ghost" onClick={deleteDraft} disabled={busy}>{t('charts.deleteDraft')}</Button>
              <span style={s.saveState} aria-live="polite">
                {saveState === 'saving' ? t('charts.saving') : saveState === 'saved' ? t('charts.saved') : dirty ? t('charts.unsaved') : ''}
              </span>
            </div>
          ) : (
            <>
              <h4 style={s.heading}>{t('charts.amendments')}</h4>
              {chart.amendments.length === 0 && <p style={s.muted}>{t('charts.noAmendments')}</p>}
              <ul style={s.list}>
                {chart.amendments.map((a) => (
                  <li key={a.id} style={s.amend}>
                    <span style={s.meta}>{t('charts.amendmentMeta', { name: a.createdByName ?? t('charts.unknownCap'), when: when(a.createdAt) })}</span>
                    <span style={s.amendText}>{a.content}</span>
                  </li>
                ))}
              </ul>
              <label htmlFor="chart-amend" style={s.label}>{t('charts.addAmendmentLabel')}</label>
              <textarea id="chart-amend" style={s.textarea} rows={3} maxLength={5000} value={amendment}
                onChange={(e) => setAmendment(e.target.value)} />
              <div style={s.actions}>
                <Button onClick={addAmendment} loading={busy} disabled={!amendment.trim()}>{t('charts.addAmendment')}</Button>
                <Button variant="secondary" onClick={openPdf} disabled={busy}>{t('charts.openPdf')}</Button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

const s: Record<string, React.CSSProperties> = {
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm) 0' },
  helper: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', margin: '0 0 var(--space-md) 0' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md) 0' },
  heading: { margin: 'var(--space-lg) 0 var(--space-sm) 0', fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  newRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-md)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  select: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', minWidth: '220px' },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box', marginTop: '4px' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  rowInfo: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  name: { fontWeight: 600, color: 'var(--color-text)' },
  tag: { fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' },
  meta: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: 'var(--space-lg)', flexWrap: 'wrap' },
  saveState: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  amend: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  amendText: { color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' },
};
