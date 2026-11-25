import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('widget');
  return (
    <div className="dsw-step dsw-step--confirmation">
      <div className="dsw-confirmation-icon">✓</div>
      <h2 className="dsw-step-title">{purchase.kind === 'package' ? t('purchase.packageTitle') : t('purchase.membershipTitle')}</h2>
      <p className="dsw-step-text">
        {purchase.kind === 'package'
          ? t('purchase.packageMessage')
          : t('purchase.membershipMessage')}
      </p>

      <div className="dsw-confirmation-card">
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{purchase.kind === 'package' ? t('purchase.package') : t('purchase.plan')}</span>
          <span>{purchase.name}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('purchase.price')}</span>
          <span>{formatMoney(purchase.price)}{purchase.billingFrequency ? ` / ${purchase.billingFrequency}` : ''}</span>
        </div>
        <div className="dsw-confirmation-row">
          <span className="dsw-label">{t('purchase.status')}</span>
          <span>{purchase.status === 'active' ? t('purchase.active') : t('purchase.pending')}</span>
        </div>
      </div>

      <button className="dsw-btn dsw-btn--primary" onClick={() => sendToParent('daystream:close')}>{t('purchase.done')}</button>
    </div>
  );
}
