import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { lifecycleStageLabel, LIFECYCLE_STAGES, PERSON_SOURCE_LABELS } from '@daystream/shared';
import { Button } from '../design-system/components/actions/Button';
import { getTags } from '../api/customers';
import { getServices } from '../api/services';
import { getStaffList } from '../api/staff';
import { getLocations } from '../api/locations';
import { getResources } from '../api/resources';
import { getEventTypes, getEvents } from '../api/events';
import { getPlans } from '../api/memberships';
import { formatDay } from '../utils/format';

/**
 * The segment builder (THE-18, David 2026-11-04, Inbox Proposals part 3): one line per condition,
 * "match all" or "match any", and groups ("any of" inside "all of"). Used for People segments and
 * so for the Inbox, which uses the same segments.
 *
 * The words shown come from the customers translation file: cond.field.<id> (what a condition is
 * about), cond.group.<group>, and cond.* for the controls.
 */

export type Rule = { field: string; operator: string; value?: any };
export type Rules = { logic: 'AND' | 'OR'; rules: Rule[] };

type Option = { value: string; label: string };
type Kind = 'choice' | 'text' | 'date' | 'yesno' | 'count' | 'complex';
type Group = 'person' | 'visits' | 'membership' | 'contact';
/** `options` are the stored values of a choice; their words come from optionLabel. */
interface FieldDef { id: string; group: Group; kind: Kind; options?: string[]; neverAllowed?: boolean }

export const FIELDS: FieldDef[] = [
  { id: 'lifecycle_stage', group: 'person', kind: 'choice', options: [...LIFECYCLE_STAGES] },
  { id: 'source', group: 'person', kind: 'choice', options: Object.keys(PERSON_SOURCE_LABELS) },
  { id: 'gender', group: 'person', kind: 'choice', options: ['male', 'female', 'other'] },
  { id: 'created_at', group: 'person', kind: 'complex' },
  { id: 'birthday', group: 'person', kind: 'complex' },
  { id: 'age', group: 'person', kind: 'complex' },
  { id: 'tags', group: 'person', kind: 'complex' },
  { id: 'address', group: 'person', kind: 'complex' },
  { id: 'country', group: 'person', kind: 'text' },
  { id: 'email', group: 'person', kind: 'text' },
  { id: 'incomplete', group: 'person', kind: 'yesno' },
  { id: 'has_account', group: 'person', kind: 'yesno' },
  { id: 'has_owner', group: 'person', kind: 'yesno' },
  { id: 'visits', group: 'visits', kind: 'complex' },
  { id: 'future_bookings', group: 'visits', kind: 'complex' },
  { id: 'upcoming_event', group: 'visits', kind: 'yesno' },
  { id: 'service', group: 'visits', kind: 'complex' },
  { id: 'location', group: 'visits', kind: 'complex' },
  { id: 'resource', group: 'visits', kind: 'complex' },
  { id: 'last_visit_at', group: 'visits', kind: 'date', neverAllowed: true },
  { id: 'membership', group: 'membership', kind: 'complex' },
  { id: 'last_contacted', group: 'contact', kind: 'complex' },
  { id: 'last_activity_at', group: 'contact', kind: 'date', neverAllowed: true },
  { id: 'last_login_at', group: 'contact', kind: 'date', neverAllowed: true },
  { id: 'consent.email', group: 'contact', kind: 'yesno' },
  { id: 'consent.sms', group: 'contact', kind: 'yesno' },
  { id: 'consent.whatsapp', group: 'contact', kind: 'yesno' },
  // Older single-purpose rules, kept so existing segments still read well.
  { id: 'birthday_this_month', group: 'person', kind: 'yesno' },
  { id: 'created_this_month', group: 'person', kind: 'yesno' },
  { id: 'birth_month', group: 'person', kind: 'text' },
];
const GROUP_ORDER: Group[] = ['person', 'visits', 'membership', 'contact'];

