import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { FormRenderer } from '../forms/FormRenderer';
import { validateFormAnswers } from '@daystream/shared';
import type { FormAnswer } from '@daystream/shared';
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

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

function errorText(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err.response?.data?.error || err.message || fallback;
}

export function ChartsPanel({ businessId, customerId, bookingId = null, defaultChartGroupId = null }: Props) {
  const [templates, setTemplates] = useState<Form[]>([]);
  const [charts, setCharts] = useState<ChartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        formsApi.listForms(businessId, 'chart'),
        chartsApi.listCustomerCharts(businessId, customerId),
      ]);
      const active = t.filter((x) => x.isActive);
      setTemplates(active);
      setCharts(c);
      setTemplateId((cur) => {
        if (cur && active.some((x) => x.id === cur)) return cur;
        const suggested = defaultChartGroupId ? active.find((x) => x.groupId === defaultChartGroupId) : undefined;
        return (suggested ?? active[0])?.id ?? '';
      });
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Could not load the charts.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, customerId, defaultChartGroupId]);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    if (!templateId) return;
    setCreating(true); setError(null);
    try {
      const chart = await chartsApi.createChart(businessId, { customerId, formId: templateId, bookingId });
      await load();
      setOpenId(chart.id);
    } catch (e) { setError(errorText(e, 'Could not start the chart.')); } finally { setCreating(false); }
  };

  if (loading) return <p style={s.muted}>Loading charts...</p>;

  const thisVisit = bookingId ? charts.filter((c) => c.bookingId === bookingId) : [];
  const others = bookingId ? charts.filter((c) => c.bookingId !== bookingId) : charts;

  const row = (c: ChartSummary) => (
    <li key={c.id} style={s.row}>
      <div style={s.rowInfo}>
        <span style={s.name}>{c.formName}</span>
        <span style={{ ...s.tag, color: c.status === 'signed' ? 'var(--color-success)' : 'var(--color-warning)' }}>
          {c.status === 'signed' ? 'Signed off' : 'Draft'}
        </span>
        {c.amendmentCount > 0 && <span style={s.tag}>{c.amendmentCount} amendment{c.amendmentCount === 1 ? '' : 's'}</span>}
        <span style={s.meta}>
          {when(c.signedAt ?? c.createdAt)}{(c.signedByName ?? c.createdByName) ? ` by ${c.signedByName ?? c.createdByName}` : ''}
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpenId(c.id)}>{c.status === 'draft' ? 'Continue' : 'Open'}</Button>
    </li>
  );

  return (
    <div>
      <p style={s.helper}>Charts are private to staff who work with clients. Opening or changing one is recorded.</p>
      {error && <p style={s.error} role="alert">{error}</p>}

      <div style={s.newRow}>
        {templates.length === 0 ? (
          <span style={s.muted}>No chart templates yet. Add one in Business Setup &gt; Templates &gt; Charts.</span>
        ) : (
          <>
            <label htmlFor="chart-template" style={s.label}>New chart</label>
            <select id="chart-template" style={s.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button size="sm" onClick={start} loading={creating} disabled={!templateId}>Start chart</Button>
          </>
        )}
      </div>

      {bookingId && (
        <>
          <h4 style={s.heading}>This visit</h4>
          {thisVisit.length === 0 ? <p style={s.muted}>No chart for this visit yet.</p> : <ul style={s.list}>{thisVisit.map(row)}</ul>}
        </>
      )}

      <h4 style={s.heading}>{bookingId ? 'Previous charts' : 'Charts'}</h4>
      {others.length === 0
        ? <p style={s.muted}>{bookingId ? 'No previous charts for this customer.' : 'No charts yet for this customer.'}</p>
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
      .catch((e) => { if (live) setError(errorText(e, 'Could not open the chart.')); });
    return () => { live = false; };
  }, [businessId, chartId]);

  const isDraft = chart?.status === 'draft';

  const persist = useCallback(async (value: ChartAnswers): Promise<boolean> => {
    setSaveState('saving');
    try {
      await chartsApi.saveChart(businessId, chartId, value);
      setSaveState('saved'); setDirty(false);
      return true;
    } catch (e) {
      setSaveState('error'); setError(errorText(e, 'Could not save the chart.'));
      return false;
    }
  }, [businessId, chartId]);

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
      setErrors(map); setError('Some answers need attention before sign-off.');
      return;
    }
    if (!confirm('Sign off this chart? It will be locked. Later corrections are added as amendments.')) return;
    setBusy(true); setError(null); setErrors({});
    try {
      if (!(await persist(answers))) return;
      const signed = await chartsApi.signOffChart(businessId, chartId);
      setChart(signed); setAnswers(signed.answers);
    } catch (e) { setError(errorText(e, 'Could not sign off the chart.')); } finally { setBusy(false); }
  };

  const deleteDraft = async () => {
    if (!confirm('Delete this draft chart? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try { await chartsApi.deleteChart(businessId, chartId); onClose(); }
    catch (e) { setError(errorText(e, 'Could not delete the draft.')); setBusy(false); }
  };

  const addAmendment = async () => {
    if (!amendment.trim()) return;
    setBusy(true); setError(null);
    try {
      const updated = await chartsApi.amendChart(businessId, chartId, amendment.trim());
      setChart(updated); setAmendment('');
    } catch (e) { setError(errorText(e, 'Could not add the amendment.')); } finally { setBusy(false); }
  };

  const openPdf = async () => {
    setError(null);
    try {
      const blob = await chartsApi.fetchChartPdf(businessId, chartId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(errorText(e, 'Could not open the PDF.')); }
  };

  return (
    <Modal open onClose={close} title={chart ? chart.formName : 'Chart'} size="lg">
      {error && <p style={s.error} role="alert">{error}</p>}
      {!chart ? (!error && <p style={s.muted}>Loading...</p>) : (
        <>
          <p style={s.helper}>
            {isDraft
              ? 'Draft. Your answers save as you type. Sign off when the chart is complete.'
              : `Signed off by ${chart.signedByName ?? 'unknown'} on ${when(chart.signedAt)}. This chart is locked.`}
          </p>
          <FormRenderer definition={chart.definition} idPrefix={`chart-${chart.id}`} answers={answers}
            onChange={change} errors={errors} disabled={!isDraft || busy} />

          {isDraft ? (
            <div style={s.actions}>
              <Button onClick={signOff} loading={busy}>Sign off</Button>
              <Button variant="ghost" onClick={deleteDraft} disabled={busy}>Delete draft</Button>
              <span style={s.saveState} aria-live="polite">
                {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : dirty ? 'Unsaved changes' : ''}
              </span>
            </div>
          ) : (
            <>
              <h4 style={s.heading}>Amendments</h4>
              {chart.amendments.length === 0 && <p style={s.muted}>No amendments.</p>}
              <ul style={s.list}>
                {chart.amendments.map((a) => (
                  <li key={a.id} style={s.amend}>
                    <span style={s.meta}>{a.createdByName ?? 'Unknown'}, {when(a.createdAt)}</span>
                    <span style={s.amendText}>{a.content}</span>
                  </li>
                ))}
              </ul>
              <label htmlFor="chart-amend" style={s.label}>Add an amendment</label>
              <textarea id="chart-amend" style={s.textarea} rows={3} maxLength={5000} value={amendment}
                onChange={(e) => setAmendment(e.target.value)} />
              <div style={s.actions}>
                <Button onClick={addAmendment} loading={busy} disabled={!amendment.trim()}>Add amendment</Button>
                <Button variant="secondary" onClick={openPdf} disabled={busy}>Open PDF</Button>
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
