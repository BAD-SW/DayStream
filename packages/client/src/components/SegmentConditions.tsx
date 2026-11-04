import { useEffect, useState } from 'react';
import { lifecycleStageLabel, LIFECYCLE_STAGES, PERSON_SOURCE_LABELS } from '@daystream/shared';
import { Button } from '../design-system/components/actions/Button';
import { getTags } from '../api/customers';
import { getServices } from '../api/services';
import { getStaffList } from '../api/staff';
import { getLocations } from '../api/locations';
import { getResources } from '../api/resources';
import { getEventTypes, getEvents } from '../api/events';
import { getPlans } from '../api/memberships';

/**
 * The segment builder (THE-18, David 2026-11-04, Inbox Proposals part 3): one line per condition,
 * "match all" or "match any", and groups ("any of" inside "all of"). Used for People segments and
 * so for the Inbox, which uses the same segments.
 */

export type Rule = { field: string; operator: string; value?: any };
export type Rules = { logic: 'AND' | 'OR'; rules: Rule[] };

type Option = { value: string; label: string };
type Kind = 'choice' | 'text' | 'date' | 'yesno' | 'count' | 'complex';
interface FieldDef { id: string; label: string; group: string; kind: Kind; options?: Option[]; neverAllowed?: boolean }

export const FIELDS: FieldDef[] = [
  { id: 'lifecycle_stage', label: 'Stage', group: 'Person', kind: 'choice', options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: lifecycleStageLabel(s) })) },
  { id: 'source', label: 'Source', group: 'Person', kind: 'choice', options: Object.entries(PERSON_SOURCE_LABELS).map(([value, label]) => ({ value, label })) },
  { id: 'gender', label: 'Gender', group: 'Person', kind: 'choice', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
  { id: 'created_at', label: 'Joined', group: 'Person', kind: 'complex' },
  { id: 'birthday', label: 'Birthday', group: 'Person', kind: 'complex' },
  { id: 'age', label: 'Age', group: 'Person', kind: 'complex' },
  { id: 'tags', label: 'Tags', group: 'Person', kind: 'complex' },
  { id: 'address', label: 'Address', group: 'Person', kind: 'complex' },
  { id: 'country', label: 'Country', group: 'Person', kind: 'text' },
  { id: 'email', label: 'Email', group: 'Person', kind: 'text' },
  { id: 'incomplete', label: 'Details incomplete', group: 'Person', kind: 'yesno' },
  { id: 'has_account', label: 'Has a login account', group: 'Person', kind: 'yesno' },
  { id: 'has_owner', label: 'Has an owner', group: 'Person', kind: 'yesno' },
  { id: 'visits', label: 'Visits', group: 'Visits & bookings', kind: 'complex' },
  { id: 'future_bookings', label: 'Future bookings', group: 'Visits & bookings', kind: 'complex' },
  { id: 'upcoming_event', label: 'Has an upcoming class or event booking', group: 'Visits & bookings', kind: 'yesno' },
  { id: 'service', label: 'Service booked', group: 'Visits & bookings', kind: 'complex' },
  { id: 'location', label: 'Location (of the business)', group: 'Visits & bookings', kind: 'complex' },
  { id: 'resource', label: 'Resource (room, equipment)', group: 'Visits & bookings', kind: 'complex' },
  { id: 'last_visit_at', label: 'Last visit', group: 'Visits & bookings', kind: 'date', neverAllowed: true },
  { id: 'membership', label: 'Membership', group: 'Membership', kind: 'complex' },
  { id: 'last_contacted', label: 'Last contacted', group: 'Contact', kind: 'complex' },
  { id: 'last_activity_at', label: 'Last activity', group: 'Contact', kind: 'date', neverAllowed: true },
  { id: 'last_login_at', label: 'Last login', group: 'Contact', kind: 'date', neverAllowed: true },
  { id: 'consent.email', label: 'Agreed to email marketing', group: 'Contact', kind: 'yesno' },
  { id: 'consent.sms', label: 'Agreed to SMS marketing', group: 'Contact', kind: 'yesno' },
  { id: 'consent.whatsapp', label: 'Agreed to WhatsApp marketing', group: 'Contact', kind: 'yesno' },
  // Older single-purpose rules, kept so existing segments still read well.
  { id: 'birthday_this_month', label: 'Birthday this month', group: 'Person', kind: 'yesno' },
  { id: 'created_this_month', label: 'Added this month', group: 'Person', kind: 'yesno' },
  { id: 'birth_month', label: 'Birth month', group: 'Person', kind: 'text' },
];