const fieldLabel = (t: TFunction, id: string) => t('cond.field.' + id, { defaultValue: id });
/** The words for one stored value of a choice field (stage, source, gender). */
function optionLabel(t: TFunction, field: string, value: string): string {
  if (field === 'lifecycle_stage') return t('stage.' + value, { defaultValue: lifecycleStageLabel(value) });
  if (field === 'source') return t('source.' + value, { defaultValue: PERSON_SOURCE_LABELS[value] ?? value });
  return t('cond.gender.' + value, { defaultValue: value });
}
/** A stored date ("2026-11-24") in the language and format shown. */
const day = (x: unknown) => formatDay(typeof x === 'string' ? x : null) || String(x ?? '');

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
  if (f.kind === 'choice') return { field, operator: 'eq', value: f.options?.[0] };
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
const countOps = (t: TFunction): Option[] => [{ value: 'gt', label: t('cond.countOp.gt') }, { value: 'lt', label: t('cond.countOp.lt') }, { value: 'eq', label: t('cond.countOp.eq') }];

/** One condition line: what it is about, and its controls. */
function Condition({ rule, onChange, onRemove, lk }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; lk: Lookups }) {
  const { t } = useTranslation('customers');
  const f = FIELDS.find((x) => x.id === rule.field);
  const v = rule.value ?? {};
  const setV = (patch: any) => onChange({ ...rule, value: { ...v, ...patch } });
  const num = (key: string, label: string, ph = '') => <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label={label} placeholder={ph} value={v[key] ?? ''} onChange={(e) => setV({ [key]: e.target.value === '' ? '' : Number(e.target.value) })} />;
  const text = (key: string, label: string) => <input style={st.ctl} aria-label={label} placeholder={label} value={v[key] ?? ''} onChange={(e) => setV({ [key]: e.target.value })} />;
  const days = t('cond.days');
  let body: React.ReactNode = null;

  switch (rule.field) {
    case 'visits':
      body = <>
        <Select label={t('cond.l.howMany')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={countOps(t)} />{num('count', t('cond.l.numberOfVisits'))}
        <span style={st.muted}>{t('cond.inTheLast')}</span>{num('within_days', days, t('cond.any'))}<span style={st.muted}>{t('cond.daysUnit')}</span>
        <Select label={t('cond.l.service')} value={v.service_id} onChange={(x) => setV({ service_id: x })} options={lk.services} empty={t('cond.anyService')} />
        <Select label={t('cond.l.staff')} value={v.staff_id} onChange={(x) => setV({ staff_id: x })} options={lk.staff} empty={t('cond.anyStaff')} />
        <Select label={t('cond.l.location')} value={v.location_id} onChange={(x) => setV({ location_id: x })} options={lk.locations} empty={t('cond.anyLocation')} />
        <Select label={t('cond.l.membershipUsed')} value={v.membership_plan_id} onChange={(x) => setV({ membership_plan_id: x })} options={lk.plans} empty={t('cond.anyMembership')} />
        <Select label={t('cond.l.eventType')} value={v.event_type_id} onChange={(x) => setV({ event_type_id: x })} options={lk.eventTypes} empty={t('cond.anyEventType')} />
        <Select label={t('cond.l.event')} value={v.event_id} onChange={(x) => setV({ event_id: x })} options={lk.events} empty={t('cond.anyEvent')} />
        <label style={st.muted}><input type="checkbox" checked={!!v.recurring} onChange={(e) => setV({ recurring: e.target.checked })} /> {t('cond.recurringOnly')}</label>
      </>;
      break;
    case 'future_bookings':
      body = <><Select label={t('cond.l.howMany')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={countOps(t)} />{num('count', t('cond.l.numberOfBookings'))}<span style={st.muted}>{t('cond.within')}</span>{num('within_days', days, t('cond.any'))}<span style={st.muted}>{t('cond.daysUnit')}</span></>;
      break;
    case 'birthday':
      body = <>
        <Select label={t('cond.l.birthday')} value={v.mode} onChange={(m) => setV({ mode: m })} options={[{ value: 'next_month', label: t('cond.bday.nextMonth') }, { value: 'this_month', label: t('cond.bday.thisMonth') }, { value: 'next_days', label: t('cond.bday.nextDays') }, { value: 'date', label: t('cond.bday.date') }, { value: 'between', label: t('cond.bday.between') }]} />
        {v.mode === 'next_days' && <>{num('days', days)}<span style={st.muted}>{t('cond.daysUnit')}</span></>}
        {v.mode === 'date' && <input type="date" style={st.ctl} aria-label={t('cond.l.day')} value={v.date ?? ''} onChange={(e) => setV({ date: e.target.value })} />}
        {v.mode === 'between' && <><input type="date" style={st.ctl} aria-label={t('cond.l.from')} value={v.from ?? ''} onChange={(e) => setV({ from: e.target.value })} /><span style={st.muted}>{t('cond.to')}</span><input type="date" style={st.ctl} aria-label={t('cond.l.to')} value={v.to ?? ''} onChange={(e) => setV({ to: e.target.value })} /></>}
        <span style={st.muted}>{v.mode === 'next_month' ? t('cond.bday.calendarNote') : t('cond.bday.yearNote')}</span>
      </>;
      break;
    case 'age':
      body = <><span style={st.muted}>{t('cond.between')}</span>{num('min', t('cond.l.fromAge'))}<span style={st.muted}>{t('cond.and')}</span>{num('max', t('cond.l.toAge'))}<span style={st.muted}>{t('cond.years')}</span></>;
      break;
    case 'tags':
      body = <>
        <Select label={t('cond.l.tagMatch')} value={v.mode} onChange={(m) => setV({ mode: m })} options={[{ value: 'any', label: t('cond.tags.any') }, { value: 'all', label: t('cond.tags.all') }, { value: 'none', label: t('cond.tags.none') }]} />
        {lk.tags.map((tg) => (
          <label key={tg.value} style={{ ...st.muted, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={(v.tag_ids || []).includes(tg.value)} onChange={(e) => setV({ tag_ids: e.target.checked ? [...(v.tag_ids || []), tg.value] : (v.tag_ids || []).filter((x: string) => x !== tg.value) })} />{tg.label}
          </label>
        ))}
        {lk.tags.length === 0 && <span style={st.muted}>{t('cond.noTags')}</span>}
      </>;
      break;
    case 'address':
      body = <>{text('street', t('cond.l.street'))}{text('city', t('cond.l.city'))}{text('postcode', t('cond.l.postcode'))}{text('country', t('cond.l.country'))}<span style={st.muted}>{t('cond.addressNote')}</span></>;
      break;
    case 'membership':
      body = <>
        <Select label={t('cond.l.plan')} value={v.plan_id} onChange={(x) => setV({ plan_id: x })} options={lk.plans} empty={t('cond.choosePlan')} />
        <Select label={t('cond.l.state')} value={v.state} onChange={(x) => setV({ state: x })} options={[{ value: 'active', label: t('cond.member.active') }, { value: 'cancelled', label: t('cond.member.cancelled') }, { value: 'expired', label: t('cond.member.expired') }, { value: 'never', label: t('cond.member.never') }, { value: 'not_active', label: t('cond.member.notActive') }]} />
      </>;
      break;
    case 'last_contacted':
      body = <>
        <Select label={t('cond.l.when')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'within_days', label: t('cond.inTheLast') }, { value: 'older_than_days', label: t('cond.moreThanAgo') }, { value: 'between', label: t('cond.between') }, { value: 'never', label: t('cond.never') }]} />
        {(rule.operator === 'within_days' || rule.operator === 'older_than_days') && <>{num('days', days)}<span style={st.muted}>{t('cond.daysUnit')}</span></>}
        {rule.operator === 'between' && <><input type="date" style={st.ctl} aria-label={t('cond.l.from')} value={v.from ?? ''} onChange={(e) => setV({ from: e.target.value })} /><input type="date" style={st.ctl} aria-label={t('cond.l.to')} value={v.to ?? ''} onChange={(e) => setV({ to: e.target.value })} /></>}
        <Select label={t('cond.l.channel')} value={v.channel} onChange={(x) => setV({ channel: x })} options={[{ value: 'email', label: t('cond.channel.email') }, { value: 'in_app', label: t('cond.channel.inApp') }, { value: 'sms', label: t('cond.channel.sms') }]} empty={t('cond.anyChannel')} />
        <span style={st.muted}>{t('cond.automaticCount')}</span>
      </>;
      break;
    case 'service':
      body = <><Select label={t('cond.l.service')} value={v.service_id} onChange={(x) => setV({ service_id: x })} options={lk.services} empty={t('cond.chooseService')} /><Select label={t('cond.l.when')} value={v.when} onChange={(x) => setV({ when: x })} options={[{ value: 'past', label: t('cond.pastOnly') }, { value: 'future', label: t('cond.futureOnly') }]} empty={t('cond.pastOrFuture')} /></>;
      break;
    case 'location':
      body = <Select label={t('cond.l.location')} value={v.location_id} onChange={(x) => setV({ location_id: x })} options={lk.locations} empty={t('cond.chooseLocation')} />;
      break;
    case 'resource':
      body = <Select label={t('cond.l.resource')} value={v.resource_id} onChange={(x) => setV({ resource_id: x })} options={lk.resources} empty={t('cond.chooseResource')} />;
      break;
    case 'created_at':
      body = <><Select label={t('cond.l.when')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o, value: o === 'within_days' ? 30 : '' })} options={[{ value: 'gte', label: t('cond.onOrAfter') }, { value: 'lte', label: t('cond.onOrBefore') }, { value: 'within_days', label: t('cond.inTheLastDays') }]} />
        {rule.operator === 'within_days'
          ? <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label={days} value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />
          : <input type="date" style={st.ctl} aria-label={t('cond.l.date')} value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} />}</>;
      break;
    default:
      if (f?.kind === 'yesno') body = <Select label={t('cond.l.yesOrNo')} value={rule.operator} onChange={(o) => onChange({ field: rule.field, operator: o })} options={[{ value: 'is_true', label: t('cond.yes') }, { value: 'is_false', label: t('cond.no') }]} />;
      else if (f?.kind === 'choice') body = <><Select label={t('cond.l.condition')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'eq', label: t('cond.is') }, { value: 'neq', label: t('cond.isNot') }]} /><Select label={t('cond.l.value')} value={rule.value} onChange={(x) => onChange({ ...rule, value: x })} options={(f.options || []).map((o) => ({ value: o, label: optionLabel(t, f.id, o) }))} /></>;
      else if (f?.kind === 'date') body = <><Select label={t('cond.l.when')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'within_days', label: t('cond.inTheLastDays') }, { value: 'older_than_days', label: t('cond.moreThanDaysAgo') }, ...(f.neverAllowed ? [{ value: 'never', label: t('cond.never') }] : [])]} />
        {rule.operator !== 'never' && <input type="number" min={0} style={{ ...st.ctl, ...st.num }} aria-label={days} value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />}</>;
      else body = <><Select label={t('cond.l.condition')} value={rule.operator} onChange={(o) => onChange({ ...rule, operator: o })} options={[{ value: 'eq', label: t('cond.is') }, { value: 'contains', label: t('cond.contains') }]} /><input style={st.ctl} aria-label={t('cond.l.value')} value={rule.value ?? ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} /></>;
  }
  const name = f ? fieldLabel(t, f.id) : rule.field;
  return (
    <div style={st.row}>
      <span style={st.what}>{name}</span>
      {body}
      <button type="button" style={st.x} aria-label={t('cond.removeCondition', { name })} onClick={onRemove}>✕</button>
    </div>
  );
}

