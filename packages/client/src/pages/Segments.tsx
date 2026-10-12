import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { lifecycleStageLabel, LIFECYCLE_STAGES, PERSON_SOURCE_LABELS } from '@daystream/shared';
import { Button } from '../design-system/components/actions/Button';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as customersApi from '../api/customers';
import type { Segment } from '../api/customers';

type Rule = { field: string; operator: string; value?: any };
type FieldType = 'choice' | 'text' | 'date' | 'yesno';

// What a rule can be about. `type` decides which conditions and which value control apply.
const RULE_FIELDS: Array<{ id: string; label: string; type: FieldType; options?: Array<{ value: string; label: string }>; neverAllowed?: boolean }> = [
  { id: 'lifecycle_stage', label: 'Stage', type: 'choice', options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: lifecycleStageLabel(s) })) },
  { id: 'source', label: 'Source', type: 'choice', options: Object.entries(PERSON_SOURCE_LABELS).map(([value, label]) => ({ value, label })) },
  { id: 'gender', label: 'Gender', type: 'choice', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
  { id: 'country', label: 'Country', type: 'text' },
  { id: 'email', label: 'Email', type: 'text' },
  { id: 'created_at', label: 'Added', type: 'date' },
  { id: 'last_activity_at', label: 'Last activity', type: 'date', neverAllowed: true },
  { id: 'last_visit_at', label: 'Last visit', type: 'date', neverAllowed: true },
  { id: 'last_login_at', label: 'Last login', type: 'date', neverAllowed: true },
  { id: 'has_account', label: 'Has a login account', type: 'yesno' },
  { id: 'has_owner', label: 'Has an owner', type: 'yesno' },
  { id: 'incomplete', label: 'Details incomplete', type: 'yesno' },
  { id: 'birthday_this_month', label: 'Birthday this month', type: 'yesno' },
  { id: 'created_this_month', label: 'Added this month', type: 'yesno' },
  { id: 'consent.email', label: 'Agreed to email marketing', type: 'yesno' },
  { id: 'consent.sms', label: 'Agreed to SMS marketing', type: 'yesno' },
  { id: 'consent.whatsapp', label: 'Agreed to WhatsApp marketing', type: 'yesno' },
];

const OPERATORS: Record<FieldType, Array<{ id: string; label: string }>> = {
  choice: [{ id: 'eq', label: 'is' }, { id: 'neq', label: 'is not' }],
  text: [{ id: 'eq', label: 'is' }, { id: 'contains', label: 'contains' }],
  date: [{ id: 'within_days', label: 'in the last (days)' }, { id: 'older_than_days', label: 'more than (days) ago' }, { id: 'never', label: 'never' }],
  yesno: [{ id: 'is_true', label: 'yes' }, { id: 'is_false', label: 'no' }],
};

const OPERATOR_TEXT: Record<string, string> = {
  eq: 'is', neq: 'is not', contains: 'contains', in: 'is one of', gt: 'after', lt: 'before', between: 'between',
  within_days: 'in the last', older_than_days: 'more than', never: 'never', is_true: 'yes', is_false: 'no',
};

