import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from './format';

interface Props {
  itemName: string;
  amountCents: number;
  onPay: () => void;
  loading: boolean;
  error: string | null;
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function PaymentStep({ itemName, amountCents, onPay, loading, error }: Props) {
  const { t } = useTranslation('widget');
  const [cardholder, setCardholder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const digits = cardNumber.replace(/\s/g, '');
    if (digits.length !== 16) { setFormError(t('payment.errors.cardNumber')); return; }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) { setFormError(t('payment.errors.expiryFormat')); return; }
    const [mm] = expiry.split('/').map(Number);
    if (mm < 1 || mm > 12) { setFormError(t('payment.errors.expiryMonth')); return; }
    if (!/^\d{3,4}$/.test(cvc)) { setFormError(t('payment.errors.cvc')); return; }
    if (!cardholder.trim()) { setFormError(t('payment.errors.cardholder')); return; }

    onPay();
  }

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">{t('payment.title')}</h2>
      <p className="dsw-step-notice">{t('payment.demoNotice')}</p>

      <div className="dsw-summary">
        <span>{itemName}</span>
        <span className="dsw-price">{formatMoney(amountCents)}</span>
      </div>

      <form onSubmit={handleSubmit} className="dsw-form">
        <div className="dsw-field">
          <label className="dsw-label" htmlFor="cardholder">{t('payment.cardholder')}</label>
          <input id="cardholder" className="dsw-input" value={cardholder} onChange={(e) => setCardholder(e.target.value)} required />
        </div>

        <div className="dsw-field">
          <label className="dsw-label" htmlFor="card_number">{t('payment.cardNumber')}</label>
          <input
            id="card_number"
            className="dsw-input"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            placeholder="4242 4242 4242 4242"
            inputMode="numeric"
            required
          />
        </div>

        <div className="dsw-field-row">
          <div className="dsw-field">
            <label className="dsw-label" htmlFor="expiry">{t('payment.expiry')}</label>
            <input
              id="expiry"
              className="dsw-input"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              placeholder="12/29"
              inputMode="numeric"
              required
            />
          </div>
          <div className="dsw-field">
            <label className="dsw-label" htmlFor="cvc">{t('payment.cvc')}</label>
            <input
              id="cvc"
              className="dsw-input"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="123"
              inputMode="numeric"
              required
            />
          </div>
        </div>

        {(formError || error) && <p className="dsw-step-error">{formError || error}</p>}

        <button type="submit" className="dsw-btn dsw-btn--primary" disabled={loading}>
          {loading ? t('payment.processing') : t('payment.pay', { amount: formatMoney(amountCents) })}
        </button>
      </form>
    </div>
  );
}
