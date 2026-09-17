import { FormEvent, useState } from 'react';
import { WidgetBooking } from '../../api/widget';
import { formatMoney } from './format';

interface Props {
  booking: WidgetBooking;
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

export function PaymentStep({ booking, amountCents, onPay, loading, error }: Props) {
  const [cardholder, setCardholder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const digits = cardNumber.replace(/\s/g, '');
    if (digits.length !== 16) { setFormError('Card number must be 16 digits'); return; }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) { setFormError('Expiry must be in MM/YY format'); return; }
    const [mm] = expiry.split('/').map(Number);
    if (mm < 1 || mm > 12) { setFormError('Expiry month must be between 01 and 12'); return; }
    if (!/^\d{3,4}$/.test(cvc)) { setFormError('CVC must be 3 or 4 digits'); return; }
    if (!cardholder.trim()) { setFormError('Cardholder name is required'); return; }

    onPay();
  }

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">Payment</h2>
      <p className="dsw-step-notice">Test / demo environment — no real card data is transmitted or stored.</p>

      <div className="dsw-summary">
        <span>{booking.service_name}</span>
        <span className="dsw-price">{formatMoney(amountCents)}</span>
      </div>

      <form onSubmit={handleSubmit} className="dsw-form">
        <div className="dsw-field">
          <label className="dsw-label" htmlFor="cardholder">Cardholder name</label>
          <input id="cardholder" className="dsw-input" value={cardholder} onChange={(e) => setCardholder(e.target.value)} required />
        </div>

        <div className="dsw-field">
          <label className="dsw-label" htmlFor="card_number">Card number</label>
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
            <label className="dsw-label" htmlFor="expiry">Expiry (MM/YY)</label>
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
            <label className="dsw-label" htmlFor="cvc">CVC</label>
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
          {loading ? 'Processing…' : `Pay ${formatMoney(amountCents)}`}
        </button>
      </form>
    </div>
  );
}
