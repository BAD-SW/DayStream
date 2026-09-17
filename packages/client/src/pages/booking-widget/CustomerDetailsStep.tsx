import { FormEvent, useState } from 'react';
import { WidgetCustomer } from '../../api/widget';

interface Props {
  customer: WidgetCustomer;
  isReturning: boolean;
  onContinue: (phone: string) => void;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}

export function CustomerDetailsStep({ customer, isReturning, onContinue, loading, error, onBack }: Props) {
  const [phone, setPhone] = useState(customer.phone || '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onContinue(phone);
  }

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">Your details</h2>
      {isReturning && <p className="dsw-step-notice">Welcome back, {customer.first_name}!</p>}

      <form onSubmit={handleSubmit} className="dsw-form">
        <div className="dsw-field-row">
          <div className="dsw-field">
            <label className="dsw-label">Name</label>
            <input className="dsw-input" value={`${customer.first_name} ${customer.last_name}`} disabled />
          </div>
          <div className="dsw-field">
            <label className="dsw-label">Email</label>
            <input className="dsw-input" value={customer.email} disabled />
          </div>
        </div>

        <div className="dsw-field">
          <label className="dsw-label" htmlFor="phone">Phone</label>
          <input
            id="phone"
            type="tel"
            className="dsw-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+34 600 000 000"
          />
        </div>

        {error && <p className="dsw-step-error">{error}</p>}

        <button type="submit" className="dsw-btn dsw-btn--primary" disabled={loading}>
          {loading ? 'Please wait…' : 'Continue'}
        </button>
      </form>

      <button type="button" className="dsw-btn dsw-btn--ghost" onClick={onBack} disabled={loading}>Back</button>
    </div>
  );
}
