import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import { Icon } from '../design-system/components/icons/Icon';
import * as inboxApi from '../api/inbox';
import { getSegments } from '../api/customers';
import type { Segment } from '../api/customers';
import './Inbox.css';

/**
 * Inbox (THE-18, option A): conversations on the left, the open conversation in the middle, the
 * person's details on the right. The right pane can be collapsed; only the middle pane then grows
 * (David, 2026-11-04). Views: Open, Mine, Unassigned, Done; search; segments; channel; unread.
 */

const VIEWS: { key: 'open' | 'mine' | 'unassigned' | 'closed'; label: string; count?: 'open' | 'mine' | 'unassigned' }[] = [
  { key: 'open', label: 'Open', count: 'open' }, { key: 'mine', label: 'Mine', count: 'mine' },
  { key: 'unassigned', label: 'Unassigned', count: 'unassigned' }, { key: 'closed', label: 'Done' },
];
const CHANNEL_LABEL: Record<string, string> = { email: 'Email', in_app: 'In-app', sms: 'SMS', whatsapp: 'WhatsApp', internal: 'Note' };
const STAGE_LABEL: Record<string, string> = { lead: 'Lead', trial: 'New customer', active: 'Active customer', at_risk: 'At risk', churned: 'Former customer', winback: 'Won back' };
const PANE_KEY = 'ds_inbox_person_pane';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const when = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Inbox() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<typeof VIEWS[number]['key']>('open');
  const [search, setSearch] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [channel, setChannel] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [list, setList] = useState<inboxApi.ConversationRow[]>([]);
  const [counts, setCounts] = useState({ open: 0, mine: 0, unassigned: 0, unread: 0 });
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<{ role: inboxApi.InboxRole; channels: inboxApi.InboxChannel[] } | null>(null);
  const [denied, setDenied] = useState('');
  const selected = searchParams.get('c');
  const [personOpen, setPersonOpen] = useState(() => { try { return localStorage.getItem(PANE_KEY) !== 'closed'; } catch { return true; } });
  const togglePerson = () => setPersonOpen((o) => { try { localStorage.setItem(PANE_KEY, o ? 'closed' : 'open'); } catch { /* ignore */ } return !o; });

  useEffect(() => {
    inboxApi.getAccess().then(setAccess).catch((e) => setDenied(e?.response?.data?.error || 'The Inbox is not available.'));
    const biz = localStorage.getItem('business_id') || '';
    if (biz) getSegments(biz).then(setSegments).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await inboxApi.listConversations({ view, search: search.trim() || undefined, segment_id: segmentId || undefined, channel: channel || undefined, unread: unreadOnly || undefined });
      setList(r.conversations); setCounts(r.counts);
      window.dispatchEvent(new Event('inbox:changed')); // the menu's unread count follows
    } catch { /* keep what is shown */ } finally { setLoading(false); }
  }, [view, search, segmentId, channel, unreadOnly]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);
  // New messages show up without a reload.
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const select = (id: string | null) => setSearchParams(id ? { c: id } : {}, { replace: false });

  if (denied) return <div className="ibx-page"><h1 className="ibx-title">Inbox</h1><Alert variant="info">{denied}</Alert></div>;

  return (
    <div className="ibx-page">
      <div className="ibx-head">
        <h1 className="ibx-title">Inbox</h1>
        <div className="ibx-views" role="tablist" aria-label="Conversations">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} className={`ibx-pill${view === v.key ? ' is-on' : ''}`} onClick={() => { setView(v.key); setLoading(true); }}>
              {v.label}{v.count ? ` · ${counts[v.count]}` : ''}
            </button>
          ))}
        </div>
        <div className="ibx-filters">
          <input className="ibx-input" type="search" placeholder="Search names and messages…" aria-label="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="ibx-input" aria-label="Segment" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            <option value="">All people</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="ibx-input" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">All channels</option>
            <option value="email">Email</option><option value="in_app">In-app</option>
            <option value="sms" disabled>SMS (not connected)</option><option value="whatsapp" disabled>WhatsApp (not connected)</option>
          </select>
          <label className="ibx-check"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread</label>
        </div>
      </div>

      <div className={`ibx-panes${personOpen ? '' : ' is-person-closed'}`}>
        <aside className="ibx-list" aria-label="Conversations">
          {loading ? <p className="ibx-empty">Loading…</p> : list.length === 0 ? <p className="ibx-empty">No conversations here.</p> : list.map((c) => (
            <button key={c.id} className={`ibx-conv${c.id === selected ? ' is-sel' : ''}${c.unread ? ' is-unread' : ''}`} onClick={() => select(c.id)}>
              <span className="ibx-avatar" aria-hidden="true">{initials(c.name)}</span>
              <span className="ibx-conv__main">
                <span className="ibx-conv__top">
                  <b>{c.name}</b>
                  {c.last_channel && <span className="ibx-tag">{CHANNEL_LABEL[c.last_channel]}</span>}
                  {c.unread && <span className="ibx-dot" aria-label="unread" />}
                  <small>{when(c.last_message_at)}</small>
                </span>
                <span className="ibx-conv__preview">{c.last_preview || '—'}</span>
                {c.assignee_name && <span className="ibx-conv__who">{c.assignee_name}</span>}
              </span>
            </button>
          ))}
        </aside>
        {selected ? (
          <ConversationPane key={selected} id={selected} access={access} personOpen={personOpen} onTogglePerson={togglePerson} onChanged={load} onClose={() => select(null)} />
        ) : (
          <section className="ibx-thread ibx-thread--empty"><p>Choose a conversation.</p></section>
        )}
      </div>
    </div>
  );
}