/** A sensible first condition for a field. */
export function newRule(field: string): Rule {
  const f = FIELDS.find((x) => x.id === field)!;
  switch (field) {
    case 'visits': return { field, operator: 'gt', value: { count: 0 } };
    case 'future_bookings': return { field, operator: 'gt', value: { count: 0 } };
    case 'birthday': return { field, operator: 'eq', value: { mode: 'next_month' } };
    case 'age': return { field, operator: 'between', value: { min: '', max: '' } };
    case 'tags': return { field, operator: 'in', value: { mode: 'any', tag_ids: [] } };
    case 'address': return { field, operator: 'eq', value: { street: '', city: '', postcode: '', country: '' } };
    case 'membership': return { field, operator: 'eq', value: { plan_id: '', state: 'active' } };
    case 'last_contacted': return { field, operator: 'within_days', value: { days: 30 } };
    case 'service': return { field, operator: 'eq', value: { service_id: '', when: '' } };
    case 'location': return { field, operator: 'eq', value: { location_id: '' } };
    case 'resource': return { field, operator: 'eq', value: { resource_id: '' } };
    case 'created_at': return { field, operator: 'gte', value: '' };
  }
  if (f.kind === 'yesno') return { field, operator: 'is_true' };
  if (f.kind === 'date') return { field, operator: 'within_days', value: 30 };
  if (f.kind === 'choice') return { field, operator: 'eq', value: f.options?.[0]?.value };
  return { field, operator: 'eq', value: '' };
}

interface Lookups { tags: Option[]; services: Option[]; staff: Option[]; locations: Option[]; resources: Option[]; eventTypes: Option[]; events: Option[]; plans: Option[] }
const EMPTY: Lookups = { tags: [], services: [], staff: [], locations: [], resources: [], eventTypes: [], events: [], plans: [] };

function useLookups(businessId: string): Lookups {
  const [l, setL] = useState<Lookups>(EMPTY);
  useEffect(() => {
    if (!businessId) return;
    const opt = (rows: any[], label = (r: any) => r.name) => (rows || []).map((r) => ({ value: r.id, label: label(r) }));
    const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    Promise.all([
      safe(getTags(businessId), []), safe(getServices(businessId, { limit: 100 }).then((r: any) => r.data || r), []),
      safe(getStaffList({ business_id: businessId, status: 'active' }).then((r) => r.data), []), safe(getLocations(businessId), []),
      safe(getResources({ business_id: businessId }).then((r) => r.data), []), safe(getEventTypes(), []),
      safe(getEvents({ business_id: businessId, limit: 100 }).then((r) => r.data), []), safe(getPlans(businessId), []),
    ]).then(([tags, services, staff, locations, resources, eventTypes, events, plans]) => setL({
      tags: opt(tags as any[]), services: opt(services as any[]), staff: opt(staff as any[], (s) => `${s.first_name} ${s.last_name}`.trim()),
      locations: opt(locations as any[]), resources: opt(resources as any[]), eventTypes: opt(eventTypes as any[]),
      events: opt(events as any[], (e) => e.title), plans: opt(plans as any[]),
    }));
  }, [businessId]);
  return l;
}

const st: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  what: { fontWeight: 600, fontSize: 'var(--font-size-sm)', minWidth: 130 },
  ctl: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '5px 8px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  num: { width: 70 },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' },
  x: { marginLeft: 'auto', background: 'none', border: 0, cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 16 },
  group: { display: 'grid', gap: 6, padding: 8, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)' },
};