function AddCondition({ onAdd, allowGroup }: { onAdd: (r: Rule) => void; allowGroup: boolean }) {
  const { t } = useTranslation('customers');
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <select style={st.ctl} aria-label={t('cond.addCondition')} value="" onChange={(e) => { if (e.target.value) onAdd(newRule(e.target.value)); }}>
        <option value="">{t('cond.addConditionOption')}</option>
        {GROUP_ORDER.map((g) => <optgroup key={g} label={t('cond.group.' + g)}>{FIELDS.filter((f) => f.group === g && !['birthday_this_month', 'created_this_month', 'birth_month'].includes(f.id)).map((f) => <option key={f.id} value={f.id}>{fieldLabel(t, f.id)}</option>)}</optgroup>)}
      </select>
      {allowGroup && <Button size="sm" variant="ghost" onClick={() => onAdd({ field: 'group', operator: 'eq', value: { logic: 'OR', rules: [] } })}>{t('cond.addGroup')}</Button>}
    </div>
  );
}

/** The whole builder: lines, match all / any, groups one level deep. */
export function SegmentConditions({ value, onChange, businessId }: { value: Rules; onChange: (r: Rules) => void; businessId: string }) {
  const { t } = useTranslation('customers');
  const lk = useLookups(businessId);
  const setRule = (i: number, r: Rule) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? r : x)) });
  const remove = (i: number) => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) });
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ ...st.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
        {t('cond.match')}
        <select style={st.ctl} aria-label={t('cond.howCombine')} value={value.logic} onChange={(e) => onChange({ ...value, logic: e.target.value as 'AND' | 'OR' })}>
          <option value="AND">{t('cond.all')}</option><option value="OR">{t('cond.anyOf')}</option>
        </select>
        {t('cond.ofTheseConditions')}
      </label>
      {value.rules.map((r, i) => r.field === 'group' ? (
        <div key={i} style={st.group}>
          <label style={{ ...st.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
            {t('cond.groupMatch')}
            <select style={st.ctl} aria-label={t('cond.howGroupCombine')} value={r.value?.logic || 'OR'} onChange={(e) => setRule(i, { ...r, value: { ...r.value, logic: e.target.value } })}>
              <option value="OR">{t('cond.anyOf')}</option><option value="AND">{t('cond.all')}</option>
            </select>
            {t('cond.of')}
            <button type="button" style={st.x} aria-label={t('cond.removeGroup')} onClick={() => remove(i)}>✕</button>
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
export function describeRules(rules: Rules | undefined | null, t: TFunction): string {
  if (!rules?.rules?.length) return '';
  const and = ` ${t('cond.and')} `;
  const or = ` ${t('cond.or')} `;
  const one = (r: Rule): string => {
    if (r.field === 'group') return `(${(r.value?.rules || []).map(one).join(r.value?.logic === 'AND' ? and : or)})`;
    const f = FIELDS.find((x) => x.id === r.field); const label = f ? fieldLabel(t, f.id) : r.field; const v = r.value ?? {};
    switch (r.field) {
      case 'visits': case 'future_bookings': {
        const op = t('cond.countOp.' + r.operator, { defaultValue: r.operator });
        return v.within_days
          ? t('cond.describe.countDays', { label, op, n: v.count, days: v.within_days })
          : t('cond.describe.count', { label, op, n: v.count });
      }
      case 'birthday': {
        const when: Record<string, string> = {
          next_month: t('cond.describe.nextMonth'), this_month: t('cond.describe.thisMonth'),
          next_days: t('cond.describe.nextDays', { days: v.days }), date: t('cond.describe.onDate', { date: day(v.date) }),
          between: t('cond.describe.betweenDays', { from: day(v.from), to: day(v.to) }),
        };
        return t('cond.describe.birthday', { when: when[v.mode] || '' });
      }
      case 'age': return t('cond.describe.age', { min: v.min || '…', max: v.max || '…' });
      case 'tags': return t('cond.describe.tags', { mode: t('cond.describe.tagMode.' + v.mode, { defaultValue: v.mode }), n: (v.tag_ids || []).length });
      case 'address': return t('cond.describe.address', { parts: [v.street, v.city, v.postcode, v.country].filter(Boolean).join(', ') });
      case 'membership': return t('cond.describe.membership', { state: t('cond.describe.memberState.' + v.state, { defaultValue: v.state }) });
      case 'last_contacted':
        if (r.operator === 'never') return t('cond.describe.contactedNever');
        if (r.operator === 'between') return t('cond.describe.contactedBetween', { from: day(v.from), to: day(v.to) });
        return r.operator === 'within_days' ? t('cond.describe.contactedWithin', { days: v.days }) : t('cond.describe.contactedOlder', { days: v.days });
      case 'service': case 'location': case 'resource': return label;
    }
    if (r.operator === 'is_true') return label;
    if (r.operator === 'is_false') return t('cond.describe.not', { label: label.toLocaleLowerCase() });
    if (r.operator === 'never') return t('cond.describe.never', { label });
    if (r.operator === 'within_days') return t('cond.describe.withinDays', { label, n: r.value });
    if (r.operator === 'older_than_days') return t('cond.describe.olderDays', { label, n: r.value });
    if (r.operator === 'gte') return t('cond.describe.onOrAfter', { label, value: day(r.value) });
    if (r.operator === 'lte') return t('cond.describe.onOrBefore', { label, value: day(r.value) });
    const shown = f?.options?.includes(r.value) ? optionLabel(t, f.id, r.value) : String(r.value);
    return t(r.operator === 'neq' ? 'cond.describe.isNot' : r.operator === 'contains' ? 'cond.describe.contains' : 'cond.describe.is', { label, value: shown });
  };
  return rules.rules.map(one).join(rules.logic === 'OR' ? or : and);
}
