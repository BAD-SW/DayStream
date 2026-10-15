import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { CurrencyInput } from '../components/CurrencyInput';
import * as payApi from '../api/payments';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', depleted: 'neutral', expired: 'warning', void: 'error',
};

/**
 * Gift card administration (spec 10, C7). Lists issued gift cards, shows balance +
 * redemption history, and allows issuing a card directly (comp/manual) or voiding
 * one. The normal way to SELL a gift card is through checkout (it funds a liability);
 * the "Issue" action here is for comps/manual issuance.
 */
export function GiftCards() {
  const businessId = localStorage.getItem('business_id') || '';
  const [cards, setCards] = useState<payApi.GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showIssue, setShowIssue] = useState(false);
  const [detail, setDetail] = useState<payApi.GiftCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCards(await payApi.listGiftCards(businessId, statusFilter || undefined)); }
    catch { setCards([]); }
    finally { setLoading(false); }
  }, [businessId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try { setDetail(await payApi.getGiftCard(id, businessId)); }
    catch { setMessage('Failed to load gift card.'); }
  };

  const voidCard = async (id: string) => {
    if (!confirm('Void this gift card? Its remaining balance will no longer be redeemable.')) return;
    try { await payApi.voidGiftCard(id, businessId); setMessage('Gift card voided.'); await load(); }
    catch (e: any) { setMessage(e?.response?.data?.error || 'Failed to void gift card.'); }
  };

  const resendEmail = async (id: string) => {
    try { await payApi.emailGiftCard(id, businessId); setMessage('Gift card email queued.'); }
    catch (e: any) { setMessage(e?.response?.data?.error || 'No recipient email on this card.'); }
  };

  const columns = [
    { key: 'code', header: 'Code', render: (_v: any, c: payApi.GiftCard) => <span style={{ fontFamily: 'var(--font-family-mono, monospace)' }}>{c.code}</span> },
    { key: 'balance', header: 'Balance', render: (_v: any, c: payApi.GiftCard) => `${formatCurrency(c.balance_cents, c.currency)} of ${formatCurrency(c.initial_amount_cents, c.currency)}` },
    { key: 'recipient', header: 'Recipient', render: (_v: any, c: payApi.GiftCard) => c.recipient_name || c.recipient_email || '—' },
    { key: 'expires', header: 'Expires', render: (_v: any, c: payApi.GiftCard) => (c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never') },
    { key: 'status', header: 'Status', render: (_v: any, c: payApi.GiftCard) => <Badge variant={STATUS_VARIANT[c.status] || 'neutral'}>{c.status}</Badge> },
    {
      key: 'actions', header: '', align: 'right' as const, render: (_v: any, c: payApi.GiftCard) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="secondary" onClick={() => openDetail(c.id)}>Details</Button>
          {c.recipient_email && <Button size="sm" variant="secondary" onClick={() => resendEmail(c.id)}>Email</Button>}
          {c.status === 'active' && <Button size="sm" variant="destructive" onClick={() => voidCard(c.id)}>Void</Button>}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <PageHeader title="Gift Cards" subtitle="Issued gift cards, balances, and redemption history" />

      {message && (
        <p style={{ fontSize: 'var(--font-size-sm)', color: message.toLowerCase().includes('fail') || message.toLowerCase().includes('no ') ? 'var(--color-error)' : 'var(--color-success)', marginBottom: 'var(--space-md)' }}>{message}</p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-md)' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="depleted">Depleted</option>
          <option value="expired">Expired</option>
          <option value="void">Void</option>
        </select>
        <Button onClick={() => setShowIssue(true)}>Issue Gift Card</Button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading gift cards…</p>
      ) : cards.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>No gift cards yet. Sell one through checkout, or issue one here.</p>
      ) : (
        <Table columns={columns} data={cards} rowId={(c: payApi.GiftCard) => c.id} />
      )}

      {showIssue && (
        <IssueGiftCardModal
          businessId={businessId}
          onClose={() => setShowIssue(false)}
          onIssued={(code) => { setShowIssue(false); setMessage(`Gift card issued: ${code}`); load(); }}
        />
      )}

      {detail && <GiftCardDetailModal card={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function IssueGiftCardModal({ businessId, onClose, onIssued }: {
  businessId: string; onClose: () => void; onIssued: (code: string) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    setBusy(true); setError(null);
    try {
      const card = await payApi.createGiftCard({
        business_id: businessId, amount,
        recipient_name: recipientName || null, recipient_email: recipientEmail || null,
        expires_at: expiresAt || null,
      });
      onIssued(card.code);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to issue gift card.');
    } finally { setBusy(false); }
  };

  const field: React.CSSProperties = { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%' };

  return (
    <Modal open onClose={onClose} title="Issue Gift Card"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={amount <= 0} onClick={submit}>Issue</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          Issuing here creates a card without taking payment (a comp or manual issuance). To SELL a gift card to a customer, add it as a line item at checkout.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Amount <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <CurrencyInput value={amount} onChange={setAmount} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Recipient name</label>
          <input style={field} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optional" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Recipient email</label>
          <input style={field} value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Optional — emails the code" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Expires</label>
          <input type="date" style={field} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

function GiftCardDetailModal({ card, onClose }: { card: payApi.GiftCard; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Gift Card ${card.code}`}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Balance</span>
          <strong>{formatCurrency(card.balance_cents, card.currency)} of {formatCurrency(card.initial_amount_cents, card.currency)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Status</span>
          <Badge variant={STATUS_VARIANT[card.status] || 'neutral'}>{card.status}</Badge>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>Redemption history</h4>
          {!card.redemptions || card.redemptions.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>No redemptions yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {card.redemptions.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--color-border)', padding: '4px 0' }}>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  <span>{formatCurrency(r.amount, r.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