function Select({ value, onChange, options, label, empty }: { value: any; onChange: (v: string) => void; options: Option[]; label: string; empty?: string }) {
  return (
    <select style={st.ctl} aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
const COUNT_OPS: Option[] = [{ value: 'gt', label: 'more than' }, { value: 'lt', label: 'less than' }, { value: 'eq', label: 'exactly' }];

/** One condition line: what it is about, and its controls. */
function Condition({ rule, onChange, onRemove, lk }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; lk: Lookups }) {
  const f = FIELDS.find((x) => x.id === rule.field);
  const v = rule.value ?? {};
  const setV = (patch: any) => onChange({ ...rule, value: { ...v, ...patch } });
  const num = (key: string, label: string, ph = '') => <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label={label} placeholder={ph} value={v[key] ?? ''} onChange={(e) => setV({ [key]: e.target.value === '' ? '' : Number(e.target.value) })} />;
  const text = (key: string, label: string) => <input style={st.ctl} aria-label={label} placeholder={label} value={v[key] ?? ''} onChange={(e) => setV({ [key]: e.target.value })} />;
  let body: React.ReactNode = null;

  switch (rule.field) {
    case 'visits':
      body = <>
        <Select label="How many" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={COUNT_OPS} />{num('count', 'Number of visits')}
        <span style={st.muted}>in the last</span>{num('within_days', 'Days', 'any')}<span style={st.muted}>days</span>
        <Select label="Service" value={v.service_id} onChange={(x) => setV({ service_id: x })} options={lk.services} empty="any service" />
        <Select label="Staff" value={v.staff_id} onChange={(x) => setV({ staff_id: x })} options={lk.staff} empty="any staff" />
        <Select label="Location" value={v.location_id} onChange={(x) => setV({ location_id: x })} options={lk.locations} empty="any location" />
        <Select label="Membership used" value={v.membership_plan_id} onChange={(x) => setV({ membership_plan_id: x })} options={lk.plans} empty="any membership" />
        <Select label="Event type" value={v.event_type_id} onChange={(x) => setV({ event_type_id: x })} options={lk.eventTypes} empty="any event type" />
        <Select label="Event" value={v.event_id} onChange={(x) => setV({ event_id: x })} options={lk.events} empty="any event" />
        <label style={st.muted}><input type="checkbox" checked={!!v.recurring} onChange={(e) => setV({ recurring: e.target.checked })} /> recurring events only</label>
      </>;
      break;
    case 'future_bookings':
      body = <><Select label="How many" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={COUNT_OPS} />{num('count', 'Number of bookings')}<span style={st.muted}>within</span>{num('within_days', 'Days', 'any')}<span style={st.muted}>days</span></>;
      break;
    case 'birthday':
      body = <>
        <Select label="Birthday" value={v.mode} onChange={(m) => setV({ mode: m })} options={[{ value: 'next_month', label: 'next month' }, { value: 'this_month', label: 'this month' }, { value: 'next_days', label: 'in the next … days' }, { value: 'date', label: 'on a day' }, { value: 'between', label: 'between two days' }]} />
        {v.mode === 'next_days' && <>{num('days', 'Days')}<span style={st.muted}>days</span></>}
        {v.mode === 'date' && <input type="date" style={st.ctl} aria-label="Day" value={v.date ?? ''} onChange={(e) => setV({ date: e.target.value })} />}
        {v.mode === 'between' && <><input type="date" style={st.ctl} aria-label="From" value={v.from ?? ''} onChange={(e) => setV({ from: e.target.value })} /><span style={st.muted}>to</span><input type="date" style={st.ctl} aria-label="To" value={v.to ?? ''} onChange={(e) => setV({ to: e.target.value })} /></>}
        <span style={st.muted}>{v.mode === 'next_month' ? 'follows the calendar: in December it means January' : 'the year does not matter'}</span>
      </>;
      break;
    case 'age':
      body = <><span style={st.muted}>between</span>{num('min', 'From age')}<span style={st.muted}>and</span>{num('max', 'To age')}<span style={st.muted}>years</span></>;
      break;
    case 'tags':
      body = <>
        <Select label="Tag match" value={v.mode} onChange={(m) => setV({ mode: m })} options={[{ value: 'any', label: 'has any of' }, { value: 'all', label: 'has all of' }, { value: 'none', label: 'has none of' }]} />
        {lk.tags.map((t) => (
          <label key={t.value} style={{ ...st.muted, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={(v.tag_ids || []).includes(t.value)} onChange={(e) => setV({ tag_ids: e.target.checked ? [...(v.tag_ids || []), t.value] : (v.tag_ids || []).filter((x: string) => x !== t.value) })} />{t.label}
          </label>
        ))}
        {lk.tags.length === 0 && <span style={st.muted}>No tags yet</span>}
      </>;
      break;
    case 'address':
      body = <>{text('street', 'Street')}{text('city', 'City')}{text('postcode', 'Postcode')}{text('country', 'Country')}<span style={st.muted}>any filled field; similar spellings match</span></>;
      break;
    case 'membership':
      body = <>
        <Select label="Plan" value={v.plan_id} onChange={(x) => setV({ plan_id: x })} options={lk.plans} empty="Choose a plan…" />
        <Select label="State" value={v.state} onChange={(x) => setV({ state: x })} options={[{ value: 'active', label: 'is active' }, { value: 'cancelled', label: 'was cancelled' }, { value: 'expired', label: 'expired' }, { value: 'never', label: 'never had it' }, { value: 'not_active', label: "doesn't have it active" }]} />
      </>;
      break;
    case 'last_contacted':
      body = <>
        <Select label="When" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'within_days', label: 'in the last' }, { value: 'older_than_days', label: 'more than … ago' }, { value: 'between', label: 'between' }, { value: 'never', label: 'never' }]} />
        {(rule.operator === 'within_days' || rule.operator === 'older_than_days') && <>{num('days', 'Days')}<span style={st.muted}>days</span></>}
        {rule.operator === 'between' && <><input type="date" style={st.ctl} aria-label="From" value={v.from ?? ''} onChange={(e) => setV({ from: e.target.value })} /><input type="date" style={st.ctl} aria-label="To" value={v.to ?? ''} onChange={(e) => setV({ to: e.target.value })} /></>}
        <Select label="Channel" value={v.channel} onChange={(x) => setV({ channel: x })} options={[{ value: 'email', label: 'by email' }, { value: 'in_app', label: 'in-app' }, { value: 'sms', label: 'by SMS' }]} empty="any channel" />
        <span style={st.muted}>automatic messages count</span>
      </>;
      break;
    case 'service':
      body = <><Select label="Service" value={v.service_id} onChange={(x) => setV({ service_id: x })} options={lk.services} empty="Choose a service…" /><Select label="When" value={v.when} onChange={(x) => setV({ when: x })} options={[{ value: 'past', label: 'past only' }, { value: 'future', label: 'future only' }]} empty="past or future" /></>;
      break;
    case 'location':
      body = <Select label="Location" value={v.location_id} onChange={(x) => setV({ location_id: x })} options={lk.locations} empty="Choose a location…" />;
      break;
    case 'resource':
      body = <Select label="Resource" value={v.resource_id} onChange={(x) => setV({ resource_id: x })} options={lk.resources} empty="Choose a resource…" />;
      break;
    case 'created_at':
      body = <><Select label="When" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o, value: o === 'within_days' ? 30 : '' })} options={[{ value: 'gte', label: 'on or after' }, { value: 'lte', label: 'on or before' }, { value: 'within_days', label: 'in the last (days)' }]} />
        {rule.operator === 'within_days'
          ? <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label="Days" value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />
          : <input type="date" style={st.ctl} aria-label="Date" value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} />}</>;
      break;
    default:
      if (f?.kind === 'yesno') body = <Select label="Yes or no" value={rule.operator} onChange={(o) => onChange({ field: rule.field, operator: o })} options={[{ value: 'is_true', label: 'yes' }, { value: 'is_false', label: 'no' }]} />;
      else if (f?.kind === 'choice') body = <><Select label="Condition" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' }]} /><Select label="Value" value={rule.value} onChange={(x) => onChange({ ...rule, value: x })} options={f.options || []} /></>;
      else if (f?.kind === 'date') body = <><Select label="When" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'within_days', label: 'in the last (days)' }, { value: 'older_than_days', label: 'more than (days) ago' }, ...(f.neverAllowed ? [{ value: 'never', label: 'never' }] : [])]} />
        {rule.operator !== 'never' && <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label="Days" value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />}</>;
      else body = <><Select label="Condition" value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'eq', label: 'is' }, { value: 'contains', label: 'contains' }]} /><input style={st.ctl} aria-label="Value" value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} /></>;
  }
  return (
    <div style={st.row}>
      <span style={st.what}>{f?.label || rule.field}</span>
      {body}
      <button type="button" style={st.x} aria-label={`Remove condition: ${f?.label || rule.field}`} onClick={onRemove}>✕</button>
    </div>
  );
}

