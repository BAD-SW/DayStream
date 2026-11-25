import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { lifecycleStageLabel } from '@daystream/shared';
import { SegmentConditions, describeRules } from '../components/SegmentConditions';
import type { Rule as SegRule } from '../components/SegmentConditions';
import { Button } from '../design-system/components/actions/Button';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as customersApi from '../api/customers';
import type { Segment } from '../api/customers';

// The builder (one line per condition, match all / any, groups) is shared: THE-18.
type Rule = SegRule;

export function Segments() {
  const { t } = useTranslation('customers');
  const navigate = useNavigate();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  // 'new-rules' / 'new-list' while creating, a segment id while editing, null otherwise.
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    customersApi.getSegments(businessId).then(setSegments).finally(() => setLoading(false));
  }, [businessId]);

  const loadMembers = async (segmentId: string) => {
    setSelectedSegment(segmentId);
    const result = await customersApi.getSegmentMembers(segmentId, businessId);
    setMembers(result.data);
    setMemberCount(result.meta.total);
  };

  const handleDelete = async (segmentId: string) => {
    setConfirmDelete(null);
    try {
      await customersApi.deleteSegment(segmentId, businessId);
      setSegments(segments.filter((s) => s.id !== segmentId));
      if (selectedSegment === segmentId) { setSelectedSegment(null); setMembers([]); }
      setMessage('');
    } catch (err: any) {
      setMessage(err.response?.data?.error || t('segments.deleteFailed'));
    }
  };

  const handleSaved = (saved: Segment, isNew: boolean) => {
    setSegments(isNew ? [...segments, saved] : segments.map((s) => (s.id === saved.id ? saved : s)));
    setEditing(null);
    if (selectedSegment === saved.id) loadMembers(saved.id);
  };

  const removeMember = async (personId: string) => {
    if (!selectedSegment) return;
    await customersApi.removeSegmentMembers(selectedSegment, businessId, [personId]);
    loadMembers(selectedSegment);
  };

  const selected = segments.find((s) => s.id === selectedSegment);

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/customers')}>{t('segments.back')}</button>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('segments.title')}</h1>
        <div style={styles.headerActions}>
          <Button variant="outline" onClick={() => setEditing(editing === 'new-list' ? null : 'new-list')}>{t('segments.newFixedList')}</Button>
          <Button onClick={() => setEditing(editing === 'new-rules' ? null : 'new-rules')}>{t('segments.newSegment')}</Button>
        </div>
      </div>
      <p style={styles.intro}>
        {t('segments.intro')}
      </p>

      {message && <p style={styles.message} role="alert">{message}</p>}

      {(editing === 'new-rules' || editing === 'new-list') && (
        <SegmentForm
          businessId={businessId}
          kind={editing === 'new-list' ? 'static' : 'dynamic'}
          onSaved={(seg) => handleSaved(seg, true)}
          onCancel={() => setEditing(null)}
        />
      )}

      <div style={styles.segmentList}>
        {loading && <p style={styles.empty}>{t('common:loading')}</p>}
        {!loading && segments.length === 0 && <p style={styles.empty}>{t('segments.none')}</p>}
        {segments.map((seg) => (
          editing === seg.id ? (
            <SegmentForm
              key={seg.id}
              businessId={businessId}
              kind={seg.kind === 'static' ? 'static' : 'dynamic'}
              segment={seg}
              onSaved={(saved) => handleSaved(saved, false)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={seg.id} style={{ ...styles.segmentCard, ...(selectedSegment === seg.id ? styles.segmentCardActive : {}) }}>
              <div style={styles.segmentInfo}>
                <div style={styles.segmentTitleRow}>
                  <span style={styles.segmentName}>{seg.name}</span>
                  <Badge variant="neutral">{seg.kind === 'static' ? t('segments.fixedList') : t('segments.rules')}</Badge>
                  {seg.is_predefined && <Badge variant="neutral">{t('segments.starter')}</Badge>}
                </div>
                <span style={styles.segmentRules}>
                  {seg.kind === 'static'
                    ? (seg.description || t('segments.addedByHand'))
                    : describeRules(seg.rules as any, t)}
                </span>
              </div>
              <div style={styles.segmentActions}>
                {confirmDelete === seg.id ? (
                  <>
                    <span style={styles.segmentRules}>{seg.kind === 'static' ? t('segments.deleteList') : t('segments.deleteSegment')}</span>
                    <button style={styles.actionBtn} onClick={() => setConfirmDelete(null)}>{t('segments.keep')}</button>
                    <button style={styles.actionBtn} onClick={() => handleDelete(seg.id)}>{t('common:delete')}</button>
                  </>
                ) : (
                  <>
                    <button style={styles.actionBtn} onClick={() => loadMembers(seg.id)}>{t('segments.viewPeople')}</button>
                    <button style={styles.actionBtn} onClick={() => setEditing(seg.id)}>{seg.is_predefined ? t('segments.rename') : t('common:edit')}</button>
                    {!seg.is_predefined && <button style={styles.actionBtn} onClick={() => setConfirmDelete(seg.id)}>{t('common:delete')}</button>}
                  </>
                )}
              </div>
            </div>
          )
        ))}
      </div>

      {selected && (
        <div style={styles.membersSection}>
          <h2 style={styles.subtitle}>{t('segments.memberCount', { name: selected.name, count: memberCount })}</h2>
          {selected.kind === 'static' && (
            <p style={styles.intro}>{t('segments.addPeopleHelp')}</p>
          )}
          <Table
            columns={[
              { key: 'reference_number', header: t('segments.col.ref') },
              { key: 'name', header: t('segments.col.name'), render: (_: any, r: any) => `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || r.phone || '—' },
              { key: 'email', header: t('segments.col.email'), render: (v: string | null) => v || '—' },
              { key: 'lifecycle_stage', header: t('segments.col.stage'), render: (v: string) => <Badge variant="neutral">{t('stage.' + v, { defaultValue: lifecycleStageLabel(v) })}</Badge> },
              ...(selected.kind === 'static' ? [{
                key: 'id', header: '',
                render: (id: string) => <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); removeMember(id); }}>{t('segments.remove')}</button>,
              }] : []),
            ]}
            data={members}
            onRowClick={(row: any) => navigate(`/customers/${row.id}`)}
            emptyMessage={selected.kind === 'static' ? t('segments.emptyList') : t('segments.emptySegment')}
          />
        </div>
      )}
    </div>
  );
}

/** Create or edit a segment (rules, with a live count) or a fixed list (name and description only). */
function SegmentForm({ businessId, kind, segment, onSaved, onCancel }: {
  businessId: string; kind: 'dynamic' | 'static'; segment?: Segment; onSaved: (seg: Segment) => void; onCancel: () => void;
}) {
  const { t } = useTranslation('customers');
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [logic, setLogic] = useState<'AND' | 'OR'>(segment?.rules?.logic === 'OR' ? 'OR' : 'AND');
  const [rules, setRules] = useState<Rule[]>(segment?.rules?.rules || []);
  const [count, setCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Starter segments keep their rules; only their name and description can change.
  const rulesEditable = kind === 'dynamic' && !segment?.is_predefined;
  // Live count of who the rules match right now.
  useEffect(() => {
    if (!rulesEditable || rules.length === 0) { setCount(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      customersApi.countSegmentRules({ logic, rules }, businessId)
        .then((n) => { if (!cancelled) setCount(n); })
        .catch(() => { if (!cancelled) setCount(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rules, logic, rulesEditable, businessId]);

  const save = async () => {
    if (!name.trim()) { setError(t('segments.nameRequired')); return; }
    if (rulesEditable && rules.length === 0) { setError(t('segments.ruleRequired')); return; }
    setSaving(true);
    setError('');
    try {
      let saved: Segment;
      if (segment) {
        saved = await customersApi.updateSegment(segment.id, businessId, {
          name: name.trim(), description: description.trim() || null, ...(rulesEditable ? { rules: { logic, rules } } : {}),
        });
      } else if (kind === 'static') {
        saved = await customersApi.createFixedList({ name: name.trim(), business_id: businessId, description: description.trim() || undefined });
      } else {
        saved = await customersApi.createSegment({ name: name.trim(), business_id: businessId, rules: { logic, rules } });
      }
      onSaved(saved);
    } catch (err: any) {
      setError(err.response?.data?.error || t('segments.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <div style={styles.createForm}>
      <strong style={styles.formTitle}>
        {segment ? t('segments.editTitle', { name: segment.name }) : kind === 'static' ? t('segments.newFixedList') : t('segments.newSegment')}
      </strong>
      <div style={styles.ruleBuilder}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('segments.form.name')} aria-label={t('segments.form.name')} style={{ ...styles.input, flex: 1, minWidth: '180px' }} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('segments.form.descriptionOptional')} aria-label={t('segments.form.description')} style={{ ...styles.input, flex: 2, minWidth: '220px' }} />
      </div>

      {rulesEditable && (
        <>
          <SegmentConditions businessId={businessId} value={{ logic, rules }} onChange={(r) => { setLogic(r.logic); setRules(r.rules); }} />
          <span style={styles.segmentRules} aria-live="polite">
            {rules.length > 0 && (count === null ? t('segments.counting') : t('segments.matchCount', { count }))}
          </span>
        </>
      )}
      {segment?.is_predefined && <span style={styles.segmentRules}>{t('segments.starterNote')}</span>}

      {error && <span style={styles.message} role="alert">{error}</span>}
      <div style={styles.formActions}>
        <Button size="sm" variant="secondary" onClick={onCancel}>{t('common:cancel')}</Button>
        <Button size="sm" loading={saving} onClick={save}>{t('common:save')}</Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  headerActions: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  intro: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg)' },
  message: { fontSize: 'var(--font-size-sm)', color: 'var(--color-error, #b42318)', margin: '0 0 var(--space-md)' },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  segmentList: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' },
  segmentCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' as const, padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  segmentCardActive: { border: '1px solid var(--color-primary)' },
  segmentInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px', minWidth: 0, flex: 1 },
  segmentTitleRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' as const },
  segmentName: { fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  segmentRules: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  segmentActions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' as const },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)' },
  membersSection: { marginTop: 'var(--space-lg)' },
  createForm: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)', padding: 'var(--space-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-sm)' },
  formTitle: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  formActions: { display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' },
  ruleBuilder: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, alignItems: 'center' },
  rulesList: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, alignItems: 'center' },
  ruleChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' },
  ruleJoin: { color: 'var(--color-text-secondary)', fontStyle: 'normal' },
  chipRemove: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1 },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
