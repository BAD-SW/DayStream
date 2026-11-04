import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import * as inbox from '../src/services/inbox.service';

/**
 * Inbox (THE-18): one conversation per person, staff notified by role, internal notes and
 * mentions, assignment, the customer's own thread, unanswered reminders. Own business and users.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BIZ: string;
let OWNER: string; let FRONT: string; let THERAPIST: string;
let CUST: string;

async function user(email: string, role: string) {
  return (await adminPool.query(
    `INSERT INTO usr_users (tenant_id, business_id, email, first_name, last_name, password_hash, role, persona, status)
     VALUES ($1, $2, $3, $4, 'Inbox', 'x', $5, 'business', 'active') RETURNING id`,
    [TENANT_ID, BIZ, email, role, role],
  )).rows[0].id as string;
}

async function cleanup() {
  await adminPool.query('DELETE FROM inbox_conversations WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM usr_notifications WHERE business_id = $1', [BIZ]);
  await adminPool.query('DELETE FROM inbox_summary_log WHERE business_id = $1', [BIZ]);
  await adminPool.query(`DELETE FROM sys_business_configurations WHERE business_id = $1 AND key LIKE 'inbox.%'`, [BIZ]);
  await adminPool.query(`DELETE FROM usr_users WHERE business_id = $1 AND email LIKE '%@inbox-test.test'`, [BIZ]);
  await adminPool.query('DELETE FROM cus_customers WHERE business_id = $1', [BIZ]);
}

describe('Inbox (THE-18)', () => {
  beforeAll(async () => {
    BIZ = (await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Inbox Test Biz', 'inbox-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [TENANT_ID],
    )).rows[0].id;
    await cleanup();
    OWNER = await user('owner@inbox-test.test', 'business_owner');
    FRONT = await user('front@inbox-test.test', 'reception');
    THERAPIST = await user('therapist@inbox-test.test', 'therapist');
    CUST = (await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, first_name, last_name, email) VALUES ($1, $2, 'INB-1', 'Rosa', 'Test', 'rosa@inbox-test.test') RETURNING id`,
      [TENANT_ID, BIZ],
    )).rows[0].id;
  });
  afterAll(cleanup);

  const notes = async (userId: string) => (await adminPool.query('SELECT type, title FROM usr_notifications WHERE user_id = $1 ORDER BY created_at', [userId])).rows;

  it('gives roles their Inbox role; therapists have none', () => {
    expect(inbox.roleOf('business_owner')).toBe('owner');
    expect(inbox.roleOf('manager')).toBe('manager');
    expect(inbox.roleOf('reception')).toBe('front_desk');
    expect(inbox.roleOf('therapist')).toBe('staff');
  });

  it('opens one conversation per person; an inbound message is unread and tells owner and front desk, not the therapist', async () => {
    await inbox.receiveMessage({ businessId: BIZ, customerId: CUST, channel: 'in_app', body: 'Can I move my float to Thursday?' });
    await inbox.receiveMessage({ businessId: BIZ, customerId: CUST, channel: 'in_app', body: 'Afternoon if possible.' });
    const { rows } = await adminPool.query('SELECT * FROM inbox_conversations WHERE business_id = $1', [BIZ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unread: true, status: 'open', last_channel: 'in_app', last_preview: 'Afternoon if possible.' });
    expect((await notes(OWNER)).map((n) => n.type)).toContain('inbox.new_unassigned');
    expect((await notes(FRONT)).map((n) => n.type)).toContain('inbox.new_unassigned');
    expect(await notes(THERAPIST)).toEqual([]);
  });

  it('lists conversations by view and finds them by message text', async () => {
    const open = await inbox.listConversations(BIZ, { view: 'open', userId: OWNER });
    expect(open.conversations).toHaveLength(1);
    expect(open.counts).toMatchObject({ open: 1, unassigned: 1, mine: 0, unread: 1 });
    expect((await inbox.listConversations(BIZ, { view: 'open', search: 'thursday', userId: OWNER })).conversations).toHaveLength(1);
    expect((await inbox.listConversations(BIZ, { view: 'open', search: 'nothing like this', userId: OWNER })).conversations).toHaveLength(0);
  });

  it('assigns to front desk (who is told) and refuses a therapist', async () => {
    const conv = (await inbox.listConversations(BIZ, { userId: OWNER })).conversations[0];
    await expect(inbox.assign(conv.id, BIZ, THERAPIST, OWNER)).rejects.toThrow('Inbox');
    const after = await inbox.assign(conv.id, BIZ, FRONT, OWNER);
    expect(after!.assignee_user_id).toBe(FRONT);
    expect((await notes(FRONT)).map((n) => n.type)).toContain('inbox.assigned_to_me');
    expect(after!.messages.some((m: any) => m.direction === 'event' && m.body.includes('Assigned to'))).toBe(true);
  });

  it('a reply on the in-app channel clears unread; an internal note mentions and tells only that person; the customer never sees notes', async () => {
    const conv = (await inbox.listConversations(BIZ, { userId: OWNER })).conversations[0];
    await inbox.sendMessage({ conversationId: conv.id, businessId: BIZ, userId: FRONT, channel: 'in_app', body: 'Moved to Thursday 17:00.' });
    await inbox.sendMessage({ conversationId: conv.id, businessId: BIZ, userId: FRONT, channel: 'internal', body: 'Room 2 is free', mentions: [OWNER] });
    const c = await inbox.getConversation(conv.id, BIZ);
    expect(c!.unread).toBe(false);
    expect((await notes(OWNER)).map((n) => n.type)).toContain('inbox.mentioned');
    const thread = await inbox.customerThread(BIZ, CUST);
    expect(thread.map((m: any) => m.body)).toEqual(['Can I move my float to Thursday?', 'Afternoon if possible.', 'Moved to Thursday 17:00.']);
  });

  it('refuses SMS (not connected) and an email without a subject', async () => {
    const conv = (await inbox.listConversations(BIZ, { userId: OWNER })).conversations[0];
    await expect(inbox.sendMessage({ conversationId: conv.id, businessId: BIZ, userId: FRONT, channel: 'sms', body: 'Hi' })).rejects.toThrow('not connected');
    await expect(inbox.sendMessage({ conversationId: conv.id, businessId: BIZ, userId: FRONT, channel: 'email', body: 'Hi' })).rejects.toThrow('subject');
  });

  it('marks done and reopens when the person writes again; a new message goes to the assignee', async () => {
    const conv = (await inbox.listConversations(BIZ, { userId: OWNER })).conversations[0];
    await inbox.setStatus(conv.id, BIZ, 'closed', FRONT);
    expect((await inbox.listConversations(BIZ, { view: 'open', userId: OWNER })).conversations).toHaveLength(0);
    await adminPool.query('DELETE FROM usr_notifications WHERE business_id = $1', [BIZ]);
    await inbox.receiveMessage({ businessId: BIZ, customerId: CUST, channel: 'in_app', body: 'Thanks!' });
    expect((await inbox.getConversation(conv.id, BIZ))!.status).toBe('open');
    expect((await notes(FRONT)).map((n) => n.type)).toEqual(['inbox.assigned_message']);
    expect(await notes(OWNER)).toEqual([]);
  });

  it('respects the business settings and each user’s own switches', async () => {
    await inbox.setNotificationSettings(BIZ, OWNER, { events: { assigned_message: { roles: { owner: true, manager: true, front_desk: true, staff: true }, in_app: false, email: false } } as any });
    await adminPool.query('DELETE FROM usr_notifications WHERE business_id = $1', [BIZ]);
    await inbox.receiveMessage({ businessId: BIZ, customerId: CUST, channel: 'in_app', body: 'One more thing' });
    expect(await notes(FRONT)).toEqual([]);
    await inbox.setNotificationSettings(BIZ, OWNER, { events: { assigned_message: { in_app: true, email: false } } as any });
    await inbox.setUserPrefs(FRONT, { assigned_message: { in_app: false, email: false } });
    await inbox.receiveMessage({ businessId: BIZ, customerId: CUST, channel: 'in_app', body: 'And another' });
    expect(await notes(FRONT)).toEqual([]);
    // Mentions and assignments cannot be switched off in-app.
    expect((await inbox.setUserPrefs(FRONT, { mentioned: { in_app: false, email: false } })).mentioned.in_app).toBe(true);
  });

  it('reports a conversation unanswered for more than the set hours, once', async () => {
    // By default it is an email; switched to in-app here so the test can read it.
    await inbox.setNotificationSettings(BIZ, OWNER, { unanswered_hours: 2, events: { unanswered: { in_app: true } } as any });
    await adminPool.query(`UPDATE inbox_conversations SET last_inbound_at = NOW() - INTERVAL '3 hours', last_outbound_at = NOW() - INTERVAL '5 hours', reminded_at = NULL WHERE business_id = $1`, [BIZ]);
    await adminPool.query('DELETE FROM usr_notifications WHERE business_id = $1', [BIZ]);
    await inbox.runReminders();
    expect((await notes(OWNER)).filter((n) => n.type === 'inbox.unanswered')).toHaveLength(1);
    await inbox.runReminders();
    expect((await notes(OWNER)).filter((n) => n.type === 'inbox.unanswered')).toHaveLength(1);
    expect((await notes(FRONT)).filter((n) => n.type === 'inbox.unanswered')).toHaveLength(0);
  });
});
