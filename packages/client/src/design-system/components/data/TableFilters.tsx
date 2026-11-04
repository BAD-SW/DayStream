import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency, getCurrencySymbol } from '../../../utils/currency';
import './TableFilters.css';

/**
 * Column filters for every table (David, 2026-11-02, design approved on the "DayStream Table
 * Filters" mock-up): a filter icon beside the sort icon opens either a list of all the column's
 * values (search, Select all / Unselect all, counts, "Contains") or, for dates, quick ranges
 * beside two months with typed From / To; for amounts, a slider over a bar chart (decision 7).
 * Nothing changes until Apply; Cancel leaves the table as it was.
 */

/** One column's filter. `values` holds the chosen values ('' = empty); dates are 'YYYY-MM-DD'; amounts `min` / `max` in cents. */
export interface ColumnFilter { values?: string[]; contains?: string; from?: string; to?: string; min?: number; max?: number }
export type TableFilters = Record<string, ColumnFilter>;
export interface FilterOption { value: string; label?: string; count?: number }

export const isFilterOn = (f?: ColumnFilter) => !!f && (!!f.values?.length || !!f.contains || !!f.from || !!f.to || f.min != null || f.max != null);

const pad = (n: number) => String(n).padStart(2, '0');
/** A date or timestamp as the local calendar day 'YYYY-MM-DD'. */
export function dayOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}.*)?$/;
export const looksLikeDate = (v: unknown) => typeof v === 'string' && ISO_LIKE.test(v);

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface FilterColumnDef<T> {
  key: string;
  kind: 'values' | 'date' | 'amount' | 'number';
  /** The value a row has in this column (what the list shows and what is matched). */
  value: (row: T) => unknown;
}

/** Rows that pass every column filter (for tables that hold all their rows). */
export function applyTableFilters<T>(rows: T[], columns: FilterColumnDef<T>[], filters: TableFilters): T[] {
  const active = columns.filter((c) => isFilterOn(filters[c.key]));
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((c) => {
    const f = filters[c.key]; const v = c.value(row);
    if (c.kind === 'amount' || c.kind === 'number') {
      const n = v == null || v === '' ? NaN : Number(v); if (!Number.isFinite(n)) return false;
      return (f.min == null || n >= f.min) && (f.max == null || n <= f.max);
    }
    if (c.kind === 'date') {
      const d = dayOf(v); if (!d) return false;
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    }
    const s = v == null ? '' : String(v);
    if (f.values?.length && !f.values.includes(s)) return false;
    if (f.contains && !plain(s).includes(plain(f.contains))) return false;
    return true;
  }));
}

/** The values of one column with how many rows have each. */
export function optionsFrom<T>(rows: T[], value: (row: T) => unknown, label?: (v: string) => string): FilterOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) { const v = value(r); const s = v == null ? '' : String(v); counts.set(s, (counts.get(s) || 0) + 1); }
  return [...counts.entries()].map(([v, count]) => ({ value: v, label: label ? label(v) : v, count }))
    .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : (a.label || a.value).localeCompare(b.label || b.value, undefined, { numeric: true })));
}

// --- Icons ---------------------------------------------------------------------------------

export function SortIcon({ dir }: { dir?: 'asc' | 'desc' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M8 9l4-4 4 4" opacity={dir === 'desc' ? 0.35 : 1} /><path d="M16 15l-4 4-4-4" opacity={dir === 'asc' ? 0.35 : 1} />
    </svg>
  );
}
export function FunnelIcon({ on }: { on?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </svg>
  );
}

// --- Popover shell -------------------------------------------------------------------------

function Popover({ anchor, width, label, onClose, children }: { anchor: HTMLElement; width: number; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 4;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 16));
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!t.isConnected || ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} style={{ ...pop.box, top, left, width, maxWidth: 'calc(100vw - 32px)', maxHeight: `${Math.max(280, window.innerHeight - top - 16)}px` }}>
      {children}
    </div>,
    document.body,
  );
}

// --- Values filter -------------------------------------------------------------------------

