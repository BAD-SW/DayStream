import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import * as customersApi from '../api/customers';
import type { Segment } from '../api/customers';

export function Segments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [memberCount, setMemberCount] = useState(0);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    customersApi.getSegments(businessId).then(setSegments).finally(() => setLoading(false));
  }, [businessId]);

  const handleViewMembers = async (segmentId: string) => {
    setSelectedSegment(segmentId);
    const result = await customersApi.getSegmentMembers(segmentId, businessId);
    setMembers(result.data);
    setMemberCount(result.meta.total);
  };

  const handleDelete = async (segmentId: string) => {
    await customersApi.deleteSegment(segmentId, businessId);
    setSegments(segments.filter((s) => s.id !== segmentId));
    if (selectedSegment === segmentId) {
      setSelectedSegment(null);
      setMembers([]);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Segments</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : 'Create Segment'}
        </Button>
      </div>

      {showCreate && <CreateSegmentForm businessId={businessId} onCreated={(seg) => { setSegments([seg, ...segments]); setShowCreate(false); }} />}

      {/* Segment list */}
      <div style={styles.segmentList}>
        {loading && <p style={styles.empty}>Loading...</p>}
        {!loading && segments.length === 0 && <p style={styles.empty}>No segments defined</p>}
        {segments.map((seg) => (
          <div key={seg.id} style={{ ...styles.segmentCard, ...(selectedSegment === seg.id ? styles.segmentCardActive : {}) }}>
            <div style={styles.segmentInfo}>
              <span style={styles.segmentName}>{seg.name}</span>
              {seg.is_predefined && <Badge variant="neutral">Predefined</Badge>}
              <span style={styles.segmentRules}>{seg.rules.rules.length} rule(s) • {seg.rules.logic}</span>
            </div>
            <div style={styles.segmentActions}>
              <button style={styles.actionBtn} onClick={() => handleViewMembers(seg.id)}>View Members</button>
              {!seg.is_predefined && (
                <button style={styles.actionBtn} onClick={() => handleDelete(seg.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Members view */}
      {selectedSegment && (
        <div style={styles.membersSection}>
          <h2 style={styles.subtitle}>Members ({memberCount})</h2>
          <Table
            columns={[
              { key: 'reference_number', header: 'Ref' },
              { key: 'name', header: 'Name', render: (_: any, r: any) => `${r.first_name} ${r.last_name}` },
              { key: 'email', header: 'Email' },
              { key: 'lifecycle_stage', header: 'Stage', render: (v: string) => <Badge variant="neutral">{v}</Badge> },
            ]}
            data={members}
            emptyMessage="No members match this segment"
          />
        </div>
      )}
    </div>
  );
}

function CreateSegmentForm({ businessId, onCreated }: { businessId: string; onCreated: (seg: Segment) => void }) {
  const [name, setName] = useState('');
  const [field, setField] = useState('lifecycle_stage');
  const [operator, setOperator] = useState('eq');
  const [value, setValue] = useState('');
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<any[]>([]);

  const addRule = () => {
    if (!value) return;
    const ruleValue = operator === 'in' ? value.split(',').map((v) => v.trim()) : value;
    setRules([...rules, { field, operator, value: ruleValue }]);
    setValue('');
  };

  const handleCreate = async () => {
    if (!name || rules.length === 0) return;
    const seg = await customersApi.createSegment({
      name,
      business_id: businessId,
      rules: { logic, rules },
    });
    onCreated(seg);
  };

  return (
    <div style={styles.createForm}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" style={styles.input} />
      <div style={styles.ruleBuilder}>
        <select value={field} onChange={(e) => setField(e.target.value)} style={styles.select}>
          <option value="lifecycle_stage">Lifecycle Stage</option>
          <option value="email">Email</option>
          <option value="country">Country</option>
          <option value="gender">Gender</option>
          <option value="created_at">Created At</option>
        </select>
        <select value={operator} onChange={(e) => setOperator(e.target.value)} style={styles.select}>
          <option value="eq">Equals</option>
          <option value="neq">Not Equals</option>
          <option value="contains">Contains</option>
          <option value="in">In (comma-separated)</option>
          <option value="gt">Greater Than</option>
          <option value="lt">Less Than</option>
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" style={styles.input} />
        <Button onClick={addRule}>+ Rule</Button>
      </div>
      <div style={styles.rulesList}>
        <select value={logic} onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')} style={styles.select}>
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
        {rules.map((r, i) => (
          <span key={i} style={styles.ruleChip}>{r.field} {r.operator} {JSON.stringify(r.value)}</span>
        ))}
      </div>
      {rules.length > 0 && <Button onClick={handleCreate}>Save Segment</Button>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  segmentList: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' },
  segmentCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  segmentCardActive: { borderColor: 'var(--color-primary)' },
  segmentInfo: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  segmentName: { fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  segmentRules: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  segmentActions: { display: 'flex', gap: 'var(--space-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  membersSection: { marginTop: 'var(--space-lg)' },
  createForm: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)', padding: 'var(--space-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)' },
  ruleBuilder: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, alignItems: 'center' },
  rulesList: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, alignItems: 'center' },
  ruleChip: { padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