function AddCondition({ onAdd, allowGroup }: { onAdd: (r: Rule) => void; allowGroup: boolean }) {
  const groups = Array.from(new Set(FIELDS.map((f) => f.group)));
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <select style={st.ctl} aria-label="Add condition" value="" onChange={(e) => { if (e.target.value) onAdd(newRule(e.target.value)); }}>
        <option value="">+ Add condition…</option>
        {groups.map((g) => <optgroup key={g} label={g}>{FIELDS.filter((f) => f.group === g && !['birthday_this_month', 'created_this_month', 'birth_month'].includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>)}
      </select>
      {allowGroup && <Button size="sm" variant="ghost" onClick={() => onAdd({ field: 'group', operator: 'eq', value: { logic: 'OR', rules: [] } })}>+ Group (any of)</Button>}
    </div>
  );
}

/** The whole builder: lines, match all / any, groups one level deep. */
export function SegmentConditions({ value, onChange, businessId }: { value: Rules; onChange: (r: Rules) => void; businessId: string }) {
  const lk = useLookups(businessId);
  const setRule = (i: number, r: Rule) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? r : x)) });
  const remove = (i: number) => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) });
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ ...st.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
        Match
        <select style={st.ctl} aria-label="How conditions combine" value={value.logic} onChange={(e) => onChange({ ...value, logic: e.target.value as 'AND' | 'OR' })}>
          <option value="AND">all</option><option value="OR">any</option>
        </select>
        of these conditions
      </label>
      {value.rules.map((r, i) => r.field === 'group' ? (
        <div key={i} style={st.group}>
          <label style={{ ...st.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
            Group: match
            <select style={st.ctl} aria-label="How the group's conditions combine" value={r.value?.logic || 'OR'} onChange={(e) => setRule(i, { ...r, value: { ...r.value, logic: e.target.value } })}>
              <option value="OR">any</option><option value="AND">all</option>
            </select>
            of
            <button type="button" style={st.x} aria-label="Remove group" onClick={() => remove(i)}>✕</button>
          </label>
          {(r.value?.rules || []).map((g: Rule, k: number) => (
            <Condition key={k} rule={g} lk={lk}
              onChange={(nr) => setRule(i, { ...r, value: { ...r.value, rules: r.value.rules.map((x: Rule, j: number) => (j === k ? nr : x)) } })}
              onRemove={() => setRule(i, { ...r, value: { ...r.value, rules: r.value.rules.filter((_: Rule, j: number) => j !== k) } })} />
          ))}
          <AddCondition allowGroup={false} onAdd={(nr) => setRule(i, { ...r, value: { ...r.value, rules: [...(r.value?.rules || []), nr] } })} />
        </div>
      ) : (
        <Condition key={i} rule={r} lk={lk} onChange={(nr) => setRule(i, nr)} onRemove={() => remove(i)} />
      ))}
      <AddCondition allowGroup onAdd={(r) => onChange({ ...value, rules: [...value.rules, r] })} />
    </div>
  );
}