export function ValuesFilter({ anchor, title, current, loadOptions, onApply, onClose }: {
  anchor: HTMLElement; title: string; current?: ColumnFilter;
  loadOptions: () => Promise<FilterOption[]> | FilterOption[];
  onApply: (f: ColumnFilter | undefined) => void; onClose: () => void;
}) {
  const [options, setOptions] = useState<FilterOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve(loadOptions()).then((opts) => {
      if (!live) return;
      setOptions(opts);
      // Nothing chosen yet means everything is shown: all ticked.
      setSel(new Set(current?.values?.length ? current.values : opts.map((o) => o.value)));
    }).catch(() => { if (live) { setFailed(true); setOptions([]); setSel(new Set()); } });
    setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 0);
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (options || []).filter((o) => plain(o.label || o.value || '(empty)').includes(plain(q))), [options, q]);
  const all = options ? options.length : 0;
  const toggle = (v: string) => setSel((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  const apply = () => {
    if (!sel) return;
    const values = sel.size === all ? undefined : [...sel];
    const next: ColumnFilter = { ...(values ? { values } : {}), ...(current?.contains ? { contains: current.contains } : {}) };
    onApply(isFilterOn(next) ? next : undefined);
  };

  return (
    <Popover anchor={anchor} width={290} label={`Filter ${title}`} onClose={onClose}>
      <div style={pop.vals}>
        <strong style={pop.title}>Filter {title}</strong>
        <input ref={searchRef} type="search" style={pop.input} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={options ? `Type to search ${all} value${all === 1 ? '' : 's'}` : 'Loading values…'} aria-label="Search values" />
        <div style={pop.quick}>
          <button type="button" style={pop.chip} onClick={() => setSel(new Set((options || []).map((o) => o.value)))}>Select all</button>
          <button type="button" style={pop.chip} onClick={() => setSel(new Set())}>Unselect all</button>
        </div>
        <div style={pop.list} role="group" aria-label={`${title} values`}>
          {options === null && <div style={pop.none}>Loading…</div>}
          {failed && <div style={pop.none}>The values could not be loaded.</div>}
          {options !== null && !failed && shown.length === 0 && <div style={pop.none}>No value matches. Use “Contains” to filter by part of a value.</div>}
          {shown.map((o) => (
            <label key={o.value} style={pop.row}>
              <input type="checkbox" checked={!!sel?.has(o.value)} onChange={() => toggle(o.value)} />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{o.value === '' ? <em>(empty)</em> : (o.label || o.value)}</span>
              {o.count !== undefined && <span style={pop.count}>{o.count}</span>}
            </label>
          ))}
        </div>
        {(q || current?.contains) && (
          <div style={pop.contains}>
            {q
              ? <>Or filter by part of a value: <button type="button" style={pop.textBtn} onClick={() => onApply({ contains: q })}>Contains “{q}”</button></>
              : <>Contains “{current?.contains}” is on.</>}
          </div>
        )}
        <div style={pop.foot}>
          {/* Clear sits with Cancel and Apply, as a button like them (David, 2026-11-04). */}
          <button type="button" style={{ ...pop.btn, marginLeft: 'auto' }} onClick={() => onApply(undefined)}>Clear</button>
          <button type="button" style={pop.btn} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...pop.btn, ...pop.primary, ...(sel && sel.size === 0 ? pop.disabled : {}) }} disabled={!sel || sel.size === 0} onClick={apply}
            title={sel && sel.size === 0 ? 'Tick at least one value' : undefined}>Apply</button>
        </div>
      </div>
    </Popover>
  );
}

// --- Date range filter ---------------------------------------------------------------------

const DAY = 86400000;
const toDay = (t: number) => dayOf(t)!;
const fromDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getTime(); };
const monthStart = (t: number, add = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + add, 1).getTime(); };
const showDay = (d: string) => new Date(fromDay(d)).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const dmy = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const parseDmy = (s: string): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim()); if (!m) return null;
  const t = new Date(+m[3], +m[2] - 1, +m[1]); return t.getMonth() === +m[2] - 1 ? toDay(t.getTime()) : null;
};

