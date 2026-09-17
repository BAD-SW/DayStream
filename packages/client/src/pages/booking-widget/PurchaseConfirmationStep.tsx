import { PurchaseResult } from './types';
import { formatMoney } from './format';
import { sendToParent } from './postMessage';

interface Props {
  purchase: PurchaseResult;
}

/** Requirement 18.5 — package: name + status; membership: plan name, billing interval,
 * price per interval. Sessions actually booked later through the business's existing
 * flow (Requirement 18.7) — nothing to schedule here. */
export function PurchaseConfirmationStep({ purchase }: Props) {
  return (
    <div className="dsw-step dsw-step--confirmation">
      <div className="dsw-confirmation-icon">✓</div>
      <h2 className="dsw-step-title">{purchase.kind === 'package' ? 'Purchase confirmed' : 'Enrollment confirmed'}</h2>
      <p className="dsw-step-text">
        {purchase.kind === 'package'
          ? "You're all set — the business will help you schedule your sessions."
          : "You're all set — your membership is active."}
      </p>

      <div className="dsw-confirmation-card">
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{purchase.kind === 'package' ? 'Package' : 'Plan'}</span>
          <span>{purchase.name}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Price</span>
          <span>{formatMoney(purchase.price)}{purchase.billingFrequency ? ` / ${purchase.billingFrequency}` : ''}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">Status</span>
          <span>{purchase.status === 'active' ? 'Active' : 'Pending'}</span>
        </div>
      </div>

      <button className="dsw-btn dsw-btn--primary" onClick={() => sendToParent('daystream:close')}>Done</button>
    </div>
  );
}