function ConversationPane({ id, access, personOpen, onTogglePerson, onChanged, onClose }: {
  id: string; access: { role: inboxApi.InboxRole; channels: inboxApi.InboxChannel[] } | null; personOpen: boolean;
  onTogglePerson: () => void; onChanged: () => void; onClose: () => void;
}) {
  const [conv, setConv] = useState<inboxApi.Conversation | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState<inboxApi.InboxChannel | 'internal'>('in_app');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const [openAuto, setOpenAuto] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const draftKey = `ds_inbox_draft_${id}`;

  const load = useCallback(async () => {
    const c = await inboxApi.getConversation(id);
    setConv(c);
    onChanged();
    return c;
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load().then((c) => {
      // Reply on the channel the person last wrote on (in-app or email); email needs an address.
      const lastIn = [...c.messages].reverse().find((m) => m.direction === 'in');
      const ch = (lastIn?.channel as inboxApi.InboxChannel) || (c.person.email ? 'email' : 'in_app');
      setMode(ch === 'email' && !c.person.email ? 'in_app' : ch);
      const lastSubject = [...c.messages].reverse().find((m) => m.subject)?.subject;
      setSubject(lastSubject ? (lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`) : '');
    }).catch(() => setProblem('The conversation could not be loaded.'));
    inboxApi.getInboxUsers().then(setUsers).catch(() => {});
    try { setBody(localStorage.getItem(draftKey) || ''); } catch { /* ignore */ }
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages.length]);
  // An unsent reply is kept per conversation.
  useEffect(() => { try { if (body) localStorage.setItem(draftKey, body); else localStorage.removeItem(draftKey); } catch { /* ignore */ } }, [body, draftKey]);

  if (!conv) return <section className="ibx-thread ibx-thread--empty"><p>{problem || 'Loading…'}</p></section>;
  const p = conv.person;

  const send = async () => {
    setSending(true); setProblem('');
    try {
      await inboxApi.sendMessage(conv.id, { channel: mode, subject: mode === 'email' ? subject : undefined, body, mentions: mode === 'internal' ? mentions : undefined });
      setBody(''); setMentions([]);
      await load();
    } catch (e: any) { setProblem(e?.response?.data?.error || 'Not sent.'); }
    finally { setSending(false); }
  };
  const act = async (fn: () => Promise<any>) => { setProblem(''); try { const c = await fn(); if (c?.messages) setConv(c); onChanged(); } catch (e: any) { setProblem(e?.response?.data?.error || 'That did not work.'); } };
  const canSend = access && access.channels;
  const channelOk = (ch: inboxApi.InboxChannel) => (ch === 'email' ? !!p.email : ch === 'in_app');

  return (
    <>
      <section className="ibx-thread" aria-label={`Conversation with ${p.name}`}>
        <div className="ibx-thread__head">
          <button className="ibx-icon ibx-back" onClick={onClose} aria-label="Back to the list"><Icon name="ArrowLeft" size="sm" /></button>
          <b className="ibx-thread__name">{p.name}</b>
          <span className="ibx-tag">{STAGE_LABEL[p.lifecycle_stage] || p.lifecycle_stage}</span>
          <span className="ibx-spacer" />
          <select className="ibx-input ibx-input--sm" aria-label="Assigned to" value={conv.assignee_user_id || ''} onChange={(e) => act(() => inboxApi.assign(conv.id, e.target.value || null))}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => act(async () => { await inboxApi.markUnread(conv.id); onClose(); })}>Mark unread</Button>
          {conv.status === 'open'
            ? <Button size="sm" onClick={() => act(() => inboxApi.setStatus(conv.id, 'closed'))}>Mark done</Button>
            : <Button size="sm" variant="ghost" onClick={() => act(() => inboxApi.setStatus(conv.id, 'open'))}>Reopen</Button>}
          <button className="ibx-icon" onClick={onTogglePerson} aria-expanded={personOpen} aria-controls="ibx-person"
            aria-label={personOpen ? 'Hide the person’s details' : 'Show the person’s details'} title={personOpen ? 'Hide details' : 'Show details'}>
            <Icon name={personOpen ? 'PanelRightClose' : 'PanelRightOpen'} size="sm" />
          </button>
        </div>
        <div className="ibx-msgs">
          {conv.messages.length === 0 && <p className="ibx-empty">No messages yet. Write the first one below.</p>}
          {conv.messages.map((m) => {
            if (m.direction === 'event') return <div key={m.id} className="ibx-event">{m.body} · {m.sender_name} · {stamp(m.created_at)}</div>;
            if (m.direction === 'auto') {
              const open = openAuto === m.id;
              return (
                <button key={m.id} className="ibx-auto" onClick={() => setOpenAuto(open ? null : m.id)} aria-expanded={open}>
                  <span>Sent automatically · {CHANNEL_LABEL[m.channel]} · {m.subject || 'Message'} · {stamp(m.created_at)}</span>
                  {open && <span className="ibx-auto__body">{m.body}</span>}
                </button>
              );
            }
            const cls = m.direction === 'in' ? 'ibx-msg' : m.direction === 'note' ? 'ibx-msg ibx-msg--note' : 'ibx-msg ibx-msg--out';
            return (
              <div key={m.id} className={cls}>
                {m.subject && m.direction !== 'note' && <b className="ibx-msg__subject">{m.subject}</b>}
                <span className="ibx-msg__body">{m.body}</span>
                <small>
                  {m.direction === 'in' ? p.name : m.sender_name || 'Staff'} · {CHANNEL_LABEL[m.channel]} · {stamp(m.created_at)}
                  {m.direction === 'note' && ' · only staff see notes'}
                  {m.status === 'failed' && <span className="ibx-failed"> · not delivered: {m.failure_reason}</span>}
                </small>
              </div>
            );
          })}
          <div ref={end} />
        </div>
        {canSend && (
          <div className="ibx-compose">
            <div className="ibx-compose__modes" role="radiogroup" aria-label="Reply as">
              {(['email', 'in_app'] as inboxApi.InboxChannel[]).map((ch) => (
                <button key={ch} role="radio" aria-checked={mode === ch} disabled={!channelOk(ch)} title={!channelOk(ch) ? 'This person has no email address' : undefined}
                  className={`ibx-pill${mode === ch ? ' is-on' : ''}`} onClick={() => setMode(ch)}>Reply · {CHANNEL_LABEL[ch]}</button>
              ))}
              <button role="radio" aria-checked={mode === 'internal'} className={`ibx-pill ibx-pill--note${mode === 'internal' ? ' is-on' : ''}`} onClick={() => setMode('internal')}>Internal note</button>
              <span className="ibx-muted">SMS and WhatsApp: not connected</span>
            </div>
            {mode === 'email' && <input className="ibx-input" placeholder="Subject" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
            <textarea className="ibx-input ibx-compose__box" rows={3} aria-label={mode === 'internal' ? 'Internal note' : 'Reply'}
              placeholder={mode === 'internal' ? 'A note only staff see…' : `Write a reply by ${CHANNEL_LABEL[mode]}…`} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="ibx-compose__foot">
              {mode === 'internal' && (
                <select className="ibx-input ibx-input--sm" aria-label="Mention someone" value="" onChange={(e) => { const v = e.target.value; if (v && !mentions.includes(v)) setMentions([...mentions, v]); }}>
                  <option value="">@ Mention…</option>
                  {users.filter((u) => !mentions.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {mentions.map((uid) => <span key={uid} className="ibx-tag">@{users.find((u) => u.id === uid)?.name} <button className="ibx-x" aria-label="Remove mention" onClick={() => setMentions(mentions.filter((x) => x !== uid))}>✕</button></span>)}
              {problem && <span className="ibx-failed">{problem}</span>}
              <span className="ibx-spacer" />
              <Button size="sm" onClick={send} loading={sending} disabled={!body.trim() || (mode === 'email' && !subject.trim())}>{mode === 'internal' ? 'Add note' : 'Send'}</Button>
            </div>
          </div>
        )}
      </section>
      <aside id="ibx-person" className="ibx-person" hidden={!personOpen} aria-label="About this person">
        <PersonPane p={p} />
      </aside>
    </>
  );
}

function PersonPane({ p }: { p: inboxApi.PersonContext }) {
  const rows = useMemo(() => [
    ['Email', p.email || '—'], ['Phone', p.phone || '—'], ['Source', p.source || '—'], ['Staff member', p.owner_name || '—'],
    ['Next booking', p.next_booking ? `${stamp(p.next_booking.start_time)}${p.next_booking.service ? ` · ${p.next_booking.service}` : ''}` : '—'],
    ['Last visit', p.last_visit_at ? new Date(p.last_visit_at).toLocaleDateString() : '—'],
    ['Membership', p.memberships.length ? p.memberships.join(', ') : '—'],
    ['Tags', p.tags.length ? p.tags.join(', ') : '—'],
  ], [p]);
  return (
    <div className="ibx-person__inner">
      <span className="ibx-avatar ibx-avatar--lg" aria-hidden="true">{initials(p.name)}</span>
      <h3>{p.name}</h3>
      <span className="ibx-tag">{STAGE_LABEL[p.lifecycle_stage] || p.lifecycle_stage}</span>
      <dl className="ibx-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <Link className="ibx-link" to={`/customers/${p.id}`}>Open profile →</Link>
      <Link className="ibx-link" to={`/bookings/new?customer_id=${p.id}`}>New booking →</Link>
    </div>
  );
}