/** A rule in plain words, e.g. "Last visit more than 30 days ago". */
function describeRule(rule: Rule): string {
  const field = RULE_FIELDS.find((f) => f.id === rule.field);
  const label = field?.label || rule.field;
  if (rule.operator === 'is_true') return label;
  if (rule.operator === 'is_false') return `Not: ${label.toLowerCase()}`;
  if (rule.operator === 'never') return `${label}: never`;
  if (rule.operator === 'within_days') return `${label} in the last ${rule.value} days`;
  if (rule.operator === 'older_than_days') return `${label} more than ${rule.value} days ago`;
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  const shown = values.map((v) => field?.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  return `${label} ${OPERATOR_TEXT[rule.operator] || rule.operator} ${shown}`;
}

export function Segments() {
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
      setMessage(err.response?.data?.error || 'This segment could not be deleted');
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
      <button style={styles.back} onClick={() => navigate('/customers')}>← Back to People</button>
      <div style={styles.header}>
        <h1 style={styles.title}>Segments</h1>
        <div style={styles.headerActions}>
          <Button variant="outline" onClick={() => setEditing(editing === 'new-list' ? null : 'new-list')}>New fixed list</Button>
          <Button onClick={() => setEditing(editing === 'new-rules' ? null : 'new-rules')}>New segment</Button>
        </div>
      </div>
      <p style={styles.intro}>
        A segment follows its rules: people enter and leave it on their own. A fixed list holds exactly the people you add to it from the People list.
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
        {loading && <p style={styles.empty}>Loading...</p>}
        {!loading && segments.length === 0 && <p style={styles.empty}>No segments defined</p>}
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
                  <Badge variant="neutral">{seg.kind === 'static' ? 'Fixed list' : 'Rules'}</Badge>
                  {seg.is_predefined && <Badge variant="neutral">Starter</Badge>}
                </div>
                <span style={styles.segmentRules}>
                  {seg.kind === 'static'
                    ? (seg.description || 'People added by hand')
                    : seg.rules.rules.map(describeRule).join(seg.rules.logic === 'OR' ? ' or ' : ' and ')}
                </span>
              </div>
              <div style={styles.segmentActions}>
                {confirmDelete === seg.id ? (
                  <>
                    <span style={styles.segmentRules}>Delete this {seg.kind === 'static' ? 'list' : 'segment'}?</span>
                    <button style={styles.actionBtn} onClick={() => setConfirmDelete(null)}>Keep</button>
                    <button style={styles.actionBtn} onClick={() => handleDelete(seg.id)}>Delete</button>
                  </>
                ) : (
                  <>
                    <button style={styles.actionBtn} onClick={() => loadMembers(seg.id)}>View people</button>
                    <button style={styles.actionBtn} onClick={() => setEditing(seg.id)}>{seg.is_predefined ? 'Rename' : 'Edit'}</button>
                    {!seg.is_predefined && <button style={styles.actionBtn} onClick={() => setConfirmDelete(seg.id)}>Delete</button>}
                  </>
                )}
              </div>
            </div>
          )
        ))}
      </div>

      {selected && (
        <div style={styles.membersSection}>
          <h2 style={styles.subtitle}>{selected.name}: {memberCount} {memberCount === 1 ? 'person' : 'people'}</h2>
          {selected.kind === 'static' && (
            <p style={styles.intro}>To add people, tick them in the People list and choose "Add to a fixed list".</p>
          )}
          <Table
            columns={[
              { key: 'reference_number', header: 'Ref' },
              { key: 'name', header: 'Name', render: (_: any, r: any) => `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || r.phone || '—' },
              { key: 'email', header: 'Email', render: (v: string | null) => v || '—' },
              { key: 'lifecycle_stage', header: 'Stage', render: (v: string) => <Badge variant="neutral">{lifecycleStageLabel(v)}</Badge> },
              ...(selected.kind === 'static' ? [{
                key: 'id', header: '',
                render: (id: string) => <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); removeMember(id); }}>Remove</button>,
              }] : []),
            ]}
            data={members}
            onRowClick={(row: any) => navigate(`/customers/${row.id}`)}
            emptyMessage={selected.kind === 'static' ? 'Nobody is on this list yet' : 'Nobody matches this segment right now'}
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
  const [name, setName] = useState(segment?.name || '');
  const [description, setDescription] = useState(segment?.description || '');
  const [logic, setLogic] = useState<'AND' | 'OR'>(segment?.rules?.logic === 'OR' ? 'OR' : 'AND');
  const [rules, setRules] = useState<Rule[]>(segment?.rules?.rules || []);
  const [field, setField] = useState(RULE_FIELDS[0].id);
  const [operator, setOperator] = useState(OPERATORS[RULE_FIELDS[0].type][0].id);
  const [value, setValue] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Starter segments keep their rules; only their name and description can change.
  const rulesEditable = kind === 'dynamic' && !segment?.is_predefined;
  const fieldDef = RULE_FIELDS.find((f) => f.id === field)!;
  const operators = OPERATORS[fieldDef.type].filter((o) => o.id !== 'never' || fieldDef.neverAllowed);
  const needsValue = !['never', 'is_true', 'is_false'].includes(operator);

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

  const chooseField = (id: string) => {
    const def = RULE_FIELDS.find((f) => f.id === id)!;
    setField(id);
    setOperator(OPERATORS[def.type][0].id);
    setValue('');
  };

  const addRule = () => {
    if (needsValue && !value) return;
    setRules([...rules, needsValue ? { field, operator, value } : { field, operator }]);
    setValue('');
  };

  const save = async () => {
    if (!name.trim()) { setError('Give it a name.'); return; }
    if (rulesEditable && rules.length === 0) { setError('Add at least one rule.'); return; }
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
      setError(err.response?.data?.error || 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div style={styles.createForm}>
      <strong style={styles.formTitle}>
        {segment ? `Edit ${segment.name}` : kind === 'static' ? 'New fixed list' : 'New segment'}
      </strong>
      <div style={styles.ruleBuilder}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" style={{ ...styles.input, flex: 1, minWidth: '180px' }} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" aria-label="Description" style={{ ...styles.input, flex: 2, minWidth: '220px' }} />
      </div>

      {rulesEditable && (
        <>
          <div style={styles.rulesList}>
            {rules.length === 0 && <span style={styles.segmentRules}>No rules yet.</span>}
            {rules.map((r, i) => (
              <span key={i} style={styles.ruleChip}>
                {i > 0 && <em style={styles.ruleJoin}>{logic === 'OR' ? 'or' : 'and'} </em>}
                {describeRule(r)}
                <button style={styles.chipRemove} aria-label={`Remove rule: ${describeRule(r)}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          <div style={styles.ruleBuilder}>
            <select value={field} onChange={(e) => chooseField(e.target.value)} style={styles.select} aria-label="Rule about">
              {RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select value={operator} onChange={(e) => setOperator(e.target.value)} style={styles.select} aria-label="Condition">
              {operators.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {needsValue && fieldDef.type === 'choice' && (
              <select value={value} onChange={(e) => setValue(e.target.value)} style={styles.select} aria-label="Value">
                <option value="">Choose…</option>
                {fieldDef.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {needsValue && fieldDef.type !== 'choice' && (
              <input
                value={value} onChange={(e) => setValue(e.target.value)} style={styles.input} aria-label="Value"
                type={fieldDef.type === 'date' ? 'number' : 'text'} min={fieldDef.type === 'date' ? 0 : undefined}
                placeholder={fieldDef.type === 'date' ? 'Days' : 'Value'}
              />
            )}
            <Button size="sm" variant="secondary" onClick={addRule} disabled={needsValue && !value}>Add rule</Button>
            {rules.length > 1 && (
              <select value={logic} onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')} style={styles.select} aria-label="How rules combine">
                <option value="AND">Match all rules</option>
                <option value="OR">Match any rule</option>
              </select>
            )}
          </div>
          <span style={styles.segmentRules} aria-live="polite">
            {rules.length > 0 && (count === null ? 'Counting…' : `${count} ${count === 1 ? 'person matches' : 'people match'} right now`)}
          </span>
        </>
      )}
      {segment?.is_predefined && <span style={styles.segmentRules}>Starter segments keep their rules; you can rename them.</span>}

      {error && <span style={styles.message} role="alert">{error}</span>}
      <div style={styles.formActions}>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="sm" loading={saving} onClick={save}>Save</Button>
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