export function DateFilter({ anchor, title, current, countFor, onApply, onClose }: {
  anchor: HTMLElement; title: string; current?: ColumnFilter;
  /** How many rows a range would match, when the table can tell (rows it holds). */
  countFor?: (from: string | null, to: string | null) => number | null;
  onApply: (f: ColumnFilter | undefined) => void; onClose: () => void;
}) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const presets: Array<[string, () => [number, number]]> = [
    ['Today', () => [today, today]], ['Yesterday', () => [today - DAY, today - DAY]],
    ['Last 7 days', () => [today - 6 * DAY, today]], ['Last 30 days', () => [today - 29 * DAY, today]],
    ['This month', () => [monthStart(today), today]], ['Last month', () => [monthStart(today, -1), monthStart(today) - DAY]],
  ];
  const [from, setFrom] = useState<string | null>(current?.from || null);
  const [to, setTo] = useState<string | null>(current?.to || null);
  // A range that is one of the quick ranges opens showing it (e.g. "This month"), not "Custom range".
  const [preset, setPreset] = useState<string | null>(() => {
    if (!current?.from) return null;
    const end = current.to || current.from;
    return presets.find(([, range]) => { const [x, y] = range(); return toDay(x) === current.from && toDay(y) === end; })?.[0] ?? null;
  });
  const [view, setView] = useState(monthStart(to ? fromDay(to) : today, -1));
  const [typedFrom, setTypedFrom] = useState(from ? dmy(from) : '');
  const [typedTo, setTypedTo] = useState(to ? dmy(to) : '');
  const [bad, setBad] = useState<'from' | 'to' | null>(null);
  useEffect(() => { setTypedFrom(from ? dmy(from) : ''); setTypedTo(to ? dmy(to) : from ? dmy(from) : ''); }, [from, to]);

  const pick = (d: string) => {
    setPreset(null);
    if (!from || (to && to !== from)) { setFrom(d); setTo(null); }
    else if (d < from) { setTo(from); setFrom(d); } else setTo(d);
  };
  const typed = (which: 'from' | 'to', text: string) => {
    if (!text.trim()) { if (which === 'from') { setFrom(null); setTo(null); } else setTo(null); setBad(null); return; }
    const d = parseDmy(text); if (!d) { setBad(which); return; }
    setBad(null); setPreset(null);
    if (which === 'from') { setFrom(d); if (to && to < d) setTo(d); } else { setTo(d); if (!from || from > d) setFrom(d); }
    setView(monthStart(fromDay(d), which === 'from' ? 0 : -1));
  };
  const end = to || from;
  const count = countFor ? countFor(from, end) : null;
  const summary = !from ? 'Any date' : preset || (end && end !== from ? `${showDay(from)} – ${showDay(end)}` : showDay(from));

  const month = (start: number, side: 'left' | 'right') => {
    const d0 = new Date(start); const blanks = (d0.getDay() + 6) % 7; const n = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
    const cells: ReactNode[] = [];
    for (let i = 0; i < blanks; i++) cells.push(<span key={`b${i}`} />);
    for (let i = 1; i <= n; i++) {
      const d = toDay(new Date(d0.getFullYear(), d0.getMonth(), i).getTime());
      const isStart = d === from; const isEnd = !!end && d === end && !!from;
      const inRange = !!from && !!end && d > from && d < end;
      cells.push(
        <button key={d} type="button" onClick={() => pick(d)} aria-label={showDay(d)} aria-pressed={isStart || isEnd}
          style={{ ...pop.day, ...(inRange ? pop.dayIn : {}), ...(isStart || isEnd ? pop.daySel : {}),
            borderRadius: isStart && isEnd ? 16 : isStart ? '16px 0 0 16px' : isEnd ? '0 16px 16px 0' : 0,
            ...(d === toDay(today) ? { textDecoration: 'underline', textUnderlineOffset: 3 } : {}) }}>{i}</button>,
      );
    }
    return (
      <div style={{ minWidth: 0 }}>
        <div style={pop.mhead}>
          {side === 'left' ? <button type="button" style={pop.nav} aria-label="Previous month" onClick={() => setView(monthStart(view, -1))}>‹</button> : <span style={{ width: 28 }} />}
          <strong style={{ flex: 1, textAlign: 'center' }}>{d0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
          {side === 'right' ? <button type="button" style={pop.nav} aria-label="Next month" onClick={() => setView(monthStart(view, 1))}>›</button> : <span style={{ width: 28 }} />}
        </div>
        <div style={pop.dow}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => <span key={x}>{x}</span>)}</div>
        <div style={pop.grid}>{cells}</div>
      </div>
    );
  };

  return (
    <Popover anchor={anchor} width={680} label={`Filter ${title}`} onClose={onClose}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <nav aria-label="Quick ranges" style={pop.presets}>
          {presets.map(([label, range]) => (
            <button key={label} type="button" style={{ ...pop.preset, ...(preset === label ? pop.presetOn : {}) }}
              onClick={() => { const [a, b] = range(); setFrom(toDay(a)); setTo(toDay(b)); setPreset(label); setView(monthStart(b, -1)); }}>{label}</button>
          ))}
          <button type="button" style={{ ...pop.preset, ...(from && !preset ? pop.presetOn : {}) }} onClick={() => setPreset(null)}>Custom range</button>
        </nav>
        <div style={{ flex: '1 1 380px', minWidth: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <label style={pop.fld}>From
              <input style={{ ...pop.input, ...(bad === 'from' ? pop.inputBad : {}) }} placeholder="dd/mm/yyyy" value={typedFrom}
                onChange={(e) => setTypedFrom(e.target.value)} onBlur={(e) => typed('from', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') typed('from', (e.target as HTMLInputElement).value); }} />
            </label>
            <label style={pop.fld}>To
              <input style={{ ...pop.input, ...(bad === 'to' ? pop.inputBad : {}) }} placeholder="dd/mm/yyyy" value={typedTo}
                onChange={(e) => setTypedTo(e.target.value)} onBlur={(e) => typed('to', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') typed('to', (e.target as HTMLInputElement).value); }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
            {month(view, 'left')}
            {month(monthStart(view, 1), 'right')}
          </div>
        </div>
      </div>
      <div style={{ ...pop.foot, borderTop: '1px solid var(--color-border)', padding: '10px 14px' }}>
        <span style={{ marginRight: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
          {summary}{count !== null ? ` · ${count} ${count === 1 ? 'row' : 'rows'}` : ''}
        </span>
        <button type="button" style={pop.btn} onClick={() => { setFrom(null); setTo(null); setPreset(null); }}>Clear</button>
        <button type="button" style={pop.btn} onClick={onClose}>Cancel</button>
        <button type="button" style={{ ...pop.btn, ...pop.primary }} onClick={() => onApply(from ? { from, to: end || from } : undefined)}>Apply</button>
      </div>
    </Popover>
  );
}

const pop: Record<string, React.CSSProperties> = {
  box: { position: 'fixed', zIndex: 1000, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 12px 32px rgba(10, 20, 50, 0.18)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', overflow: 'auto', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, textAlign: 'left' },
  vals: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  title: { fontSize: 'var(--font-size-sm)' },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '7px 10px', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', background: 'var(--color-background)', color: 'var(--color-text)' },
  inputBad: { borderColor: 'var(--color-error)' },
  quick: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { border: '1px solid var(--color-border)', background: 'var(--color-background)', color: 'var(--color-text)', borderRadius: 999, padding: '4px 10px', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)', fontWeight: 600, cursor: 'pointer' },
  list: { maxHeight: 240, minHeight: 60, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 0' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 'var(--font-size-sm)', cursor: 'pointer' },
  count: { marginLeft: 'auto', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', fontVariantNumeric: 'tabular-nums' },
  none: { padding: '8px 10px', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  contains: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  textBtn: { border: 0, background: 'none', color: 'var(--color-primary)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)', fontWeight: 600, cursor: 'pointer', padding: 0 },
  foot: { display: 'flex', alignItems: 'center', gap: 8 },
  btn: { border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 999, padding: '6px 14px', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-xs)', fontWeight: 600, cursor: 'pointer' },
  primary: { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-text-inverse, #fff)' },
  disabled: { opacity: 0.45, cursor: 'not-allowed' },
  presets: { display: 'flex', flexDirection: 'column', gap: 2, padding: 10, borderRight: '1px solid var(--color-border)', width: 150, flexShrink: 0 },
  preset: { border: 0, background: 'none', textAlign: 'left', padding: '7px 10px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  presetOn: { background: 'var(--color-surface-hover)', color: 'var(--color-primary)', fontWeight: 700 },
  fld: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', minWidth: 0 },
  mhead: { display: 'flex', alignItems: 'center', fontSize: 'var(--font-size-sm)' },
  nav: { border: 0, background: 'none', width: 28, height: 28, borderRadius: 'var(--radius-md)', fontSize: 18, fontWeight: 700, color: 'var(--color-text-secondary)', cursor: 'pointer' },
  dow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '6px 0 2px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', rowGap: 2, textAlign: 'center' },
  day: { height: 32, border: 0, background: 'none', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
  dayIn: { background: 'var(--color-surface-hover)' },
  daySel: { background: 'var(--color-primary)', color: 'var(--color-text-inverse, #fff)', fontWeight: 700 },
};

// --- Amount filter (slider over a bar chart) -----------------------------------------------

const BINS = 14;
/** A number with up to two decimals, as people read it (7.5, not 7.50). */
const plainNumber = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
/** What a typed number means ('' = no limit, null = not a number), times `scale` (100 for cents). */
const parseNumber = (s: string, scale: number): number | null | undefined => {
  const t = s.trim().replace(/[^\d,.\-−]/g, '').replace('−', '-').replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * scale * 100) / 100 : null;
};

/**
 * Number filter (David, 2026-11-02, decision 7 option C, and 7b for every number column): a bar
 * chart of how the column's values spread, two handles to drag, and From / To boxes. Money is kept
 * in cents and shown in the currency; other numbers in their `unit` (stored value / `scale`, e.g. a
 * tax rate in basis points shown as %). Apply keeps rows from `min` to `max` (either may be open).
 */
export function AmountFilter({ anchor, title, current, loadOptions, onApply, onClose, money: isMoney = true, unit, scale: scaleProp }: {
  anchor: HTMLElement; title: string; current?: ColumnFilter;
  loadOptions: () => Promise<FilterOption[]> | FilterOption[];
  onApply: (f: ColumnFilter | undefined) => void; onClose: () => void;
  /** Money in cents (the default) or a plain number. */
  money?: boolean;
  /** The unit a plain number is shown in (e.g. 'h', 'min', '%'). */
  unit?: string;
  /** Stored value per shown unit: 100 for cents (money) or basis points; 1 for plain numbers. */
  scale?: number;
}) {
  const scale = scaleProp ?? (isMoney ? 100 : 1);
  const shown = (v: number) => (isMoney ? formatCurrency(Math.round(v)) : `${plainNumber(v / scale)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`);
  const typedText = (v: number) => (isMoney ? (v / scale).toFixed(2) : String(Math.round((v / scale) * 100) / 100));
  const boxUnit = isMoney ? getCurrencySymbol() : unit;
  const [points, setPoints] = useState<Array<{ v: number; n: number }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [min, setMin] = useState<number | undefined>(current?.min);
  const [max, setMax] = useState<number | undefined>(current?.max);
  const [typedMin, setTypedMin] = useState(current?.min != null ? typedText(current.min) : '');
  const [typedMax, setTypedMax] = useState(current?.max != null ? typedText(current.max) : '');
  const [bad, setBad] = useState<'min' | 'max' | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve(loadOptions()).then((opts) => {
      if (!live) return;
      setPoints(opts.map((o) => ({ v: Number(o.value), n: o.count ?? 1 })).filter((p) => o_ok(p.v)));
    }).catch(() => { if (live) { setFailed(true); setPoints([]); } });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The range the handles move over: the lowest to the highest value, in whole units.
  const lo = points && points.length ? Math.floor(Math.min(...points.map((p) => p.v)) / scale) * scale : 0;
  const hi = points && points.length ? Math.max(Math.ceil(Math.max(...points.map((p) => p.v)) / scale) * scale, lo + scale) : scale;
  const step = (hi - lo) / BINS;
  const bins = useMemo(() => {
    const b = new Array(BINS).fill(0);
    for (const p of points || []) b[Math.min(BINS - 1, Math.max(0, Math.floor((p.v - lo) / step)))] += p.n;
    return b;
  }, [points, lo, step]);
  const top = Math.max(1, ...bins);
  const a = min ?? lo;
  const b = max ?? hi;
  const total = (points || []).reduce((s, p) => s + p.n, 0);
  const inRange = (points || []).reduce((s, p) => s + ((min == null || p.v >= min) && (max == null || p.v <= max) ? p.n : 0), 0);

  // A handle at the end of the range means "no limit" on that side.
  const slide = (which: 'min' | 'max', raw: number) => {
    setBad(null);
    if (which === 'min') { const v = Math.min(raw, b); const open = v <= lo; setMin(open ? undefined : v); setTypedMin(open ? '' : typedText(v)); }
    else { const v = Math.max(raw, a); const open = v >= hi; setMax(open ? undefined : v); setTypedMax(open ? '' : typedText(v)); }
  };
  const typed = (which: 'min' | 'max', text: string) => {
    const v = parseNumber(text, scale);
    if (v === null) { setBad(which); return; }
    setBad(null);
    if (which === 'min') setMin(v); else setMax(v);
  };
  const apply = () => {
    let lower = min; let upper = max;
    if (lower != null && upper != null && lower > upper) [lower, upper] = [upper, lower];
    onApply(lower == null && upper == null ? undefined : { ...(lower != null ? { min: lower } : {}), ...(upper != null ? { max: upper } : {}) });
  };
  const summary = min == null && max == null ? (isMoney ? 'Any amount' : 'Any value') : min == null ? `Up to ${shown(max!)}` : max == null ? `From ${shown(min)}` : `${shown(min)} – ${shown(max)}`;

  return (
    <Popover anchor={anchor} width={360} label={`Filter ${title}`} onClose={onClose}>
      <div style={pop.vals}>
        <strong style={pop.title}>Filter {title}</strong>
        {points === null && <div style={pop.none}>Loading…</div>}
        {failed && <div style={pop.none}>The values could not be loaded.</div>}
        {points !== null && !failed && (
          <>
            <div style={amt.hist} aria-hidden="true">
              {bins.map((n, i) => {
                const x0 = lo + i * step; const x1 = x0 + step;
                return <span key={i} style={{ ...amt.bar, height: n ? 8 + 40 * (n / top) : 2, background: x1 > a && x0 < b ? 'var(--color-primary)' : 'var(--color-border)' }} />;
              })}
            </div>
            <div style={amt.dual}>
              <div style={amt.track} />
              <input type="range" className="ds-amount-range" min={lo} max={hi} step={scale / 100} value={a} aria-label={`Lowest ${title}`}
                onChange={(e) => slide('min', Number(e.target.value))} style={amt.range} />
              <input type="range" className="ds-amount-range" min={lo} max={hi} step={scale / 100} value={b} aria-label={`Highest ${title}`}
                onChange={(e) => slide('max', Number(e.target.value))} style={amt.range} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <label style={pop.fld}>From{boxUnit ? ` (${boxUnit})` : ''}
                <input style={{ ...pop.input, ...(bad === 'min' ? pop.inputBad : {}) }} inputMode="decimal" placeholder={shown(lo)} value={typedMin}
                  onChange={(e) => { setTypedMin(e.target.value); typed('min', e.target.value); }} />
              </label>
              <label style={pop.fld}>To{boxUnit ? ` (${boxUnit})` : ''}
                <input style={{ ...pop.input, ...(bad === 'max' ? pop.inputBad : {}) }} inputMode="decimal" placeholder={shown(hi)} value={typedMax}
                  onChange={(e) => { setTypedMax(e.target.value); typed('max', e.target.value); }} />
              </label>
            </div>
          </>
        )}
        <div style={pop.foot}>
          <span style={{ marginRight: 'auto', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            {summary}{points ? ` · ${inRange} of ${total}` : ''}
          </span>
          <button type="button" style={pop.btn} onClick={() => { setMin(undefined); setMax(undefined); setTypedMin(''); setTypedMax(''); setBad(null); }}>Clear</button>
          <button type="button" style={pop.btn} onClick={onClose}>Cancel</button>
          <button type="button" style={{ ...pop.btn, ...pop.primary, ...(bad ? pop.disabled : {}) }} disabled={!!bad} onClick={apply}>Apply</button>
        </div>
      </div>
    </Popover>
  );
}
const o_ok = (v: number) => Number.isFinite(v);

const amt: Record<string, React.CSSProperties> = {
  hist: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 50 },
  bar: { flex: 1, borderRadius: '2px 2px 0 0', minWidth: 0 },
  dual: { position: 'relative', height: 22 },
  track: { position: 'absolute', left: 0, right: 0, top: 9, height: 4, borderRadius: 2, background: 'var(--color-border)' },
  range: { position: 'absolute', inset: 0, width: '100%', margin: 0, background: 'none', pointerEvents: 'none', WebkitAppearance: 'none', appearance: 'none' },
};