/** A condition in plain words, for the segment list. */
export function describeRules(rules: Rules | undefined | null): string {
  if (!rules?.rules?.length) return '';
  const one = (r: Rule): string => {
    if (r.field === 'group') return `(${(r.value?.rules || []).map(one).join(r.value?.logic === 'AND' ? ' and ' : ' or ')})`;
    const f = FIELDS.find((x) => x.id === r.field); const label = f?.label || r.field; const v = r.value ?? {};
    switch (r.field) {
      case 'visits': case 'future_bookings': return `${label} ${({ gt: 'more than', lt: 'less than', eq: 'exactly' } as any)[r.operator] || r.operator} ${v.count}${v.within_days ? ` (${v.within_days} days)` : ''}`;
      case 'birthday': return `Birthday ${({ next_month: 'next month', this_month: 'this month', next_days: `in the next ${v.days} days`, date: `on ${v.date}`, between: `between ${v.from} and ${v.to}` } as any)[v.mode] || ''}`;
      case 'age': return `Age ${v.min || '…'}–${v.max || '…'}`;
      case 'tags': return `Tags: ${v.mode} of ${(v.tag_ids || []).length}`;
      case 'address': return `Address: ${[v.street, v.city, v.postcode, v.country].filter(Boolean).join(', ')}`;
      case 'membership': return `Membership ${v.state}`;
      case 'last_contacted': return `Last contacted ${r.operator === 'never' ? 'never' : r.operator === 'between' ? `${v.from}–${v.to}` : `${r.operator === 'within_days' ? 'in the last' : 'more than'} ${v.days} days`}`;
      case 'service': case 'location': case 'resource': return label;
    }
    if (r.operator === 'is_true') return label;
    if (r.operator === 'is_false') return `Not: ${label.toLowerCase()}`;
    if (r.operator === 'never') return `${label}: never`;
    if (r.operator === 'within_days') return `${label} in the last ${r.value} days`;
    if (r.operator === 'older_than_days') return `${label} more than ${r.value} days ago`;
    if (r.operator === 'gte') return `${label} on or after ${r.value}`;
    if (r.operator === 'lte') return `${label} on or before ${r.value}`;
    const shown = f?.options?.find((o) => o.value === r.value)?.label ?? String(r.value);
    return `${label} ${r.operator === 'neq' ? 'is not' : r.operator === 'contains' ? 'contains' : 'is'} ${shown}`;
  };
  return rules.rules.map(one).join(rules.logic === 'OR' ? ' or ' : ' and ');
}
