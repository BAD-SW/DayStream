import { askConfirm } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { CurrencyInput } from '../components/CurrencyInput';
import * as payApi from '../api/payments';
import { formatCurrency } from '../utils/currency';
import { formatDate, formatDateTime } from '../utils/format';
import { useTranslation } from 'react-i18next';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', depleted: 'neutral', expired: 'warning', void: 'error',
};

/**
 * Gift card administration (spec 10, C7). Lists issued gift cards, shows balance +
 * redemption history, and allows issuing a card directly (comp/manual) or voiding
 * one. The normal way to SELL a gift card is through checkout (it funds a liability);
 * the t('giftCards.issue') action here is for comps/manual issuance.
 */
export function GiftCards() {
  const { t } = useTranslation('offerings');
  const businessId = localStorage.getItem('business_id') || '';
  const [cards, setCards] = useState<payApi.GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);
  const [detail, setDetail] = useState<payApi.GiftCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Every gift card: the Status column's filter replaces the menu above the table (column filters beside the sort icon, David 2026-11-02).
    try { setCards(await payApi.listGiftCards(businessId)); }
    catch { setCards([]); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const failureMessages = [t('giftCards.loadFailed'), t('giftCards.voidFailed'), t('giftCards.noRecipient')];
  const isFailure = (m: string) => failureMessages.includes(m) || m.toLowerCase().includes('fail') || m.toLowerCase().includes('no ');
  const openDetail = async (id: string) => {
    try { setDetail(await payApi.getGiftCard(id, businessId)); }
    catch { setMessage(t('giftCards.loadFailed')); }
  };

  const voidCard = async (id: string) => {
    if (!(await askConfirm({ message: t('giftCards.voidConfirm'), confirmLabel: t('common:action.void'), destructive: true }))) return;
    try { await payApi.voidGiftCard(id, businessId); setMessage(t('giftCards.voided')); await load(); }
    catch (e: any) { setMessage(e?.response?.data?.error || t('giftCards.voidFailed')); }
  };

  const resendEmail = async (id: string) => {
    try { await payApi.emailGiftCard(id, businessId); setMessage(t('giftCards.emailQueued')); }
    catch (e: any) { setMessage(e?.response?.data?.error || t('giftCards.noRecipient')); }
  };

  const columns = [
    { key: 'code', header: t('shared.code'), render: (_v: any, c: payApi.GiftCard) => <span style={{ fontFamily: 'var(--font-family-mono, monospace)' }}>{c.code}</span> },
    { key: 'balance', header: t('giftCards.balance'), filter: 'amount' as const, filterValue: (c: payApi.GiftCard) => c.balance_cents, render: (_v: any, c: payApi.GiftCard) => t('giftCards.balanceOf', { balance: formatCurrency(c.balance_cents, c.currency), total: formatCurrency(c.initial_amount_cents, c.currency) }) },
    { key: 'recipient', header: t('giftCards.recipient'), render: (_v: any, c: payApi.GiftCard) => c.recipient_name || c.recipient_email || '—' },
    { key: 'expires', header: t('giftCards.expires'), render: (_v: any, c: payApi.GiftCard) => (c.expires_at ? formatDate(c.expires_at) : t('packages.never')) },
    { key: 'status', header: t('shared.status'), render: (_v: any, c: payApi.GiftCard) => <Badge variant={STATUS_VARIANT[c.status] || 'neutral'}>{t(`giftCards.status.${c.status}`, { defaultValue: c.status })}</Badge> },
    {
      key: 'actions', header: '', align: 'right' as const, render: (_v: any, c: payApi.GiftCard) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="secondary" onClick={() => openDetail(c.id)}>{t('giftCards.details')}</Button>
          {c.recipient_email && <Button size="sm" variant="secondary" onClick={() => resendEmail(c.id)}>{t('giftCards.email')}</Button>}
          {c.status === 'active' && <Button size="sm" variant="destructive" onClick={() => voidCard(c.id)}>{t('giftCards.void')}</Button>}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <PageHeader title={t('giftCards.title')} subtitle={t('giftCards.subtitle')} />

      {message && (
        <p style={{ fontSize: 'var(--font-size-sm)', color: isFailure(message) ? 'var(--color-error)' : 'var(--color-success)', marginBottom: 'var(--space-md)' }}>{message}</p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-md)' }}>
        <Button onClick={() => setShowIssue(true)}>{t('giftCards.issueButton')}</Button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>{t('giftCards.loading')}</p>
      ) : cards.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>{t('giftCards.empty')}</p>
      ) : (
        <Table columns={columns} data={cards} rowId={(c: payApi.GiftCard) => c.id} />
      )}

      {showIssue && (
        <IssueGiftCardModal
          businessId={businessId}
          onClose={() => setShowIssue(false)}
          onIssued={(code) => { setShowIssue(false); setMessage(t('giftCards.issued', { code })); load(); }}
        />
      )}

      {detail && <GiftCardDetailModal card={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function IssueGiftCardModal({ businessId, onClose, onIssued }: {
  businessId: string; onClose: () => void; onIssued: (code: string) => void;
}) {
  const { t } = useTranslation('offerings');
  const [amount, setAmount] = useState(0);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (amount <= 0) { setError(t('giftCards.amountInvalid')); return; }
    setBusy(true); setError(null);
    try {
      const card = await payApi.createGiftCard({
        business_id: businessId, amount,
        recipient_name: recipientName || null, recipient_email: recipientEmail || null,
        expires_at: expiresAt || null,
      });
      onIssued(card.code);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('giftCards.issueFailed'));
    } finally { setBusy(false); }
  };

  const field: React.CSSProperties = { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%' };

  return (
    <Modal open onClose={onClose} title={t('giftCards.issueButton')}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
        <Button loading={busy} disabled={amount <= 0} onClick={submit}>{t('giftCards.issue')}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          {t('giftCards.issueHelp')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('giftCards.amount')} <span style={{ color: 'var(--color-error)' }}>*</span></label>
          <CurrencyInput value={amount} onChange={setAmount} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('giftCards.recipientName')}</label>
          <input style={field} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder={t('giftCards.optional')} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('giftCards.recipientEmail')}</label>
          <input style={field} value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder={t('giftCards.optionalEmails')} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('giftCards.expires')}</label>
          <input type="date" style={field} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}

function GiftCardDetailModal({ card, onClose }: { card: payApi.GiftCard; onClose: () => void }) {
  const { t } = useTranslation('offerings');
  return (
    <Modal open onClose={onClose} title={t('giftCards.detailTitle', { code: card.code })}
      footer={<Button variant="outline" onClick={onClose}>{t('giftCards.close')}</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('giftCards.balance')}</span>
          <strong>{t('giftCards.balanceOf', { balance: formatCurrency(card.balance_cents, card.currency), total: formatCurrency(card.initial_amount_cents, card.currency) })}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{t('shared.status')}</span>
          <Badge variant={STATUS_VARIANT[card.status] || 'neutral'}>{t(`giftCards.status.${card.status}`, { defaultValue: card.status })}</Badge>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px' }}>{t('giftCards.redemptionHistory')}</h4>
          {!card.redemptions || card.redemptions.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>{t('giftCards.noRedemptions')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {card.redemptions.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--color-border)', padding: '4px 0' }}>
                  <span>{formatDateTime(r.created_at)}</span>
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
